import type { ChatMessage, ChatResponse } from './types';

export async function sendMessage(message: string, history: ChatMessage[]): Promise<ChatResponse> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export async function startAvatar(text: string): Promise<{ talkId: string }> {
  const res = await fetch('/api/avatar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (!res.ok || !data.talkId) throw new Error(data.error || 'Failed to start avatar');
  return data;
}

export async function checkAvatarStatus(
  talkId: string,
): Promise<{ status: 'pending' | 'done' | 'error'; videoUrl: string | null; error?: string }> {
  const res = await fetch(`/api/avatar?id=${talkId}`);
  return res.json();
}
