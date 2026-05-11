'use client';

import React from 'react';

export function LiquidAIAnimation() {
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none">
      <div className="relative w-full h-full filter blur-[20px] opacity-60 animate-slow-spin">
        {/* Multicolor blobs */}
        <div 
          className="absolute top-1/4 left-1/4 w-1/2 h-1/2 rounded-full bg-accent mix-blend-screen animate-blob-1" 
          style={{ background: 'radial-gradient(circle, #8b5cf6 0%, transparent 70%)' }}
        />
        <div 
          className="absolute top-1/3 right-1/4 w-1/2 h-1/2 rounded-full bg-gold mix-blend-screen animate-blob-2"
          style={{ background: 'radial-gradient(circle, #f59e0b 0%, transparent 70%)' }}
        />
        <div 
          className="absolute bottom-1/4 left-1/3 w-1/2 h-1/2 rounded-full bg-neon mix-blend-screen animate-blob-3"
          style={{ background: 'radial-gradient(circle, #06b6d4 0%, transparent 70%)' }}
        />
      </div>
      
      {/* Central glow */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-32 h-32 rounded-full bg-white/5 backdrop-blur-md border border-white/10 shadow-[0_0_30px_rgba(139,92,246,0.2)] animate-pulse-slow" />
      </div>

      <style jsx>{`
        @keyframes blob-1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(20px, -30px) scale(1.05); }
        }
        @keyframes blob-2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-20px, 30px) scale(1.1); }
        }
        @keyframes blob-3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(30px, 15px) scale(0.95); }
        }
        .animate-blob-1 { animation: blob-1 10s infinite alternate ease-in-out; }
        .animate-blob-2 { animation: blob-2 15s infinite alternate ease-in-out; }
        .animate-blob-3 { animation: blob-3 12s infinite alternate ease-in-out; }
        .animate-slow-spin { animation: spin 30s linear infinite; }
        .animate-pulse-slow { animation: pulse 6s infinite ease-in-out; }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}
