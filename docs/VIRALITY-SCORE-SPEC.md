# Virality Score — Product Spec

**Status:** MVP spec, locked 2026-07-20. Decisions on score range, UX split, and gating are settled; see "Decisions" at the bottom.

**Companion docs:**
- `virality-research-2026.md` — visual signal research (Gupta 2025, WebShorts 2026, eye-tracking studies)
- `talkshot-script-virality-research-2026.md` — script / hook / cadence research (Buffer 1.1M, Berger & Milkman 2012, TikTok SMB)
- `VIRALITY-SCORE-VISION-MODEL-RESEARCH.md` — AI model pricing, latency, and Vercel deployment notes

**Research date:** 2026-07-20. All cited sources are primary; gaps are labeled honestly.

---

## What this is (and isn't)

A **transparent, rule-based scorecard** for short-form video virality potential. Each rule is independently testable and cites a primary source. The user sees exactly which signals added or subtracted and why.

**It is not:**
- A virality guarantee. No scoring system has that.
- A black-box ML score. Every rule is explainable.
- A single precision number. It returns a 0–100 score with a confidence band.
- A gate. The score is a fix-list, not a "you may not post this" check.

The product wedge: every commercial virality score (HookScores, quso.ai, OpusClip, Higgsfield, Tikalyzer, Go Viral, Predis.ai, Lately.ai) is opaque. TalkShot publishes its rubric. That is the actual moat.

---

## Two-tier UX

The user gets two different scores at two different moments.

### Tier 1 — Pre-record heuristic score (in the editor)

- **When:** Live, in the script editor, before recording.
- **What it scores:** 8 of 10 rules, all heuristic, all client-side. No API call.
- **Latency:** <50ms (debounced on text change).
- **Output:** `XX/100 (heuristic only)` with a per-rule breakdown.
- **Cost:** $0.

### Tier 2 — Post-record full score (on the review screen)

- **When:** After recording stops, on the existing "How did it look?" review screen.
- **What it scores:** All 10 rules. The 2 AI rules (first-frame + result/payoff) are added; the heuristic rules are re-run.
- **Latency:** ~2.5–3s (Sonnet 4.6 vision call) + the heuristic pass.
- **Output:** `XX/100` with the full breakdown, including the visual + payoff AI subscores, plus an optional rewrite of the hook.
- **Cost:** ~$0.010/call (Sonnet 4.6, 1MP image + 200-word script + 300 tok JSON output). See `VIRALITY-SCORE-VISION-MODEL-RESEARCH.md`.

The split lets the user iterate freely before recording (free, infinite) and get a premium "we looked at your actual frame" moment after recording.

---

## The 10-rule scorecard (max 100)

| # | Component | Max | Type | Source | What it checks |
|---:|---|---:|---|---|---|
| 1 | First-frame scroll-stop | 15 | AI (Sonnet 4.6) | Gupta 2025 C8/C5 (Strong/Medium) | Face present + close-up; high contrast; direct address; on-screen text; high-arousal expression |
| 2 | Hook in opening line | 15 | Heuristic | Buffer 1.1M (Strong) + TikTok SMB (Medium) | Script's first sentence contains one of the 5 hook reactions (attacked/need/didn't know/disagree/want answer) |
| 3 | Result/payoff in script | 15 | AI (Sonnet 4.6) | Berger & Milkman 2012 (Strong, on articles not short-form) | Script references a specific result, fact, story, or transformation |
| 4 | Audience specificity | 10 | Heuristic | post-quality framework | Script names a specific audience ("if you're a first-time founder…") |
| 5 | Length in supported bucket | 10 | Heuristic | Buffer 1.1M (Strong) | Estimated read duration lands in 9–15s (TikTok ad sweet) or 30–60s (>1min reach bucket) |
| 6 | Credibility markers | 10 | Heuristic | post-quality framework | Script contains a number, named source, lived-experience marker, or specific claim |
| 7 | CTA present | 10 | Heuristic | Maynooth Facebook study, in `02-post-quality.md` | Script ends with a singular next action |
| 8 | Sentence-length variance | 5 | Heuristic (convention, no primary source) | — | Variance > 1.5 std (proxy for natural speech rhythm) |
| 9 | Cadence warning (flag, not subtract) | 5 | Heuristic | TikTok 9–15s sweet spot (Medium) | Read duration falls outside supported buckets — flags a warning, not a deduction |
| 10 | Series/community fit | 5 | Heuristic | post-quality framework | Tone matches a recurring topic the user has scored before (if any) |
| | **Total** | **100** | | | |

### Confidence band

Returned alongside the score:

- **High** (3+ AI rules agree + all heuristic rules scored as expected)
- **Medium** (2 AI rules present OR a heuristic rule is borderline)
- **Low** (first-frame extraction failed OR only heuristic rules are present)

Per WebShorts 2026, content-only scoring is materially weaker than content + context. The confidence band is the honest answer to that finding.

---

## Heuristic rules (8 of 10)

All client-side, in a new `src/lib/scoreHeuristic.ts`. Each rule is a pure function with a unit test.

### Rule 2 — Hook in opening line (15 pts)

Check the first sentence for one of the 5 hook reactions (post-quality framework, AIDA-derived):

- **"I feel attacked"** — direct challenge, contrarian claim
- **"I need this"** — outcome promise, "X will give you Y"
- **"I didn't know that"** — surprising fact, counterintuitive claim
- **"I disagree"** — strong opinion, contrarian stance
- **"I want the answer"** — question, open loop, curiosity tease

Detection: small regex/keyword set per reaction. Cap at 15 if multiple reactions are present (no stacking).

### Rule 4 — Audience specificity (10 pts)

Check the script for a specific audience phrase. Heuristic:
- Contains a noun phrase like "if you're a [role/niche]"
- Contains "founders," "creators," "parents," "marketers," or any specific role
- Contains "X-year-olds," "in [city/region]," or other demographic markers

Bonus: 5 pts for "you/your" used in the first 3 sentences (direct address).

### Rule 5 — Length in supported bucket (10 pts)

Estimate read duration:

```
duration_sec = syllable_count / 165 * 60 / 100  # 165 WPM target
```

Then check:
- 9 ≤ duration ≤ 15s → 10 pts (TikTok ad sweet spot)
- 15 < duration ≤ 60s → 7 pts (Buffer's reach bucket)
- 60 < duration ≤ 90s → 5 pts (>1min reach bucket, but with diminishing returns)
- Otherwise → 0 pts (with Rule 9 warning fired)

Note: 165 WPM is a **convention**, not a primary-source finding. We do not assert this is the optimal WPM. The score is based on the length bucket, not the WPM.

### Rule 6 — Credibility markers (10 pts)

Check for at least one of:
- A number (e.g., "3x," "47%," "in 90 days")
- A named source (e.g., "per the Berger study," "Gartner reports")
- Lived-experience marker (e.g., "I tried this for 90 days," "when I ran my first agency")
- A specific claim with a quantifier (e.g., "the first 3 seconds," "saves 2 hours/week")

### Rule 7 — CTA present (10 pts)

Check the last sentence for a singular next action:
- "save this," "share with [someone]," "comment [word]," "join us [day]," "try this for [duration]"
- Bonus: 5 pts if the CTA uses the word "you" or "your" (direct address)

### Rule 8 — Sentence-length variance (5 pts, convention)

Compute std dev of word count per sentence. > 1.5 std = 5 pts. < 1.0 std = 0 pts. In between = 3 pts.

This rule is labeled as "convention" in the UI. No primary source.

### Rule 9 — Cadence warning (5 pts)

If the read duration is in an *unsupported* bucket, this rule fires a warning and awards 0 pts. If the duration is in a supported bucket (covered by Rule 5), this rule awards 5 pts for the "you're on target" signal. The 5 pts here are independent of Rule 5's length-bucket points — the two rules score different things (length fit vs. pace health).

### Rule 10 — Series/community fit (5 pts)

Compare the script's tone/keywords against the user's previously-scored scripts (read from Supabase). If the script uses 2+ recurring keywords or has a similar opening pattern to a prior high-scoring script, +5.

If the user has no prior scripts, the rule returns null (does not score, does not penalize). The total is renormalized across the 9 remaining rules so the cap is still 100.

---

## AI rules (2 of 10)

Both call Sonnet 4.6 in a single API call (`/api/score-video`) with structured JSON output.

### Rule 1 — First-frame scroll-stop (15 pts)

The vision model receives the first frame + a short context string (script length, platform target, and the heuristic score so far). It returns:

```json
{
  "frame": {
    "face_present": { "value": true, "confidence": 0.92 },
    "is_close_up": { "value": true, "confidence": 0.85 },
    "eye_contact": { "value": true, "confidence": 0.88 },
    "high_contrast": { "value": true, "confidence": 0.78 },
    "on_screen_text": { "value": false, "confidence": 0.95 },
    "expression_arousal": { "value": "high", "confidence": 0.71 }
  },
  "subtotal": 13,
  "rationale": "Strong direct-address close-up. Face fills 60% of frame, looking at lens, mouth open mid-word. Expression reads as excitement/urgency. No on-screen text; the visual carries the hook."
}
```

Subtotal rules:
- 5 pts: face present + close-up
- 4 pts: eye contact with viewer
- 3 pts: high contrast / bright / saturated
- 2 pts: on-screen text (counts if it's readable in <1s)
- 1 pt: high-arousal expression (excitement, urgency, surprise, joy, anger, awe)
- Cap at 15

The model must return a per-feature confidence. If face_present confidence < 0.6, that feature is dropped from the subtotal and the rule's "low confidence" flag is set.

### Rule 3 — Result/payoff in script (15 pts)

The text model receives the script (already passed to the vision call as context, so no extra input). It returns:

```json
{
  "payoff": {
    "kind": "result|fact|story|transformation|missing",
    "specificity": "high|medium|low",
    "rationale": "References a 30-day test with a specific 23% lift. Concrete and citable."
  },
  "subtotal": 12,
  "suggested_hook_rewrite": "Open with the 23% number, not the framework name."
}
```

Subtotal rules:
- 5 pts: a payoff is present (any kind)
- 4 pts: it has a specific number, named source, or lived-experience marker
- 3 pts: it's high-arousal emotion (Berger & Milkman)
- 3 pts: it's referenceable (would someone save this to come back to?)
- Cap at 15

`suggested_hook_rewrite` is optional — only returned if the heuristic Rule 2 scored < 10.

---

## The API endpoint

### `POST /api/score-video`

- **Input:** `{ scriptId: string, firstFrameBase64: string, script: string, platform: 'instagram' | 'tiktok' }`
- **Process:**
  1. Verify auth (same as `/api/score-script`).
  2. Downscale the first frame to 768px longest edge client-side before upload.
  3. Call Sonnet 4.6 with image + script, `output_config.format.json_schema` enforcing the Rule 1 + Rule 3 shape.
  4. Persist `(scriptId, frame, payoff, suggestedHookRewrite, createdAt)` to Supabase.
  5. Return the full score breakdown.
- **Limits:** 1MP max image, 8000 chars max script (matches `MAX_SCRIPT_CHARS`).
- **Cost:** ~$0.010 per call at current Sonnet 4.6 pricing.

### Caching

- The score is cached on the `script` row in Supabase so re-renders don't re-call the API.
- Cache invalidates when the script content changes (hash compare).
- The first-frame dataUrl is stored alongside for re-scoring (with a "re-score" button in the UI).

---

## Frontend flow

### Scorecard UI (post-record)

```
┌────────────────────────────────────────────────────┐
│  Virality potential                                │
│                                                    │
│       76 / 100   (medium confidence)               │
│       ████████████████████░░░░░░░░░░░             │
│                                                    │
│  Strong signals (3)                                │
│  +15  Hook in opening line            [Buffer]     │
│  +12  First-frame direct address      [Gupta 2025] │
│  +10  Result-first pattern            [Berger]     │
│                                                    │
│  Suggested improvements (2)                        │
│  −10  No CTA in script — add one to close the post │
│  −5   No specific number in script — even 1 helps  │
│                                                    │
│  Try this (optional)                               │
│  "Open with the 23% number, not the framework."    │
│                                                    │
│  [Re-score]  [Dismiss]                             │
└────────────────────────────────────────────────────┘
```

This UI lives below the "How did it look?" headline on the review screen (existing `recordedUrl` branch in `src/App.tsx`). The card is collapsible; the headline + Score button (now `Score` → `Virality score`) are visible by default.

### Pre-record score chip

A small pill in the editor header: `Score: 64/100 · heuristic`. Click to expand a dropdown with the per-rule breakdown. Updates live as the user types.

---

## Tech stack

- **Frontend:** `src/App.tsx` (new scorecard component + first-frame extraction)
- **Heuristic scorer:** new `src/lib/scoreHeuristic.ts` (pure functions, unit-tested)
- **AI endpoint:** new `api/score-video.ts` (mirrors `api/score-script.ts`)
- **Storage:** extend `script` table with `frame_score JSONB`, `frame_data_url TEXT`, `frame_scored_at TIMESTAMPTZ`
- **Tests:** Vitest unit tests for each heuristic rule + Playwright e2e for the post-record flow
- **No new dependencies** beyond what's in the existing project (Anthropic SDK, Supabase client, Vercel)

---

## Build scope

I'm proposing a single MVP build (no phasing) because the heuristic + AI parts are coupled at the storage layer — a phased build would split one logical change across two deploys.

**MVP deliverable:**
1. `src/lib/scoreHeuristic.ts` — all 8 heuristic rules with unit tests
2. Pre-record score chip in the editor
3. `api/score-video.ts` — Sonnet 4.6 endpoint with structured JSON
4. First-frame extraction on the review screen
5. Post-record scorecard UI
6. Supabase migration for the new fields
7. Playwright e2e for the post-record flow

**Not in MVP (deferred):**
- Gating / Pro tier (deferred per your decision; add before launch)
- Series/community fit scoring beyond keyword match (deferred; needs ML clustering)
- Web trend context (WebShorts' "evidence card" pattern — needs research on which API to use)
- Confidence band tuning (start with the simple high/medium/low; refine after we have data)

---

## Risks I'm flagging now

1. **First-frame extraction timing.** A first frame at t=0s of a WebM is the encoder's I-frame, which may be a still pose. Default to t=0.5s if the video is long enough; document the choice. **Mitigation:** test with 3 real recordings before locking the timestamp.

2. **Sonnet 4.6 scoring variance.** Temperature 0 helps but isn't a guarantee. **Mitigation:** cache the score on the script; require user to click "Re-score" to call the API again.

3. **AI may invent reasons.** "We gave you +5 for X" must cite a script line or a frame feature, not a hallucination. **Mitigation:** the JSON schema requires `value` + `confidence` for every subfeature; the prompt explicitly bans invented reasons; reject any response that doesn't cite a source.

4. **First-frame-only visual scoring is the weakest signal.** Per Gupta 2025, visual-only ρ=0.62 (vs ρ=0.71 with audio). **Mitigation:** the score's confidence band drops to "low" if the frame score is the only AI component; the UI labels the first-frame component's confidence visibly.

5. **Heuristic rules without primary source are judgment calls.** Rule 8 (sentence variance) and the 165 WPM target have no published backing. **Mitigation:** label them as "convention" in the UI; don't promote them to "rule" in any user-facing copy.

6. **The 0–100 score is a false-precision risk.** A user might fixate on "I need 85+." **Mitigation:** the UI shows the score as a *fix-list*, not a gate. There's no "publish at 80+" or "rewrite at 60-" language. The score's job is to teach, not to evaluate.

---

## Open questions for build-time

These will be settled during the build, not the spec:

1. First-frame timestamp: 0s, 0.5s, or 1.0s? (Test with 3 recordings.)
2. Re-score button: visible always, or only if the cached score is >7 days old?
3. Scorecard position: above the "How did it look?" headline, below it, or replace it?
4. Score persistence: per script version, or per script (latest wins)?

---

## Decisions (locked 2026-07-20)

- **Score range:** 0–100 with per-rule breakdown shown. (User: "I agree!")
- **Two-tier UX:** yes — pre-record heuristic + post-record full. (User: "agreed")
- **Gating:** not in MVP; add before shipping. (User: "agreed but let's not gate yet we'll do that before shipping the MVP")
- **Heuristic rules without primary source:** include with "convention" labels. (User: "agreed")
