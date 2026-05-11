import { memo } from 'react';
import { useAppSelector } from '@/lib/store/hooks';
import { SystemState } from '@/lib/store/appSlice';

const WAVE_BARS = [0, 1, 2, 3, 4];

const Waveform = memo(function Waveform() {
  return (
    <div className="flex items-center gap-[3px] h-6">
      {WAVE_BARS.map((i) => (
        <div key={i} className="waveform-bar w-[3px] rounded-full bg-accent" />
      ))}
    </div>
  );
});

export const StatusIndicator = memo(function StatusIndicator() {
  const systemState = useAppSelector((state) => state.app.systemState);
  
  // Adjusted for available states in the slice
  const labels: Record<string, { text: string; color: string }> = {
    idle: { text: 'Ready to talk', color: 'text-muted' },
    listening: { text: 'Listening...', color: 'text-teal' },
    thinking: { text: 'Thinking…', color: 'text-gold' },
    speaking: { text: 'Avatar is speaking…', color: 'text-teal' },
  };
  
  const currentLabel = labels[systemState] || labels.idle;
  
  return (
    <div className={`flex items-center gap-2 text-sm font-medium ${currentLabel.color}`}>
      {systemState === 'speaking' && <Waveform />}
      {(systemState === 'thinking') && (
        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      )}
      {systemState === 'idle' && <span className="w-2 h-2 rounded-full bg-muted" />}
      {currentLabel.text}
    </div>
  );
});
