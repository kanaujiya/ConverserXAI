import OpenAI from 'openai';
import { ChatMessage } from './types';

// Use Groq's free OpenAI-compatible API by default, fall back to OpenAI if configured
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';

const DEFAULT_MAX_TOKENS = Number(process.env.LLM_MAX_OUTPUT_TOKENS ?? 100);
const SYSTEM_PROMPT =
  'You are a conversational AI assistant. Respond in a short, natural, and human-like manner. ' +
  'Keep answers concise, clear, and informative in 1–2 lines only. ' +
  'Avoid unnecessary explanations, repeated context, or overly detailed responses. ' +
  'If the user question is clear, answer directly without asking for extra clarification. ' +
  'Only ask a clarifying question if the query is genuinely ambiguous. ' +
  'Maintain a friendly, conversational tone and keep response latency fast for real-time avatar interaction.';

export interface GenerateResponseParams {
  message: string;
  history: ChatMessage[];
}

/**
 * Builds the messages array for the OpenAI chat completions API.
 * System prompt first, then conversation history, then the current user message.
 */
export function buildMessages(
  message: string,
  history: ChatMessage[],
): OpenAI.ChatCompletionMessageParam[] {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    })),
    { role: 'user', content: message },
  ];
  return messages;
}

/**
 * Generates a chat response from OpenAI given a user message and conversation history.
 * Throws on API errors with a descriptive message.
 */
export async function generateChatResponse(
  params: GenerateResponseParams,
): Promise<string> {
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('LLM_API_KEY is not configured');
  }

  const client = new OpenAI({ apiKey, baseURL: LLM_BASE_URL });
  const messages = buildMessages(params.message, params.history);

  try {
    const response = await client.chat.completions.create({
      model: LLM_MODEL,
      messages,
      max_tokens: Number.isFinite(DEFAULT_MAX_TOKENS) ? DEFAULT_MAX_TOKENS : 100,
      temperature: 0.7,
    });

    const text = response.choices[0]?.message?.content;
    if (!text) {
      throw new Error('No response content from OpenAI');
    }

    return text;
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      console.error('[OpenAI] API error:', error.status, error.message);
      throw new Error(`Failed to generate AI response: ${error.message}`);
    }
    if (error instanceof Error) {
      console.error('[OpenAI] Error:', error.message);
      throw new Error(`Failed to generate AI response: ${error.message}`);
    }
    throw new Error('Failed to generate AI response');
  }
}
