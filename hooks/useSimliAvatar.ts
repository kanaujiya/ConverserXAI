'use client';

import { useRef, useCallback, useEffect } from 'react';
import { useAppDispatch } from '@/lib/store/hooks';
import {
  setSystemState,
  setAvatarReady,
  setConnectionStatus,
  setVideoUrl,
  setError as setGlobalError,
} from '@/lib/store/appSlice';
import { SimliClient, LogLevel } from 'simli-client';
import { toast } from 'sonner';

const RECONNECT_MAX_ATTEMPTS = 5;
const RECONNECT_INITIAL_DELAY_MS = 1000;
const CONNECTION_TIMEOUT_MS = 15000;
const HEARTBEAT_INTERVAL_MS = 30000;

export function useSimliAvatar() {
  const dispatch = useAppDispatch();
  const simliRef = useRef<SimliClient | null>(null);
  const isConnectingRef = useRef(false);
  const reconnectCountRef = useRef(0);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Exposed so AvatarPlayer can register its <video> and <audio> elements
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  /**
   * Setup connection monitoring and heartbeat
   */
  const setupConnectionMonitoring = useCallback((client: SimliClient) => {
    console.log('[Simli] Setting up connection monitoring');

    // Heartbeat to keep connection alive
    if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);

    heartbeatIntervalRef.current = setInterval(() => {
      try {
        // Send dummy audio frame to keep connection alive
        const dummyFrame = new Uint8Array(1024);
        client.sendAudioData(dummyFrame);
      } catch (error) {
        console.warn('[Simli] Heartbeat failed:', error);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }, []);

  /**
   * Cleanup connection monitoring
   */
  const cleanupConnectionMonitoring = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }

    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
  }, []);

  const disconnect = useCallback(async () => {
    console.log('[Simli] Disconnecting');
    cleanupConnectionMonitoring();

    if (simliRef.current) {
      try {
        await simliRef.current.stop();
      } catch (error) {
        console.warn('[Simli] Error stopping client:', error);
      }
      simliRef.current = null;
    }

    dispatch(setAvatarReady(false));
    dispatch(setVideoUrl(null));
    dispatch(setConnectionStatus('disconnected'));
    dispatch(setSystemState('idle'));
  }, [cleanupConnectionMonitoring, dispatch]);

  /**
   * Attempt reconnection with exponential backoff
   */
  const attemptReconnect = useCallback(async () => {
    if (reconnectCountRef.current >= RECONNECT_MAX_ATTEMPTS) {
      console.error('[Simli] Max reconnection attempts reached');
      dispatch(setConnectionStatus('disconnected'));
      dispatch(setGlobalError({
        message: 'Avatar connection failed. Please refresh and try again.',
        code: 'AVATAR_RECONNECT_FAILED',
      }));
      return;
    }

    reconnectCountRef.current++;
    const delayMs = RECONNECT_INITIAL_DELAY_MS * Math.pow(2, reconnectCountRef.current - 1);

    console.log(`[Simli] Reconnecting (attempt ${reconnectCountRef.current}/${RECONNECT_MAX_ATTEMPTS}) in ${delayMs}ms`);

    setTimeout(async () => {
      try {
        await connect();
        reconnectCountRef.current = 0; // Reset on successful connection
      } catch (error) {
        console.error('[Simli] Reconnection attempt failed:', error);
        await attemptReconnect();
      }
    }, delayMs);
  }, [dispatch]);

  const connect = useCallback(async () => {
    if (simliRef.current || isConnectingRef.current) {
      console.log('[Simli] Already connecting or connected');
      return;
    }

    const videoEl = videoElementRef.current;
    const audioEl = audioElementRef.current;

    if (!videoEl || !audioEl) {
      console.warn(`[Simli] Video/Audio elements not yet mounted. Video: ${!!videoEl}, Audio: ${!!audioEl}`);
      return;
    }

    isConnectingRef.current = true;
    console.log('[Simli] Starting connection process...');
    dispatch(setConnectionStatus('disconnected'));

    try {
      // Set connection timeout
      connectionTimeoutRef.current = setTimeout(() => {
        console.error('[Simli] Connection timeout');
        disconnect();
        attemptReconnect();
      }, CONNECTION_TIMEOUT_MS);

      // Fetch session token and ICE servers from backend
      const res = await fetch('/api/simli/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        throw new Error(`Session fetch failed: ${res.status}`);
      }

      const { session_token, ice_servers } = await res.json();

      const finalIceServers = ice_servers && ice_servers.length > 0
        ? ice_servers
        : [{ urls: ['stun:stun.l.google.com:19302'] }];

      console.log('[Simli] Initializing with ICE servers:', finalIceServers);

      const client = new SimliClient(
        session_token,
        videoEl,
        audioEl,
        finalIceServers,
        LogLevel.INFO,
        'livekit'
      );

      // Setup event handlers with proper error handling
      client.on('start', () => {
        console.log('[Simli] WebRTC connected');
        if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
        reconnectCountRef.current = 0;
        dispatch(setAvatarReady(true));
        dispatch(setConnectionStatus('good'));
        dispatch(setVideoUrl('simli-stream'));
        setupConnectionMonitoring(client);
      });

      client.on('speaking', () => {
        console.log('[Simli] Avatar speaking');
        dispatch(setSystemState('speaking'));
      });

      client.on('silent', () => {
        console.log('[Simli] Avatar silent');
        dispatch(setSystemState('idle'));
      });

      client.on('error', (msg: string) => {
        console.error('[Simli] Error:', msg);
        dispatch(setGlobalError({ message: 'Simli connection error: ' + msg, code: 'SIMLI_ERROR' }));
        
        // Attempt reconnection on non-critical errors
        if (!msg.includes('QUOTA') && !msg.includes('UNAUTHORIZED')) {
          attemptReconnect();
        }
      });

      client.on('startup_error', (msg: string) => {
        console.error('[Simli] Startup error:', msg);
        toast.error(`Simli failed to start: ${msg}`);
        dispatch(setConnectionStatus('disconnected'));
        attemptReconnect();
      });

      client.on('stop', () => {
        console.log('[Simli] Session ended');
        cleanupConnectionMonitoring();
        dispatch(setAvatarReady(false));
        dispatch(setConnectionStatus('disconnected'));
      });

      simliRef.current = client;

      // Handle autoplay policy
      try {
        await client.start();
      } catch (startErr: any) {
        if (startErr.name === 'NotAllowedError' || startErr.message?.includes('autoplay')) {
          console.warn('[Simli] Autoplay blocked. User interaction required.');
          toast.info('Click anywhere to enable avatar audio/video');
          
          // One-time listener for user interaction
          const startOnInteract = async () => {
            try {
              await client.start();
            } catch (err) {
              console.error('[Simli] Start on interact failed:', err);
              attemptReconnect();
            }
            window.removeEventListener('click', startOnInteract);
          };

          window.addEventListener('click', startOnInteract);
        } else {
          throw startErr;
        }
      }
    } catch (err: any) {
      console.error('[Simli] Connect error:', err);
      dispatch(setGlobalError({ message: 'Failed to connect to Simli: ' + err.message, code: 'SIMLI_ERROR' }));
      toast.error('Avatar connection failed');
      attemptReconnect();
    } finally {
      isConnectingRef.current = false;
      if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
    }
  }, [dispatch, setupConnectionMonitoring, cleanupConnectionMonitoring, attemptReconnect, disconnect]);

  /**
   * Generate TTS with fallback and error handling
   */
  const speak = useCallback(async (text: string) => {
    if (!simliRef.current) {
      console.log('[Simli] Client not ready, attempting connection');
      await connect();
    }

    if (!simliRef.current) {
      console.error('[Simli] Client unavailable after connection attempt');
      throw new Error('Avatar client not available');
    }

    try {
      console.log(`[Simli] Fetching TTS for: "${text.substring(0, 30)}..."`);

      const res = await fetch('/api/simli/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        if (res.status === 402 || errJson.isQuota) {
          console.warn('[Simli] Quota limit reached, using fallback TTS');
          toast.warning('Using fallback voice due to quota limits');
          triggerBrowserTTS(text);
          return;
        }
        throw new Error(errJson.error || `TTS failed: ${res.status}`);
      }

      const buf = await res.arrayBuffer();
      const pcm = new Uint8Array(buf);
      const duration = res.headers.get('X-Audio-Duration');

      console.log(`[Simli] Received ${pcm.length} bytes of PCM data. Duration: ${duration}s`);

      // Validate audio payload
      let isSilent = true;
      for (let i = 0; i < Math.min(pcm.length, 1000); i++) {
        if (pcm[i] !== 0) {
          isSilent = false;
          break;
        }
      }

      if (isSilent) {
        console.warn('[Simli] Rejecting silent audio payload');
        triggerBrowserTTS(text);
        return;
      }

      // Send audio in chunks with proper error handling
      const CHUNK_SIZE = 6000;
      let chunksSent = 0;

      for (let offset = 0; offset < pcm.length; offset += CHUNK_SIZE) {
        try {
          simliRef.current?.sendAudioData(pcm.slice(offset, offset + CHUNK_SIZE));
          chunksSent++;
        } catch (error) {
          console.error(`[Simli] Error sending chunk ${chunksSent}:`, error);
          throw error;
        }
      }

      console.log(`[Simli] Successfully sent ${chunksSent} audio chunks`);
    } catch (err: any) {
      console.error('[Simli] Speak error:', err);
      toast.error('Voice generation failed, using fallback');
      triggerBrowserTTS(text);
    }
  }, [connect]);

  /**
   * Browser-based TTS fallback
   */
  const triggerBrowserTTS = (text: string) => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        window.speechSynthesis.speak(utterance);
      } catch (error) {
        console.error('[Simli] Browser TTS error:', error);
      }
    }
  };

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      console.log('[Simli] Unmounting');
      cleanupConnectionMonitoring();
      disconnect();
    };
  }, [cleanupConnectionMonitoring, disconnect]);

  /**
   * Cleanup on page refresh/close
   */
  useEffect(() => {
    const handleUnload = () => {
      if (simliRef.current) {
        try {
          simliRef.current.stop();
        } catch {}
      }
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, []);

  return {
    connect,
    speak,
    disconnect,
    videoElementRef,
    audioElementRef,
  };
}

