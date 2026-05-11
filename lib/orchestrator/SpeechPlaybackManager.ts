/**
 * Speech Playback Manager
 * Handles synchronized playback of audio and avatar animation
 * Ensures audio and video start/stop together
 */

export interface PlaybackState {
  isPlaying: boolean;
  startTime: number | null;
  duration: number;
  currentTime: number;
}

export interface PlaybackResources {
  audio: HTMLAudioElement;
  videoElement: HTMLVideoElement;
  audioBlob?: Blob;
  duration: number;
}

export class SpeechPlaybackManager {
  private playbackState: PlaybackState = {
    isPlaying: false,
    startTime: null,
    duration: 0,
    currentTime: 0,
  };

  private resources: PlaybackResources | null = null;
  private animationFrameId: number | null = null;
  private playbackListeners: Array<(state: PlaybackState) => void> = [];
  private readonly SYNC_CHECK_INTERVAL = 100; // ms
  private syncCheckInterval: NodeJS.Timeout | null = null;
  private audioSyncOffset = 0; // Track audio/video drift

  /**
   * Prepare for playback - validate all resources ready
   */
  public async preparePlayback(resources: PlaybackResources): Promise<void> {
    console.log('[SpeechPlayback] Preparing playback', {
      audioDuration: resources.duration,
      hasVideo: !!resources.videoElement.srcObject,
    });

    this.resources = resources;

    // Validate audio element
    if (!resources.audio) {
      throw new Error('Audio element not available');
    }

    // Validate video stream
    if (!resources.videoElement.srcObject) {
      throw new Error('Video stream not available');
    }

    // Set up audio
    resources.audio.volume = 1;
    resources.audio.playbackRate = 1;

    console.log('[SpeechPlayback] Preparation complete');
  }

  /**
   * Start synchronized playback
   * Both audio and video must be ready
   */
  public async startPlayback(): Promise<void> {
    if (!this.resources) {
      throw new Error('Playback not prepared');
    }

    if (this.playbackState.isPlaying) {
      console.warn('[SpeechPlayback] Playback already in progress');
      return;
    }

    console.log('[SpeechPlayback] Starting synchronized playback');

    try {
      // Reset sync offset
      this.audioSyncOffset = 0;

      // Start audio playback with error handling
      try {
        const playPromise = this.resources.audio.play();
        if (playPromise) {
          await playPromise;
        }
      } catch (error) {
        console.error('[SpeechPlayback] Audio play failed:', error);
        throw new Error(`Audio playback failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Record playback start
      this.playbackState.isPlaying = true;
      this.playbackState.startTime = Date.now();
      this.playbackState.currentTime = 0;

      console.log('[SpeechPlayback] Playback started successfully');

      // Start synchronization monitoring
      this.startSyncMonitoring();

      // Notify listeners
      this.notifyPlaybackStateChange();
    } catch (error) {
      this.playbackState.isPlaying = false;
      throw error;
    }
  }

  /**
   * Stop playback
   */
  public stopPlayback(): void {
    if (!this.resources) return;

    console.log('[SpeechPlayback] Stopping playback');

    try {
      this.resources.audio.pause();
      this.resources.audio.currentTime = 0;
    } catch (error) {
      console.error('[SpeechPlayback] Error stopping audio:', error);
    }

    this.playbackState.isPlaying = false;
    this.playbackState.startTime = null;
    this.playbackState.currentTime = 0;

    this.stopSyncMonitoring();
    this.notifyPlaybackStateChange();

    console.log('[SpeechPlayback] Playback stopped');
  }

  /**
   * Wait for playback to complete
   */
  public async waitForPlaybackComplete(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.playbackState.isPlaying) {
        resolve();
        return;
      }

      if (!this.resources) {
        reject(new Error('No playback resources'));
        return;
      }

      const onEnded = () => {
        this.resources!.audio.removeEventListener('ended', onEnded);
        resolve();
      };

      const onError = (error: Event) => {
        this.resources!.audio.removeEventListener('error', onError);
        reject(new Error('Audio playback error'));
      };

      this.resources.audio.addEventListener('ended', onEnded);
      this.resources.audio.addEventListener('error', onError);

      // Safety timeout
      setTimeout(() => {
        this.resources?.audio.removeEventListener('ended', onEnded);
        this.resources?.audio.removeEventListener('error', onError);
        reject(new Error('Playback timeout'));
      }, this.playbackState.duration + 5000);
    });
  }

  /**
   * Monitor audio/video synchronization
   */
  private startSyncMonitoring(): void {
    if (this.syncCheckInterval) {
      clearInterval(this.syncCheckInterval);
    }

    this.syncCheckInterval = setInterval(() => {
      if (!this.playbackState.isPlaying || !this.resources) {
        return;
      }

      const audioTime = this.resources.audio.currentTime;
      const expectedTime = (Date.now() - (this.playbackState.startTime || 0)) / 1000;

      // Check for significant sync drift (>200ms)
      const drift = Math.abs(audioTime - expectedTime);
      if (drift > 0.2) {
        console.warn('[SpeechPlayback] Audio sync drift detected:', {
          audioTime,
          expectedTime,
          drift,
        });

        this.audioSyncOffset = drift;
      }

      // Update current time
      this.playbackState.currentTime = audioTime;
      this.notifyPlaybackStateChange();
    }, this.SYNC_CHECK_INTERVAL);
  }

  /**
   * Stop sync monitoring
   */
  private stopSyncMonitoring(): void {
    if (this.syncCheckInterval) {
      clearInterval(this.syncCheckInterval);
      this.syncCheckInterval = null;
    }
  }

  /**
   * Notify state change listeners
   */
  private notifyPlaybackStateChange(): void {
    this.playbackListeners.forEach(listener => listener({ ...this.playbackState }));
  }

  /**
   * Subscribe to playback state changes
   */
  public onPlaybackStateChange(listener: (state: PlaybackState) => void): () => void {
    this.playbackListeners.push(listener);
    return () => {
      this.playbackListeners = this.playbackListeners.filter(l => l !== listener);
    };
  }

  /**
   * Get current playback state
   */
  public getPlaybackState(): PlaybackState {
    return { ...this.playbackState };
  }

  /**
   * Check if playback is active
   */
  public isPlaying(): boolean {
    return this.playbackState.isPlaying;
  }

  /**
   * Get sync offset (drift between audio and expected time)
   */
  public getSyncOffset(): number {
    return this.audioSyncOffset;
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    console.log('[SpeechPlayback] Cleaning up resources');

    this.stopPlayback();
    this.stopSyncMonitoring();
    this.playbackListeners = [];
    this.resources = null;
  }

  /**
   * Get debug info
   */
  public getDebugInfo(): object {
    return {
      isPlaying: this.playbackState.isPlaying,
      currentTime: this.playbackState.currentTime,
      duration: this.playbackState.duration,
      syncOffset: this.audioSyncOffset,
      resources: {
        hasAudio: !!this.resources?.audio,
        hasVideo: !!this.resources?.videoElement,
      },
    };
  }
}
