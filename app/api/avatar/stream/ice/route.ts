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
    const { streamId, candidate, sdpMid, sdpMLineIndex, sessionId } = await req.json();
    
    const res = await fetch(`${DID_API_URL}/talks/streams/${streamId}/ice`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ 
        candidate, 
        sdpMid, 
        sdpMLineIndex, 
        session_id: sessionId 
      }),
    });
    
    if (!res.ok) {
      const error = await res.text();
      return NextResponse.json({ error }, { status: res.status });
    }
    
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
