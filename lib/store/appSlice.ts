import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ChatMessage } from '@/lib/types';

export type SystemState = 'idle' | 'listening' | 'thinking' | 'waiting' | 'speaking';
export type InputMode = 'text' | 'voice';
export type ConnectionStatus = 'good' | 'poor' | 'disconnected';

interface AppState {
  messages: ChatMessage[];
  systemState: SystemState;
  inputMode: InputMode;
  isAvatarReady: boolean;
  isAvatarProcessing: boolean;
  hasInteracted: boolean;
  streamId: string | null;
  sessionId: string | null;
  videoUrl: string | null;
  connectionStatus: ConnectionStatus;
  useTTSFallback: boolean;
  error: { message: string; code: string } | null;
  /**
   * Rolling estimate of avatar "start speaking" lag in ms.
   * Computed from WebRTC `talk accepted` → DataChannel `stream/started`.
   * Used to time UI text reveal so it matches when the avatar actually moves.
   */
  avatarStartLagMs: number;
  /**
   * Monotonic counter incremented whenever avatar starts a segment.
   * Used by UI to reveal text sentence-by-sentence in sync with speaking.
   */
  avatarSegmentStartCount: number;
}

const initialState: AppState = {
  messages: [],
  systemState: 'idle',
  inputMode: 'text',
  isAvatarReady: false,
  isAvatarProcessing: false,
  hasInteracted: false,
  streamId: null,
  sessionId: null,
  videoUrl: null,
  connectionStatus: 'disconnected',
  useTTSFallback: false,
  error: null,
  avatarStartLagMs: 1500,
  avatarSegmentStartCount: 0,
};

export const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    addMessage: (state, action: PayloadAction<ChatMessage>) => {
      state.messages.push(action.payload);
    },
    updateLastMessage: (state, action: PayloadAction<string>) => {
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant') {
        lastMessage.content = action.payload;
      }
    },
    appendLastMessage: (state, action: PayloadAction<string>) => {
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant') {
        const spacer = lastMessage.content.length > 0 ? ' ' : '';
        lastMessage.content += spacer + action.payload;
      }
    },
    setSystemState: (state, action: PayloadAction<SystemState>) => {
      if (state.systemState === action.payload) return;
      state.systemState = action.payload;
    },
    setAvatarReady: (state, action: PayloadAction<boolean>) => {
      if (state.isAvatarReady === action.payload) return;
      state.isAvatarReady = action.payload;
    },
    setIsAvatarProcessing: (state, action: PayloadAction<boolean>) => {
      if (state.isAvatarProcessing === action.payload) return;
      state.isAvatarProcessing = action.payload;
    },
    setHasInteracted: (state, action: PayloadAction<boolean>) => {
      state.hasInteracted = action.payload;
    },
    setStreamSession: (state, action: PayloadAction<{ streamId: string | null; sessionId: string | null }>) => {
      state.streamId = action.payload.streamId;
      state.sessionId = action.payload.sessionId;
    },
    setVideoUrl: (state, action: PayloadAction<string | null>) => {
      if (state.videoUrl === action.payload) return;
      state.videoUrl = action.payload;
    },
    setConnectionStatus: (state, action: PayloadAction<ConnectionStatus>) => {
      if (state.connectionStatus === action.payload) return;
      state.connectionStatus = action.payload;
    },
    setInputMode: (state, action: PayloadAction<InputMode>) => {
      state.inputMode = action.payload;
    },
    setUseTTSFallback: (state, action: PayloadAction<boolean>) => {
      if (state.useTTSFallback === action.payload) return;
      state.useTTSFallback = action.payload;
    },
    setError: (state, action: PayloadAction<{ message: string; code: string } | null>) => {
      if (
        state.error?.message === action.payload?.message &&
        state.error?.code === action.payload?.code
      ) return;
      state.error = action.payload;
    },
    recordAvatarStartLagMs: (state, action: PayloadAction<number>) => {
      const sample = action.payload;
      if (!Number.isFinite(sample) || sample <= 0) return;

      // Clamp to ignore wild outliers (tab backgrounding, stalls, etc.)
      const clamped = Math.min(5000, Math.max(200, sample));

      // EWMA smoothing — stable but responsive
      const alpha = 0.2;
      state.avatarStartLagMs = Math.round(state.avatarStartLagMs * (1 - alpha) + clamped * alpha);
    },
    bumpAvatarSegmentStartCount: (state) => {
      state.avatarSegmentStartCount += 1;
    },
    clearHistory: (state) => {
      state.messages = [];
    },
  },
});

export const {
  addMessage,
  updateLastMessage,
  appendLastMessage,
  setSystemState,
  setAvatarReady,
  setIsAvatarProcessing,
  setHasInteracted,
  setStreamSession,
  setVideoUrl,
  setConnectionStatus,
  setInputMode,
  setUseTTSFallback,
  setError,
  recordAvatarStartLagMs,
  bumpAvatarSegmentStartCount,
  clearHistory,
} = appSlice.actions;

export default appSlice.reducer;
