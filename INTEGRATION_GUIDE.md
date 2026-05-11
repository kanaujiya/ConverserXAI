# Integration Guide - Architectural Fixes

## Quick Start

This guide shows how to integrate the new orchestration architecture into your application.

## Step 1: Update Your Provider Component

Update your main chat provider to use the new orchestrators:

```typescript
'use client';

import { useAvatarOrchestrator } from '@/hooks/useAvatarOrchestrator';
import { useSimliAvatar } from '@/hooks/useSimliAvatar';
import { useRef, useEffect } from 'react';

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const simli = useSimliAvatar();
  
  const orchestrator = useAvatarOrchestrator(
    videoRef.current,
    audioRef.current,
    {
      greeting: {
        text: "Hey! I'm your AI assistant. How can I help you today?",
        preloadDelayMs: 200,
        playbackDelayMs: 500,
        timeoutMs: 30000,
      },
      onError: (error, context) => {
        console.error(`Error in ${context}:`, error);
        // Handle error in your UI
      },
    }
  );

  useEffect(() => {
    // Initialize session when app loads
    orchestrator.initializeSession().catch(err =>
      console.error('Failed to initialize avatar session:', err)
    );
  }, []);

  return (
    <div>
      {/* Video element for avatar */}
      <video ref={videoRef} {...simli.videoElementRef} />
      
      {/* Audio element for playback */}
      <audio ref={audioRef} {...simli.audioElementRef} />
      
      {/* Your chat components */}
      {children}
    </div>
  );
}
```

## Step 2: Update Your Chat Component

Use the orchestrator in your chat component:

```typescript
import { useAvatarOrchestrator } from '@/hooks/useAvatarOrchestrator';
import { useChat } from '@/hooks/useChat';

export function ChatInterface() {
  const { sendMessage, isGenerating } = useChat();
  
  const handleSendMessage = async (text: string) => {
    await sendMessage(text);
  };

  return (
    <div>
      <input 
        type="text" 
        placeholder="Type your message..."
        onKeyPress={async (e) => {
          if (e.key === 'Enter' && e.currentTarget.value) {
            await handleSendMessage(e.currentTarget.value);
            e.currentTarget.value = '';
          }
        }}
        disabled={isGenerating}
      />
    </div>
  );
}
```

## Step 3: Use Diagnostics (Optional)

Add diagnostics to your development environment:

```typescript
import { pipelineDiagnostics } from '@/lib/orchestrator/PipelineDiagnostics';

// In your chat component or useEffect
if (process.env.NODE_ENV === 'development') {
  pipelineDiagnostics.printReport();
  
  // Export for analysis
  console.log(pipelineDiagnostics.exportJSON());
}
```

## Step 4: Configure Error Handling

Add global error handling:

```typescript
import { useEffect } from 'react';
import { useAppDispatch } from '@/lib/store/hooks';
import { setError } from '@/lib/store/appSlice';

export function ErrorHandler() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error('Unhandled error:', event.error);
      dispatch(setError({
        message: event.error?.message || 'An unexpected error occurred',
        code: 'UNHANDLED_ERROR',
      }));
    };

    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, [dispatch]);

  return null;
}
```

## Step 5: Monitor Stream Health (Optional)

Add connection monitoring:

```typescript
import { useEffect } from 'react';
import { AvatarSessionManager } from '@/lib/orchestrator/AvatarSessionManager';

export function StreamHealthMonitor({ sessionManager }: { sessionManager: AvatarSessionManager }) {
  useEffect(() => {
    const interval = setInterval(() => {
      const metrics = sessionManager.getStreamMetrics();
      
      if (metrics.peerConnectionState === 'failed') {
        console.error('Peer connection failed, attempting recovery...');
      }
      
      if (!metrics.remoteStreamActive) {
        console.warn('No active remote streams');
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [sessionManager]);

  return null;
}
```

## Architecture Components Reference

### Orchestrators

| Component | Purpose | Location |
|-----------|---------|----------|
| `ConversationOrchestrator` | Main orchestration hub | `lib/orchestrator/ConversationOrchestrator.ts` |
| `ConversationStateMachine` | State management | `lib/orchestrator/ConversationStateMachine.ts` |
| `AvatarSessionManager` | WebRTC session lifecycle | `lib/orchestrator/AvatarSessionManager.ts` |
| `SpeechPlaybackManager` | Audio/video sync | `lib/orchestrator/SpeechPlaybackManager.ts` |

### Managers

| Component | Purpose | Location |
|-----------|---------|----------|
| `PlaybackQueueManager` | Playback queue control | `lib/orchestrator/PlaybackQueueManager.ts` |
| `GreetingManager` | Greeting lifecycle | `lib/orchestrator/GreetingManager.ts` |
| `StreamPlaybackController` | Synchronized playback | `lib/orchestrator/StreamPlaybackController.ts` |
| `PipelineDiagnostics` | Latency analysis | `lib/orchestrator/PipelineDiagnostics.ts` |

### Hooks

| Hook | Purpose | Location |
|------|---------|----------|
| `useAvatarOrchestrator` | Unified orchestration API | `hooks/useAvatarOrchestrator.ts` |
| `useSimliAvatar` | Avatar connection | `hooks/useSimliAvatar.ts` |
| `useChat` | Chat messaging | `hooks/useChat.ts` |
| `useTTS` | Text-to-speech | `hooks/useTTS.ts` |

## Configuration Options

### Orchestrator Configuration

```typescript
interface AvatarOrchestratorOptions {
  greeting?: {
    text: string;
    preloadDelayMs?: number;  // Default: 200ms
    playbackDelayMs?: number; // Default: 500ms
    timeoutMs?: number;       // Default: 30000ms
  };
  sessionConfig?: {
    maxReconnectAttempts?: number;    // Default: 5
    heartbeatInterval?: number;       // Default: 30000ms
    reconnectBackoffMs?: number;      // Default: 1000ms
    sessionTimeoutMs?: number;        // Default: 600000ms
    streamMonitorInterval?: number;   // Default: 3000ms
  };
  onError?: (error: Error, context: string) => void;
  onStateChange?: (state: any) => void;
}
```

## State Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Chat Flow                            │
└─────────────────────────────────────────────────────────┘

User Speech
    │
    ▼
    startListening()
    │
    ▼
    (VAD auto-stop or manual stop)
    │
    ▼
    stopListening()
    │
    ▼
    onTranscriptionComplete(text)
    │
    ▼
    [AI generates response via streaming]
    │
    ▼
    onAIResponseReceived(response)
    │
    ▼
    [Parallel: TTS generation + Avatar preparation]
    │
    ▼
    startPlayback()
    │
    ▼
    [Audio plays + Avatar animates synchronized]
    │
    ▼
    reset() → Back to idle
```

## Error Recovery Flow

```
Operation Fails
    │
    ▼
    Error Type?
    │
    ├─→ Retryable (TTS, Avatar, Audio)
    │   │
    │   ▼
    │   Retry with Exponential Backoff
    │   │
    │   ├─→ Succeeds → Continue
    │   └─→ Max Retries → User Error
    │
    └─→ Non-Retryable (Quota, Auth)
        │
        ▼
        Notify User
        │
        ▼
        Fallback if available
```

## Performance Metrics

### Latency Targets

- **Transcription → AI Response:** < 1500ms
- **AI Response → Avatar Ready:** < 2000ms  
- **Audio Start After Ready:** < 300ms
- **Total Pipeline:** < 4000ms

### Resource Usage

- **Memory per session:** ~20-30MB
- **WebRTC bandwidth:** 50-100kbps (Opus)
- **CPU usage:** < 15% (idle), < 40% (speaking)

## Troubleshooting

### Avatar not appearing

1. Check WebRTC connection status
2. Verify session was initialized
3. Review console logs for connection errors
4. Check ICE servers configuration

### Audio delay

1. Review TTS generation timing via diagnostics
2. Check avatar preparation time
3. Verify network latency
4. Check for browser codec limitations

### Memory leaks

1. Verify cleanup in useEffect
2. Check for removeEventListener calls
3. Monitor blob URL revocation
4. Review console for warnings

## Testing

```typescript
// Example test for greeting flow
test('greeting should play on avatar ready', async () => {
  const { getByText } = render(<ChatApp />);
  
  // Wait for greeting to complete
  await waitFor(() => {
    expect(getByText(/How can I help/)).toBeInTheDocument();
  }, { timeout: 5000 });
});

// Example test for message handling
test('should handle message and play response', async () => {
  const { getByPlaceholderText, findByText } = render(<ChatApp />);
  
  const input = getByPlaceholderText(/Type your message/);
  fireEvent.change(input, { target: { value: 'Hello' } });
  fireEvent.keyPress(input, { key: 'Enter', code: 13 });
  
  await findByText(/response text/, {}, { timeout: 10000 });
});
```

## Deployment

1. **Test locally** - Verify all flows work
2. **Test on staging** - Test with real services
3. **Performance benchmark** - Record latency metrics
4. **Error monitoring** - Set up error tracking
5. **User communication** - Document breaking changes
6. **Gradual rollout** - Deploy to subset of users first
7. **Monitor metrics** - Watch latency and error rates

## Support

For issues or questions:

1. Check `ARCHITECTURE_FIXES.md` for detailed documentation
2. Review component source code comments
3. Run diagnostics to identify bottlenecks
4. Check browser console for detailed logs
5. Review error messages and stack traces

## Version History

### v2.0 (Current)
- Complete architectural refactor
- Orchestration layer implementation
- WebRTC stream monitoring
- Parallel TTS + Avatar preparation
- Comprehensive error handling
- Diagnostics and metrics

### v1.0 (Previous)
- Initial implementation
- Basic avatar integration
- Fire-and-forget async handling
- Limited error recovery

---

**Last Updated:** May 2026  
**Compatibility:** Next.js 13+, React 18+
