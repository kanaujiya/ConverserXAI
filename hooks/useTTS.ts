import { TTSService } from '@/lib/services/tts.service';
import { useEffect, useCallback } from 'react';

export function useTTS() {
  useEffect(() => {
    TTSService.init();
    return () => {
      TTSService.stop();
    };
  }, []);

  const speak = useCallback((text: string) => {
    TTSService.speak(text);
  }, []);

  const stop = useCallback(() => {
    TTSService.stop();
  }, []);

  const setOnStateChange = useCallback((cb: (isSpeaking: boolean) => void) => {
    TTSService.setOnStateChange(cb);
  }, []);

  return { speak, stop, setOnStateChange };
}
