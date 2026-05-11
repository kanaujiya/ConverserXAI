import { ChatMessage } from '../types';
import { mapError } from '../utils/error-mapping';
import { syncManager } from '../sync-manager';

export class AIService {
  static async streamChat(
    message: string,
    history: ChatMessage[],
    onUpdate: (fullText: string, chunk: string) => void,
    maxRetries = 2,
    signal?: AbortSignal
  ): Promise<string> {
    let lastError: any;
    const startTime = Date.now();
    const INITIAL_RETRY_DELAY_MS = 250;
    
    for (let i = 0; i <= maxRetries; i++) {
      const controller = new AbortController();
      const baseTimeout = 15000; // 15s base timeout
      const timeoutId = setTimeout(() => controller.abort(), baseTimeout);
      let hasReceivedChunk = false;
      
      const onAbort = () => controller.abort();
      if (signal) signal.addEventListener('abort', onAbort);

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, history }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        if (signal) signal.removeEventListener('abort', onAbort);

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const error = mapError(response.status, 'AI', data.error?.message);
          throw error;
        }

        if (!response.body) {
          throw new Error('No response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          if (chunk.trim().length > 0) {
            hasReceivedChunk = true;
          }
          fullText += chunk;
          onUpdate(fullText, chunk);
        }

        const finalChunk = decoder.decode();
        if (finalChunk) {
          fullText += finalChunk;
          onUpdate(fullText, finalChunk);
        }

        console.log(`[AIService] Chat completed in ${Date.now() - startTime}ms`);
        return fullText;
      } catch (err: any) {
        lastError = err;
        
        // Don't retry if it's a quota or auth error
        if (err.code === 'RATE_LIMIT_EXCEEDED' || err.code === 'UNAUTHORIZED') {
          throw err;
        }

        // Don't retry if signal was aborted
        if (err.name === 'AbortError') {
          throw err;
        }

        // If streaming already started, retrying will replay content and can
        // duplicate words in UI/audio pipelines. Fail fast instead.
        if (hasReceivedChunk) {
          throw err;
        }

        // Retry only when no chunk was received yet; keep delay short to avoid
        // introducing visible 1-3s latency spikes on transient first-byte errors.
        if (i < maxRetries) {
          const retryDelay = INITIAL_RETRY_DELAY_MS * (i + 1);
          console.log(`[AIService] Retry ${i + 1}/${maxRetries} in ${retryDelay}ms`);
          await new Promise(r => setTimeout(r, retryDelay));
          continue;
        }
      } finally {
        clearTimeout(timeoutId);
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    }

    throw lastError;
  }
}
