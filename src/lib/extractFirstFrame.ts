// Extract a single still frame from a recorded video blob, downscaled to
// 768px on the longest edge and encoded as JPEG at quality 0.7.
//
// Used by the post-record virality-score flow: the user has a recorded
// video Blob in memory, we need a base64 JPEG to send to /api/score-video.
//
// Frame timing: the default 0.0s is the encoder's first I-frame, which on
// TalkShot is BEFORE the 3-2-1 countdown ends. The first I-frame is often
// dim (camera hasn't fully exposed) and not representative of the user's
// actual opening frame. The default 4.0s is past the countdown + ~1s
// buffer. For very short takes (< 4s) we fall back to 0.5s, which is past
// any encoder I-frame weirdness but still in the first second of footage.
// Use `timeSeconds` to override.
export interface ExtractFirstFrameOptions {
  /** Override the frame timestamp in seconds. */
  timeSeconds?: number
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
 * Extract a single frame from a video Blob. Returns null on any failure
 * (unsupported codec, missing data, decoding error). The caller should
 * show a "couldn't read your video" state rather than crashing.
 */
export async function extractFirstFrame(
  blob: Blob,
  options: ExtractFirstFrameOptions = {},
): Promise<ExtractedFrame | null> {
  const maxEdge = options.maxEdge ?? 768
  const quality = options.quality ?? 0.7

  // Use a transient <video> + <canvas> pair. We never attach these to the
  // DOM, so there's no layout cost and no risk of them flashing on screen.
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  // Some browsers won't decode a Blob URL without an explicit src set.
  const blobUrl = URL.createObjectURL(blob)
  video.src = blobUrl

  try {
    await waitForMetadata(video)
    // Pick the best frame timestamp:
    // - If caller provided one, use it.
    // - If the video is at least 4s long, use 4.0s (past the 3-2-1 countdown
    //   + 1s buffer). This is the user's actual opening frame.
    // - Otherwise (very short take, dropped recording, etc.) use 0.5s.
    //   0.5s is past the encoder I-frame artifact window but still in the
    //   first second, so the frame is representative of the take.
    let requestedTime: number
    if (typeof options.timeSeconds === 'number') {
      requestedTime = options.timeSeconds
    } else if (video.duration > 0 && video.duration >= 4) {
      requestedTime = 4.0
    } else if (video.duration > 0) {
      requestedTime = Math.min(0.5, Math.max(0, video.duration - 0.1))
    } else {
      // Unknown duration — fall back to 4.0; if the seek fails we'll retry.
      requestedTime = 4.0
    }
    let actualTime = await seekVideo(video, requestedTime)
    // If the seek failed (e.g. very short clip), try 0.5s, then 0.0s.
    if (actualTime === null) {
      actualTime = await seekVideo(video, 0.5)
    }
    if (actualTime === null) {
      actualTime = await seekVideo(video, 0)
    }
    if (actualTime === null) {
      return null
    }

    const srcW = video.videoWidth
    const srcH = video.videoHeight
    if (!srcW || !srcH) return null

    // Downscale so the longest edge is `maxEdge`. The model is fine with
    // small inputs and a 1MP image is ~$0.010 of input cost on Sonnet 4.6.
    const scale = Math.min(1, maxEdge / Math.max(srcW, srcH))
    const dstW = Math.max(1, Math.round(srcW * scale))
    const dstH = Math.max(1, Math.round(srcH * scale))

    const canvas = document.createElement('canvas')
    canvas.width = dstW
    canvas.height = dstH
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, dstW, dstH)

    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    // dataUrl is "data:image/jpeg;base64,XXXX" — strip the prefix so the
    // server gets raw base64 (it accepts both, but raw is smaller on the wire).
    const comma = dataUrl.indexOf(',')
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
    const approxBytes = Math.floor((base64.length * 3) / 4)

    return {
      base64,
      mediaType: 'image/jpeg',
      width: dstW,
      height: dstH,
      approxBytes,
      timeSeconds: actualTime,
    }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(blobUrl)
    // Detach the video element to release the decoder ASAP.
    video.removeAttribute('src')
    video.load()
  }
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
    // 5s ceiling — if the video is corrupt or codec is unsupported, fail fast.
    setTimeout(() => {
      cleanup()
      reject(new Error('Video metadata load timed out'))
    }, 5000)
  })
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<number | null> {
  return new Promise((resolve) => {
    // Some browsers don't fire 'seeked' if the video is already at `time`,
    // or if `time` is past the duration. Guard both.
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
