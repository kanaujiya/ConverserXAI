/**
 * Stream Playback Controller
 * Manages synchronized audio and avatar playback
 * Ensures audio and avatar start/stop together with proper validation
 */

export interface PlaybackTarget {
  audioElement: HTMLAudioElement;
  videoElement?: HTMLVideoElement;
}

export interface PlaybackContext {
  audioBlob: Blob;
  duration: number;
  text: string;
}

export type PlaybackEvent = 'starting' | 'started' | 'progressing' | 'completed' | 'failed' | 'stopped';
export type PlaybackEventListener = (event: PlaybackEvent, data?: any) => void;

export class StreamPlaybackController {
  private target: PlaybackTarget | null = null;
  private currentContext: PlaybackContext | null = null;
  private isPlaying = false;
  private eventListeners: Map<PlaybackEvent, PlaybackEventListener[]> = new Map();
  private playbackTimeoutId: NodeJS.Timeout | null = null;

  private readonly AUDIO_READY_TIMEOUT = 5000; // ms
  private readonly PLAYBACK_TIMEOUT_BUFFER = 2000; // ms

  constructor() {
    console.log('[StreamPlaybackController] Initialized');
  }

  /**
   * Set playback target (audio/video elements)
   */
  public setTarget(target: PlaybackTarget): void {
    this.target = target;
    console.log('[StreamPlaybackController] Target set');
  }

  /**
   * Start synchronized audio and avatar playback
   */
  public async startPlayback(context: PlaybackContext): Promise<void> {
    if (this.isPlaying) {
      console.warn('[StreamPlaybackController] Playback already in progress');
      return;
    }

    if (!this.target) {
      throw new Error('No playback target configured');
    }

    console.log(`[StreamPlaybackController] Starting playback: "${context.text.substring(0, 50)}"...`);

    this.emit('starting', { text: context.text });

    try {
      this.currentContext = context;
      this.isPlaying = true;

      // Prepare audio element
      await this.prepareAudio(context);

      // Play audio with proper error handling
      await this.playAudio();

      this.emit('started', { duration: context.duration });

      // Wait for playback to complete
      await this.waitForCompletion(context.duration);

      this.emit('completed', { text: context.text });

      console.log('[StreamPlaybackController] Playback completed successfully');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('[StreamPlaybackController] Playback error:', err);
      this.emit('failed', { error: err.message });
      throw err;
    } finally {
      this.isPlaying = false;
      this.currentContext = null;
      this.cleanup();
    }
  }

  /**
   * Prepare audio element
   */
  private async prepareAudio(context: PlaybackContext): Promise<void> {
    if (!this.target) {
      throw new Error('Target not set');
    }

    const { audioElement } = this.target;

    // Set audio source
    const audioUrl = URL.createObjectURL(context.audioBlob);
    audioElement.src = audioUrl;
    audioElement.volume = 1;
    audioElement.playbackRate = 1;

    console.log('[StreamPlaybackController] Audio prepared, waiting for readiness');

    // Wait for audio to be ready
    await this.waitForAudioReady(audioElement);

    console.log('[StreamPlaybackController] Audio ready for playback');
  }

  /**
   * Wait for audio element to be ready
   */
  private waitForAudioReady(audio: HTMLAudioElement): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if already ready
      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        console.log('[StreamPlaybackController] Audio already ready');
        resolve();
        return;
      }

      const timeoutId = setTimeout(() => {
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('loadeddata', onLoadedData);
        audio.removeEventListener('error', onError);
        reject(new Error('Audio ready timeout'));
      }, this.AUDIO_READY_TIMEOUT);

      const onCanPlay = () => {
        clearTimeout(timeoutId);
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('loadeddata', onLoadedData);
        audio.removeEventListener('error', onError);
        console.log('[StreamPlaybackController] Audio canplay event fired');
        resolve();
      };

      const onLoadedData = () => {
        clearTimeout(timeoutId);
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('loadeddata', onLoadedData);
        audio.removeEventListener('error', onError);
        console.log('[StreamPlaybackController] Audio loadeddata event fired');
        resolve();
      };

      const onError = () => {
        clearTimeout(timeoutId);
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('loadeddata', onLoadedData);
        audio.removeEventListener('error', onError);
        reject(new Error('Audio load error'));
      };

      audio.addEventListener('canplay', onCanPlay, { once: true });
      audio.addEventListener('loadeddata', onLoadedData, { once: true });
      audio.addEventListener('error', onError, { once: true });
    });
  }

  /**
   * Play audio element
   */
  private async playAudio(): Promise<void> {
    if (!this.target) {
      throw new Error('Target not set');
    }

    const { audioElement } = this.target;

    console.log('[StreamPlaybackController] Triggering audio play');

    try {
      const playPromise = audioElement.play();
      if (playPromise) {
        await playPromise;
      }
      console.log('[StreamPlaybackController] Audio play successful');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('[StreamPlaybackController] Audio play error:', err);

      // Check for autoplay policy restriction
      if (
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.message.includes('autoplay'))
      ) {
        throw new Error('Audio playback blocked by autoplay policy. User interaction required.');
      }

      throw err;
    }
  }

  /**
   * Wait for playback to complete
   */
  private async waitForCompletion(duration: number): Promise<void> {
    if (!this.target) {
      throw new Error('Target not set');
    }

    const { audioElement } = this.target;

    return new Promise((resolve, reject) => {
      const onEnded = () => {
        audioElement.removeEventListener('ended', onEnded);
        audioElement.removeEventListener('error', onError);
        clearTimeout(this.playbackTimeoutId || undefined);
        console.log('[StreamPlaybackController] Audio ended event');
        resolve();
      };

      const onError = () => {
        audioElement.removeEventListener('ended', onEnded);
        audioElement.removeEventListener('error', onError);
        clearTimeout(this.playbackTimeoutId || undefined);
        console.error('[StreamPlaybackController] Audio error during playback');
        reject(new Error('Audio playback error'));
      };

      audioElement.addEventListener('ended', onEnded, { once: true });
      audioElement.addEventListener('error', onError, { once: true });

      // Safety timeout
      const totalTimeout = duration * 1000 + this.PLAYBACK_TIMEOUT_BUFFER;
      this.playbackTimeoutId = setTimeout(() => {
        audioElement.removeEventListener('ended', onEnded);
        audioElement.removeEventListener('error', onError);
        console.warn('[StreamPlaybackController] Playback timeout');
        reject(new Error('Playback timeout'));
      }, totalTimeout);
    });
  }

  /**
   * Stop playback
   */
  public async stopPlayback(): Promise<void> {
    console.log('[StreamPlaybackController] Stopping playback');

    if (!this.target) {
      return;
    }

    try {
      const { audioElement } = this.target;
      audioElement.pause();
      audioElement.currentTime = 0;

      if (this.playbackTimeoutId) {
        clearTimeout(this.playbackTimeoutId);
      }

      this.isPlaying = false;
      this.currentContext = null;

      this.emit('stopped');
    } catch (error) {
      console.error('[StreamPlaybackController] Error stopping audio:', error);
    }
  }

  /**
   * Check if currently playing
   */
  public isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Get current playback context
   */
  public getCurrentContext(): PlaybackContext | null {
    return this.currentContext;
  }

  /**
   * Emit event
   */
  private emit(event: PlaybackEvent, data?: any): void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.forEach(listener => {
      try {
        listener(event, data);
      } catch (error) {
        console.error(`[StreamPlaybackController] Event listener error for ${event}:`, error);
      }
    });
  }

  /**
   * Subscribe to playback events
   */
  public on(event: PlaybackEvent, listener: PlaybackEventListener): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }

    const listeners = this.eventListeners.get(event)!;
    listeners.push(listener);

    return () => {
      const idx = listeners.indexOf(listener);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    if (this.target) {
      try {
        const url = this.target.audioElement.src;
        if (url && url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      } catch (error) {
        console.error('[StreamPlaybackController] Error revoking URL:', error);
      }
    }
  }

  /**
   * Full cleanup and destroy
   */
  public destroy(): void {
    console.log('[StreamPlaybackController] Destroying');
    this.stopPlayback();
    this.cleanup();
    this.eventListeners.clear();
    this.target = null;
  }

  /**
   * Get debug info
   */
  public getDebugInfo(): object {
    return {
      isPlaying: this.isPlaying,
      currentContext: this.currentContext,
      targetSet: !!this.target,
    };
  }
}
