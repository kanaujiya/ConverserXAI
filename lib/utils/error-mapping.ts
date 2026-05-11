export type ErrorProvider = 'AI' | 'Avatar' | 'System';

export interface AppError {
  code: string;
  message: string;
  provider: ErrorProvider;
  status?: number;
}

export function mapError(status: number, provider: ErrorProvider, rawMessage?: string): AppError {
  // Common status code mappings
  if (status === 401) {
    return {
      code: 'UNAUTHORIZED',
      message: 'Authentication failed. Please check the API configuration.',
      provider,
      status,
    };
  }

  if (status === 402) {
    return {
      code: 'INSUFFICIENT_CREDITS',
      message: provider === 'Avatar' 
        ? 'Avatar generation credits are exhausted. Please try again later.' 
        : 'Credits exhausted for this service.',
      provider,
      status,
    };
  }

  if (status === 429) {
    return {
      code: 'RATE_LIMIT_EXCEEDED',
      message: provider === 'AI'
        ? 'AI response limit reached. Please try again later or upgrade the plan.'
        : 'Too many requests. Please slow down.',
      provider,
      status,
    };
  }

  if (status === 504 || status === 408) {
    return {
      code: 'TIMEOUT',
      message: 'The request timed out. Please check your connection and try again.',
      provider,
      status,
    };
  }

  // Fallback for specific raw messages
  const lowerMessage = rawMessage?.toLowerCase() || '';
  if (lowerMessage.includes('quota') || lowerMessage.includes('limit exceeded')) {
    return {
      code: 'QUOTA_EXCEEDED',
      message: `${provider} limit reached. Please try again later.`,
      provider,
      status,
    };
  }

  if (lowerMessage.includes('max user sessions reached')) {
    return {
      code: 'MAX_SESSIONS',
      message: 'Too many active avatar sessions. Please refresh or try again in a moment.',
      provider,
      status,
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: 'Something went wrong. Please try again.',
    provider,
    status,
  };
}
