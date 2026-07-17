# Prompter PWA — Feature Status

Last updated: 2026-07-17

## ✅ Shipped

- **Screen wake lock**
  - Screen stays awake while in the prompter view (`navigator.wakeLock`, iOS Safari 16.4+).
  - Re-acquires the lock when returning to the app after backgrounding.

- **Focus band**
  - Text fades out away from the eye-level line so the reader's gaze stays near the camera.
  - Toggleable in prompter controls; on by default.

- **Bluetooth clicker / keyboard controls**
  - Cheap Bluetooth camera remotes and page-turner clickers pair as keyboards.
  - Space / Enter / → / PageDown: play–pause. ↑ / ← / PageUp: jump back. ↓: jump forward.

- **AI script scoring**
  - "✨ Score" in the editor sends the script to `/api/score-script` (Vercel serverless
    function calling Claude `claude-opus-4-8` with structured JSON output).
  - Scores hook / clarity / pacing / CTA / overall (0-10), estimates spoken duration,
    lists strengths + concrete suggestions, and rewrites the opening line.
  - Requires `ANTHROPIC_API_KEY` in Vercel env vars; degrades gracefully when absent.
  - Also: live word count + spoken-duration estimate in the editor (client-side, free).

- **Accounts + cloud sync (client side)**
  - Supabase auth via email one-time code (PWA-friendly — no magic-link/Safari handoff).
  - Local-first: localStorage stays the source of truth; saves/deletes write through to
    the cloud when signed in; full merge (last-write-wins) on sign-in and "Sync now".
  - Deletion tombstones so offline deletes don't resurrect on sync.
  - App runs fully local when env vars are absent. Activation steps: README "Cloud sync setup".

- **Script list + localStorage persistence**
  - Create, edit, delete, and title scripts.
  - All data stored in `localStorage`.

- **Camera preview**
  - Front/back camera switching.
  - Portrait orientation (matches short-form filming).
  - Works on iPhone Safari over HTTPS.

- **Scrolling teleprompter overlay**
  - Adjustable font size, speed, and margin.
  - Mirror text toggle.
  - Play / pause / reset controls.
  - Auto-scroll at fixed speed.

- **Video recording**
  - 3-second countdown before recording starts.
  - Records camera + microphone together.
  - Recording indicator and elapsed timer.
  - Auto-scroll starts when recording begins.
  - Stop recording → review + share.
  - Web Share API to save to iPhone Photos.

- **PWA basics**
  - Vite + React + TypeScript + Tailwind CSS.
  - `vite-plugin-pwa` with service worker.
  - Deployed to Vercel.
  - Add-to-Home-Screen support on iOS.

## 🔄 In Progress / Needs Polish

- **Aspect-ratio guide overlays**
  - Add transparent frame guides for 9:16, 4:5, 1:1 so creators know what will be cropped by platforms.

- **Onboarding + permissions UX**
  - First-run explanation of why camera + microphone are needed.
  - Safari permission denied state with reload instructions.

- **PWA install prompt**
  - Surface "Add to Home Screen" instructions for iOS users.

- **Settings validation**
  - Current numeric inputs in settings can be edited to invalid values.

## 📝 Feature Requests

### 1. Voice-activated scrolling
**Idea:** The teleprompter listens to your voice and scrolls forward only when you actually speak the words. Auto-pauses when you pause, catches up if you speed up.

**Why it matters:** Fixed-speed scroll forces creators to chase the text. Voice-driven scroll would make delivery feel natural.

**Blocker in PWA:** iOS Safari cannot reliably share the microphone between `MediaRecorder` (recording video audio) and the Web Speech API (transcribing voice). Voice scroll would therefore only work in **rehearsal/practice mode** (no recording), not while recording.

**Decision:** Deferred. If voice-while-recording is a must-have differentiator, this becomes the reason to build a native iOS app.

### 2. Cloud sync / unlimited scripts
**Idea:** Sync scripts across devices and remove the free-tier script limit.

**Business context:** Freemium plan — first 3 scripts free, then pay for unlimited + cloud sync.

**Status:** Client side shipped (see "Accounts + cloud sync" above). Needs a Supabase project + env vars to activate — see README "Cloud sync setup". Payments/free-tier enforcement still deferred until paid validation.

### 3. Remote control
**Idea:** Use a second phone or a Bluetooth controller to pause/play/scroll while filming.

**Decision:** Bluetooth clicker support shipped via keyboard events (see Shipped). Second-phone remote via WebRTC/pairing code remains deferred.

### 4. Speed presets
**Idea:** Slow / Normal / Fast one-tap speed buttons.

**Decision:** Low priority. Current slider already works.

### 5. Better export formats
**Idea:** Ensure saved videos are `.mp4` on all iPhones, not `.webm`.

**Blocker:** Safari on iOS usually records `.mp4`, but some configurations produce `.webm`. Client-side conversion is possible but heavy.

**Decision:** Monitor real-world behavior first.

### 6. Background music / watermarking
**Idea:** Add intro/outro cards, captions, or background audio.

**Decision:** Out of scope for core teleprompter. Keep the app focused.

## 🚧 Native iOS Considerations

If voice-while-recording becomes non-negotiable, the project should move to native iOS:

- **Language:** Swift
- **UI:** SwiftUI for fast iteration
- **Camera/Recording:** AVFoundation + `AVCaptureVideoDataOutput` / `AVCaptureAudioDataOutput`
- **Speech recognition:** `SFSpeechRecognizer` or `SpeechAnalyzer` (newer iOS APIs)
- **Advantage:** One microphone stream can feed both recording and speech recognition simultaneously.
- **Requirement:** Mac with Xcode for building/testing/deploying to App Store.

Current project intentionally stays PWA because the user does not have a Mac.
