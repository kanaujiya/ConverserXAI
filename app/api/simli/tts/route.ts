import { NextResponse } from 'next/server';

const TARGET_RATE = 16000;
const OPENAI_RATE = 24000;

/** Linear-interpolation downsample Int16 PCM from inputRate → outputRate */
function downsample(buf: ArrayBuffer, inRate: number, outRate: number): ArrayBuffer {
  const inp = new Int16Array(buf);
  const ratio = inRate / outRate;
  const outLen = Math.floor(inp.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s1 = inp[idx];
    const s2 = idx + 1 < inp.length ? inp[idx + 1] : s1;
    out[i] = Math.round(s1 + frac * (s2 - s1));
  }
  return out.buffer;
}

/**
 * POST /api/simli/tts
 * Converts text to PCM16 @ 16kHz and returns raw bytes for Simli.
 *
 * Primary:  OpenAI TTS (OPENAI_API_KEY env var)  – returns 24kHz PCM, we downsample to 16kHz.
 * Fallback: 0.5 s of silence so Simli stays connected (browser TTS handles audio separately).
 */
export async function POST(req: Request) {
  try {
    const { text } = await req.json();
    if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });

    // ── OpenAI TTS ──────────────────────────────────────────────────────────
    if (process.env.OPENAI_API_KEY) {
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: text,
          voice: process.env.OPENAI_TTS_VOICE || 'alloy',
          response_format: 'pcm', // raw PCM16 at 24kHz
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        let errJson;
        try { errJson = JSON.parse(errText); } catch { errJson = { error: { message: errText } }; }
        
        console.error('[Simli TTS] OpenAI error:', errJson);
        
        // If it's a quota error, return a specific status so the client can show a warning
        const isQuota = errJson.error?.code === 'insufficient_quota';
        return NextResponse.json(
          { 
            error: errJson.error?.message || 'OpenAI TTS failed',
            code: errJson.error?.code,
            isQuota 
          }, 
          { status: isQuota ? 402 : 500 }
        );
      } else {
        const pcm24 = await res.arrayBuffer();
        const pcm16 = downsample(pcm24, OPENAI_RATE, TARGET_RATE);
        return new Response(pcm16, {
          headers: { 
            'Content-Type': 'audio/pcm', 
            'Content-Length': String(pcm16.byteLength),
            'X-Audio-Duration': String(pcm16.byteLength / (TARGET_RATE * 2)) // length / (rate * 2 bytes per sample)
          },
        });
      }
    }

    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
  } catch (err: any) {
    console.error('[Simli TTS] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
