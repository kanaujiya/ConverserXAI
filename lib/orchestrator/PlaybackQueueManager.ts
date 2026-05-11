/**
 * Playback Queue Manager
 * Manages playback queue to prevent overlapping requests and ensure proper synchronization
 * 
 * Key responsibilities:
 * - Prevent multiple simultaneous playback requests
 * - Manage playback queue with strict ordering
 * - Ensure audio and avatar are synchronized before playback starts
 * - Track playback timing and state
 */

export interface QueuedPlayback {
  id: string;
  text: string;
  audioBlob: Blob;
  duration: number;
  timestamp: number;
  retryCount: number;
}

export interface PlaybackQueueState {
  isPlaying: boolean;
  currentPlayback: QueuedPlayback | null;
  queueLength: number;
  totalProcessed: number;
  totalFailed: number;
}

export type QueueListener = (state: PlaybackQueueState) => void;

export class PlaybackQueueManager {
  private queue: QueuedPlayback[] = [];
  private currentPlayback: QueuedPlayback | null = null;
  private isPlaying = false;
  private isProcessing = false;
  private listeners: QueueListener[] = [];
  private totalProcessed = 0;
  private totalFailed = 0;

  private readonly MAX_QUEUE_SIZE = 10;
  private readonly MAX_RETRIES = 2;
  private audioElement: HTMLAudioElement | null = null;

  constructor() {
    console.log('[PlaybackQueue] Initialized');
  }

  /**
   * Set audio element to use for playback
   */
  public setAudioElement(audio: HTMLAudioElement): void {
    this.audioElement = audio;
    console.log('[PlaybackQueue] Audio element set');
  }

  /**
   * Enqueue a playback request
   */
  public enqueue(text: string, audioBlob: Blob, duration: number): string {
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      console.warn(`[PlaybackQueue] Queue full (${this.MAX_QUEUE_SIZE}), dropping oldest`);
      this.queue.shift();
    }

    const id = `playback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const playback: QueuedPlayback = {
      id,
      text,
      audioBlob,
      duration,
      timestamp: Date.now(),
      retryCount: 0,
    };

    this.queue.push(playback);
    console.log(`[PlaybackQueue] Enqueued: "${text.substring(0, 50)}"... Queue size: ${this.queue.length}`);

    this.notifyStateChange();
    this.processQueue().catch(err => console.error('[PlaybackQueue] Processing error:', err));

    return id;
  }

  /**
   * Process queue items sequentially
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.isPlaying) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.queue.length > 0 && !this.isPlaying) {
        const playback = this.queue.shift();
        if (!playback) break;

        this.currentPlayback = playback;
        this.notifyStateChange();

        try {
          await this.playItem(playback);
          this.totalProcessed++;
        } catch (error) {
          this.totalFailed++;
          console.error(`[PlaybackQueue] Playback failed for item ${playback.id}:`, error);

          if (playback.retryCount < this.MAX_RETRIES) {
            playback.retryCount++;
            console.log(`[PlaybackQueue] Retrying (${playback.retryCount}/${this.MAX_RETRIES})`);
            this.queue.unshift(playback); // Put back in queue
            await this.delay(500 * Math.pow(2, playback.retryCount - 1));
          }
        }

        this.currentPlayback = null;
      }
    } finally {
      this.isProcessing = false;
      this.notifyStateChange();
    }
  }

  /**
   * Play individual queue item
   */
  private async playItem(playback: QueuedPlayback): Promise<void> {
    if (!this.audioElement) {
      throw new Error('Audio element not configured');
    }

    console.log(`[PlaybackQueue] Playing: "${playback.text.substring(0, 50)}"...`);

    this.isPlaying = true;
    this.notifyStateChange();

    try {
      const audioUrl = URL.createObjectURL(playback.audioBlob);
      this.audioElement.src = audioUrl;
      this.audioElement.volume = 1;
      this.audioElement.playbackRate = 1;

      // Wait for audio to be loadable
      await this.waitForAudioReady(this.audioElement);

      // Play with error handling
      try {
        const playPromise = this.audioElement.play();
        if (playPromise) {
          await playPromise;
        }
      } catch (error) {
        throw new Error(`Audio play failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Wait for playback to complete
      await this.waitForPlaybackComplete(this.audioElement, playback.duration);

      // Cleanup URL
      URL.revokeObjectURL(audioUrl);

      console.log(`[PlaybackQueue] Playback completed for: "${playback.text.substring(0, 50)}"...`);
    } finally {
      this.isPlaying = false;
      this.notifyStateChange();
    }
  }

  /**
   * Wait for audio element to be ready
   */
  private waitForAudioReady(audio: HTMLAudioElement): Promise<void> {
    return new Promise((resolve, reject) => {
      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        resolve();
        return;
      }

      const onCanPlay = () => {
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('error', onError);
        resolve();
      };

      const onError = () => {
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('error', onError);
        reject(new Error('Audio failed to load'));
      };

      audio.addEventListener('canplay', onCanPlay);
      audio.addEventListener('error', onError);

      // Timeout
      setTimeout(() => {
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('error', onError);
        reject(new Error('Audio ready timeout'));
      }, 5000);
    });
  }

  /**
   * Wait for playback to complete
   */
  private waitForPlaybackComplete(audio: HTMLAudioElement, duration: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const onEnded = () => {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        clearTimeout(timeoutId);
        resolve();
      };

      const onError = () => {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        clearTimeout(timeoutId);
        reject(new Error('Audio playback error'));
      };

      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);

      // Safety timeout (duration + 2 seconds)
      const timeoutId = setTimeout(() => {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        reject(new Error('Playback timeout'));
      }, duration * 1000 + 2000);
    });
  }

  /**
   * Clear queue
   */
  public clear(): void {
    console.log('[PlaybackQueue] Clearing queue');
    this.queue = [];
    this.currentPlayback = null;
    this.isPlaying = false;
    this.isProcessing = false;
    this.notifyStateChange();
  }

  /**
   * Stop current playback
   */
  public stop(): void {
    if (this.audioElement) {
      try {
        this.audioElement.pause();
        this.audioElement.currentTime = 0;
      } catch (error) {
        console.error('[PlaybackQueue] Error stopping audio:', error);
      }
    }

    this.isPlaying = false;
    this.notifyStateChange();
    console.log('[PlaybackQueue] Playback stopped');
  }

  /**
   * Get current state
   */
  public getState(): PlaybackQueueState {
    return {
      isPlaying: this.isPlaying,
      currentPlayback: this.currentPlayback,
      queueLength: this.queue.length,
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed,
    };
  }

  /**
   * Check if queue is empty and not playing
   */
  public isIdle(): boolean {
    return !this.isPlaying && this.queue.length === 0 && !this.isProcessing;
  }

  /**
   * Subscribe to state changes
   */
  public onStateChange(listener: QueueListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Notify state change listeners
   */
  private notifyStateChange(): void {
    const state = this.getState();
    this.listeners.forEach(listener => {
      try {
        listener(state);
      } catch (error) {
        console.error('[PlaybackQueue] Listener error:', error);
      }
    });
  }

  /**
   * Cleanup
   */
  public cleanup(): void {
    console.log('[PlaybackQueue] Cleanup');
    this.stop();
    this.clear();
    this.listeners = [];
    this.audioElement = null;
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get debug info
   */
  public getDebugInfo(): object {
    return {
      isPlaying: this.isPlaying,
      isProcessing: this.isProcessing,
      currentPlayback: this.currentPlayback,
      queueLength: this.queue.length,
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed,
      audioElementReady: !!this.audioElement,
    };
  }
}
