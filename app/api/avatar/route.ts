import { startAvatarVideo, checkTalkStatus } from '@/lib/did';
import { mapError } from '@/lib/utils/error-mapping';

// POST /api/avatar — kick off D-ID video generation, return talk ID immediately
export async function POST(request: Request): Promise<Response> {
  console.log('[API] POST /api/avatar - Starting generation');
  let body: { text: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!body.text?.trim()) {
    console.warn('[API] POST /api/avatar - Empty text provided');
    return Response.json({ error: 'Text is required' }, { status: 400 });
  }

  if (!process.env.DID_API_KEY) {
    console.error('[API] POST /api/avatar - Missing DID_API_KEY');
    return Response.json({ error: 'D-ID not configured' }, { status: 500 });
  }

  const result = await startAvatarVideo(body.text);
  if (result.error) {
    const mapped = mapError(500, 'Avatar', result.error);
    return Response.json({ error: mapped.message, code: mapped.code }, { status: 500 });
  }

  console.log('[API] POST /api/avatar - Success, Talk ID:', result.talkId);
  return Response.json({ talkId: result.talkId });
}

// GET /api/avatar?id=xxx — single status check for D-ID video
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const talkId = searchParams.get('id');

  if (!talkId) {
    return Response.json({ error: 'Missing talk ID' }, { status: 400 });
  }

  console.log('[API] GET /api/avatar - Checking status for:', talkId);
  const result = await checkTalkStatus(talkId);
  
  if (result.error) {
    console.error('[API] GET /api/avatar - Status check error:', result.error);
    const mapped = mapError(500, 'Avatar', result.error);
    return Response.json({ status: 'error', error: mapped.message }, { status: 500 });
  }

  return Response.json(result);
}
