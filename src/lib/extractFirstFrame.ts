// Extract one or more still frames from a recorded video blob, downscaled
// to 768px on the longest edge and encoded as JPEG at quality 0.7.
//
// Used by the post-record virality-score flow: the user has a recorded
// video Blob in memory, we need base64 JPEGs to send to /api/score-video.
//
// Frame timing: TalkShot records after a 3-2-1 countdown, so the encoder's
// first I-frame is BEFORE the user's actual opening frame. We extract
// multiple candidate timestamps and let the user pick which represents
// their "first frame" best.
//
// Why multiple: at t=4.0 the creator is often just past the countdown
// (mid-intro, eyes on the teleprompter, expression flat). At t=6.0 they're
// usually in motion, eye contact settled, expression live. Both are
// reasonable "first frame" candidates — the user knows which one they
// want scored.
export interface ExtractFirstFrameOptions {
  /** Override the frame timestamps in seconds. Default [4.0, 6.0]. */
  timesSeconds?: number[]
  /** Max edge in pixels (downscale to fit). Default 768. */
  maxEdge?: number
  /** JPEG quality 0–1. Default 0.7. */
  quality?: number
}

export interface ExtractedFrame {
  base64: string
  mediaType: 'image/jpeg'
  width: number
  height: number
  approxBytes: number
  /** The timestamp (in seconds) actually used for extraction. */
  timeSeconds: number
}

/**
 * Extract one or more candidate frames from a video Blob. Returns an
 * array of ExtractedFrame in the order requested; missing/corrupt
 * timestamps are dropped from the result (not failed). Returns an empty
 * array if no frames could be extracted at all.
 */
export async function extractFirstFrame(
  blob: Blob,
  options: ExtractFirstFrameOptions = {},
): Promise<ExtractedFrame[]> {
  const timesSeconds = options.timesSeconds ?? [4.0, 6.0]
  const maxEdge = options.maxEdge ?? 768
  const quality = options.quality ?? 0.7

  // Use a transient <video> + <canvas> pair. We never attach these to the
  // DOM, so there's no layout cost and no risk of them flashing on screen.
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  const blobUrl = URL.createObjectURL(blob)
  video.src = blobUrl

  const results: ExtractedFrame[] = []
  try {
    await waitForMetadata(video)
    if (!video.videoWidth || !video.videoHeight) return []

    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight))
    const dstW = Math.max(1, Math.round(video.videoWidth * scale))
    const dstH = Math.max(1, Math.round(video.videoHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = dstW
    canvas.height = dstH
    const ctx = canvas.getContext('2d')
    if (!ctx) return []

    for (const requestedTime of timesSeconds) {
      // Cap by video duration. If a take is 5s long, t=6.0 will fail to
      // seek; fall back to the last 0.2s so we still get a frame.
      let seekTarget = requestedTime
      if (video.duration > 0 && seekTarget >= video.duration) {
        seekTarget = Math.max(0, video.duration - 0.2)
      }
      const actualTime = await seekVideo(video, seekTarget)
      if (actualTime === null) continue

      ctx.drawImage(video, 0, 0, dstW, dstH)
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      const comma = dataUrl.indexOf(',')
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
      const approxBytes = Math.floor((base64.length * 3) / 4)

      results.push({
        base64,
        mediaType: 'image/jpeg',
        width: dstW,
        height: dstH,
        approxBytes,
        timeSeconds: actualTime,
      })
    }
  } catch {
    // Soft fail: return whatever we got.
  } finally {
    URL.revokeObjectURL(blobUrl)
    video.removeAttribute('src')
    video.load()
  }
  return results
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1) {
      resolve()
      return
    }
    const onLoaded = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('Video metadata load failed'))
    }
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('loadedmetadata', onLoaded, { once: true })
    video.addEventListener('error', onError, { once: true })
    setTimeout(() => {
      cleanup()
      reject(new Error('Video metadata load timed out'))
    }, 5000)
  })
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<number | null> {
  return new Promise((resolve) => {
    if (video.duration > 0 && time > video.duration) {
      resolve(null)
      return
    }
    const onSeeked = () => {
      cleanup()
      resolve(video.currentTime)
    }
    const onError = () => {
      cleanup()
      resolve(null)
    }
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })
    try {
      video.currentTime = time
    } catch {
      cleanup()
      resolve(null)
      return
    }
    setTimeout(() => {
      cleanup()
      resolve(null)
    }, 5000)
  })
}
