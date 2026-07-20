// Extract a single still frame from a recorded video blob, downscaled to
// 768px on the longest edge and encoded as JPEG at quality 0.7.
//
// Used by the post-record virality-score flow: the user has a recorded
// video Blob in memory, we need a base64 JPEG to send to /api/score-video.
//
// Frame timing: we use currentTime = 0.0 by default. The spec called this
// out as an open question — 0s vs 0.5s vs 1.0s. The default 0s is the
// encoder's first I-frame. If a creator's videos have a "settling" beat
// at the start (hand on lens, camera adjusting), the first frame may be
// useless. Use `timeSeconds` to override.
export interface ExtractFirstFrameOptions {
  /** Override the frame timestamp in seconds. Default 0.0. */
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
  const timeSeconds = options.timeSeconds ?? 0
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
    // Some Android recordings have the first I-frame at t=0 with a duration
    // of 0 (the encoder's "still" frame). If duration > 0 and the requested
    // time is within it, seek there; otherwise use the first decodable frame.
    const seekTo = video.duration > 0 && timeSeconds <= video.duration
      ? timeSeconds
      : 0
    await seekVideo(video, seekTo)

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

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // Some browsers don't fire 'seeked' if the video is already at `time`.
    if (video.currentTime === time) {
      resolve()
      return
    }
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('Video seek failed'))
    }
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })
    video.currentTime = time
    setTimeout(() => {
      cleanup()
      reject(new Error('Video seek timed out'))
    }, 5000)
  })
}
