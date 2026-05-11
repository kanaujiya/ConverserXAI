import { AppError } from '../utils/error-mapping';

export interface AvatarStatusResponse {
  status: 'pending' | 'done' | 'error';
  videoUrl: string | null;
  error?: string;
}

export class AvatarService {
  /**
   * Starts a video generation (Talk) on D-ID
   * Returns the talk ID
   */
  async generateTalk(text: string): Promise<string> {
    const res = await fetch('/api/avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to start avatar generation');
    }

    const data = await res.json();
    if (!data.talkId) throw new Error('No Talk ID returned from server');
    
    return data.talkId;
  }

  /**
   * Checks the status of a specific Talk
   */
  async checkStatus(talkId: string): Promise<AvatarStatusResponse> {
    const res = await fetch(`/api/avatar?id=${talkId}`);
    
    if (!res.ok) {
      throw new Error(`Status check failed: ${res.status}`);
    }

    return await res.json();
  }
}
