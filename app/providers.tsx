'use client';

import { Provider } from 'react-redux';
import { store } from '@/lib/store/store';
import { AvatarProvider } from '@/hooks/useAvatarContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <AvatarProvider>
        {children}
      </AvatarProvider>
    </Provider>
  );
}
