export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  videoUrl?: string | null;
}

export interface ChatRequest {
  message: string;
  history: ChatMessage[];
  persona?: string;
}

export interface ChatResponse {
  text: string;
  videoUrl: string | null;
  error?: string;
}
