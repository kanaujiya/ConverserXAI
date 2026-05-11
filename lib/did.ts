const DID_API_BASE = 'https://api.d-id.com';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120000; // 2 minutes — D-ID is faster than HeyGen

// Default presenter image from D-ID
const DEFAULT_SOURCE_URL =
  'https://create-images-results.d-id.com/DefaultPresenters/Noelle_f/image.png';

export interface GenerateVideoResult {
  videoUrl: string | null;
  error?: string;
}

function getAuthHeader(): string {
  const apiKey = process.env.DID_API_KEY;
  if (!apiKey) throw new Error('DID_API_KEY is missing');
  
  // Ensure we don't double-prefix if user provided "Basic ..."
  const header = apiKey.startsWith('Basic ') ? apiKey : `Basic ${apiKey}`;
  return header;
}

/**
 * Single status check for D-ID talk. Returns current status.
 * Used by the GET /api/avatar endpoint — frontend handles polling loop.
 */
export async function checkTalkStatus(
  talkId: string,
): Promise<{ status: 'pending' | 'done' | 'error'; videoUrl: string | null; error?: string }> {
  try {
    const res = await fetch(`${DID_API_BASE}/talks/${talkId}`, {
      headers: { Authorization: getAuthHeader() },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[D-ID] Status check failed:', res.status, body);
      return { status: 'error', videoUrl: null, error: `D-ID error (${res.status}): ${body}` };
    }

    const json = await res.json();
    console.log('[D-ID] Status check response:', json);
    const s = json?.status;

    if (s === 'done') {
      return { status: 'done', videoUrl: json.result_url };
    }

    if (s === 'error' || s === 'rejected') {
      return { status: 'error', videoUrl: null, error: json?.error?.description || s };
    }

    // still processing
    return { status: 'pending', videoUrl: null };
  } catch (err) {
    return {
      status: 'error',
      videoUrl: null,
      error: `D-ID polling error: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}

/**
 * Polls D-ID talk status until done, failed, or timeout.
 * Used by the legacy single-request flow.
 */
export async function pollTalkStatus(
  talkId: string,
): Promise<GenerateVideoResult> {
  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    try {
      const res = await fetch(`${DID_API_BASE}/talks/${talkId}`, {
        headers: { Authorization: getAuthHeader() },
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error('[D-ID] Status check failed:', res.status, body);
        return { videoUrl: null, error: `D-ID status check failed: ${res.status}` };
      }

      const json = await res.json();
      const status = json?.status;

      if (status === 'done') {
        return { videoUrl: json.result_url };
      }

      if (status === 'error' || status === 'rejected') {
        console.error('[D-ID] Video failed:', JSON.stringify(json));
        return { videoUrl: null, error: `D-ID video generation failed: ${json?.error?.description || status}` };
      }
    } catch (err) {
      return {
        videoUrl: null,
        error: `D-ID polling error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return { videoUrl: null, error: 'D-ID video generation timed out' };
}

/**
 * Starts a talking avatar video via D-ID. Returns the talk ID immediately
 * without waiting for completion. Use pollTalkStatus to check progress.
 */
export async function startAvatarVideo(
  text: string,
): Promise<{ talkId: string | null; error?: string }> {
  const apiKey = process.env.DID_API_KEY;
  if (!apiKey) {
    return { talkId: null, error: 'DID_API_KEY is not configured' };
  }

  const sourceUrl = process.env.DID_SOURCE_URL || DEFAULT_SOURCE_URL;
  const voiceId = process.env.DID_VOICE_ID || 'en-US-JennyNeural';

  const body = {
    source_url: sourceUrl,
    script: {
      type: 'text',
      input: text,
      provider: {
        type: 'microsoft',
        voice_id: voiceId,
      },
    },
    config: {
      result_format: 'mp4',
    },
  };

  try {
    const res = await fetch(`${DID_API_BASE}/talks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: getAuthHeader(),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      console.error('[D-ID] Talk creation failed:', {
        status: res.status,
        statusText: res.statusText,
        body: errorBody
      });
      return { talkId: null, error: `D-ID error (${res.status}): ${errorBody}` };
    }

    const json = await res.json();
    console.log('[D-ID] Talk created successfully:', json);
    const talkId = json?.id;

    if (!talkId) {
      return { talkId: null, error: 'D-ID returned no talk id' };
    }

    return { talkId };
  } catch (err) {
    return {
      talkId: null,
      error: `D-ID request error: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}

/**
 * Generates a talking avatar video via D-ID for the given text.
 * Waits for completion (used by legacy single-request flow).
 */
export async function generateAvatarVideo(
  text: string,
): Promise<GenerateVideoResult> {
  const apiKey = process.env.DID_API_KEY;
  if (!apiKey) {
    return { videoUrl: null, error: 'DID_API_KEY is not configured' };
  }

  const sourceUrl = process.env.DID_SOURCE_URL || DEFAULT_SOURCE_URL;
  const voiceId = process.env.DID_VOICE_ID || 'en-US-JennyNeural';

  const body = {
    source_url: sourceUrl,
    script: {
      type: 'text',
      input: text,
      provider: {
        type: 'microsoft',
        voice_id: voiceId,
      },
    },
  };

  try {
    const res = await fetch(`${DID_API_BASE}/talks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: getAuthHeader(),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      console.error('[D-ID] Video creation failed:', res.status, errorBody);
      return { videoUrl: null, error: `D-ID video creation failed: ${res.status} - ${errorBody}` };
    }

    const json = await res.json();
    const talkId = json?.id;

    if (!talkId) {
      return { videoUrl: null, error: 'D-ID returned no talk id' };
    }

    return pollTalkStatus(talkId);
  } catch (err) {
    return {
      videoUrl: null,
      error: `D-ID request error: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}
