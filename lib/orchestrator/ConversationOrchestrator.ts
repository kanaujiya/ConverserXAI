/**
 * Conversation Orchestrator
 * Central orchestration layer for the entire conversation lifecycle
 * Manages: transcription → AI response → TTS → avatar preparation → playback
 * 
 * Key responsibilities:
 * - Enforce strict conversation state machine
 * - Coordinate parallel TTS + avatar preparation
 * - Manage playback synchronization
 * - Handle error recovery and retries
 * - Provide detailed timing instrumentation
 */

import { ConversationStateMachine, ConversationState } from './ConversationStateMachine';
import { SpeechPlaybackManager } from './SpeechPlaybackManager';

export interface ConversationMessage {
  id: string;
  userText: string;
  aiResponse: string;
  timestamp: number;
}

export interface OrchestrationMetrics {
  transcriptionTime: number;
  aiResponseTime: number;
  ttsGenerationTime: number;
  avatarPreparationTime: number;
  parallelPreparationTime: number;
  totalTime: number;
  timestamps: {
    transcriptionStart: number;
    transcriptionEnd: number;
    aiStart: number;
    aiEnd: number;
    ttsStart: number;
    ttsEnd: number;
    avatarStart: number;
    avatarEnd: number;
    playbackStart: number;
    playbackEnd: number;
  };
}

interface PendingConversation {
  userMessage: string;
  aiResponse: string;
  audioBlob?: Blob;
  audioDuration?: number;
}

/**
 * Callbacks for orchestrator events
 */
export interface OrchestratorCallbacks {
  onStateChange?: (state: ConversationState) => void;
  onTranscriptionComplete?: (text: string) => void;
  onAIResponseReceived?: (response: string) => void;
  onPreparationStart?: () => void;
  onPreparationComplete?: () => void;
  onPlaybackStart?: () => void;
  onPlaybackComplete?: () => void;
  onError?: (error: Error, context: string) => void;
  onMetrics?: (metrics: OrchestrationMetrics) => void;
}

export class ConversationOrchestrator {
  private stateMachine: ConversationStateMachine;
  private playbackManager: SpeechPlaybackManager;
  private pendingConversation: PendingConversation | null = null;
  private isProcessing = false;
  private metrics: Partial<OrchestrationMetrics> = {};
  private callbacks: OrchestratorCallbacks;
  private retryAttempts = 0;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 1000;

  // External dependencies (injected)
  private readonly generateTTS: (text: string) => Promise<{ blob: Blob; duration: number }>;
  private readonly prepareAvatarForSpeech: (aiResponse: string) => Promise<void>;
  private readonly videoElement: HTMLVideoElement;
  private readonly audioElement: HTMLAudioElement;

  constructor(
    videoElement: HTMLVideoElement,
    audioElement: HTMLAudioElement,
    generateTTS: (text: string) => Promise<{ blob: Blob; duration: number }>,
    prepareAvatarForSpeech: (text: string) => Promise<void>,
    callbacks: OrchestratorCallbacks = {}
  ) {
    this.stateMachine = new ConversationStateMachine();
    this.playbackManager = new SpeechPlaybackManager();
    this.videoElement = videoElement;
    this.audioElement = audioElement;
    this.generateTTS = generateTTS;
    this.prepareAvatarForSpeech = prepareAvatarForSpeech;
    this.callbacks = callbacks;

    this.setupStateListener();
  }

  /**
   * ============================================
   * MAIN ORCHESTRATION FLOW
   * ============================================
   */

  /**
   * Start listening for user speech
   */
  public async startListening(): Promise<void> {
    if (this.isProcessing) {
      console.warn('[Orchestrator] Already processing, ignoring startListening');
      return;
    }

    if (!this.stateMachine.transition('listening', 'startRecording')) {
      throw new Error('Cannot start listening in current state');
    }

    this.isProcessing = true;
    console.log('[Orchestrator] Listening started');
  }

  /**
   * Stop listening and begin transcription
   */
  public async stopListening(): Promise<void> {
    if (!this.stateMachine.isInState('listening')) {
      console.warn('[Orchestrator] Not in listening state');
      return;
    }

    if (!this.stateMachine.transition('transcribing', 'stopRecording')) {
      throw new Error('Cannot transition to transcribing');
    }

    console.log('[Orchestrator] Transcription phase started');
  }

  /**
   * Handle transcription completion
   */
  public async onTranscriptionComplete(userText: string): Promise<void> {
    if (!this.stateMachine.isInState('transcribing')) {
      console.warn('[Orchestrator] Not in transcribing state');
      return;
    }

    console.log('[Orchestrator] Transcription complete:', userText);

    if (this.callbacks.onTranscriptionComplete) {
      this.callbacks.onTranscriptionComplete(userText);
    }

    // Transition to thinking
    if (!this.stateMachine.transition('thinking', 'transcriptionComplete')) {
      throw new Error('Cannot transition to thinking');
    }

    this.pendingConversation = {
      userMessage: userText,
      aiResponse: '',
    };

    this.recordMetric('transcriptionEnd', Date.now());
  }

  /**
   * Handle AI response received
   * Trigger parallel TTS + Avatar preparation
   */
  public async onAIResponseReceived(aiResponse: string): Promise<void> {
    if (!this.stateMachine.isInState('thinking')) {
      console.warn('[Orchestrator] Not in thinking state');
      return;
    }

    console.log('[Orchestrator] AI response received:', aiResponse.substring(0, 100) + '...');

    if (!this.pendingConversation) {
      throw new Error('No pending conversation');
    }

    this.pendingConversation.aiResponse = aiResponse;

    if (this.callbacks.onAIResponseReceived) {
      this.callbacks.onAIResponseReceived(aiResponse);
    }

    this.recordMetric('aiEnd', Date.now());

    // Transition to preparation phase
    if (!this.stateMachine.transition('preparing', 'responseReceived')) {
      throw new Error('Cannot transition to preparing');
    }

    if (this.callbacks.onPreparationStart) {
      this.callbacks.onPreparationStart();
    }

    // Execute TTS + Avatar preparation in PARALLEL
    try {
      await this.executeParallelPreparation(aiResponse);

      if (!this.stateMachine.transition('speaking', 'preparationComplete')) {
        throw new Error('Cannot transition to speaking');
      }

      if (this.callbacks.onPreparationComplete) {
        this.callbacks.onPreparationComplete();
      }
    } catch (error) {
      console.error('[Orchestrator] Preparation failed:', error);

      if (!this.stateMachine.transition('error', 'preparationError')) {
        console.error('[Orchestrator] Failed to transition to error state');
      }

      if (this.callbacks.onError) {
        this.callbacks.onError(
          error instanceof Error ? error : new Error(String(error)),
          'preparation'
        );
      }

      throw error;
    }
  }

  /**
   * Start playback - both audio and video synchronized
   */
  public async startPlayback(): Promise<void> {
    if (!this.stateMachine.isInState('speaking')) {
      console.warn('[Orchestrator] Not in speaking state');
      return;
    }

    if (!this.pendingConversation?.audioBlob) {
      throw new Error('No audio prepared');
    }

    console.log('[Orchestrator] Starting playback');
    this.recordMetric('playbackStart', Date.now());

    try {
      // Setup audio
      const audioUrl = URL.createObjectURL(this.pendingConversation.audioBlob);
      this.audioElement.src = audioUrl;
      this.audioElement.volume = 1;

      // Prepare playback manager
      await this.playbackManager.preparePlayback({
        audio: this.audioElement,
        videoElement: this.videoElement,
        audioBlob: this.pendingConversation.audioBlob,
        duration: this.pendingConversation.audioDuration || 0,
      });

      // Start synchronized playback
      await this.playbackManager.startPlayback();

      if (this.callbacks.onPlaybackStart) {
        this.callbacks.onPlaybackStart();
      }

      // Wait for playback to complete
      await this.playbackManager.waitForPlaybackComplete();

      this.recordMetric('playbackEnd', Date.now());

      // Cleanup and complete
      await this.completeConversation();
    } catch (error) {
      console.error('[Orchestrator] Playback error:', error);

      if (!this.stateMachine.transition('error', 'playbackError')) {
        console.error('[Orchestrator] Failed to transition to error state');
      }

      if (this.callbacks.onError) {
        this.callbacks.onError(
          error instanceof Error ? error : new Error(String(error)),
          'playback'
        );
      }

      throw error;
    }
  }

  /**
   * ============================================
   * PARALLEL PREPARATION EXECUTION
   * ============================================
   */

  /**
   * Execute TTS + Avatar preparation in parallel
   * This is critical for reducing latency
   */
  private async executeParallelPreparation(aiResponse: string): Promise<void> {
    console.log('[Orchestrator] Starting parallel TTS + Avatar preparation');
    const parallelStartTime = Date.now();
    this.recordMetric('ttsStart', Date.now());
    this.recordMetric('avatarStart', Date.now());

    try {
      // Execute both operations in parallel
      const [ttsResult] = await Promise.all([
        this.generateTTSWithRetry(aiResponse),
        this.prepareAvatarWithRetry(aiResponse),
      ]);

      this.recordMetric('parallelPreparationTime', Date.now() - parallelStartTime);
      this.recordMetric('ttsEnd', Date.now());
      this.recordMetric('avatarEnd', Date.now());

      if (!this.pendingConversation) {
        throw new Error('Pending conversation lost');
      }

      this.pendingConversation.audioBlob = ttsResult.blob;
      this.pendingConversation.audioDuration = ttsResult.duration;

      console.log('[Orchestrator] Parallel preparation complete', {
        audioLength: ttsResult.blob.size,
        duration: ttsResult.duration,
      });
    } catch (error) {
      console.error('[Orchestrator] Parallel preparation failed:', error);
      throw error;
    }
  }

  /**
   * Generate TTS with retry logic
   */
  private async generateTTSWithRetry(
    text: string
  ): Promise<{ blob: Blob; duration: number }> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        console.log(`[Orchestrator] TTS generation attempt ${attempt}/${this.MAX_RETRIES}`);
        const result = await this.generateTTS(text);
        console.log('[Orchestrator] TTS generated successfully');
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[Orchestrator] TTS generation failed (attempt ${attempt}):`, lastError);

        if (attempt < this.MAX_RETRIES) {
          const delay = this.RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          console.log(`[Orchestrator] Retrying TTS in ${delay}ms`);
          await this.delay(delay);
        }
      }
    }

    throw new Error(`TTS generation failed after ${this.MAX_RETRIES} attempts: ${lastError?.message}`);
  }

  /**
   * Prepare avatar with retry logic
   */
  private async prepareAvatarWithRetry(text: string): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        console.log(`[Orchestrator] Avatar preparation attempt ${attempt}/${this.MAX_RETRIES}`);
        await this.prepareAvatarForSpeech(text);
        console.log('[Orchestrator] Avatar prepared successfully');
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[Orchestrator] Avatar preparation failed (attempt ${attempt}):`, lastError);

        if (attempt < this.MAX_RETRIES) {
          const delay = this.RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          console.log(`[Orchestrator] Retrying avatar in ${delay}ms`);
          await this.delay(delay);
        }
      }
    }

    throw new Error(`Avatar preparation failed after ${this.MAX_RETRIES} attempts: ${lastError?.message}`);
  }

  /**
   * ============================================
   * COMPLETION & CLEANUP
   * ============================================
   */

  /**
   * Complete conversation and cleanup
   */
  private async completeConversation(): Promise<void> {
    console.log('[Orchestrator] Conversation complete');

    if (!this.stateMachine.transition('completed', 'playbackComplete')) {
      console.error('[Orchestrator] Failed to transition to completed state');
    }

    // Emit metrics
    const finalMetrics = this.buildMetrics();
    if (this.callbacks.onMetrics) {
      this.callbacks.onMetrics(finalMetrics);
    }

    // Emit callback
    if (this.callbacks.onPlaybackComplete) {
      this.callbacks.onPlaybackComplete();
    }

    // Schedule cleanup and reset
    setTimeout(() => {
      this.reset();
    }, 500);
  }

  /**
   * Reset to idle state
   */
  public reset(): void {
    console.log('[Orchestrator] Resetting to idle');

    this.playbackManager.cleanup();
    this.stateMachine.transition('idle', 'reset');
    this.isProcessing = false;
    this.pendingConversation = null;
    this.metrics = {};
    this.retryAttempts = 0;
  }

  /**
   * Cancel current operation
   */
  public cancel(): void {
    console.log('[Orchestrator] Canceling current operation');

    this.playbackManager.stopPlayback();
    this.isProcessing = false;

    const currentState = this.stateMachine.getState();
    if (!['idle', 'completed', 'error'].includes(currentState)) {
      this.stateMachine.transition('idle', 'cancel');
    }
  }

  /**
   * ============================================
   * STATE & METRICS
   * ============================================
   */

  /**
   * Setup state change listener
   */
  private setupStateListener(): void {
    this.stateMachine.onStateChange((newState) => {
      console.log('[Orchestrator] State changed to:', newState);
      if (this.callbacks.onStateChange) {
        this.callbacks.onStateChange(newState);
      }
    });
  }

  /**
   * Record timing metric
   */
  private recordMetric(key: string, value: number): void {
    if (!this.metrics.timestamps) {
      this.metrics.timestamps = {
        transcriptionStart: 0,
        transcriptionEnd: 0,
        aiStart: 0,
        aiEnd: 0,
        ttsStart: 0,
        ttsEnd: 0,
        avatarStart: 0,
        avatarEnd: 0,
        playbackStart: 0,
        playbackEnd: 0,
      };
    }

    if (key === 'transcriptionStart') {
      this.metrics.timestamps.transcriptionStart = value;
    } else if (key === 'transcriptionEnd') {
      this.metrics.timestamps.transcriptionEnd = value;
      this.metrics.transcriptionTime = value - (this.metrics.timestamps.transcriptionStart || 0);
    } else if (key === 'aiStart') {
      this.metrics.timestamps.aiStart = value;
    } else if (key === 'aiEnd') {
      this.metrics.timestamps.aiEnd = value;
      this.metrics.aiResponseTime = value - (this.metrics.timestamps.aiStart || 0);
    } else if (key === 'ttsStart') {
      this.metrics.timestamps.ttsStart = value;
    } else if (key === 'ttsEnd') {
      this.metrics.timestamps.ttsEnd = value;
      this.metrics.ttsGenerationTime = value - (this.metrics.timestamps.ttsStart || 0);
    } else if (key === 'avatarStart') {
      this.metrics.timestamps.avatarStart = value;
    } else if (key === 'avatarEnd') {
      this.metrics.timestamps.avatarEnd = value;
      this.metrics.avatarPreparationTime = value - (this.metrics.timestamps.avatarStart || 0);
    } else if (key === 'playbackStart') {
      this.metrics.timestamps.playbackStart = value;
    } else if (key === 'playbackEnd') {
      this.metrics.timestamps.playbackEnd = value;
    } else if (key === 'parallelPreparationTime') {
      this.metrics.parallelPreparationTime = value;
    }
  }

  /**
   * Build complete metrics object
   */
  private buildMetrics(): OrchestrationMetrics {
    const timestamps = this.metrics.timestamps || {
      transcriptionStart: 0,
      transcriptionEnd: 0,
      aiStart: 0,
      aiEnd: 0,
      ttsStart: 0,
      ttsEnd: 0,
      avatarStart: 0,
      avatarEnd: 0,
      playbackStart: 0,
      playbackEnd: 0,
    };
    const transcriptionStart = timestamps.transcriptionStart || 0;
    const playbackEnd = timestamps.playbackEnd || Date.now();

    return {
      transcriptionTime: this.metrics.transcriptionTime || 0,
      aiResponseTime: this.metrics.aiResponseTime || 0,
      ttsGenerationTime: this.metrics.ttsGenerationTime || 0,
      avatarPreparationTime: this.metrics.avatarPreparationTime || 0,
      parallelPreparationTime: this.metrics.parallelPreparationTime || 0,
      totalTime: playbackEnd - transcriptionStart,
      timestamps: timestamps as any,
    };
  }

  /**
   * Get current state
   */
  public getState(): ConversationState {
    return this.stateMachine.getState();
  }

  /**
   * Check if processing
   */
  public isRunning(): boolean {
    return this.isProcessing || this.stateMachine.isProcessing();
  }

  /**
   * Get debug info
   */
  public getDebugInfo(): object {
    return {
      stateMachine: this.stateMachine.getDebugInfo(),
      playback: this.playbackManager.getDebugInfo(),
      isProcessing: this.isProcessing,
      metrics: this.metrics,
    };
  }

  /**
   * ============================================
   * UTILITIES
   * ============================================
   */

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Initialize orchestrator with AI metrics recording
   */
  public initializeMetrics(aiStartTime: number): void {
    this.recordMetric('aiStart', aiStartTime);
  }
}
