import { memo } from 'react';
import { useAppSelector } from '@/lib/store/hooks';

const ResponseText = memo(function ResponseText({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="animate-fade-in max-w-2xl mx-auto px-6 w-full">
      <div className="bg-surface border border-border rounded-2xl px-5 py-4 shadow-lg">
        <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  );
});

export const MessageList = memo(function MessageList() {
  const lastAssistantMessage = useAppSelector((state) => {
    for (let i = state.app.messages.length - 1; i >= 0; i--) {
      const msg = state.app.messages[i];
      if (msg.role === 'assistant') return msg.content;
    }
    return null;
  });
  
  return (
    <div className="w-full">
       <ResponseText text={lastAssistantMessage} />
    </div>
  );
});
