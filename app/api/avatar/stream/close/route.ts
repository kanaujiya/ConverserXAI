import { NextResponse } from 'next/server';

const DID_API_URL = 'https://api.d-id.com';

function getHeaders() {
  return {
    Authorization: `Basic ${process.env.DID_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

/**
 * POST /api/avatar/stream/close
 * Called by navigator.sendBeacon on page unload to clean up the D-ID stream session.
 * sendBeacon requires a POST endpoint; body is JSON { streamId, sessionId }.
 */
export async function POST(req: Request) {
  try {
    const { streamId, sessionId } = await req.json();
    if (!streamId || !sessionId) {
      return NextResponse.json({ error: 'streamId and sessionId required' }, { status: 400 });
    }

    await fetch(`${DID_API_URL}/talks/streams/${streamId}`, {
      method: 'DELETE',
      headers: getHeaders(),
      body: JSON.stringify({ session_id: sessionId }),
    });

    // Return 200 even if D-ID errors — page is unloading anyway
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
