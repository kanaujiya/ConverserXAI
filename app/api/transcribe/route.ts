import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req: Request) {
  try {
    const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
    }

    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    // Guard: reject excessively large uploads
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `Audio file too large (max 10 MB, received ${(file.size / 1_000_000).toFixed(1)} MB)` },
        { status: 413 },
      );
    }

    // Guard: reject near-empty blobs (too short to contain real speech)
    if (file.size < 1000) {
      return NextResponse.json(
        { error: 'Audio recording too short. Please speak for at least a second.' },
        { status: 422 },
      );
    }

    // Use Groq's whisper model when the base URL is Groq, otherwise OpenAI whisper-1
    const isGroq = LLM_BASE_URL.includes('groq');
    const model = isGroq ? 'whisper-large-v3' : 'whisper-1';

    const client = new OpenAI({ apiKey, baseURL: LLM_BASE_URL });

    const response = await client.audio.transcriptions.create({
      file,
      model,
      response_format: 'json',
    });

    const text = response.text?.trim() ?? '';

    // Return 422 if Whisper produced no usable transcript (e.g. pure silence / noise)
    if (!text) {
      return NextResponse.json(
        { error: 'No speech detected in the recording.' },
        { status: 422 },
      );
    }

    return NextResponse.json({ text });
  } catch (error: any) {
    console.error('[Transcribe API] Error:', error);

    // Surface quota / auth errors with a clearer message
    if (error?.status === 429) {
      return NextResponse.json({ error: 'API rate limit exceeded. Please try again shortly.' }, { status: 429 });
    }
    if (error?.status === 401) {
      return NextResponse.json({ error: 'Invalid API key.' }, { status: 401 });
    }

    return NextResponse.json(
      { error: error.message || 'Failed to transcribe audio' },
      { status: 500 },
    );
  }
}
