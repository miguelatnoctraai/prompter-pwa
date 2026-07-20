# TalkShot Visual Identity Plan

Three independent scopes that take the UI from "engineer-built dark utility" to a
branded product. Each scope ships on its own, in order — Scope 1 is the
foundation the other two sit on. No code in this doc on purpose: it describes
intent, values, and acceptance criteria; the implementer owns the how.

**Context for the implementer.** The app is a single-page React + Tailwind v4
PWA. All views live in `src/App.tsx` (list / editor / account share a
`bg-zinc-950` root; the prompter is a camera view and is mostly *excluded* from
this work). Global styles and keyframes live in `src/index.css` (note the
existing `ts-*` animation convention and the `prefers-reduced-motion` block —
follow both). The brand color is amber (already used on the record button, live
pulse, and app icon). Verify every change at a 375px-wide viewport; that is the
real device class.

---

## Scope 1 — Atmosphere: kill the flat black

### Why
Every non-camera screen today is flat near-black boxes on flat near-black.
Dark is the right choice for a filming tool (it recedes next to the camera
view), but flatness is not. Depth — a tinted gradient environment, glow, and
elevated surfaces — is what makes dark UIs read as designed. This scope is
first because it touches every screen with a small set of decisions, and the
other two scopes inherit its tokens.

### What to build (in order)

1. **Define tokens before touching any screen.** Add theme-level color
   variables (Tailwind v4 supports theme variables in the global stylesheet)
   rather than sprinkling raw values. You need roughly five: a base background
   (near-black with a warm cast — think `#0c0a09`-family rather than pure
   black), a raised surface color a step lighter with the same warm cast, a
   subtle warm border color (low-alpha white-warm, ~8–12% opacity), the brand
   amber (keep the existing amber-400/orange-500 family), and a muted text
   color. Every later decision references these five.
2. **Page background.** Replace the flat root background on list, editor, and
   account views with a vertical gradient from the warm near-black down to true
   black, plus one large, very soft radial glow anchored near the top of the
   screen (amber at extremely low alpha — it should be perceptible only as
   "warmth," never readable as a colored blob). One shared treatment, not
   per-screen variants.
3. **Surface system.** Script cards, the settings panel, the score panel, and
   the Adjust sheet become "elevated surfaces": the raised surface color (a
   subtle top-lit gradient is welcome), the 1px warm border, a soft shadow.
   The goal is that a card visibly *sits on* the background instead of being a
   slightly different gray rectangle. Apply identically everywhere — the system
   is the identity.
4. **Sweep for stragglers.** Any remaining `zinc-800/900/950` fills on the
   three atmosphere screens should be re-pointed at the tokens.

### Out of scope
The prompter/camera view (its background is the video feed; only its Adjust
sheet gets the surface treatment). Any color meaning changes (that's Scope 2).

### Acceptance criteria
- No flat `zinc-950` root remains on list / editor / account.
- Cards are visually separable from the page background at arm's length with
  screen brightness at ~50%.
- All body text on the new surfaces still passes WCAG AA contrast (4.5:1) —
  check the muted/secondary text especially, it's the first thing tinting
  breaks.
- No gradient or glow renders inside the camera view.
- Build passes; no horizontal overflow introduced at 375px.

### Pitfalls to flag in review
- Warm-tinting the background but leaving cards cool-gray reads as a bug, not a
  style. Tint travels together.
- Radial glows implemented as large blurred elements can create scroll jank on
  low-end phones — prefer static CSS gradients over `filter: blur` layers.
- Don't add translucency/backdrop-blur to list cards; blur belongs only where
  content genuinely passes underneath (sheets over the camera).

---

## Scope 2 — Amber as a system + a typographic voice

### Why
A brand color only becomes identity when it consistently *means* something.
Today amber appears in three places; everywhere else, primary actions are
white pills — so white means "go," and amber means nothing. This scope makes
amber the single carrier of "primary action / live / go" across the app, and
adds one distinctive display typeface so headings have a voice. Fonts are the
highest identity-per-effort lever that exists; this is deliberately a
half-day, not a design-system project.

### What to build (in order)

1. **Primary-action audit.** List every button in the app and classify:
   primary (advances the core loop: Prompt, Save, Record, Send code, Verify,
   Use rewrite, "Write your first script"), secondary (Edit, Retake, Keep
   mine, utilities), destructive (Delete). One screen may have at most one
   primary.
2. **Recolor by class.** Primary actions move from white pills to the brand
   amber fill (amber-400-family background, near-black text — this pairing
   passes AA easily; white text on amber-400 does not, don't use it).
   Secondary stays neutral surface-colored. Destructive keeps its muted
   neutral until pressed states are revisited later. Active states on the
   segmented controls (preset pickers, Scroll|Cards switch) also become amber
   — an "on" state is a commitment, which is amber's meaning.
3. **Resolve the amber-as-warning collision.** The duration meter currently
   turns amber past 60s as a *warning*. Once amber means "primary," the
   warning must move to a hotter color (orange-600/red family) so the two
   meanings never share a hue.
4. **Display typeface.** Pick one — Bricolage Grotesque or Space Grotesk are
   both free, distinctive, and hold up at heavy weights. Self-host the file in
   `public/` (no CDN requests — this is a PWA; a font fetched from a CDN
   fails offline and violates the app's self-contained precache). Declare it
   with `font-display: swap` and a system-font fallback stack. Apply it to:
   the TalkShot wordmark, view titles (Edit script, Account), the empty-state
   pitch line, and section headers (SCRIPT SCORE). Body text, inputs, and the
   teleprompter text itself stay on the system stack — readability at
   distance beats voice there.
5. **Wordmark moment.** The "TalkShot" header on the list view gets the
   display face plus a subtle amber→orange gradient fill on the text itself.
   This is the one place a gradient may touch typography.

### Out of scope
The prompter's on-camera controls keep their current white/translucent scheme
(over video, translucent-white reads better than filled color) — except the
record button, which is already amber. Icon redesign. Light mode.

### Acceptance criteria
- Exactly one amber-filled primary action per screen; screenshot each screen
  and check.
- Amber never appears meaning "warning" anywhere.
- The display font loads from the app's own origin, shows a fallback within
  ~100ms on slow connections (no invisible-text period), and adds no more
  than ~50KB (subset the font file to Latin if the tooling allows).
- Teleprompter reading text is unchanged.
- Lighthouse/PWA install still passes; no external font origin appears in the
  network log.

### Pitfalls to flag in review
- Recoloring *every* button amber. The system works because of restraint —
  if Edit and Delete are also amber, "go" means nothing again.
- White text on amber fills (contrast failure). Near-black text on amber.
- Loading the font via a Google Fonts `<link>` — that's an external origin,
  breaks offline, and leaks user IPs. Self-host.

---

## Scope 3 — Three hero moments

### Why
Users don't remember uniform polish; they remember emotional peaks. This
scope over-invests in the three moments where the user feels something —
arrival, commitment, and payoff — instead of spreading effort across forty
small tweaks. It ships after Scopes 1–2 because it uses their tokens and
typography. Each moment is independently shippable; do them in the order
below and stop whenever taste says "enough."

### Moment A — Arrival (list header)
The first two seconds of every session. Give the header a small amount of
ceremony: the gradient wordmark from Scope 2, the soft glow behind it from
Scope 1, and slightly more generous vertical spacing so the screen "opens."
The script cards' Prompt button (now amber) becomes the obvious eye-landing
point. Success test: a stranger opening the app for the first time should be
able to answer "what does this app want me to do?" within two seconds —
without reading body text.

### Moment B — Commitment (the record ritual)
Recording is the scariest tap in the app; the ritual should feel charged, not
bureaucratic. Build on the existing countdown (accelerating 3-2-1, "Go"
flash): add a slow glow "breath" to the amber record button while idle (a
2–3s opacity/shadow pulse — barely perceptible, like an on-air lamp warming),
intensify the glow during the countdown beats, and let the "Go" flash bloom
slightly larger. All of it must be pure CSS animation, register under the
existing `ts-*` keyframe convention, and be disabled by the existing
`prefers-reduced-motion` block. Nothing here may touch recording logic or add
JS timers.

### Moment C — Payoff (the review screen)
"How did it look?" is the dopamine peak — the user just did the brave thing.
Warm it up: the bottom gradient behind the controls picks up a trace of the
amber cast, the headline uses the display face, and the Share action becomes
the amber primary (Retake stays secondary — the app's opinion is that the
take was good). Optionally, one single celebratory beat on entry (e.g. the
headline rising in with the existing view-enter curve) — no confetti, no
sound; restraint is the brand.

### Acceptance criteria
- Each moment is its own commit, testable on a phone before the next starts.
- All new animation respects `prefers-reduced-motion` and adds no `setTimeout`
  / `requestAnimationFrame` logic — CSS only.
- The record button glow is invisible in a screenshot but noticeable in
  motion (if it's obvious in a still frame, it's too strong).
- Frame rate on the camera screen does not drop (test on-device: the glow
  animates a composited property — opacity or shadow on its own layer — not
  layout).

### Pitfalls to flag in review
- Celebration inflation: if every screen gets a "moment," none of them are.
  Three, only.
- Animating box-shadow directly can jank on low-end devices; prefer opacity
  pulses on a pre-rendered glow layer.
- The review screen plays video underneath — keep added effects on the
  gradient/controls layer, never over the video itself.

---

## Sequencing & sizing

| Scope | Ships as | Rough size | Depends on |
|---|---|---|---|
| 1 — Atmosphere | one commit | half a day | — |
| 2 — Amber system + type | one commit | half a day | 1 (tokens) |
| 3 — Hero moments | three commits (A, B, C) | 1–2 hours each | 1 + 2 |

Global definition of done, all scopes: build and lint pass; no new lint
warnings; every screen checked at 375×667 and 375×812; camera view visually
unchanged except where a scope explicitly touches it; `prefers-reduced-motion`
honored; no new external network origins.
