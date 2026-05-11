'use client';

import React, { createContext, useContext, ReactNode } from 'react';
// import { useSimliAvatar } from './useSimliAvatar'; // Simli integration (currently disabled)
import { useAvatar } from './useAvatar';
import { useAppSelector } from '@/lib/store/hooks';

interface AvatarContextType {
  connect: () => Promise<void>;
  speak: (text: string) => Promise<void>;
  disconnect: () => Promise<void>;
  videoUrl: string | null;
  videoElementRef: React.RefObject<HTMLVideoElement | null>;
  audioElementRef: React.RefObject<HTMLAudioElement | null>;
  didVideoElementRef: React.RefObject<HTMLVideoElement | null>;
  isProcessing: boolean;
  clearQueue: () => void;
}

const AvatarContext = createContext<AvatarContextType | null>(null);

export function AvatarProvider({ children }: { children: ReactNode }) {
  const videoUrl = useAppSelector((state) => state.app.videoUrl);
  // const simli = useSimliAvatar(); // Simli integration (currently disabled)
  const did = useAvatar();

  const value: AvatarContextType = {
    connect: did.connect,
    speak: did.speak,
    disconnect: did.disconnect,
    videoUrl: videoUrl,
    videoElementRef: did.videoElementRef as React.RefObject<HTMLVideoElement | null>,
    audioElementRef: { current: null }, // D-ID handles audio via the video stream
    didVideoElementRef: did.videoElementRef as React.RefObject<HTMLVideoElement | null>,
    isProcessing: did.isProcessing,
    clearQueue: did.clearQueue,
  };

  return <AvatarContext.Provider value={value}>{children}</AvatarContext.Provider>;
}

export function useAvatarProvider() {
  const context = useContext(AvatarContext);
  if (!context) {
    throw new Error('useAvatarProvider must be used within an AvatarProvider');
  }
  return context;
}
