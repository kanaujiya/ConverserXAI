import { NextResponse } from 'next/server';
import { generateIceServers } from 'simli-client';

const SIMLI_API_URL = 'https://api.simli.ai';

/**
 * POST /api/simli/session
 * Fetches a Simli session token server-side so the API key stays secret.
 */
export async function POST() {
  const apiKey = process.env.SIMLI_API_KEY;
  const faceId = process.env.SIMLI_FACE_ID;

  if (!apiKey || !faceId) {
    return NextResponse.json(
      { error: 'SIMLI_API_KEY or SIMLI_FACE_ID not configured' },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(`${SIMLI_API_URL}/compose/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-simli-api-key': apiKey,
      },
      body: JSON.stringify({
        faceId,
        handleSilence: true,
        maxSessionLength: 600,
        maxIdleTime: 180,
        audioInputFormat: 'pcm16',
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      console.error('[Simli] Session token error:', res.status, error);
      return NextResponse.json({ error }, { status: res.status });
    }

    const data = await res.json();
    const iceServers = await generateIceServers(apiKey);
    console.log('[Simli] Returning ICE servers count:', iceServers?.length);
    
    return NextResponse.json({ ...data, ice_servers: iceServers }); // { session_token: '...', ice_servers: [...] }
  } catch (err: any) {
    console.error('[Simli] Session fetch error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
