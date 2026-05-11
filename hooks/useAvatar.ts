import { useRef, useCallback, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import {
  setAvatarReady,
  setConnectionStatus,
  setIsAvatarProcessing,
  setVideoUrl,
  setStreamSession,
  setUseTTSFallback,
  setError as setGlobalError,
  setSystemState,
  recordAvatarStartLagMs,
  bumpAvatarSegmentStartCount,
} from '@/lib/store/appSlice';
import { 
  useCreateStreamSessionMutation,
  useSubmitIceCandidateMutation,
  useSubmitSdpAnswerMutation,
  useSubmitTalkMutation,
  useCloseStreamSessionMutation
} from '@/lib/store/apiSlice';
import { toast } from 'sonner';
import { store } from '@/lib/store/store';
import { PerfLogger } from '@/lib/perf-logger';

/**
 * useAvatar
 * Manages D-ID WebRTC streaming session with robust error handling and retry logic.
 * Handles peer connection setup, track attachment, and talk submission.
 * 
 * LATENCY OPTIMIZATION:
 * - speak() submits talk request and returns immediately after HTTP 200 (~400ms)
 * - Does NOT wait for talk/started DataChannel event (was blocking 2-3s per sentence)
 * - DataChannel events are used ONLY for UI state updates (speaking indicator)
 * - D-ID queues multiple talk requests internally per stream session
 */

const MAX_CONNECTION_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const AVATAR_READY_WAIT_MAX_MS = 600;
const TALK_RETRY_BASE_DELAY_MS = 200;
// Module-level lock — prevents concurrent connect() calls across React Strict Mode remounts
let globalIsConnecting = false;

export function useAvatar() {
  const dispatch = useAppDispatch();
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const isConnectingRef = useRef(false);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  // Some browsers may deliver ontrack events with event.streams = []
  // (Unified Plan / transceiver behavior). We assemble our own inbound stream
  // from tracks to ensure the <video> always gets a valid MediaStream.
  const inboundStreamRef = useRef<MediaStream | null>(null);
  const connectionRetriesRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks how many talk segments are pending (submitted but not yet ended)
  const pendingTalkSegmentsRef = useRef(0);
  // Best-effort latency measurement (FIFO): when talk is accepted, enqueue timestamp.
  // When D-ID signals stream/started, dequeue and compute delta.
  const talkAcceptedAtQueueRef = useRef<number[]>([]);
  // Tracks how many segments were in-flight when clearQueue() was called (interrupted).
  // stream/done events for these are absorbed here so they don't corrupt the new
  // response's pendingTalkSegmentsRef counter.
  const abandonedSegmentsRef = useRef(0);

  const [createSession] = useCreateStreamSessionMutation();
  const [submitIce] = useSubmitIceCandidateMutation();
  const [submitSdp] = useSubmitSdpAnswerMutation();
  const [submitTalk] = useSubmitTalkMutation();
  const [closeSession] = useCloseStreamSessionMutation();
  
  const { streamId, sessionId, videoUrl, isAvatarProcessing } = useAppSelector(state => state.app);

  useEffect(() => { streamIdRef.current = streamId; }, [streamId]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  const clearQueue = useCallback(() => {
    const inFlight = pendingTalkSegmentsRef.current;
    console.log(`[WebRTC] Clearing pending segments (${inFlight} abandoned, ${abandonedSegmentsRef.current} already waiting)`);
    // Move in-flight segments to abandoned so their stream/done events are ignored
    abandonedSegmentsRef.current += inFlight;
    pendingTalkSegmentsRef.current = 0;
    talkAcceptedAtQueueRef.current = [];
    dispatch(setIsAvatarProcessing(false));
    dispatch(setSystemState('idle'));
  }, [dispatch]);

  const disconnect = useCallback(async () => {
    const sid = streamIdRef.current;
    const sessId = sessionIdRef.current;
    
    clearQueue();
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (sid && sessId) {
      try {
        await closeSession({ streamId: sid, sessionId: sessId }).unwrap();
      } catch (e) {
        console.warn('[WebRTC] Failed to close session on server:', e);
      }
    }
    
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    
    dataChannelRef.current = null;
    streamIdRef.current = null;
    sessionIdRef.current = null;
    isConnectingRef.current = false;
    globalIsConnecting = false;
    dispatch(setStreamSession({ streamId: null, sessionId: null }));
    dispatch(setVideoUrl(null));
    dispatch(setAvatarReady(false));
    dispatch(setConnectionStatus('disconnected'));
  }, [closeSession, dispatch, clearQueue]);

  const connect = useCallback(async () => {
    if (peerConnection.current || isConnectingRef.current || globalIsConnecting) {
      console.log('[WebRTC] Connection already in progress or established');
      return;
    }

    isConnectingRef.current = true;
    globalIsConnecting = true;
    const tPerf = PerfLogger.start('webrtc-connect');
    
    try {
      PerfLogger.mark(tPerf, 'create-session-start');
      clearQueue();
      
      const session = await createSession().unwrap();
      PerfLogger.mark(tPerf, 'session-created', { streamId: session.id });
      
      const pc = new RTCPeerConnection({ iceServers: session.ice_servers });
      peerConnection.current = pc;
      
      // ── DataChannel for D-ID synchronization events ──────────────────────
      const dc = pc.createDataChannel('Janus');
      dataChannelRef.current = dc;

      dc.onopen = () => console.log('[WebRTC] DataChannel opened');
      dc.onclose = () => {
        console.log('[WebRTC] DataChannel closed — D-ID ended the stream session');
        // Reset processing state so the UI doesn't get stuck
        dispatch(setIsAvatarProcessing(false));
        if (store.getState().app.systemState === 'speaking') {
          dispatch(setSystemState('idle'));
        }
      };

      dc.onmessage = (event) => {
        try {
          const data = event.data as string;
          console.log('[WebRTC] DataChannel:', data);

          // D-ID sends "type:payload" or bare "type"
          const type = data.includes(':') ? data.substring(0, data.indexOf(':')) : data;

          if (type === 'talk/started' || type === 'stream/started') {
            // Avatar is now speaking — update UI state only
            console.log(`[WebRTC] ▶ Avatar started speaking (${type})`);
            const turnMetrics = ((window as any).__avatarTurnMetrics ?? {}) as Record<string, number>;
            if (!turnMetrics.avatarStartedAt) {
              turnMetrics.avatarStartedAt = Date.now();
              (window as any).__avatarTurnMetrics = turnMetrics;
              const micToTranscript = turnMetrics.transcriptionDoneAt && turnMetrics.micOffAt
                ? turnMetrics.transcriptionDoneAt - turnMetrics.micOffAt
                : null;
              const transcriptToFirstChunk = turnMetrics.llmFirstChunkAt && turnMetrics.transcriptionDoneAt
                ? turnMetrics.llmFirstChunkAt - turnMetrics.transcriptionDoneAt
                : null;
              const firstChunkToAvatarSubmit = turnMetrics.firstAvatarSubmitAt && turnMetrics.llmFirstChunkAt
                ? turnMetrics.firstAvatarSubmitAt - turnMetrics.llmFirstChunkAt
                : null;
              const submitToAvatarStart = turnMetrics.avatarStartedAt && turnMetrics.firstAvatarSubmitAt
                ? turnMetrics.avatarStartedAt - turnMetrics.firstAvatarSubmitAt
                : null;
              const totalMicToAvatar = turnMetrics.avatarStartedAt && turnMetrics.micOffAt
                ? turnMetrics.avatarStartedAt - turnMetrics.micOffAt
                : null;
              console.log('[Latency] Turn breakdown', {
                micToTranscript,
                transcriptToFirstChunk,
                firstChunkToAvatarSubmit,
                submitToAvatarStart,
                totalMicToAvatar,
              });
            }
            const acceptedAt = talkAcceptedAtQueueRef.current.shift();
            if (acceptedAt) {
              const lagMs = Date.now() - acceptedAt;
              console.log(`[WebRTC] ⏱ talk-accepted → ${type}: ${lagMs}ms`);
              dispatch(recordAvatarStartLagMs(lagMs));
            }
            dispatch(bumpAvatarSegmentStartCount());
            dispatch(setSystemState('speaking'));
          } else if (type === 'talk/ended' || type === 'stream/ended' || type === 'stream/done') {
            // Check if this event belongs to an abandoned (interrupted) segment
            if (abandonedSegmentsRef.current > 0) {
              abandonedSegmentsRef.current--;
              console.log(`[WebRTC] ⏭ Ignored stale segment event (${type}). Abandoned remaining: ${abandonedSegmentsRef.current}`);
            } else {
              // One current segment finished — D-ID may send either 'stream/done' or 'stream/ended'
              pendingTalkSegmentsRef.current = Math.max(0, pendingTalkSegmentsRef.current - 1);
              console.log(`[WebRTC] ⏹ Avatar segment ended (${type}). Remaining: ${pendingTalkSegmentsRef.current}`);
              if (pendingTalkSegmentsRef.current === 0) {
                dispatch(setIsAvatarProcessing(false));
                dispatch(setSystemState('idle'));
              }
            }
          } // end else-if talk/ended|stream/done
        } catch (e) {
          console.warn('[WebRTC] Error handling DataChannel message:', e);
        }
      };

      dispatch(setStreamSession({ streamId: session.id, sessionId: session.session_id }));
      
      // ── ICE candidates ──────────────────────────────────────────────────
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          submitIce({
            streamId: session.id,
            sessionId: session.session_id,
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid!,
            sdpMLineIndex: event.candidate.sdpMLineIndex!,
          });
        }
      };

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        console.log(`[WebRTC] ICE state: ${state}`);
        if (state === 'connected' || state === 'completed') {
          PerfLogger.mark(tPerf, 'ice-connected');
          PerfLogger.end(tPerf, 'ready to speak');
          dispatch(setAvatarReady(true));
          dispatch(setConnectionStatus('good'));
          isConnectingRef.current = false;
          globalIsConnecting = false;
          connectionRetriesRef.current = 0;
        } else if (state === 'disconnected') {
          // D-ID may drop the peer connection after a session ends or during idle.
          // Wait 4s and reconnect if still disconnected (not just a transient blip).
          console.warn('[WebRTC] ICE disconnected — waiting 4s before reconnect...');
          dispatch(setConnectionStatus('poor'));
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }
          reconnectTimeoutRef.current = setTimeout(() => {
            const currentState = peerConnection.current?.iceConnectionState;
            if (currentState === 'disconnected' || currentState === 'failed' || !peerConnection.current) {
              console.log('[WebRTC] ICE still disconnected — triggering reconnect');
              dispatch(setAvatarReady(false));
              disconnect().then(() => connect());
            }
          }, 4000);
        } else if (state === 'failed') {
          console.error('[WebRTC] ICE FAILED');
          if (connectionRetriesRef.current < MAX_CONNECTION_RETRIES) {
            connectionRetriesRef.current++;
            const delay = RETRY_DELAY_MS * Math.pow(2, connectionRetriesRef.current - 1);
            console.log(`[WebRTC] Retrying ICE in ${delay}ms`);
            if (reconnectTimeoutRef.current) {
              clearTimeout(reconnectTimeoutRef.current);
            }
            reconnectTimeoutRef.current = setTimeout(() => disconnect().then(() => connect()), delay);
          } else {
            disconnect();
            toast.error('Connection failed after multiple attempts. Please refresh.');
          }
        }
      };

      pc.ontrack = (event) => {
        const kind = event.track.kind;

        // ── Latency tuning (best-effort, browser-dependent) ────────────────
        // Helps reduce "audio leads video" lip-sync lag from jitter buffering.
        try {
          const receiverAny = event.receiver as any;
          if (receiverAny && 'playoutDelayHint' in receiverAny) {
            receiverAny.playoutDelayHint = 0;
          }
          if (receiverAny && 'jitterBufferTarget' in receiverAny) {
            receiverAny.jitterBufferTarget = 20; // ms
          }
        } catch {
          // ignore – purely an optimization
        }

        // Prefer browser-provided stream when present; otherwise build our own
        const browserStream = event.streams?.[0] ?? null;
        const stream = browserStream ?? inboundStreamRef.current ?? new MediaStream();
        if (!browserStream && !inboundStreamRef.current) inboundStreamRef.current = stream;

        // Ensure the current track is part of the stream (safe even if already added)
        try {
          if (!stream.getTracks().some((t) => t.id === event.track.id)) {
            stream.addTrack(event.track);
          }
        } catch (e) {
          console.warn('[WebRTC] Failed to add track to stream:', e);
        }

        console.log(`[WebRTC] 📡 Track received (${kind}) — tracks now:`, stream.getTracks().map(t => t.kind).join(','));

        // Store globally so AvatarPlayer can re-attach on remount
        (window as any).avatarStream = stream;

        const el = videoElementRef.current;
        if (el) {
          if (el.srcObject !== stream) {
            el.srcObject = stream;
          }
          // Explicitly call play() — autoplay policy may block without this
          el.play()
            .then(() => console.log('[WebRTC] ✅ Stream playing'))
            .catch((e) => console.error('[WebRTC] play() rejected:', e));
        } else {
          console.error('[WebRTC] videoElementRef.current is NULL — stream cannot attach');
        }

        // Only flip UI "show video" once we have a video track
        if (kind === 'video') dispatch(setVideoUrl('webrtc-stream'));
      };

      // ── SDP negotiation ────────────────────────────────────────────────
      await pc.setRemoteDescription(new RTCSessionDescription(session.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await submitSdp({ streamId: session.id, sessionId: session.session_id, answer }).unwrap();
      console.log(`[WebRTC] SDP exchanged — waiting for ICE...`);
      
    } catch (err: any) {
      isConnectingRef.current = false;
      globalIsConnecting = false;
      console.error('[WebRTC] Connection error:', err);
      
      // Check for specific session limit error from our API
      const isMaxSessions = err?.data?.error === 'MAX_SESSIONS' || (typeof err?.data === 'string' && err.data.includes('Max user sessions reached'));
      
      if (isMaxSessions) {
        dispatch(setGlobalError({ 
          message: 'D-ID session limit reached. Please close other browser tabs and wait a few moments.', 
          code: 'MAX_SESSIONS' 
        }));
        toast.error('Too many active sessions. Please close other tabs.', { duration: 5000 });
        return; // Don't auto-retry on max sessions, let the user decide
      }

      if (connectionRetriesRef.current < MAX_CONNECTION_RETRIES) {
        connectionRetriesRef.current++;
        const retryDelay = RETRY_DELAY_MS * Math.pow(2, connectionRetriesRef.current - 1);
        console.log(`[WebRTC] Retrying in ${retryDelay}ms`);
        setTimeout(() => connect(), retryDelay);
      } else {
        dispatch(setGlobalError({ message: 'Failed to connect to avatar service', code: 'WEBRTC_ERROR' }));
        toast.error('Avatar connection failed. Please refresh and try again.');
      }
    }
  }, [createSession, submitIce, submitSdp, dispatch, disconnect, clearQueue]);

  /**
   * speak() — OPTIMIZED for low latency
   * 
   * BEFORE: awaited talkStartedPromise (2-3s per sentence blocking)
   * AFTER:  submits talk request and returns after HTTP 200 (~400ms)
   * 
   * D-ID queues talk segments internally per stream session.
   * DataChannel events update UI state asynchronously.
   */
  const speak = useCallback(async (text: string) => {
    const tPerf = PerfLogger.start('avatar-speak');
    PerfLogger.mark(tPerf, 'speak-initiated', { text: text.substring(0, 40) });

    // ── Ensure connection exists ───────────────────────────────────────────
    if (!streamIdRef.current || !sessionIdRef.current) {
      console.warn('[WebRTC] No active session — connecting before speaking...');
      await connect();
      
      // Keep this wait short so reconnect does not block first response segment.
      // talk retries below handle transient readiness races safely.
      let waited = 0;
      while (!store.getState().app.isAvatarReady && waited < AVATAR_READY_WAIT_MAX_MS) {
        await new Promise(r => setTimeout(r, 100));
        waited += 100;
      }
      console.log(`[WebRTC] ⏱ Waited ${waited}ms for ICE readiness`);
    }
    
    const sId = streamIdRef.current;
    const sessId = sessionIdRef.current;
    if (!sId || !sessId) {
      console.error('[WebRTC] Cannot speak — no session after connect attempt');
      return;
    }

    // ── Submit talk request (fire and move on) ────────────────────────────
    let retries = 0;
    const MAX_TALK_RETRIES = 2;

    const attemptTalk = async (): Promise<void> => {
      try {
        PerfLogger.mark(tPerf, 'talk-request-sent');
        await submitTalk({ streamId: sId, sessionId: sessId, text }).unwrap();
        PerfLogger.mark(tPerf, 'talk-request-accepted');
        talkAcceptedAtQueueRef.current.push(Date.now());
        
        pendingTalkSegmentsRef.current++;
        dispatch(setIsAvatarProcessing(true));
        PerfLogger.end(tPerf, 'handoff to D-ID queue');
      } catch (err: any) {
        if (retries < MAX_TALK_RETRIES) {
          retries++;
          const delay = TALK_RETRY_BASE_DELAY_MS * retries;
          console.warn(`[WebRTC] talk failed, retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          return attemptTalk();
        }
        throw err;
      }
    };

    try {
      await attemptTalk();
      // Return immediately — caller (useChat processQueue) moves to next sentence
      // D-ID plays segments in order internally
    } catch (err: any) {
      console.error('[WebRTC] Talk error after retries:', err);
      
      let errorData: any = {};
      try {
        errorData = err?.data?.error ? JSON.parse(err.data.error) : {};
      } catch {}
      
      if (err?.status === 402 || errorData?.kind === 'InsufficientCreditsError') {
        toast.error('Insufficient D-ID credits — switching to voice-only mode.', { duration: 5000 });
        dispatch(setUseTTSFallback(true));
      } else {
        toast.error('Failed to send text to avatar');
      }
      dispatch(setIsAvatarProcessing(false));
    }
  }, [submitTalk, connect, dispatch]);

  // Graceful cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Send beacon on tab close
  useEffect(() => {
    const handleUnload = () => {
      const sid = streamIdRef.current;
      const sessId = sessionIdRef.current;
      if (sid && sessId) {
        navigator.sendBeacon(
          '/api/avatar/stream/close',
          new Blob([JSON.stringify({ streamId: sid, sessionId: sessId })], { type: 'application/json' })
        );
        peerConnection.current?.close();
        peerConnection.current = null;
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, []);

  return { videoUrl, isProcessing: isAvatarProcessing, connect, speak, disconnect, clearQueue, videoElementRef };
}
