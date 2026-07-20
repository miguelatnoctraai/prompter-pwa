# TalkShot Landing Page + Blog Plan

Companion to [`visual-identity-plan.md`](./visual-identity-plan.md) — that doc
brings the app's *own* screens up to a real visual identity; this doc builds
the public-facing site around it. They should share one visual language, not
invent a second.

**Decision already made:** marketing + blog live at `talkshot.app` (root) as a
new site; the app moves to `app.talkshot.app`. No installed user base exists
yet, so this costs nothing to do now and is expensive to retrofit later
(PWA home-screen icons bind to the origin they were installed from — this is
the one thing that gets harder, not easier, the longer we wait).

**New codebase, new repo.** Not a monorepo with `prompter-pwa` — a sibling
project (e.g. `talkshot-site`), built in **Astro**. Reasoning: this is a
client-rendered Vite/React SPA today, which is the wrong foundation for a
marketing site — no server-rendered HTML means poor SEO and every shared link
gets the same social-preview card regardless of page. Astro ships zero JS by
default, gives every page its own real `<title>`/OG tags, has first-class
Markdown/MDX content collections (exactly what the blog needs), and still
deploys on Vercel with Tailwind — so the design tokens transfer directly.

---

## Reference: what we're borrowing from interviewcoder.co

Pulled from the live site's computed styles, not eyeballed — treat these as
real starting values, not inspiration:

| Element | Value |
|---|---|
| Page background | `#000000`, true black |
| Headline font | Geist, 600 weight, ~85px desktop, **-3.4px** letter-spacing, ~90px line-height — big, bold, tight |
| Body font | Inter |
| Primary button | pill-shaped (fully rounded), fill `rgb(239, 200, 58)` — a gold-amber almost identical to TalkShot's brand amber |
| Social-proof badge | pill shape, `rgb(25,25,25)` fill, 1px `rgb(30,30,30)` border |
| Feature cards | 16px rounded rect, `rgb(25,25,25)` fill, 1px `rgb(30,30,30)` border, **no drop shadow** |
| Gradients | used sparingly and functionally: fade-to-black overlays for legibility over video/screenshots, and soft amber glows behind icon tiles — never decorative rainbow gradients |
| Section spacing | very generous — ~142px top padding on major sections |

The throughline: confident oversized type, true black, restrained gradient use
(fades and glows, not decoration), pill shapes for anything tag/button-like,
soft-bordered flat cards for content. This is close enough to the amber
identity we already defined for the app that **TalkShot's brand amber can
stand in directly for their gold** — no new color needed.

---

## Scope 0 — Infrastructure & cutover

### Why
Get the plumbing right before any design work, so nothing here has to be
redone once content exists.

### What to do
1. Scaffold the new Astro project in its own repo, Tailwind configured with
   the token values from Scope 1 of the identity plan (reuse them verbatim —
   don't redefine a second dark palette).
2. In Vercel: add `app.talkshot.app` as a domain on the **existing**
   `prompter-pwa` project first, and confirm the app loads correctly there
   before touching the root domain. Only after that's verified, reassign
   `talkshot.app` (and `www`) to the new marketing project.
3. In the existing app: update the PWA manifest's `start_url`/`scope`, any
   hardcoded `talkshot.app` references (README, share-sheet filenames,
   `og:url` if any), and confirm Supabase's Auth URL allow-list includes
   `app.talkshot.app`. None of this touches data — see the earlier discussion
   in this thread — it's just making the app's own config match its new home.
4. **Precaution, not a real risk:** before cutover, open the current app and
   hit "Sync now" so anything local-only is confirmed in the cloud —
   `localStorage` is origin-scoped, so anything never synced would be
   stranded on the old domain after the move.
5. Set up redirects: `talkshot.app/app*` → `app.talkshot.app` (in case old
   links or the app's own internal links ever pointed at the root path), and
   confirm the new marketing site's 404 page doesn't accidentally shadow the
   app during the brief propagation window.

### Acceptance criteria
- `app.talkshot.app` serves the working app, sign-in and sync both verified
  end to end, before root is touched.
- `talkshot.app` root serves the new marketing placeholder (even a single
  "coming soon" page is fine at this stage) before any content work starts.
- No Supabase data touched or migrated — this step is pure routing.

---

## Scope 1 — Landing page

### Why
The landing page's job is narrow: convert a cold visitor (from a TikTok bio
link, most likely) into someone who taps "Open the app" within seconds. It is
not a features encyclopedia.

### Structure (top to bottom)

1. **Nav.** Transparent over the hero, wordmark left, minimal links (How it
   works, Blog), Sign in + primary CTA right. Becomes opaque/bordered on
   scroll.
2. **Hero.** One confident headline in the Geist-style oversized tight-tracked
   treatment — something that names the actual outcome, not the mechanism
   (e.g. leads with "never lose your train of thought on camera" rather than
   "teleprompter app"). One-line subhead. Primary CTA ("Open the app" — pill,
   amber fill) plus a secondary ("See how it works" — ghost/outline pill).
   Below the fold-line: a looping muted video or GIF of the actual product —
   the eye-level scroll + camera + a real recording — because this product is
   fundamentally show-not-tell. **Skip the social-proof badge** ("used by
   150,000+...") entirely for now — there's no real number yet, and a fake
   one is a worse first impression than no badge. Revisit once there's a
   number worth stating.
3. **How it works / feature grid.** Three or four cards, icon-tile + heading +
   one sentence, mirroring the card treatment in the reference table above.
   Map to what's actually real today: eye-level teleprompter with the focus
   band, AI script scoring (hook/clarity/pacing/CTA + rewrite), cue cards for
   reading naturally instead of word-by-word, cloud sync across devices.
   Each card's claim must be something the product actually does today — no
   roadmap items presented as shipped.
4. **Proof / comparison** *(optional — include only if it earns its place)*.
   Interview Coder's version is a feature-by-feature table against named
   competitors. TalkShot's honest equivalent is "reading off a script badly"
   vs. TalkShot, not a competitor takedown — a short before/after framing
   (stiff, robotic, staring at paper *vs.* natural, eyes on the lens, AI-tuned
   script) probably lands better than a table with no real competitors to
   name. Decide this one by feel once the hero and feature grid exist —
   easier to judge whether the page needs more persuasion once it's real.
5. **Pricing.** Deferred. There's no monetization plan yet (freemium is an
   explicit "wait for demand" decision already made for this product) — a
   pricing section with only "Free" in it undersells the page. Skip the
   section entirely until there's a real tier to show; the nav's "Pricing"
   link goes in later, not now.
6. **Footer.** Wordmark, a couple of links (Blog, Privacy, Sign in), copyright.
   Small and quiet — it's not doing persuasion work.

### Copy
Draft copy against the structure above as part of implementation, flagged
clearly as a first draft for review — not written blind ahead of time in this
planning doc. Tone should match the product's own voice already established
in the app (the first-run demo script, the "your first take will be garbage,
record it anyway" line) — direct, a little wry, not corporate.

### Acceptance criteria
- Real Lighthouse SEO/performance pass (this is the entire point of the Astro
  choice — verify it, don't just assume it).
- Every feature claim maps to a real, shipped capability.
- Primary CTA is reachable without scrolling on a 375px-wide phone.
- Hero video/GIF is muted, autoplays inline, and has a static poster frame
  fallback (no jank on slow connections).

---

## Scope 2 — Blog home page (shell only)

### Why
Per the scoping decision: build the index page — title, post grid, enough
placeholder content that it doesn't look empty — without the individual
article template or any CMS. That's a deliberately separate follow-up scope
once there's real content to publish.

### What to do
1. Set up an Astro **content collection** for blog posts now (a typed
   frontmatter schema: title, excerpt, date, cover image, category) even
   though the reading page doesn't exist yet — this is the one piece of
   groundwork worth doing early, since the index page's data shape shouldn't
   need to change when the article template gets built later.
2. Build the index page itself: page header, optional category filter row
   (skip if it feels like clutter with only a few posts), a responsive grid of
   post cards using the same card treatment as the feature grid (bordered,
   16px radius, no heavy shadow) — cover image, title, one-line excerpt, date.
3. Write 2–3 placeholder posts as real Markdown files so the grid isn't empty
   on launch — topics adjacent to the product's actual use case (e.g. "why
   your first take is always the worst one," "how to write a script that
   sounds like you talking, not you reading," a short one on the eye-level
   trick). These can ship as genuinely useful short posts, not filler — worth
   writing them for real rather than lorem-ipsum placeholders, since they
   cost little more effort and give the page something honest to show.
4. Cards link to `/blog/[slug]` even though that route doesn't resolve yet —
   fine to leave as a follow-up scope; don't build a fake modal or disable the
   links.

### Acceptance criteria
- Index page has zero empty/awkward states with 2–3 posts in the collection.
- Content collection schema won't need breaking changes when the article
  template scope starts.
- Visually consistent with the landing page — same card, type, and spacing
  system, not a separate look.

### Explicitly out of scope for this pass
Individual article page template, any CMS or external content source, RSS
feed, comments, author pages, category archive pages, search. Name these here
so it's clear they're deferred, not forgotten.

---

## Sequencing & sizing

| Scope | Depends on | Rough size |
|---|---|---|
| 0 — Infrastructure & cutover | — | half a day |
| 1 — Landing page | 0, and Scope 1 (tokens) from the identity plan | 1–2 days incl. copy draft |
| 2 — Blog home shell | 0, 1 (shares its component system) | half a day |

Global definition of done: Lighthouse SEO + performance both green on the new
site; every page verified at 375px; the app verified working at
`app.talkshot.app` before root is ever touched; no Supabase/data changes at
any point in this initiative.
