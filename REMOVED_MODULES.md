# Removed modules (cleanup reference)

This document lists major code removed during the production cleanup pass. The active stack remains: **D-ID WebRTC streaming** (`hooks/useAvatar.ts`, `/api/avatar/stream/*`), **Groq via AI SDK** (`/api/chat`), **browser Speech API fallback** (`lib/services/tts.service.ts`, `hooks/useTTS.ts`), and **Redux** (`lib/store/*`).

## Legacy avatar / lip-sync paths

| Removed | Notes |
|--------|--------|
| `app/api/avatar/route.ts` | REST D-ID talk create + GET poll (`talkId` → video URL). Replaced by streaming APIs only. |
| `lib/did.ts` | Server helpers for that REST flow. |
| `lib/store/apiSlice.ts` — `generateAvatar`, `checkAvatarStatus` | RTK Query endpoints for the removed REST route. |
| `lib/api.ts`, `lib/services/avatar.service.ts` | Client wrappers for `/api/avatar` polling; unused in the WebRTC path. |
| `lib/heygen.ts` | HeyGen API helpers; never imported by the app. |

## Unused orchestration layer

| Removed | Notes |
|--------|--------|
| `lib/orchestrator/*` | `ConversationOrchestrator`, state machine, playback managers, `PipelineDiagnostics`, etc. Not referenced by UI or hooks; superseded by `useChat` + `useAvatar` + Redux. |

## Simli (disabled integration)

| Removed | Notes |
|--------|--------|
| `hooks/useSimliAvatar.ts` | Simli WebRTC client hook (was commented out in `useAvatarContext`). |
| `app/api/simli/session/route.ts`, `app/api/simli/tts/route.ts` | Server proxies for Simli session and PCM TTS. |
| `simli-client` (npm) | Dependency removed. |

## Dead utilities and duplicates

| Removed | Notes |
|--------|--------|
| `lib/openai.ts` | Unused; APIs use `openai` / `@ai-sdk/groq` directly where needed. |
| `lib/logger.ts` | Unused structured logger. |
| `lib/tts.ts` | Duplicate browser TTS; `TTSService` in `lib/services/tts.service.ts` is the implementation in use. |
| `lib/components/ReduxProvider.tsx` | Duplicate of `app/providers.tsx` wiring. |
| `lib/sync-manager.ts` | Latency helper imported only from `ai.service.ts` but never used there; removed both the import and the module. |

## Static assets

| Removed | Notes |
|--------|--------|
| `public/file.svg`, `public/window.svg`, `public/vercel.svg` | Unused default assets; no references in app code. |

## Dev dependencies

| Removed | Notes |
|--------|--------|
| `fast-check` | Not used in tests or source. |
| `@ai-sdk/openai` | Not imported; chat uses `@ai-sdk/groq`. |

To restore Simli or REST polling avatar flows, recover them from git history using the paths above.
