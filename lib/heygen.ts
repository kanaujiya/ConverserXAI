const HEYGEN_API_BASE = 'https://api.heygen.com';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 300000;

export interface GenerateVideoResult {
  videoUrl: string | null;
  error?: string;
}

/**
 * Builds the HeyGen video generation request payload.
 * Exported for testability in property-based tests.
 */
export function buildVideoRequest(
  text: string,
  avatarId: string,
  voiceId: string,
) {
  return {
    video_inputs: [
      {
        character: {
          type: 'avatar',
          avatar_id: avatarId,
          avatar_style: 'normal',
        },
        voice: {
          type: 'text',
          input_text: text,
          voice_id: voiceId,
        },
      },
    ],
    dimension: {
      width: 512,
      height: 512,
    },
  };
}

/**
 * Polls HeyGen video status at POLL_INTERVAL_MS intervals until
 * completed, failed, or POLL_TIMEOUT_MS is exceeded.
 */
export async function pollVideoStatus(
  videoId: string,
): Promise<GenerateVideoResult> {
  const apiKey = process.env.HEYGEN_API_KEY;
  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    try {
      const res = await fetch(
        `${HEYGEN_API_BASE}/v1/video_status.get?video_id=${videoId}`,
        {
          headers: { 'X-Api-Key': apiKey! },
        },
      );

      if (!res.ok) {
        return { videoUrl: null, error: `HeyGen status check failed: ${res.status}` };
      }

      const json = await res.json();
      const status = json?.data?.status;

      if (status === 'completed') {
        return { videoUrl: json.data.video_url };
      }

      if (status === 'failed') {
        const errorDetail = JSON.stringify(json?.data);
        console.error('[HeyGen] Video generation failed:', errorDetail);
        return { videoUrl: null, error: `HeyGen video generation failed: ${errorDetail}` };
      }
    } catch (err) {
      return {
        videoUrl: null,
        error: `HeyGen polling error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return { videoUrl: null, error: 'HeyGen video generation timed out' };
}

/**
 * Generates a lip-synced avatar video via HeyGen for the given text.
 * Returns the video URL on success, or an error on failure.
 */
export async function generateAvatarVideo(
  text: string,
): Promise<GenerateVideoResult> {
  const apiKey = process.env.HEYGEN_API_KEY;
  const avatarId = process.env.HEYGEN_AVATAR_ID;
  const voiceId = process.env.HEYGEN_VOICE_ID;

  if (!apiKey) {
    return { videoUrl: null, error: 'HEYGEN_API_KEY is not configured' };
  }

  const body = buildVideoRequest(text, avatarId ?? '', voiceId ?? '');

  try {
    const res = await fetch(`${HEYGEN_API_BASE}/v2/video/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => 'no body');
      console.error('[HeyGen] Video creation failed:', res.status, errorBody);
      return { videoUrl: null, error: `HeyGen video creation failed: ${res.status} - ${errorBody}` };
    }

    const json = await res.json();
    const videoId = json?.data?.video_id;

    if (!videoId) {
      return { videoUrl: null, error: 'HeyGen returned no video_id' };
    }

    return pollVideoStatus(videoId);
  } catch (err) {
    return {
      videoUrl: null,
      error: `HeyGen request error: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}
