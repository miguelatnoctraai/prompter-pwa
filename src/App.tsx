import { useEffect, useRef, useState } from 'react'

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let stream: MediaStream | null = null

    async function startCamera() {
      setError(null)
      setLoading(true)

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })

        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Could not access the camera. Please allow camera permission and reload.',
        )
      } finally {
        setLoading(false)
      }
    }

    void startCamera()

    return () => {
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [facingMode])

  function flipCamera() {
    setFacingMode((mode) => (mode === 'user' ? 'environment' : 'user'))
  }

  return (
    <div className="relative h-screen w-screen bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="h-full w-full object-cover"
        aria-label="Camera preview"
      />

      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white/80">
          <p>Starting camera…</p>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 p-8 text-center text-white">
          <p className="max-w-md">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full bg-white px-6 py-2 text-sm font-medium text-black shadow-lg active:scale-95"
          >
            Reload
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={flipCamera}
        className="absolute bottom-8 right-8 rounded-full bg-white/90 p-4 text-black shadow-lg backdrop-blur-sm active:scale-95"
        aria-label="Flip camera"
        title="Flip camera"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
          <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
          <circle cx="12" cy="12" r="3" />
          <path d="m18 22-3-3 3-3" />
          <path d="m6 2 3 3-3 3" />
        </svg>
      </button>
    </div>
  )
}

export default App
