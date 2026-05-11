'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAvatarProvider } from '@/hooks/useAvatarContext';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import { setSystemState, setHasInteracted } from '@/lib/store/appSlice';
import { LiquidAIAnimation } from './LiquidAIAnimation';
import { User, AlertCircle, RefreshCw } from 'lucide-react';

// ─── Component ───────────────────────────────────────────────────────────────
// IMPORTANT: The video element must NEVER be conditionally rendered.
// Unmounting it destroys srcObject and kills the WebRTC stream.
// Visibility is controlled via CSS opacity only.
export function AvatarPlayer() {
  // Internal ref for the video DOM node
  const videoNodeRef = useRef<HTMLVideoElement | null>(null);

  const {
    videoUrl,
    isProcessing,
    connect,
    videoElementRef,
    didVideoElementRef,
  } = useAvatarProvider();

  const dispatch = useAppDispatch();
  const systemState = useAppSelector((state) => state.app.systemState);
  const isAvatarReady = useAppSelector((state) => state.app.isAvatarReady);
  const useTTSFallback = useAppSelector((state) => state.app.useTTSFallback);
  const hasInteracted = useAppSelector((state) => state.app.hasInteracted);
  const error = useAppSelector((state) => state.app.error);
  const connectionStatus = useAppSelector((state) => state.app.connectionStatus);

  const isSpeaking = systemState === 'speaking' || isProcessing;
  const isIdle = systemState === 'idle' && !isProcessing;
  const isWaiting = systemState === 'waiting';

  // ── Stable video ref callback ─────────────────────────────────────────────
  // useCallback keeps the function identity stable across re-renders.
  // Without this, React destroys and recreates the DOM node on every render
  // because it sees a "new" ref function, wiping srcObject each time.
  const videoRefCallback = useCallback((node: HTMLVideoElement | null) => {
    if (!node) return;
    videoNodeRef.current = node;

    // Sync into the hook's ref so useAvatar.ontrack can attach streams
    if (videoElementRef) videoElementRef.current = node;
    if (didVideoElementRef) didVideoElementRef.current = node;

    console.log('[AvatarPlayer] Video element stable-ref attached');

    // If the WebRTC stream is already flowing (e.g. component remounted after
    // hot-reload or Strict Mode double-mount), re-attach immediately
    const existingStream = (window as any).avatarStream as MediaStream | undefined;
    if (existingStream && node.srcObject !== existingStream) {
      console.log('[AvatarPlayer] Re-attaching existing stream on mount');
      node.srcObject = existingStream;
      node.play().catch(() => {});
    }
  }, []); // no deps — intentionally stable for lifetime of component

  // ── Warm-up: click "Start Conversation" ───────────────────────────────────
  const handleStart = async () => {
    console.log('[AvatarPlayer] Warm-up initiated');
    dispatch(setHasInteracted(true));
    dispatch(setSystemState('thinking'));

    // ── Pre-authorize unmuted autoplay (user-gesture window) ──────────────
    // Chrome blocks play() with audio when called outside a user gesture.
    // el.play() on an empty video always rejects (no source), so we must
    // attach a real MediaStream first. We create a silent AudioContext stream,
    // play it muted (always allowed), which marks this element as "trusted".
    // After that, any future play() on the same element — including from
    // ontrack — is permitted even though it's async / outside the gesture.
    const el = videoNodeRef.current;
    if (el) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        const dest = ctx.createMediaStreamDestination();
        el.srcObject = dest.stream;  // attach silent stream (has an audio track)
        el.muted = true;
        await el.play();             // succeeds: user gesture + muted + valid src
        el.muted = false;            // unmute — Chrome now allows audio on this element
        el.srcObject = null;         // detach temp stream; real stream set by ontrack
        el.pause();
        ctx.close();
        console.log('[AvatarPlayer] Autoplay pre-authorized ✓');
      } catch (e) {
        console.warn('[AvatarPlayer] Pre-auth play() failed:', e);
      }
    }

    // Unlock AudioContext on Safari
    try { new Audio().play().catch(() => {}); } catch {}

    try {
      await connect();
    } catch (err) {
      console.error('[AvatarPlayer] Warm-up failed:', err);
      dispatch(setHasInteracted(false));
    } finally {
      dispatch(setSystemState('idle'));
    }
  };


  const showVideo = Boolean(videoUrl) && !useTTSFallback;

  // ── Retry play() when stream becomes visible ──────────────────────────────
  // If ontrack fired outside a user-gesture and play() was silently blocked,
  // this effect re-triggers play() the moment D-ID starts delivering frames.
  useEffect(() => {
    const el = videoNodeRef.current;
    if (!el || !showVideo) return;
    if (el.paused) {
      el.play()
        .then(() => console.log('[AvatarPlayer] play() resumed via showVideo effect ✓'))
        .catch((e) => console.warn('[AvatarPlayer] showVideo play() rejected:', e));
    }
  }, [showVideo]);

  return (
    <div className="relative">
      {/* Speaking pulse ring */}
      {isSpeaking && (
        <div className="absolute inset-0 rounded-full animate-pulse-ring border-2 border-accent/30" />
      )}

      <div
        className={`
          w-64 h-64 sm:w-80 sm:h-80 rounded-full overflow-hidden border-2
          transition-all duration-500 bg-surface-light relative
          ${isSpeaking
            ? 'border-accent avatar-glow-speaking'
            : isIdle
              ? 'border-border avatar-glow'
              : 'border-gold/50 avatar-glow'
          }
        `}
      >
        {/* ── D-ID WebRTC video — ALWAYS MOUNTED, visibility via opacity ────
            Never unmount this element. Unmounting resets srcObject to null
            and destroys the WebRTC stream, requiring full reconnection.      */}
        <video
          ref={videoRefCallback}
          autoPlay
          playsInline
          muted={false}
          className={`
            w-full h-full object-cover scale-105 absolute inset-0
            transition-opacity duration-200
            ${showVideo ? 'opacity-100 z-10' : 'opacity-0 z-0'}
          `}
          onCanPlay={() => console.log('[AvatarPlayer] canplay')}
          onPlaying={() => console.log('[AvatarPlayer] playing ▶')}
          onEnded={() => {
            console.log('[AvatarPlayer] ended');
            dispatch(setSystemState('idle'));
          }}
          onError={(e) => {
            const err = (e.target as HTMLVideoElement).error;
            console.error('[AvatarPlayer] video error:', err?.message, 'code:', err?.code);
            dispatch(setSystemState('idle'));
          }}
        />

        {/* ── Connection Error / Retry Overlay ── */}
        {error && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm p-6 text-center">
            <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mb-3">
              <AlertCircle className="text-red-500 w-6 h-6" />
            </div>
            <h3 className="text-white font-bold mb-1">Connection Error</h3>
            <p className="text-gray-300 text-[10px] mb-4 max-w-[200px] leading-relaxed">
              {error.code === 'MAX_SESSIONS' 
                ? "D-ID session limit reached. Please close other tabs and wait 10s." 
                : error.message || "Failed to connect to avatar service"}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-xs font-medium transition-transform active:scale-95 shadow-lg shadow-blue-600/30"
            >
              <RefreshCw className="w-3 h-3" />
              Retry Connection
            </button>
          </div>
        )}

        {/* ── Overlay (static avatar image / controls) ─────────────────────
            Fades out when the video stream is active (200ms, not 1000ms).   */}
        <div
          className={`
            absolute inset-0 w-full h-full flex flex-col items-center justify-center
            z-20 bg-surface-light transition-opacity duration-200
            ${showVideo ? 'opacity-0 pointer-events-none' : 'opacity-100'}
          `}
        >
          {!hasInteracted ? (
            <button
              onClick={handleStart}
              className="px-8 py-3 rounded-full sunset-gradient text-white font-bold shadow-xl hover:scale-105 active:scale-95 transition-all animate-pulse-glow flex flex-col items-center gap-1"
            >
              <span className="text-lg">Start Conversation</span>
              <span className="text-[10px] opacity-80 font-normal">Initializes Avatar & Audio</span>
            </button>
          ) : (
            <>
              {isIdle && !isWaiting && isAvatarReady ? (
                <LiquidAIAnimation />
              ) : (
                <div className="w-20 h-20 mx-auto mb-3 rounded-full sunset-gradient flex items-center justify-center shadow-lg">
                  {!isAvatarReady || isProcessing || isWaiting ? (
                    <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin" />
                  ) : (
                    <User size={36} stroke="white" strokeWidth={1.5} />
                  )}
                </div>
              )}

              <p className="text-xs text-muted px-6 text-center font-medium z-30">
                {useTTSFallback
                  ? 'Voice-only mode active'
                  : !isAvatarReady
                    ? 'Initializing WebRTC…'
                    : isProcessing || isWaiting
                      ? 'AI is thinking…'
                      : isSpeaking
                        ? 'AI is speaking…'
                        : 'Ready to Talk — tap the mic'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
