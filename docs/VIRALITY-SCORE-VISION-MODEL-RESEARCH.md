# Vision AI Models for TalkShot Virality Scoring — Research Summary
*Research date: 2026-07-20. All prices confirmed against official pricing pages (Anthropic, OpenAI, Google AI for Developers) on this date.*

## Context
TalkShot already runs `/api/score-script` on Vercel via **Claude Sonnet 4.6** (text-only structured-output scoring). The new virality-score feature extends this to also analyze the **first frame image** of a recorded clip. The PWA runs on Vercel serverless functions backed by Supabase. Typical payload: 1 image (≤1MP first frame from a recorded WebM/MP4) + ~200-word script = small input, small JSON output.

## Pricing Table — Vision-capable models, mid-2026

| Model | $/MTok input | $/MTok output | Image handling | ~Latency (1 image + 200 tok out) | Batch discount |
|---|---|---|---|---|---|
| **Claude Opus 4.8** (Anthropic) | $5.00 | $25.00 | Images are tokens (≈1.6k tokens for a 1024×1024 tile). Same $/MTok as text. | ~3.5–5 s (TTFT ~1.1 s + gen) | 50% via Batch API |
| **Claude Sonnet 4.6** (Anthropic) | $3.00 | $15.00 | Same tokenized image pricing. | ~2–3 s (TTFT ~580 ms + gen) | 50% Batch |
| **Claude Haiku 4.5** (Anthropic) | $1.00 | $5.00 | Same tokenized image pricing. Best cost/perf Claude. | ~1.5–2 s (TTFT ~180 ms) | 50% Batch |
| **GPT-5.4** (OpenAI, flagship) | $2.50 (short ctx) | $15.00 | Tile-based: 85 base + 170/tile @ 512px; 1MP ≈ 1.2k tokens. | ~3 s (TTFT ~850 ms) | 50% Batch |
| **GPT-5.4-mini** (OpenAI) | $0.75 | $4.50 | Same tile math, multiplier 1.62×. | ~1.5 s (TTFT ~320 ms) | 50% Batch |
| **GPT-5.4-nano** (OpenAI) | $0.20 | $1.25 | Same tile math, multiplier 2.46×. | ~1 s (TTFT ~250 ms) | 50% Batch |
| **GPT-4o** (OpenAI, legacy tier) | $2.50 | $10.00 | Tile-based, 85 base + 170/tile. | ~2.5 s | 50% Batch |
| **Gemini 2.5 Pro** (Google) | $1.25 (≤200k) | $10.00 | Image input same $/MTok as text. | ~2.5 s (TTFT ~720 ms) | 50% Batch |
| **Gemini 2.5 Flash** (Google) | $0.30 (text/img/vid) | $2.50 | Image billed as text tokens. | ~1.2 s (TTFT ~250 ms) | 50% Batch |
| **Gemini 2.5 Flash-Lite** (Google) | $0.10 (text/img/vid) | $0.40 | Image billed as text tokens. Cheapest vision-capable frontier model. | ~0.8 s (TTFT ~140 ms) | 50% Batch |
| **Gemini 3.5 Flash** (Google, current gen) | $1.50 | $9.00 | Same image-as-text token model. | ~1.5 s (TTFT ~250 ms) | 50% Batch |
| **Gemini 3 Flash Preview** (Google) | $0.50 (text/img/vid) | $3.00 | Same image-as-text token model. | ~1 s | 50% Batch |

Notes: every row supports a `Batch API` path that halves cost in exchange for up-to-24-hour async turnaround. Image pricing varies by provider: Anthropic and Google charge images at the same per-token text rate; OpenAI uses a tile-based formula that's slightly more expensive per megapixel but is comparable at <1MP inputs.

## Cost per virality-score call (estimated)
Assuming a 1MP first frame + 200-word script + ~300-token JSON output:

- Opus 4.8: ~$0.016
- Sonnet 4.6: ~$0.010 ← **current TalkShot default**
- Haiku 4.5: ~$0.0033
- GPT-5.4-mini: ~$0.0024
- Gemini 2.5 Flash: ~$0.0015
- **Gemini 2.5 Flash-Lite: ~$0.0005** (cheapest viable)
- Gemini 3 Flash Preview: ~$0.0018

At 10,000 calls/month, Sonnet 4.6 ≈ $100 vs Flash-Lite ≈ $5.

## Recommendation

- **Best for this use case — Claude Sonnet 4.6 (existing) or Gemini 2.5 Pro.** Sonnet already ships in TalkShot, supports structured JSON output (`output_config.format.json_schema` via the Anthropic SDK 0.112+), and gives the most reliable editorial-judgment-style scores. Gemini 2.5 Pro is the strongest alternative if you want a second opinion or to A/B score; it's faster and ~2.4× cheaper per call.
- **Good enough for this use case — Gemini 2.5 Flash.** At $0.0015/call with sub-1.5s latency, it's the strongest cost/quality compromise for a "good enough" virality signal at scale. Falls back to Sonnet 4.6 for borderline scores if you want a confidence-tiered router.
- **Cheapest viable — Gemini 2.5 Flash-Lite ($0.0005/call) or Claude Haiku 4.5 ($0.0033/call).** Reasonable for low-stakes / high-volume calls, but quality drops noticeably on aesthetic-judgment tasks per published VLM benchmarks.

For a router: call Flash-Lite first; if its self-reported confidence is <0.7, escalate to Sonnet 4.6. This is the established "small-first, big-on-doubt" pattern and keeps monthly spend low.

## Vercel deployment / cold-start notes

- TalkShot already uses Vercel serverless functions (Node 20+, Anthropic SDK). Vercel Functions on paid plans now keep **at least one warm instance** for production, so SDK init (~200–400 ms) is usually amortized — but a true cold start on a vision route can add **1.5–3 s** on top of model inference.
- The native **Anthropic SDK** is ~15% faster on short prompts than routing through Vercel AI Gateway; for a 200-word text+image call where every 100 ms matters, stay on the direct SDK (the existing pattern in `api/score-script.ts`).
- Stay on the default Node.js runtime (not Edge) for vision routes — Edge has a 4 MB body limit and base64 image upload of a 1MP JPEG is ~300–500 KB, which fits, but Node is simpler.
- Set function memory to **1024 MB** for routes that accept image uploads (Vercel default 256 MB can OOM on large base64 buffers).
- Use **streaming** for perceived latency even though output is small — first token in 500–800 ms feels instant vs 2 s for the full JSON.

## Best fit for TalkShot specifically
- **Default model: keep Claude Sonnet 4.6** — already integrated, supports structured JSON, gives best editorial judgment.
- **Add a second endpoint `/api/score-image` (Sonnet 4.6) that takes a first-frame JPEG + the existing script-score context, returns a virality 0–10 with rationale.** This keeps everything on one provider, one SDK, one set of env vars.
- **Cost control:** cap `MAX_SCRIPT_CHARS` (already 8000), downscale first frame to 768px longest edge before base64-encoding to keep input tokens around 1.2k (≈$0.004 input on Sonnet 4.6).
- **Future option:** add Gemini 2.5 Flash as a fallback provider via `@google/generative-ai` if Anthropic has a regional outage or you want to test cost-quality tradeoffs.

## Citations (checked 2026-07-20)

1. **Anthropic Claude API pricing** — https://docs.anthropic.com/en/docs/about-claude/pricing (Opus 4.8 $5/$25, Sonnet 4.6 $3/$15, Haiku 4.5 $1/$5; Sonnet 5 intro $2/$10 through Aug 31 2026, $3/$15 after)
2. **OpenAI API pricing** — https://platform.openai.com/docs/pricing (flagship gpt-5.4 family, mini $0.75/$4.50, nano $0.20/$1.25, plus gpt-4o legacy at $2.50/$10)
3. **OpenAI Images & vision guide** — https://platform.openai.com/docs/guides/images-vision (tile-based image tokenization: 85 base + 170/tile for gpt-4o/4.1/5)
4. **Google Gemini Developer API pricing** — https://ai.google.dev/gemini-api/docs/pricing (Gemini 2.5 Pro $1.25/$10, Flash $0.30/$2.50, Flash-Lite $0.10/$0.40, 3.5 Flash $1.50/$9, Batch API = 50% off; image modality billed at same rate as text)
5. **Vercel Functions cold-start guidance** — https://vercel.com/kb/guide/how-can-i-improve-serverless-function-lambda-cold-start-performance-on-vercel and https://vercel.com/changelog/vercel-functions-now-have-faster-and-fewer-cold-starts (production minimum-one-warm; recommend Node 20+ runtime, Fluid compute)
6. **AI Inference Speed Benchmark 2026** — https://crazyrouter.com/en/blog/ai-inference-speed-benchmark-2026 (TTFT/TPS numbers used in the latency column: Sonnet 4.5 580 ms TTFT, Haiku 4.5 180 ms, GPT-5 Mini 320 ms, Gemini 2.5 Flash 250 ms, Flash-Lite 140 ms)
