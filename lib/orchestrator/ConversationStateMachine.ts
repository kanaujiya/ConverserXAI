/**
 * Conversation State Machine
 * Enforces strict state transitions and prevents invalid operations
 */

export type ConversationState = 
  | 'idle'           // Ready for new input
  | 'listening'      // Recording user speech
  | 'transcribing'   // Converting speech to text
  | 'thinking'       // AI generating response
  | 'preparing'      // Generating TTS + preparing avatar
  | 'speaking'       // Playing back audio + animation
  | 'completed'      // Conversation complete, ready for next
  | 'error';         // Error state

interface StateTransition {
  from: ConversationState;
  to: ConversationState;
  action?: string;
}

// Valid state transitions
const VALID_TRANSITIONS: StateTransition[] = [
  // Listening flow
  { from: 'idle', to: 'listening', action: 'startRecording' },
  { from: 'listening', to: 'transcribing', action: 'stopRecording' },
  { from: 'listening', to: 'error', action: 'recordingError' },
  
  // Transcription flow
  { from: 'transcribing', to: 'thinking', action: 'transcriptionComplete' },
  { from: 'transcribing', to: 'error', action: 'transcriptionError' },
  
  // AI thinking flow
  { from: 'thinking', to: 'preparing', action: 'responseReceived' },
  { from: 'thinking', to: 'error', action: 'aiError' },
  
  // Preparation flow (TTS + Avatar)
  { from: 'preparing', to: 'speaking', action: 'preparationComplete' },
  { from: 'preparing', to: 'error', action: 'preparationError' },
  
  // Speaking flow
  { from: 'speaking', to: 'completed', action: 'playbackComplete' },
  { from: 'speaking', to: 'error', action: 'playbackError' },
  
  // Completion flow
  { from: 'completed', to: 'idle', action: 'reset' },
  
  // Error recovery
  { from: 'error', to: 'idle', action: 'resetFromError' },
  
  // Direct idle reset
  { from: 'listening', to: 'idle', action: 'cancel' },
  { from: 'transcribing', to: 'idle', action: 'cancel' },
  { from: 'thinking', to: 'idle', action: 'cancel' },
  { from: 'preparing', to: 'idle', action: 'cancel' },
  { from: 'speaking', to: 'idle', action: 'cancel' },
];

export class ConversationStateMachine {
  private currentState: ConversationState = 'idle';
  private stateHistory: Array<{ state: ConversationState; timestamp: number }> = [];
  private stateListeners: Array<(newState: ConversationState, oldState: ConversationState) => void> = [];
  private readonly MAX_HISTORY = 50;

  constructor() {
    this.recordStateChange('idle');
  }

  /**
   * Attempt state transition with validation
   */
  public canTransition(targetState: ConversationState): boolean {
    return VALID_TRANSITIONS.some(
      t => t.from === this.currentState && t.to === targetState
    );
  }

  /**
   * Perform state transition
   */
  public transition(targetState: ConversationState, action?: string): boolean {
    if (!this.canTransition(targetState)) {
      console.error(
        `[StateMachine] Invalid transition: ${this.currentState} → ${targetState}`,
        action ? `(action: ${action})` : ''
      );
      return false;
    }

    const previousState = this.currentState;
    this.currentState = targetState;
    this.recordStateChange(targetState);

    console.log(
      `[StateMachine] Transition: ${previousState} → ${targetState}`,
      action ? `(${action})` : ''
    );

    // Notify listeners
    this.stateListeners.forEach(listener => listener(targetState, previousState));

    return true;
  }

  /**
   * Get current state
   */
  public getState(): ConversationState {
    return this.currentState;
  }

  /**
   * Check if in specific state
   */
  public isInState(state: ConversationState): boolean {
    return this.currentState === state;
  }

  /**
   * Check if processing (not idle or completed)
   */
  public isProcessing(): boolean {
    return !['idle', 'completed', 'error'].includes(this.currentState);
  }

  /**
   * Subscribe to state changes
   */
  public onStateChange(
    listener: (newState: ConversationState, oldState: ConversationState) => void
  ): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter(l => l !== listener);
    };
  }

  /**
   * Get state transition timeline
   */
  public getHistory(): Array<{ state: ConversationState; timestamp: number }> {
    return [...this.stateHistory];
  }

  /**
   * Get timing for specific state
   */
  public getStateTiming(state: ConversationState): number | null {
    const entry = this.stateHistory.find(h => h.state === state);
    if (!entry) return null;

    const nextEntry = this.stateHistory[this.stateHistory.indexOf(entry) + 1];
    if (!nextEntry) return null;

    return nextEntry.timestamp - entry.timestamp;
  }

  /**
   * Reset state machine
   */
  public reset(): void {
    if (this.currentState !== 'idle') {
      this.transition('idle', 'reset');
    }
  }

  /**
   * Record state change in history
   */
  private recordStateChange(state: ConversationState): void {
    this.stateHistory.push({
      state,
      timestamp: Date.now(),
    });

    if (this.stateHistory.length > this.MAX_HISTORY) {
      this.stateHistory.shift();
    }
  }

  /**
   * Get debug info
   */
  public getDebugInfo(): object {
    return {
      currentState: this.currentState,
      isProcessing: this.isProcessing(),
      history: this.stateHistory.slice(-10),
      transitionsAvailable: VALID_TRANSITIONS
        .filter(t => t.from === this.currentState)
        .map(t => t.to),
    };
  }
}
