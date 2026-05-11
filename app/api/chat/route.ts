import { streamText } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import type { ChatRequest } from '@/lib/types';
import { mapError } from '@/lib/utils/error-mapping';

const LLM_MODEL = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';
const CHAT_HISTORY_LIMIT = 12;
const DEFAULT_MAX_OUTPUT_TOKENS = Number(process.env.LLM_MAX_OUTPUT_TOKENS ?? 100);
const BASE_SYSTEM_PROMPT =
  'You are a conversational AI assistant. Respond in a short, natural, and human-like manner. ' +
  'Keep answers concise, clear, and informative in 1–2 lines only. ' +
  'Avoid unnecessary explanations, repeated context, or overly detailed responses. ' +
  'If the user question is clear, answer directly without asking for extra clarification. ' +
  'Only ask a clarifying question if the query is genuinely ambiguous. ' +
  'Maintain a friendly, conversational tone and keep response latency fast for real-time avatar interaction.';

function personaSystemPrompt(persona?: string | null): string {
  const key = (persona ?? '').trim().toLowerCase();
  if (!key) return BASE_SYSTEM_PROMPT;

  switch (key) {
    case 'science teacher':
    case 'science_teacher':
    case 'science-teacher':
      return (
        BASE_SYSTEM_PROMPT +
        ' You are also a science teacher: explain concepts clearly with simple examples, ' +
        'use a friendly teaching tone, and add a little extra detail for conceptual questions.'
      );
    case 'interview assistant':
    case 'interview_assistant':
    case 'interview-assistant':
      return (
        BASE_SYSTEM_PROMPT +
        ' You are also an interview assistant: ask clarifying questions when needed, ' +
        'suggest structured answers, and help the user practice concise but complete responses.'
      );
    case 'customer support agent':
    case 'customer_support':
    case 'customer-support':
      return (
        BASE_SYSTEM_PROMPT +
        ' You are also a customer support agent: be empathetic, confirm understanding, ' +
        'and provide step-by-step troubleshooting with clear next actions.'
      );
    case 'ai tutor':
    case 'tutor':
    case 'ai_tutor':
      return (
        BASE_SYSTEM_PROMPT +
        ' You are also an AI tutor: teach step-by-step, check for understanding, and provide small examples.'
      );
    default:
      // Allow custom personas (passed by UI) without encouraging verbosity.
      return BASE_SYSTEM_PROMPT + ` Persona: ${persona}.`;
  }
}
const BASE_URL = process.env.LLM_BASE_URL || undefined;

let cachedGroqProvider:
  | { apiKey: string; baseURL?: string; provider: ReturnType<typeof createGroq> }
  | null = null;

function getGroqProvider(apiKey: string) {
  if (
    cachedGroqProvider &&
    cachedGroqProvider.apiKey === apiKey &&
    cachedGroqProvider.baseURL === BASE_URL
  ) {
    return cachedGroqProvider.provider;
  }
  const provider = createGroq({ apiKey, baseURL: BASE_URL });
  cachedGroqProvider = { apiKey, baseURL: BASE_URL, provider };
  return provider;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: 'INVALID_BODY', message: 'Invalid request body' } }, { status: 400 });
  }

  if (!body.message || !body.message.trim()) {
    return Response.json({ error: { code: 'EMPTY_MESSAGE', message: 'Message cannot be empty' } }, { status: 400 });
  }

  const apiKey = process.env.GROQ_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: { code: 'CONFIG_ERROR', message: 'Server configuration error' } }, { status: 500 });
  }

  try {
    const history = (body.history ?? []).slice(-CHAT_HISTORY_LIMIT);
    const result = streamText({
      model: getGroqProvider(apiKey)(LLM_MODEL),
      system: personaSystemPrompt(body.persona),
      messages: [
        ...history.map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.content })),
        { role: 'user', content: body.message }
      ],
      temperature: 0.7,
      maxOutputTokens: Number.isFinite(DEFAULT_MAX_OUTPUT_TOKENS) ? DEFAULT_MAX_OUTPUT_TOKENS : 100,
    });

    return result.toTextStreamResponse({
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    console.error('[Chat API] LLM error:', err);
    
    const status = err?.status || 500;
    const mapped = mapError(status, 'AI', err?.message);
    
    return Response.json(
      { error: { code: mapped.code, message: mapped.message } },
      { status }
    );
  }
}
