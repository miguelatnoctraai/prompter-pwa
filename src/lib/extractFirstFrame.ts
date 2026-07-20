// Extract multiple still frames from a recorded video Blob, downscaled
// for upload. Used by the post-record virality-score flow.
//
// Why multiple frames (not one): a single still image cannot show
// expression, energy, or pacing — those are temporal. By sampling 4
// frames at 1s intervals starting at t=3, we give the model a "flipbook"
// of the opening — enough temporal data to judge expression, eye
// contact, and energy without the cost of sending a full video.

export interface ExtractFramesOptions {
  /** Timestamps in seconds. Default [3.0, 4.0, 5.0, 6.0]. */
  timesSeconds?: number[]
  /** Max edge in pixels. Default 512 (4 images, total ~1MB). */
  maxEdge?: number
  /** JPEG quality 0-1. Default 0.7. */
  quality?: number
}

export interface ExtractedFrame {
  base64: string
  mediaType: 'image/jpeg'
  width: number
  height: number
  approxBytes: number
  timeSeconds: number
}

/**
 * Extract multiple candidate frames from a video Blob. Returns an array
 * of ExtractedFrame in the order requested; missing/corrupt timestamps
 * are dropped from the result (not failed). Returns an empty array if
 * no frames could be extracted at all.
 */
export async function extractFirstFrame(
  blob: Blob,
  options: ExtractFramesOptions = {},
): Promise<ExtractedFrame[]> {
  const timesSeconds = options.timesSeconds ?? [3.0, 4.0, 5.0, 6.0]
  const maxEdge = options.maxEdge ?? 512
  const quality = options.quality ?? 0.7

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
