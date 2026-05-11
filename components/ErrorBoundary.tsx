'use client';

import React, { ReactNode, useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Error boundary for graceful error handling in voice assistant UI.
 * Prevents entire app crash from component errors.
 */
export function ErrorBoundary({ children, fallback }: ErrorBoundaryProps) {
  const [hasError, setHasError] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error('[ErrorBoundary] Uncaught error:', event.error);
      setError(event.error);
      setHasError(true);
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      console.error('[ErrorBoundary] Unhandled promise rejection:', event.reason);
      setError(new Error(String(event.reason)));
      setHasError(true);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  if (hasError) {
    return (
      fallback || (
        <div className="flex flex-col items-center justify-center h-screen gap-4 px-6 bg-surface">
          <AlertTriangle size={48} className="text-red" />
          <div className="text-center space-y-2">
            <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
            <p className="text-sm text-muted max-w-md">
              {error?.message || 'An unexpected error occurred. Please refresh the page.'}
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-6 py-2 rounded-full sunset-gradient text-white font-medium hover:scale-105 transition-transform"
          >
            Refresh Page
          </button>
        </div>
      )
    );
  }

  return <>{children}</>;
}
