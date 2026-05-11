'use client';

import { memo } from 'react';
import { useAppSelector } from '@/lib/store/hooks';

const COLOR_MAP: Record<string, string> = {
  good: 'bg-green-500',
  poor: 'bg-yellow-400',
  disconnected: 'bg-red-500',
};
const LABEL_MAP: Record<string, string> = {
  good: 'Good',
  poor: 'Poor',
  disconnected: 'Disconnected',
};
const TEXT_COLOR_MAP: Record<string, string> = {
  good: 'text-green',
  poor: 'text-gold',
  disconnected: 'text-red',
};

export const ConnectionBadge = memo(function ConnectionBadge() {
  const status = useAppSelector((state) => state.app.connectionStatus);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface/80 backdrop-blur-sm border border-border text-xs">
      <span className={`w-2 h-2 rounded-full ${COLOR_MAP[status] ?? 'bg-muted'}`} />
      <span className="text-muted">Connection:</span>
      <span className={`font-medium ${TEXT_COLOR_MAP[status] ?? 'text-muted'}`}>
        {LABEL_MAP[status] ?? 'Unknown'}
      </span>
    </div>
  );
});
