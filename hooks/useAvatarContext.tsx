'use client';

import React, { createContext, useContext, ReactNode } from 'react';
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
  const avatar = useAvatar();

  const value: AvatarContextType = {
    connect: avatar.connect,
    speak: avatar.speak,
    disconnect: avatar.disconnect,
    videoUrl: videoUrl,
    videoElementRef: avatar.videoElementRef as React.RefObject<HTMLVideoElement | null>,
    audioElementRef: { current: null }, // Lip-sync audio is muxed into the WebRTC video stream
    didVideoElementRef: avatar.videoElementRef as React.RefObject<HTMLVideoElement | null>,
    isProcessing: avatar.isProcessing,
    clearQueue: avatar.clearQueue,
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
