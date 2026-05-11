'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useChat } from '@/hooks/useChat';
import { useAppSelector, useAppDispatch } from '@/lib/store/hooks';
import { setSystemState } from '@/lib/store/appSlice';
import { PerfLogger } from '@/lib/perf-logger';
import { Mic, Square, RefreshCw, Loader2, Radio } from 'lucide-react';
import { toast } from 'sonner';
import { AudioWave } from './AudioWave';

// ─── Constants ────────────────────────────────────────────────────────────────
const SILENCE_THRESHOLD = 10;        // RMS below this is "silence"
const SILENCE_DURATION_MS = 1100;    // Base auto-stop; adaptive guard below for early utterances
const TRANSCRIPTION_TIMEOUT_MS = 15_000;  // Reduced from 20s for faster feedback
const VAD_FRAME_INTERVAL = 50;  // Check silence every 50ms for faster detection

// Pick the best supported codec — Opus in WebM is ~80% smaller than raw PCM
function getBestMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

// ─── Component ────────────────────────────────────────────────────────────────
export function VoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  const dispatch = useAppDispatch();
  const { sendMessage, interrupt, isGenerating } = useChat();

  const error = useAppSelector((state) => state.app.error);
  const systemState = useAppSelector((state) => state.app.systemState);
  const hasInteracted = useAppSelector((state) => state.app.hasInteracted);
  const isAvatarReady = useAppSelector((state) => state.app.isAvatarReady);
  const lastUserMessage = useAppSelector((state) => {
    for (let i = state.app.messages.length - 1; i >= 0; i--) {
      const msg = state.app.messages[i];
      if (msg.role === 'user') return msg.content;
    }
    return null;
  });

  // Refs — avoid stale closures and prevent duplicate recordings
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const isRecordingRef = useRef(false);          // Source-of-truth lock for recording state
  const streamRef = useRef<MediaStream | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vadAnalyserRef = useRef<AnalyserNode | null>(null);
  const vadContextRef = useRef<AudioContext | null>(null);
  const vadFrameRef = useRef<number>(0);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const recordingStartedAtRef = useRef<number>(0);

  // ── Cleanup helpers ──────────────────────────────────────────────────────
  const stopVAD = useCallback(() => {
    if (vadFrameRef.current) cancelAnimationFrame(vadFrameRef.current);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (vadContextRef.current) {
      vadContextRef.current.close().catch(() => {});
      vadContextRef.current = null;
    }
    vadAnalyserRef.current = null;
  }, []);

  const releaseStream = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setMediaStream(null);
    }
  }, []);

  // ── VAD: auto-stop when silence detected ────────────────────────────────
  const startVAD = useCallback((stream: MediaStream, onSilence: () => void) => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      vadContextRef.current = ctx;
      vadAnalyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      let silenceStart: number | null = null;

      const check = () => {
        if (!vadAnalyserRef.current) return;
        vadAnalyserRef.current.getByteTimeDomainData(data as any);

        // RMS amplitude
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length) * 100;

        if (rms < SILENCE_THRESHOLD) {
          if (!silenceStart) silenceStart = Date.now();
          else {
            const recordingAgeMs = recordingStartedAtRef.current
              ? Date.now() - recordingStartedAtRef.current
              : 0;
            // Keep a slightly longer silence window at the very start to avoid
            // clipping users who pause briefly while beginning to speak.
            const requiredSilenceMs = recordingAgeMs < 1800 ? 1400 : SILENCE_DURATION_MS;
            if (Date.now() - silenceStart > requiredSilenceMs) {
              onSilence();
              return; // stop RAF loop
            }
          }
        } else {
          silenceStart = null;
        }

        vadFrameRef.current = requestAnimationFrame(check);
      };

      vadFrameRef.current = requestAnimationFrame(check);
    } catch (e) {
      console.warn('[VAD] Failed to start:', e);
    }
  }, []);

  // ── Start recording ──────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    // Lock guard — prevent duplicate recordings
    if (isRecordingRef.current) return;
    isRecordingRef.current = true;

    // If avatar is speaking, interrupt it first
    if (systemState === 'speaking' || systemState === 'waiting' || isGenerating) {
      interrupt();
      // Give the interrupt a frame to settle
      await new Promise((r) => setTimeout(r, 80));
    }

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });

      streamRef.current = stream;
      setMediaStream(stream);

      const mimeType = getBestMimeType();
      const options: MediaRecorderOptions = mimeType
        ? { mimeType, audioBitsPerSecond: 24000 }
        : {};

      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const t = PerfLogger.start('voice-pipeline');
        (window as any).__avatarTurnMetrics = { micOffAt: Date.now() };
        stopVAD();
        const blob = new Blob(chunksRef.current, {
          type: mimeType || 'audio/webm',
        });
        PerfLogger.mark(t, 'blob-created', { sizeKB: Math.round(blob.size / 1024) });

        try {
          setIsTranscribing(true);
          dispatch(setSystemState('thinking'));
          await handleTranscription(blob, mimeType, t);
        } finally {
          setIsTranscribing(false);
          releaseStream();
          PerfLogger.end(t, 'recorder.onstop done');
        }
      };

      recorder.start(150); // collect in 150ms chunks for even lower latency
      recordingStartedAtRef.current = Date.now();
      setIsRecording(true);
      dispatch(setSystemState('listening'));

      // Start VAD — auto-stop when silence detected
      startVAD(stream, () => {
        if (isRecordingRef.current) stopRecordingInternal();
      });
    } catch (err: any) {
      isRecordingRef.current = false;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setMediaStream(null);
      }
      stopVAD();

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        toast.error('Microphone access denied. Please allow microphone permissions and try again.');
      } else if (err.name === 'NotFoundError') {
        toast.error('No microphone found. Please connect a microphone and try again.');
      } else {
        toast.error('Could not access microphone: ' + (err.message || 'Unknown error'));
      }
      dispatch(setSystemState('idle'));
    }
  }, [systemState, isGenerating, interrupt, dispatch, startVAD, stopVAD, releaseStream]);

  // ── Stop recording (internal — does not reset lock yet, onstop does) ────
  const stopRecordingInternal = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop(); // triggers onstop
    }
    stopVAD();
    setIsRecording(false);
    isRecordingRef.current = false;
  }, [stopVAD]);

  // ── Public toggle ────────────────────────────────────────────────────────
  const toggleRecording = useCallback(() => {
    if (isRecordingRef.current) {
      stopRecordingInternal();
    } else {
      startRecording();
    }
  }, [startRecording, stopRecordingInternal]);

  // ── Transcription with timeout & clear errors ────────────────────────────
  const handleTranscription = useCallback(async (blob: Blob, mimeType: string, t?: ReturnType<typeof PerfLogger.start>) => {
    if (blob.size < 1000) {
      toast.error("Recording was too short. Please hold the mic and speak.");
      dispatch(setSystemState('idle'));
      return;
    }

    const abortCtrl = new AbortController();
    transcriptionAbortRef.current = abortCtrl;
    const timeoutId = setTimeout(() => abortCtrl.abort(), TRANSCRIPTION_TIMEOUT_MS);

    try {
      const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
      const formData = new FormData();
      formData.append('file', blob, `recording.${ext}`);

      if (t) PerfLogger.mark(t, 'transcription-fetch-start');
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
        signal: abortCtrl.signal,
      });
      if (t) PerfLogger.mark(t, 'transcription-response-received', { status: response.status });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 422) {
          toast.error("No speech detected. Please speak clearly and try again.");
          dispatch(setSystemState('idle'));
          return;
        }
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error || `Transcription failed (${response.status})`);
      }

      const data = await response.json();
      if (data.text && data.text.trim()) {
        const metrics = ((window as any).__avatarTurnMetrics ?? {}) as Record<string, number>;
        metrics.transcriptionDoneAt = Date.now();
        (window as any).__avatarTurnMetrics = metrics;
        if (t) PerfLogger.mark(t, 'sendMessage-dispatched', { text: data.text.substring(0, 40) });
        sendMessage(data.text.trim());
      } else {
        toast.error("No speech detected. Please speak clearly and try again.");
        dispatch(setSystemState('idle'));
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        toast.error('Transcription timed out. Please check your connection and try again.');
      } else {
        toast.error(err.message || 'Failed to transcribe audio');
      }
      dispatch(setSystemState('idle'));
    } finally {
      transcriptionAbortRef.current = null;
    }
  }, [sendMessage, dispatch]);

  // ── Keyboard shortcut: Esc cancels everything ───────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isRecordingRef.current) stopRecordingInternal();
        transcriptionAbortRef.current?.abort();
        interrupt();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stopRecordingInternal, interrupt]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopVAD();
      releaseStream();
      transcriptionAbortRef.current?.abort();
    };
  }, [stopVAD, releaseStream]);

  // ── Retry last message ───────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    if (lastUserMessage) sendMessage(lastUserMessage);
  }, [lastUserMessage, sendMessage]);

  // ── Derived UI state ─────────────────────────────────────────────────────
  const isProcessing = isTranscribing || isGenerating;
  const isBusy = isProcessing && !isRecording; // disable mic during processing
  const statusLabel = isRecording
    ? 'Listening… tap to stop'
    : isTranscribing
    ? 'Processing speech…'
    : isGenerating
    ? 'AI is responding…'
    : 'Tap the mic and start speaking';

  return (
    <div className="relative max-w-xl mx-auto w-full flex flex-col items-center gap-3">
      {/* Interrupt button — shown while AI is generating */}
      {isGenerating && !isRecording && (
        <button
          onClick={interrupt}
          className="absolute -top-14 right-0 flex items-center gap-1.5 p-2.5 rounded-full bg-red text-white shadow-lg hover:scale-110 transition-transform z-10"
          aria-label="Stop AI (Esc)"
          title="Stop AI (Esc)"
        >
          <Square size={14} fill="currentColor" />
          <span className="text-xs font-medium pr-1">Stop</span>
        </button>
      )}

      {/* Retry button — shown on error */}
      {!isProcessing && error && (
        <button
          onClick={handleRetry}
          className="absolute -top-14 right-0 flex items-center gap-2 px-4 py-2 rounded-full bg-surface border border-border text-xs font-medium text-foreground hover:bg-surface-hover transition-all z-10 shadow-lg"
        >
          <RefreshCw size={14} /> Retry
        </button>
      )}

      {/* Status label + waveform */}
      <div className="w-full flex flex-col items-center gap-1 min-h-[52px] justify-center">
        <span
          className={`text-xs font-medium transition-colors ${
            isRecording
              ? 'text-teal'
              : isTranscribing
              ? 'text-gold'
              : isGenerating
              ? 'text-accent'
              : 'text-muted'
          }`}
        >
          {statusLabel}
        </span>
        <AudioWave isRecording={isRecording} stream={mediaStream} />
      </div>

      {/* Mic / Stop button */}
      <button
        type="button"
        id="voice-recorder-btn"
        onClick={toggleRecording}
        disabled={isBusy || !hasInteracted || !isAvatarReady}
        className={`relative p-5 rounded-full shadow-lg transition-all duration-200 transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 ${
          isRecording
            ? 'bg-red text-white'
            : 'sunset-gradient text-white'
        }`}
        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
      >
        {/* Pulse ring while recording */}
        {isRecording && (
          <span className="absolute inset-0 rounded-full border-2 border-red/50 animate-ping" />
        )}
        {/* Processing spinner overlay */}
        {isTranscribing && !isRecording && (
          <span className="absolute inset-0 rounded-full border-2 border-gold/40 border-t-gold animate-spin" />
        )}
        {isRecording ? (
          <Square size={24} fill="currentColor" />
        ) : isTranscribing ? (
          <Loader2 size={24} className="animate-spin" />
        ) : isGenerating ? (
          <Radio size={24} className="animate-pulse" />
        ) : (
          <Mic size={24} />
        )}
      </button>

      <p className="text-[10px] text-muted text-center">
        {isRecording ? 'Auto-stops after silence · Esc to cancel' : 'Press Esc to stop AI'}
      </p>
    </div>
  );
}
