# Latency Improvement Note

## Goal
Improve response speed and perceived real-time behavior for an avatar-based conversational app, while keeping responses natural and useful.

---

## 1) Traditional (non-optimized) flow

In a traditional conversational pipeline, latency usually comes from waiting at multiple stages:

1. User sends message.
2. Backend calls the LLM.
3. App waits for full response completion.
4. Text is rendered only after the full response is ready.
5. TTS/avatar playback starts after full text processing.

### Typical latency issues in traditional flow
- **Hard prompt constraints** (e.g., "1 short sentence only") produce unnatural and sometimes low-value replies.
- **Very low token caps** (e.g., ~30 tokens) force short output and can reduce conversational quality.
- **Late playback start** (waiting for full response) increases perceived lag.
- **Sequential blocking behavior** can delay avatar speech and UI updates.
- **Overly defensive clarifications** can make interactions feel slower and less direct.

---

## 2) Optimized flow implemented

The current optimized approach improves both **actual latency** and **perceived latency**:

1. User sends message.
2. Backend streams LLM output progressively.
3. Frontend consumes chunks immediately.
4. Sentences are extracted and queued as they appear.
5. Avatar/TTS begins speaking early (before full response ends).
6. UI reveals response progressively, synced with avatar behavior.

---

## 3) Improvements done to reduce latency

### A) Prompt and response-behavior tuning
- Removed strict one-line-only behavior.
- Replaced with short, direct, conversational guidance (1-2 line target).
- Reduced unnecessary explanation/clarification behavior unless ambiguity is real.

**Impact:** Faster direct answers, better quality per token, fewer "extra" tokens spent.

### B) Token budget tuning (moderate, not tiny)
- Increased from very low values (~30) to a moderate default (around 100 via env-configurable limit).
- Keeps responses short enough for real-time interaction, but long enough to avoid clipped answers.

**Impact:** Better balance of quality vs speed; avoids both over-brief and over-long outputs.

### C) Streaming-first delivery
- LLM response is streamed to the client, not held until full completion.

**Impact:** Lower time-to-first-visible-text; users perceive the system as faster.

### D) Early sentence dispatch for avatar
- Response chunks are parsed into sentence units and sent to avatar/TTS queue quickly.
- Early submission logic lets avatar start rendering before full answer finishes.

**Impact:** Reduced "dead air" before avatar speaks; improved lip-sync responsiveness.

### E) Queue and playback optimization
- Sentence queue processing avoids unnecessary artificial delays.
- Small segment handling merges tiny fragments for more natural speech.

**Impact:** Smoother playback, less stutter, fewer micro-pauses.

### F) Controlled fallback behavior
- Clarification prompts are minimized for clear questions.
- Keeps conversation direct and reduces extra turns.

**Impact:** Lower conversational overhead and faster completion per query.

---

## 4) Traditional vs optimized summary

## Traditional
- Wait-for-full-response pattern
- Very short forced outputs
- Delayed avatar start
- Higher perceived lag

## Optimized
- Streamed output and progressive reveal
- Medium-short direct answers (1-2 lines)
- Early avatar/TTS start from partial text
- Better perceived responsiveness and naturalness

---

## 5) Why this works for avatar experiences

Avatar systems are highly sensitive to **time-to-first-speech**.  
These optimizations reduce idle time between user input and first avatar motion/speech, which is the biggest factor for perceived latency in real-time conversational UX.

---

## 6) Recommended operating range (practical)

- Keep response style concise and direct.
- Use moderate token caps (not too low, not too high).
- Continue streaming + early sentence queueing.
- Ask clarifying questions only when needed.

This preserves low latency while keeping answers useful and human-like.

