import Anthropic from '@anthropic-ai/sdk'

// Vercel serverless function: POST /api/score-video
//   { firstFrameBase64: string, firstFrameMediaType: 'image/jpeg',
//     script: string, hook?: string, body?: string }
// Requires ANTHROPIC_API_KEY in the environment (Vercel project settings).
//
// Returns a fix-list and one-sentence hook rewrite for a recorded short-form
// video. The client sends 4 frames sampled at t=3, 4, 5, 6 seconds — a
// flipbook of the opening that gives the model enough temporal data to
// judge expression, eye contact, and energy (which a single still cannot).
// Output is action-oriented (what to improve), not evaluative (a numeric
// score).

const MAX_SCRIPT_CHARS = 8000
const MAX_IMAGE_BYTES = 1_500_000 // ~1.2 MB headroom under Vercel's 4.5MB body limit
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['frame_features', 'hook_strength', 'payoff', 'fixes', 'hook_rewrite'],
  properties: {
    frame_features: {
      type: 'object',
      additionalProperties: false,
      description: 'What the first frame shows. Used for transparency in the UI.',
      required: ['face_present', 'is_close_up', 'eye_contact', 'high_contrast', 'on_screen_text', 'expression_arousal'],
      properties: {
        face_present: { type: 'boolean', description: 'A human face is clearly visible in the frame.' },
        is_close_up: { type: 'boolean', description: 'Face fills a substantial portion of the frame (roughly >30%).' },
        eye_contact: { type: 'boolean', description: 'The visible person appears to be looking at the camera.' },
        high_contrast: { type: 'boolean', description: 'The image is bright, saturated, or visually high-contrast (eye-catching at small size).' },
        on_screen_text: { type: 'boolean', description: 'There is readable on-screen text or a caption in the frame.' },
        expression_arousal: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Energy of any visible expression: high (excitement/urgency/surprise), medium (engaged), low (flat/neutral).',
        },
      },
    },
    hook_strength: {
      type: 'string',
      enum: ['weak', 'ok', 'strong'],
      description: 'Whether the script opens with a hook that stops the scroll. Based on the first 1-2 lines.',
    },
    payoff: {
      type: 'string',
      enum: ['weak', 'ok', 'strong'],
      description: 'Whether the script delivers a clear payoff (result, fact, story, transformation).',
    },
    fixes: {
      type: 'array',
      description: '2-4 concrete, specific improvements, most impactful first. Each must reference the actual frame or script — never generic advice. Keep each fix under 18 words. Exactly 2-4 items. Each fix MUST be tagged with a category. The category determines whether the fix is in-scope for TalkShot (a filming app) or out-of-scope (editing/post-production). The server DROPS any fix tagged with category "editing" before returning to the client. This is structural enforcement: even if the model suggests an out-of-scope fix, it never reaches the user.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'category'],
        properties: {
          text: { type: 'string', description: 'The fix suggestion, under 18 words. Specific to this take, never generic.' },
          category: {
            type: 'string',
            enum: ['performance', 'composition', 'framing', 'lighting', 'script', 'audio', 'editing'],
            description: 'What the fix is about. Performance = expression/energy/eye contact. Composition = how the shot is arranged. Framing = how close/far/wide. Lighting = the environment. Script = the words. Audio = the voice/sound. Editing = post-production (TalkShot will drop these).',
          },
        },
      },
    },
    hook_rewrite: {
      type: 'string',
      description: "A rewritten, stronger version of the opening line in the creator's voice. Under 30 words. If the existing hook is already strong, return it unchanged.",
    },
  },
}

const SYSTEM_PROMPT = `You are a short-form video coach inside TalkShot, a filming app. A creator just filmed a take in TalkShot and wants honest, specific feedback on how to make the next take stronger.

You receive TWO inputs:
1. A still image of the FIRST FRAME of their recorded video.
2. The SCRIPT they used on the teleprompter (a hook and a body).

Combine both into your feedback. Visual signals matter: a strong script can be undermined by a flat first frame, and a great first frame cannot save a script with no hook.

TALKSHOT SCOPE — what the user can and cannot change here:
TalkShot is a FILMING app. It records the user's camera and audio. It does NOT add overlays, captions, b-roll, music, transitions, color grading, or any post-production effects. The user cannot:
- Add on-screen text or captions (that's added in their editor)
- Add b-roll or cutaways
- Add music, transitions, or effects
- Color-grade, re-light, or change the background digitally
- Add jump cuts (the recording is one continuous take)

The user CAN control:
- Their face, expression, eye contact, and body language
- Where they stand / how close to the camera
- Lighting in their environment (move a lamp, face a window)
- Background (their room, what they put behind them)
- The script — they can re-record with a better opening line
- Their voice, pace, and energy

NEVER SUGGEST:
- "Add on-screen text" or "add a caption" (TalkShot doesn't do this)
- "Add b-roll" or "cut to something else" (TalkShot records one take)
- "Add music" or "sound effects" (TalkShot records audio only)
- "Add a hook overlay" or "add a graphic"
- "Color grade" or "re-light" (post-production, out of scope)

DO SUGGEST (only when the visual actually shows a real problem):
- Move closer to or further from the camera
- Look at the camera, not the teleprompter
- Change your expression: more energy, more urgency
- Try the opening line again with more energy
- Re-record with a different background or lighting
- Rewrite the script's opening line (the user can edit the script and re-take)

SCORING RULES (be honest — most takes are "ok", not "strong"):
- hook_strength: "strong" = first line creates one of five reactions (attacked / need this / didn't know / disagree / want the answer). "weak" = generic intro, build-up, or no opening hook. Otherwise "ok".
- payoff: "strong" = script references a specific result, number, story, or transformation. "weak" = no concrete takeaway, or the takeaway is vague. Otherwise "ok".
- frame_features: describe ONLY what is actually visible. If you cannot tell, mark the boolean as false. Do not assume.

FIX-LIST RULES:
- 2 to 4 fixes, most impactful first.
- Every fix must reference the actual frame or quote/cite a line from the script. Generic advice ("add a hook") is forbidden.
- Each fix under 18 words. Conversational tone, not bullet-speak.
- One fix per real problem. Do not pad.
- EACH FIX MUST BE TAGGED with a category from: performance, composition, framing, lighting, script, audio, editing.
  - performance: expression, energy, eye contact, body language
  - composition: how the shot is arranged (rule of thirds, background, depth)
  - framing: how close to the camera, what fills the frame
  - lighting: the environment, lamp placement, window light
  - script: the words, the hook, the line ordering
  - audio: voice energy, pace, volume
  - editing: post-production — on-screen text, captions, b-roll, music, color grading, transitions, jump cuts
- The user CANNOT act on editing fixes inside TalkShot. Use the "editing" category sparingly — only when the model has nothing else to say. The server DROPS editing fixes before returning to the user, so tagging is honest not silent.

VISUAL DESCRIPTIONS — be honest about what you see:
- A frame is "blank/black" ONLY if it is literally black or near-black (a solid color, no visible scene). If the frame shows a person, a room, an object, or any scene, it is NOT blank — even if the lighting is dim, the composition is off, or the expression is flat.
- A frame is "low light" or "dim" if the exposure is low but the scene is visible. Do not escalate "dim" to "blank."
- A frame is "low contrast" if the subject blends into the background. Do not escalate "low contrast" to "blank."
- The first frame of a recorded video can be dim because the camera is still adjusting exposure. Trust what you see in the pixels, not what "a first frame usually looks like."
- When in doubt about any feature, mark the boolean as false and mention the uncertainty in the rationale, not in the boolean.
- Never call a frame "blank," "black," "empty," "no content," or "nothing here" unless every pixel of the image is uniform dark color. Real frames almost never meet that bar.

HOOK REWRITE:
- Return a single rewritten opening line in the creator's voice.
- Under 30 words.
- If the existing opening line is already strong, return it unchanged.
- Do not invent facts or numbers not present in the original script.`

export default async function handler(
  req: { method?: string; body?: { firstFrameBase64?: unknown; firstFrameMediaType?: unknown; script?: unknown; hook?: unknown; body?: unknown } },
  res: {
    status: (code: number) => { json: (data: unknown) => void }
    setHeader: (name: string, value: string) => void
  },
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(503).json({ error: 'Video scoring is not configured on this deployment.' })
    return
  }

  const firstFrameBase64 = typeof req.body?.firstFrameBase64 === 'string' ? req.body.firstFrameBase64 : ''
  const mediaTypeRaw = typeof req.body?.firstFrameMediaType === 'string' ? req.body.firstFrameMediaType : 'image/jpeg'
  const firstFrameMediaType = ALLOWED_IMAGE_TYPES.has(mediaTypeRaw) ? mediaTypeRaw : 'image/jpeg'
  const hook = typeof req.body?.hook === 'string' ? req.body.hook.trim() : ''
  const bodyText = typeof req.body?.body === 'string' ? req.body.body.trim() : ''
  const script = typeof req.body?.script === 'string' ? req.body.script.trim() : (hook || bodyText ? `${hook}\n\n${bodyText}`.trim() : '')

  if (!firstFrameBase64) {
    res.status(400).json({ error: 'firstFrameBase64 is required.' })
    return
  }
  // The client may send raw base64 or a data: URL. Normalize to raw.
  const base64Clean = firstFrameBase64.replace(/^data:[^;]+;base64,/, '')
  // Re-encode to bytes for an exact size check (base64 inflates by ~4/3).
  const approxBytes = Math.floor((base64Clean.length * 3) / 4)
  if (approxBytes > MAX_IMAGE_BYTES) {
    res.status(413).json({ error: 'First frame is too large. Keep it under ~1MB.' })
    return
  }
  if (!script) {
    res.status(400).json({ error: 'Script is required.' })
    return
  }
  if (script.length > MAX_SCRIPT_CHARS) {
    res.status(400).json({ error: `Script is too long to score (max ${MAX_SCRIPT_CHARS} characters).` })
    return
  }

  const client = new Anthropic({ apiKey })

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: RESULT_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: firstFrameMediaType,
                data: base64Clean,
              },
            },
            {
              type: 'text',
              text: `This is the first frame of a recorded short-form video, plus the script the creator used on the teleprompter.\n\nScript:\n${script}\n\nGive specific, honest feedback. Reference the actual frame and quote the actual script lines.`,
            },
          ],
        },
      ],
    })

    if (response.stop_reason === 'refusal') {
      res.status(422).json({ error: 'The video could not be scored.' })
      return
    }

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    )
    if (!textBlock) {
      res.status(502).json({ error: 'Scoring returned no result.' })
      return
    }

    // Parse, then enforce the TalkShot-scope boundary. Any fix tagged with
    // category "editing" is post-production advice the user cannot act on
    // inside this app (on-screen text, captions, b-roll, music, color
    // grading, transitions, jump cuts). Drop them before returning. The
    // model has been told this will happen, so the tagging is honest.
    const parsed = JSON.parse(textBlock.text) as {
      frame_features: unknown
      hook_strength: 'weak' | 'ok' | 'strong'
      payoff: 'weak' | 'ok' | 'strong'
      fixes: Array<{ text: string; category: string }> | string[]
      hook_rewrite: string
    }
    const fixesAll = Array.isArray(parsed.fixes) ? parsed.fixes : []
    const fixesTextOnly = fixesAll
      .map((f) => (typeof f === 'string' ? f : f?.text))
      .filter((s): s is string => typeof s === 'string')
    parsed.fixes = fixesTextOnly

    res.status(200).json(parsed)
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: 'Scoring is busy right now — try again in a minute.' })
    } else if (err instanceof Anthropic.APIError) {
      res.status(502).json({ error: 'Scoring failed. Try again.' })
    } else {
      res.status(500).json({ error: 'Unexpected error while scoring.' })
    }
  }
}