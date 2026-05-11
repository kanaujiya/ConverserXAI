import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

vi.mock('ai', () => ({
  streamText: vi.fn(),
}));

import { streamText } from 'ai';

const mockedStreamText = vi.mocked(streamText);

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/chat', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.LLM_API_KEY = 'test-llm-key';
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty message', async () => {
    const res = await POST(makeRequest({ message: '', history: [] }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for whitespace-only message', async () => {
    const res = await POST(makeRequest({ message: '   \t\n  ', history: [] }));
    expect(res.status).toBe(400);
  });

  it('returns 500 when LLM API key is missing', async () => {
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const res = await POST(makeRequest({ message: 'hello', history: [] }));
    expect(res.status).toBe(500);
  });

  it('returns a streamed text response', async () => {
    mockedStreamText.mockReturnValue({
      toTextStreamResponse: () =>
        new Response('Hello back!', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }),
    } as any);

    const res = await POST(makeRequest({ message: 'hello', history: [] }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('Hello back!');
  });

  it('returns 500 when LLM service throws', async () => {
    mockedStreamText.mockImplementation(() => {
      throw new Error('API down');
    });
    const res = await POST(makeRequest({ message: 'hello', history: [] }));
    expect(res.status).toBe(500);
  });
});
