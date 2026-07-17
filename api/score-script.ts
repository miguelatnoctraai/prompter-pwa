import Anthropic from '@anthropic-ai/sdk'

// Vercel serverless function: POST /api/score-script { title, body }
// Requires ANTHROPIC_API_KEY in the environment (Vercel project settings).

const MAX_SCRIPT_CHARS = 8000

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scores', 'estimated_seconds', 'strengths', 'suggestions', 'rewrite_hook'],
  properties: {
    scores: {
      type: 'object',
      additionalProperties: false,
      required: ['hook', 'clarity', 'pacing', 'cta', 'overall'],
      properties: {
        hook: { type: 'integer', description: 'How well the first line stops the scroll, 0-10' },
        clarity: { type: 'integer', description: 'How easy the script is to follow when spoken aloud, 0-10' },
        pacing: { type: 'integer', description: 'Rhythm and sentence length for spoken delivery, 0-10' },
        cta: { type: 'integer', description: 'Strength of the call to action or ending, 0-10' },
        overall: { type: 'integer', description: 'Overall score, 0-10' },
      },
    },
    estimated_seconds: {
      type: 'integer',
      description: 'Estimated spoken duration in seconds at a natural creator pace (~150 wpm)',
    },
    strengths: {
      type: 'array',
      description: '1-2 things the script already does well',
      items: { type: 'string' },
    },
    suggestions: {
      type: 'array',
      description: '2-3 concrete, specific improvements, most impactful first',
      items: { type: 'string' },
    },
    rewrite_hook: {
      type: 'string',
      description: "A rewritten, stronger version of the opening line in the creator's voice",
    },
  },
} as const

const SYSTEM_PROMPT = `You are a short-form video script coach. Creators paste teleprompter scripts for TikTok, Reels, and Shorts; you score them and give concrete, actionable feedback.

Judge for the medium: the first 1-2 seconds decide whether viewers scroll past, spoken language beats written language, one idea per video, and the ending should tell the viewer what to do next. Be honest — a mediocre script should score 4-6, not 8. Suggestions must be specific to this script (quote or reference its actual lines), never generic advice.`

export default async function handler(
  req: { method?: string; body?: { title?: unknown; body?: unknown } },
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
    res.status(503).json({ error: 'Script scoring is not configured on this deployment.' })
    return
  }

  const title = typeof req.body?.title === 'string' ? req.body.title : ''
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : ''
  if (!body) {
    res.status(400).json({ error: 'Script body is required.' })
    return
  }
  if (body.length > MAX_SCRIPT_CHARS) {
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
          content: `Score this short-form video script.\n\nTitle: ${title || '(untitled)'}\n\nScript:\n${body}`,
        },
      ],
    })

    if (response.stop_reason === 'refusal') {
      res.status(422).json({ error: 'The script could not be scored.' })
      return
    }

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    )
    if (!textBlock) {
      res.status(502).json({ error: 'Scoring returned no result.' })
      return
    }

    res.status(200).json(JSON.parse(textBlock.text))
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
