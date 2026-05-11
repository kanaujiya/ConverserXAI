import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import { 
  addMessage, 
  updateLastMessage, 
  appendLastMessage,
  setSystemState, 
  setError as setGlobalError 
} from '@/lib/store/appSlice';
import { AIService } from '@/lib/services/ai.service';
import { useAvatarProvider } from './useAvatarContext';
import { useTTS } from './useTTS';
import { toast } from 'sonner';
import { store } from '@/lib/store/store';
import { PerfLogger } from '@/lib/perf-logger';

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_QUEUE_SIZE = 20;
const SENTENCE_EXTRACTION_PATTERN = /[^.!?]+[.!?]+/g;
// Submit to D-ID early (before sentence ending) once we have this many words.
// Lower threshold gets the first avatar segment in-flight sooner.
// NOTE: too-low thresholds can split sentences into multiple avatar segments
// (e.g. "I'm here to" + "help you.") which hurts lip-sync naturalness.
const EARLY_SUBMIT_WORD_THRESHOLD = 3;
const EARLY_SUBMIT_MAX_WORDS = 5;
const QUEUE_DRAIN_POLL_MS = 10; // was 50ms — tighter polling reduces drain wait
const QUEUE_DRAIN_TIMEOUT_MS = 5000;
const MIN_SEGMENT_CHARS = 8;
const MAX_HISTORY_MESSAGES = 12;
const FAST_FIRST_SEGMENT_MAX_CHARS = 20;
const FAST_FIRST_SEGMENT_MIN_WORDS = 2;

/** If phrase ends on one of these, include the next word when present (avoids "each" | "other"). */
const EARLY_CUT_JOINERS: Record<string, string> = {
  each: 'other',
  either: 'or',
  neither: 'nor',
  such: 'as',
};

function normalizeWord(w: string): string {
  return w.replace(/[^a-z0-9']/gi, '').toLowerCase();
}

/** Extend word cut so we do not flush "… each" while "other …" is still in the buffer. */
function extendEarlyWordCut(words: string[], cut: number, maxWords: number): number {
  let n = Math.min(cut, words.length);
  const cap = Math.min(words.length, maxWords);
  while (n < cap) {
    const last = normalizeWord(words[n - 1] ?? '');
    const need = EARLY_CUT_JOINERS[last];
    const nextRaw = words[n] ?? '';
    const next = normalizeWord(nextRaw);
    if (need && next === need) {
      n += 1;
      continue;
    }
    break;
  }
  return n;
}

function normalizeForDedup(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:]+$/g, '')
    .toLowerCase();
}

export function useChat() {
  const [isGenerating, setIsGenerating] = useState(false);
  const dispatch = useAppDispatch();
  
  const messages = useAppSelector((state) => state.app.messages);
  const recentHistory = useMemo(() => messages.slice(-MAX_HISTORY_MESSAGES), [messages]);

  const useTTSFallback = useAppSelector((state) => state.app.useTTSFallback);
  const avatarStartLagMs = useAppSelector((state) => state.app.avatarStartLagMs);
  const avatarSegmentStartCount = useAppSelector((state) => state.app.avatarSegmentStartCount);

  const { speak: avatarSpeak, clearQueue: avatarClearQueue, connect: avatarConnect } = useAvatarProvider();
  const { speak: ttsSpeak, stop: ttsStop } = useTTS();
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const sentenceQueueRef = useRef<string[]>([]);
  const uiSentenceQueueRef = useRef<string[]>([]);
  const uiSentenceQueuedAtRef = useRef<number[]>([]);
  const isProcessingQueueRef = useRef(false);
  const isLockedRef = useRef(false);
  const uiGateTimeoutRef = useRef<number | null>(null);
  const lastSegmentStartCountRef = useRef<number>(avatarSegmentStartCount);
  const uiRevealCounterRef = useRef<number>(0);
  const lastQueuedSpeechNormRef = useRef<string | null>(null);
  const lastQueuedUiNormRef = useRef<string | null>(null);

  /**
   * Keep the first segment short (when possible) so avatar response can start earlier.
   * We only split when the first part is still meaningful enough to sound natural.
   */
  const splitForFastFirstSegment = useCallback((text: string): [string, string | null] => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length <= FAST_FIRST_SEGMENT_MAX_CHARS) {
      return [trimmed, null];
    }

    // Only split at a comma (natural pause). Word-boundary splits here caused
    // broken phrases (e.g. "… each" + "other …") and awkward avatar segments.
    const commaIdx = trimmed.indexOf(',');
    if (commaIdx >= 12 && commaIdx <= FAST_FIRST_SEGMENT_MAX_CHARS + 10) {
      const first = trimmed.slice(0, commaIdx + 1).trim();
      const rest = trimmed.slice(commaIdx + 1).trim();
      if (first.split(/\s+/).filter(Boolean).length >= FAST_FIRST_SEGMENT_MIN_WORDS && rest) {
        return [first, rest];
      }
    }

    return [trimmed, null];
  }, []);

  const flushOneUiSentence = useCallback((): boolean => {
    const next = uiSentenceQueueRef.current.shift();
    if (!next) return false;
    const queuedAt = uiSentenceQueuedAtRef.current.shift();
    uiRevealCounterRef.current += 1;
    const lagMs = queuedAt ? Date.now() - queuedAt : null;
    console.log(
      `[Chat] 🗣 UI reveal segment #${uiRevealCounterRef.current}` +
      (lagMs !== null ? ` (+${lagMs}ms since queued)` : '') +
      `: "${next.substring(0, 50)}"`
    );
    dispatch(appendLastMessage(next));
    return true;
  }, [dispatch]);

  const scheduleUiFallbackFlush = useCallback(() => {
    if (uiGateTimeoutRef.current) {
      window.clearTimeout(uiGateTimeoutRef.current);
      uiGateTimeoutRef.current = null;
    }
    if (useTTSFallback || uiSentenceQueueRef.current.length === 0) return;

    const dynamicGateMs = Math.min(2600, Math.max(900, Math.round(avatarStartLagMs + 200)));
    uiGateTimeoutRef.current = window.setTimeout(() => {
      flushOneUiSentence();
      if (uiSentenceQueueRef.current.length > 0) {
        scheduleUiFallbackFlush();
      }
    }, dynamicGateMs);
  }, [avatarStartLagMs, useTTSFallback, flushOneUiSentence]);

  // Per-segment gate: each avatar segment start reveals one queued UI sentence.
  useEffect(() => {
    if (useTTSFallback) {
      while (flushOneUiSentence()) {
        // flush all immediately in voice-only fallback
      }
      return;
    }

    const previous = lastSegmentStartCountRef.current;
    const current = avatarSegmentStartCount;
    lastSegmentStartCountRef.current = current;
    const startsToApply = Math.max(0, current - previous);
    if (startsToApply === 0) return;

    if (uiGateTimeoutRef.current) {
      window.clearTimeout(uiGateTimeoutRef.current);
      uiGateTimeoutRef.current = null;
    }

    for (let i = 0; i < startsToApply; i++) {
      if (!flushOneUiSentence()) break;
    }
    if (uiSentenceQueueRef.current.length > 0) {
      scheduleUiFallbackFlush();
    }
  }, [avatarSegmentStartCount, useTTSFallback, flushOneUiSentence, scheduleUiFallbackFlush]);

  /**
   * Add sentence to queue
   */
  const queueSentence = useCallback((sentence: string) => {
    const trimmed = sentence.trim();
    if (!trimmed) return;

    // Never send punctuation-only segments to D-ID (causes 400s like "." in your logs)
    if (/^[\s.!?,;:]+$/.test(trimmed)) return;

    const normalized = normalizeForDedup(trimmed);
    if (normalized && lastQueuedSpeechNormRef.current === normalized) {
      console.log(`[Chat] Skipped duplicate speech segment: "${trimmed.substring(0, 50)}"`);
      return;
    }

    // Avoid tiny tail fragments ("help you.", "food.") becoming a separate talk.
    // Merge short segments into the previous queued segment for more natural speech.
    if (trimmed.length < MIN_SEGMENT_CHARS && sentenceQueueRef.current.length > 0) {
      const lastIdx = sentenceQueueRef.current.length - 1;
      sentenceQueueRef.current[lastIdx] = `${sentenceQueueRef.current[lastIdx]} ${trimmed}`.trim();
      console.log(`[Chat] Merged tiny segment into previous (q=${sentenceQueueRef.current.length})`);
      return;
    }

    if (sentenceQueueRef.current.length >= MAX_QUEUE_SIZE) {
      console.warn('[Chat] Queue at capacity, dropping oldest');
      sentenceQueueRef.current.shift();
    }

    sentenceQueueRef.current.push(trimmed);
    lastQueuedSpeechNormRef.current = normalized;
    console.log(`[Chat] Queued: "${trimmed.substring(0, 50)}" (q=${sentenceQueueRef.current.length})`);
  }, []);

  const queueUiSentence = useCallback((sentence: string) => {
    const trimmed = sentence.trim();
    if (!trimmed) return;
    if (/^[\s.!?,;:]+$/.test(trimmed)) return;

    const normalized = normalizeForDedup(trimmed);
    if (normalized && lastQueuedUiNormRef.current === normalized) {
      console.log(`[Chat] Skipped duplicate UI segment: "${trimmed.substring(0, 50)}"`);
      return;
    }

    if (trimmed.length < MIN_SEGMENT_CHARS && uiSentenceQueueRef.current.length > 0) {
      const lastIdx = uiSentenceQueueRef.current.length - 1;
      uiSentenceQueueRef.current[lastIdx] = `${uiSentenceQueueRef.current[lastIdx]} ${trimmed}`.trim();
      return;
    }

    if (uiSentenceQueueRef.current.length >= MAX_QUEUE_SIZE) {
      uiSentenceQueueRef.current.shift();
      uiSentenceQueuedAtRef.current.shift();
    }
    uiSentenceQueueRef.current.push(trimmed);
    uiSentenceQueuedAtRef.current.push(Date.now());
    lastQueuedUiNormRef.current = normalized;
    console.log(`[Chat] 🧾 UI sentence queued (q=${uiSentenceQueueRef.current.length}): "${trimmed.substring(0, 50)}"`);

    if (useTTSFallback) {
      while (flushOneUiSentence()) {
        // reveal immediately in fallback mode
      }
      return;
    }
    scheduleUiFallbackFlush();
  }, [useTTSFallback, flushOneUiSentence, scheduleUiFallbackFlush]);

  /**
   * OPTIMIZED: speak() now returns after HTTP 200 from D-ID (~400ms)
   * instead of waiting for talk/started event (~2-3s).
   * UI state is driven by DataChannel events in useAvatar.
   */
  const speakAndReveal = useCallback(async (sentence: string) => {
    const t0 = Date.now();
    const state = store.getState().app;

    try {
      if (!state.useTTSFallback) {
        const metrics = ((window as any).__avatarTurnMetrics ?? {}) as Record<string, number>;
        if (!metrics.firstAvatarSubmitAt) {
          metrics.firstAvatarSubmitAt = Date.now();
          (window as any).__avatarTurnMetrics = metrics;
        }
        console.log(`[Chat] ⏱ Submitting to avatar: "${sentence.substring(0, 40)}"`);
        await avatarSpeak(sentence);
        console.log(`[Chat] ⏱ avatarSpeak() returned in ${Date.now() - t0}ms`);
      } else {
        console.log('[Chat] Using TTS fallback');
        ttsSpeak(sentence);
      }
    } catch (error) {
      console.error('[Chat] speakAndReveal error:', error);
    }
  }, [avatarSpeak, ttsSpeak]);

  /**
   * OPTIMIZED: Process queue with no artificial delay between sentences.
   * Each sentence is submitted to D-ID as fast as it returns HTTP 200.
   * D-ID handles internal ordering/queuing per stream session.
   */
  const processQueue = useCallback(async () => {
    if (isProcessingQueueRef.current) {
      console.log('[Chat] Queue already processing');
      return;
    }

    isProcessingQueueRef.current = true;

    try {
      while (sentenceQueueRef.current.length > 0) {
        const sentence = sentenceQueueRef.current.shift();
        if (sentence) {
          await speakAndReveal(sentence);
          // No artificial delay — D-ID accepts sequential requests quickly
        }
      }
      console.log('[Chat] Queue fully processed');
    } catch (error) {
      console.error('[Chat] Queue processing error:', error);
    } finally {
      isProcessingQueueRef.current = false;
    }
  }, [speakAndReveal]);

  /**
   * Send message to AI and stream response
   */
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isGenerating || isLockedRef.current) {
      if (isLockedRef.current) console.warn('[Chat] sendMessage locked');
      return;
    }

    isLockedRef.current = true;
    const t = PerfLogger.start('chat-pipeline');

    try {
      setIsGenerating(true);
      dispatch(setSystemState('thinking'));
      dispatch(setGlobalError(null));

      // Opportunistically ensure avatar session is alive while STT/LLM is in flight.
      // Do not block chat streaming on this.
      const state = store.getState().app;
      if (!state.useTTSFallback && !state.isAvatarReady) {
        avatarConnect().catch((err) => {
          console.warn('[Chat] Avatar preconnect failed (non-blocking):', err);
        });
      }

      sentenceQueueRef.current = [];
      isProcessingQueueRef.current = false;
      lastQueuedSpeechNormRef.current = null;
      uiSentenceQueueRef.current = [];
      uiSentenceQueuedAtRef.current = [];
      lastQueuedUiNormRef.current = null;
      uiRevealCounterRef.current = 0;
      if (uiGateTimeoutRef.current) {
        window.clearTimeout(uiGateTimeoutRef.current);
        uiGateTimeoutRef.current = null;
      }
      lastSegmentStartCountRef.current = store.getState().app.avatarSegmentStartCount;

      PerfLogger.mark(t, 'ai-fetch-start', { text: text.substring(0, 40) });
      {
        const metrics = ((window as any).__avatarTurnMetrics ?? {}) as Record<string, number>;
        metrics.aiFetchStartAt = Date.now();
        (window as any).__avatarTurnMetrics = metrics;
      }
      dispatch(addMessage({ role: 'user', content: text }));
      dispatch(addMessage({ role: 'assistant', content: '' }));

      try {
        let sentenceBuffer = '';
        let firstSentenceDispatched = false;
        abortControllerRef.current = new AbortController();

        await AIService.streamChat(
          text,
          recentHistory,
          (_fullText, chunk) => {
            const metrics = ((window as any).__avatarTurnMetrics ?? {}) as Record<string, number>;
            if (!metrics.llmFirstChunkAt && chunk.trim().length > 0) {
              metrics.llmFirstChunkAt = Date.now();
              (window as any).__avatarTurnMetrics = metrics;
            }
            sentenceBuffer += chunk;

            // ── Primary: extract complete sentences (.!?) ───────────────────
            const matches = sentenceBuffer.match(SENTENCE_EXTRACTION_PATTERN);
            if (matches) {
              const processedLength = matches.join('').length;
              sentenceBuffer = sentenceBuffer.substring(processedLength);

              matches.forEach(sentence => {
                if (!firstSentenceDispatched) {
                  PerfLogger.mark(t, 'first-sentence-queued', { sentence: sentence.substring(0, 40) });
                  firstSentenceDispatched = true;
                  const [fastFirst, remainder] = splitForFastFirstSegment(sentence);
                  queueSentence(fastFirst);
                  queueUiSentence(fastFirst);
                  if (remainder) {
                    queueSentence(remainder);
                    queueUiSentence(remainder);
                  }
                  processQueue().catch(err =>
                    console.error('[Chat] Queue processing error:', err)
                  );
                  return;
                }
                queueSentence(sentence);
                queueUiSentence(sentence);
                processQueue().catch(err =>
                  console.error('[Chat] Queue processing error:', err)
                );
              });
            } else if (!firstSentenceDispatched) {
              // ── Secondary: early submission before first sentence ends ──────
              // Submit to D-ID as soon as we have enough words, even mid-stream.
              // Gets the D-ID render in-flight ~100-300ms sooner.
              const buffered = sentenceBuffer.trim();
              const words = buffered.split(/\s+/).filter(Boolean);
              const wordCount = words.length;
              if (wordCount >= EARLY_SUBMIT_WORD_THRESHOLD) {
                const cut = extendEarlyWordCut(words, EARLY_SUBMIT_MAX_WORDS, 8);
                const phrase = words.slice(0, cut).join(' ').trim();
                const tail = words.slice(cut).join(' ').trim();
                // Don't early-submit very short fragments; they frequently cause 2-part speech.
                if (phrase.length < MIN_SEGMENT_CHARS) return;
                sentenceBuffer = tail ? `${tail} ` : '';
                PerfLogger.mark(t, 'first-sentence-queued (early)', { phrase: phrase.substring(0, 40), words: wordCount });
                firstSentenceDispatched = true;
                const [fastFirst, remainder] = splitForFastFirstSegment(phrase);
                queueSentence(fastFirst);
                queueUiSentence(fastFirst);
                if (remainder) {
                  queueSentence(remainder);
                  queueUiSentence(remainder);
                }
                processQueue().catch(err =>
                  console.error('[Chat] Early-submit queue error:', err)
                );
              }
            }
          },
          1,
          abortControllerRef.current.signal
        );

        PerfLogger.mark(t, 'ai-stream-complete');

        if (sentenceBuffer.trim()) {
          queueSentence(sentenceBuffer);
          queueUiSentence(sentenceBuffer);
          processQueue().catch(err => console.error('[Chat] Queue flush error:', err));
        }

        // Wait for queue to drain
        let waitTime = 0;
        while (
          (sentenceQueueRef.current.length > 0 || isProcessingQueueRef.current) &&
          waitTime < QUEUE_DRAIN_TIMEOUT_MS
        ) {
          await new Promise(r => setTimeout(r, QUEUE_DRAIN_POLL_MS));
          waitTime += QUEUE_DRAIN_POLL_MS;
        }

        if (waitTime >= QUEUE_DRAIN_TIMEOUT_MS) {
          console.warn('[Chat] Queue drain timeout');
        }

        PerfLogger.end(t, 'queue drained');
      } catch (err: unknown) {
        const error = err as { name?: string; message?: string; code?: string };
        if (error.name === 'AbortError') {
          PerfLogger.error(t, 'AbortError');
          dispatch(setSystemState('idle'));
        } else {
          PerfLogger.error(t, error.message || 'Unknown stream error');
          const message = error.message || 'Sorry, I encountered an error.';
          dispatch(updateLastMessage(message));
          dispatch(setGlobalError({ message, code: error.code || 'UNKNOWN' }));
          toast.error(message);
          dispatch(setSystemState('idle'));
        }
      }
    } finally {
      setIsGenerating(false);
      isLockedRef.current = false;
      if (uiGateTimeoutRef.current) {
        window.clearTimeout(uiGateTimeoutRef.current);
        uiGateTimeoutRef.current = null;
      }
      dispatch(setSystemState('idle'));
    }
  }, [isGenerating, dispatch, queueSentence, queueUiSentence, processQueue, recentHistory, avatarConnect, splitForFastFirstSegment]);

  /**
   * Interrupt current operation
   */
  const interrupt = useCallback(() => {
    console.log('[Chat] Interrupting');
    abortControllerRef.current?.abort();
    ttsStop();
    avatarClearQueue();
    sentenceQueueRef.current = [];
    lastQueuedSpeechNormRef.current = null;
    uiSentenceQueueRef.current = [];
    uiSentenceQueuedAtRef.current = [];
    lastQueuedUiNormRef.current = null;
    uiRevealCounterRef.current = 0;
    if (uiGateTimeoutRef.current) {
      window.clearTimeout(uiGateTimeoutRef.current);
      uiGateTimeoutRef.current = null;
    }
    isProcessingQueueRef.current = false;
    setIsGenerating(false);
    isLockedRef.current = false;
    dispatch(setSystemState('idle'));
  }, [ttsStop, avatarClearQueue, dispatch]);

  return { sendMessage, interrupt, isGenerating };
}
