import { NextResponse } from 'next/server';

const DID_API_URL = 'https://api.d-id.com';

function getHeaders() {
  return {
    Authorization: `Basic ${process.env.DID_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

export async function POST(req: Request) {
  const maxRetries = 2;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const res = await fetch(`${DID_API_URL}/talks/streams`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          source_url: process.env.DID_SOURCE_URL || 'https://create-images-results.d-id.com/DefaultPresenters/Noelle_f/image.png'
        }),
      });
      
      if (!res.ok) {
        const error = await res.text();
        
        // If limit reached, wait and retry
        if (res.status === 403 && attempt < maxRetries) {
          console.warn(`[API] Max sessions reached. Retrying in 4s... (Attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 4000));
          attempt++;
          continue;
        }

        if (res.status === 403) {
          return NextResponse.json(
            { error: 'MAX_SESSIONS', message: 'D-ID session limit reached. Please close other tabs and wait 10 seconds.' },
            { status: 403 }
          );
        }

        return NextResponse.json({ error }, { status: res.status });
      }
      
      const data = await res.json();
      return NextResponse.json(data);
    } catch (error: any) {
      if (attempt < maxRetries) {
        attempt++;
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
}

export async function DELETE(req: Request) {
  try {
    const { streamId, sessionId } = await req.json();
    if (!streamId || !sessionId) return NextResponse.json({ error: 'Stream ID and Session ID required' }, { status: 400 });

    const res = await fetch(`${DID_API_URL}/talks/streams/${streamId}`, {
      method: 'DELETE',
      headers: getHeaders(),
      body: JSON.stringify({ session_id: sessionId }),
    });

    return NextResponse.json({ success: res.ok });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
