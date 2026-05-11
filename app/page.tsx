'use client';

import { AvatarPlayer } from '@/components/AvatarPlayer';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { StatusIndicator } from '@/components/StatusIndicator';
import { MessageList } from '@/components/MessageList';
import { ConnectionBadge } from '@/components/ConnectionBadge';
import { Mic, Radio } from 'lucide-react';

export default function Home() {
  return (
    <div className="flex flex-col h-full min-h-screen">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl sunset-gradient flex items-center justify-center shadow-md">
            <Radio size={18} stroke="white" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight">
              Converser<span className="text-accent">X</span><span className="text-gold">AI</span>
            </h1>
            <p className="text-[10px] text-muted">Voice Avatar Assistant</p>
          </div>
        </div>

        {/* Voice-only mode badge */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface border border-border text-xs font-medium text-accent">
          <Mic size={13} />
          Voice Mode
        </div>
      </header>

      {/* Avatar area */}
      <main className="flex-1 flex flex-col items-center justify-center gap-6 px-6 py-8 relative">
        <div className="absolute top-4 left-6"><ConnectionBadge /></div>

        <AvatarPlayer />

        <div className="text-center space-y-2 mt-4">
          <h2 className="text-lg font-semibold text-foreground">AI Assistant</h2>
          <StatusIndicator />
        </div>

        <MessageList />
      </main>

      {/* Input */}
      <div className="px-6 py-4 border-t border-border bg-surface/50 backdrop-blur-sm flex justify-center w-full">
        <VoiceRecorder />
      </div>
    </div>
  );
}
