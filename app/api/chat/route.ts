import { streamText } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import type { ChatRequest } from '@/lib/types';
import { mapError } from '@/lib/utils/error-mapping';

const LLM_MODEL = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';
const CHAT_HISTORY_LIMIT = 12;
const DEFAULT_MAX_OUTPUT_TOKENS = Number(process.env.LLM_MAX_OUTPUT_TOKENS ?? 100);
const CHAT_CACHE_TTL_MS = Number(process.env.CHAT_CACHE_TTL_MS ?? 60_000);
const CHAT_CACHE_MAX_ENTRIES = Number(process.env.CHAT_CACHE_MAX_ENTRIES ?? 200);
const CHAT_SEMANTIC_HISTORY_DEPTH = Number(process.env.CHAT_SEMANTIC_HISTORY_DEPTH ?? 2);
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

type ChatCacheEntry = { text: string; expiresAt: number; createdAt: number };
const semanticResponseCache = new Map<string, ChatCacheEntry>();

function normalizeForCache(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:]+$/g, '')
    .toLowerCase();
}

function buildSemanticCacheKey(body: ChatRequest): string {
  const persona = (body.persona ?? '').trim().toLowerCase() || 'default';
  const history = (body.history ?? [])
    .slice(-CHAT_SEMANTIC_HISTORY_DEPTH)
    .map((msg) => `${msg.role}:${normalizeForCache(msg.content)}`)
    .join('|');
  const message = normalizeForCache(body.message);
  return `${LLM_MODEL}|${persona}|${history}|${message}`;
}

function getCachedResponse(cacheKey: string): string | null {
  const hit = semanticResponseCache.get(cacheKey);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    semanticResponseCache.delete(cacheKey);
    return null;
  }
  return hit.text;
}

function pruneCacheIfNeeded() {
  if (semanticResponseCache.size <= CHAT_CACHE_MAX_ENTRIES) return;
  const entries = [...semanticResponseCache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
  const removeCount = Math.max(1, entries.length - CHAT_CACHE_MAX_ENTRIES);
  for (let i = 0; i < removeCount; i += 1) {
    semanticResponseCache.delete(entries[i][0]);
  }
}

function setCachedResponse(cacheKey: string, text: string) {
  if (!text.trim()) return;
  semanticResponseCache.set(cacheKey, {
    text,
    createdAt: Date.now(),
    expiresAt: Date.now() + CHAT_CACHE_TTL_MS,
  });
  pruneCacheIfNeeded();
}

function createTextStreamResponse(text: string, cacheState: 'HIT' | 'MISS'): Response {
  const encoder = new TextEncoder();
  const sourceText = text ?? '';
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (!sourceText.length) {
        controller.close();
        return;
      }
      // Micro-batched replay preserves streaming behavior while staying near-instant.
      const chunks = Math.min(6, Math.max(1, Math.ceil(sourceText.length / 30)));
      const chunkSize = Math.ceil(sourceText.length / chunks);
      for (let i = 0; i < sourceText.length; i += chunkSize) {
        controller.enqueue(encoder.encode(sourceText.slice(i, i + chunkSize)));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Chat-Cache': cacheState,
      Connection: 'keep-alive',
    },
  });
}

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
    const cacheKey = buildSemanticCacheKey(body);
    const cachedText = getCachedResponse(cacheKey);
    if (cachedText) {
      return createTextStreamResponse(cachedText, 'HIT');
    }

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

    const upstream = result.toTextStreamResponse({
      headers: {
        'Cache-Control': 'no-store',
        'X-Chat-Cache': 'MISS',
        Connection: 'keep-alive',
      },
    });

    const bodyStream = upstream.body;
    if (!bodyStream) {
      return upstream;
    }

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let fullText = '';

    const transformed = new ReadableStream<Uint8Array>({
      start(controller) {
        const reader = bodyStream.getReader();
        const pump = (): void => {
          void reader.read().then(({ done, value }) => {
            if (done) {
              const tail = decoder.decode();
              if (tail) fullText += tail;
              setCachedResponse(cacheKey, fullText);
              controller.close();
              return;
            }
            if (value) {
              const chunk = decoder.decode(value, { stream: true });
              fullText += chunk;
              controller.enqueue(encoder.encode(chunk));
            }
            pump();
          }).catch((streamErr) => {
            controller.error(streamErr);
          });
        };
        pump();
      },
    });

    return new Response(transformed, {
      headers: upstream.headers,
      status: upstream.status,
      statusText: upstream.statusText,
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
