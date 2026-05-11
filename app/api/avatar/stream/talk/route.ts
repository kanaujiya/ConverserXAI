import { NextResponse } from 'next/server';

const DID_API_URL = 'https://api.d-id.com';

function getHeaders() {
  return {
    Authorization: `Basic ${process.env.DID_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

export async function POST(req: Request) {
  try {
    const { streamId, script, text, sessionId } = await req.json();
    const inputScript = script || text;
    
    console.log(`[API] Talk request for stream ${streamId}, text length: ${inputScript?.length}`);

    const res = await fetch(`${DID_API_URL}/talks/streams/${streamId}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        script: {
          type: 'text',
          input: inputScript,
          provider: {
            type: 'microsoft',
            voice_id: process.env.DID_VOICE_ID || 'en-US-JennyNeural',
          }
        },
        session_id: sessionId
      }),
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[API] D-ID talk request failed with status ${res.status}:`, errorText);
      return NextResponse.json({ error: errorText }, { status: res.status });
    }
    
    const data = await res.json();
    console.log(`[API] D-ID talk request successful:`, data.id);
    return NextResponse.json(data);
  } catch (error: any) {
    console.error(`[API] Talk route error:`, error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
