import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import {
  type Script,
  loadScripts,
  saveScripts,
  addTombstone,
  pushScript,
  pushDeletion,
  fullSync,
} from './lib/scriptStore'

interface Settings {
  fontSize: number
  lineHeight: number
  speed: number
  mirror: boolean
  margin: number
  focusBand: boolean
}

const DEFAULT_SETTINGS: Settings = {
  fontSize: 42,
  lineHeight: 1.6,
  speed: 50,
  mirror: false,
  margin: 16,
  focusBand: true,
}

// Fades text away from the eye-level line (~45vh, where scrolling text enters)
// so the reader's gaze stays anchored near the camera.
const FOCUS_BAND_MASK =
  'linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.2) 28%, rgba(0,0,0,1) 40%, rgba(0,0,0,1) 56%, rgba(0,0,0,0.2) 72%, rgba(0,0,0,0.2) 100%)'

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('prompter.settings.v1')
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

function saveSettings(settings: Settings) {
  localStorage.setItem('prompter.settings.v1', JSON.stringify(settings))
}

export default function App() {
  const [view, setView] = useState<'list' | 'edit' | 'prompt' | 'account'>('list')
  const [scripts, setScripts] = useState<Script[]>(loadScripts)
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [session, setSession] = useState<Session | null>(null)

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const activeScript = scripts.find((s) => s.id === activeScriptId) || null

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // On sign-in, reconcile local scripts with the cloud copy.
  useEffect(() => {
    if (!session) return
    fullSync(loadScripts())
      .then(setScripts)
      .catch(() => {}) // offline — write-through and manual sync will catch up
  }, [session])

  function createScript() {
    setTitle('')
    setBody('')
    setActiveScriptId(null)
    setView('edit')
  }

  function editScript(script: Script) {
    setTitle(script.title)
    setBody(script.body)
    setActiveScriptId(script.id)
    setView('edit')
  }

  function saveScript() {
    const trimmedTitle = title.trim() || 'Untitled script'
    const trimmedBody = body.trim()
    if (!trimmedBody) return

    const now = Date.now()
    let nextScripts: Script[]
    if (activeScript) {
      nextScripts = scripts.map((s) =>
        s.id === activeScript.id ? { ...s, title: trimmedTitle, body: trimmedBody, updatedAt: now } : s,
      )
    } else {
      const newScript: Script = {
        id: crypto.randomUUID(),
        title: trimmedTitle,
        body: trimmedBody,
        createdAt: now,
        updatedAt: now,
      }
      nextScripts = [newScript, ...scripts]
    }

    setScripts(nextScripts)
    saveScripts(nextScripts)
    if (session) {
      const saved = activeScript
        ? nextScripts.find((s) => s.id === activeScript.id)
        : nextScripts[0]
      if (saved) void pushScript(saved)
    }
    setView('list')
  }

  function deleteScript(id: string) {
    const next = scripts.filter((s) => s.id !== id)
    setScripts(next)
    saveScripts(next)
    addTombstone(id)
    if (session) void pushDeletion(id)
  }

  function updateSettings(patch: Partial<Settings>) {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
  }

  function startPrompting(script: Script) {
    setActiveScriptId(script.id)
    setView('prompt')
  }

  return (
    <div className="h-full w-full bg-black text-white">
      {view === 'list' && (
        <ScriptListView
          scripts={scripts}
          onCreate={createScript}
          onEdit={editScript}
          onDelete={deleteScript}
          onPrompt={startPrompting}
          settings={settings}
          onUpdateSettings={updateSettings}
          signedIn={!!session}
          onAccount={() => setView('account')}
        />
      )}
      {view === 'account' && (
        <AccountView
          session={session}
          onBack={() => setView('list')}
          onScriptsSynced={setScripts}
        />
      )}
      {view === 'edit' && (
        <EditScriptView
          title={title}
          body={body}
          isNew={!activeScript}
          onTitleChange={setTitle}
          onBodyChange={setBody}
          onSave={saveScript}
          onCancel={() => setView('list')}
        />
      )}
      {view === 'prompt' && activeScript && (
        <PromptView
          script={activeScript}
          settings={settings}
          onUpdateSettings={updateSettings}
          onBack={() => setView('list')}
        />
      )}
    </div>
  )
}

function ScriptListView({
  scripts,
  onCreate,
  onEdit,
  onDelete,
  onPrompt,
  settings,
  onUpdateSettings,
  signedIn,
  onAccount,
}: {
  scripts: Script[]
  onCreate: () => void
  onEdit: (s: Script) => void
  onDelete: (id: string) => void
  onPrompt: (s: Script) => void
  settings: Settings
  onUpdateSettings: (p: Partial<Settings>) => void
  signedIn: boolean
  onAccount: () => void
}) {
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div className="flex h-full flex-col bg-zinc-950 p-4 pt-12">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">TalkShot</h1>
        <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onAccount}
          className="relative rounded-full bg-zinc-800 p-3 text-white active:scale-95"
          aria-label="Account"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          {signedIn && (
            <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-emerald-400" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setShowSettings((s) => !s)}
          className="rounded-full bg-zinc-800 p-3 text-white active:scale-95"
          aria-label="Settings"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />
          </svg>
        </button>
        </div>
      </div>

      {showSettings && (
        <div className="mb-4 rounded-2xl bg-zinc-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">Default display</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Font size
              <input
                type="number"
                value={settings.fontSize}
                onChange={(e) => onUpdateSettings({ fontSize: Number(e.target.value) })}
                className="rounded-lg bg-zinc-800 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Line height
              <input
                type="number"
                step="0.1"
                value={settings.lineHeight}
                onChange={(e) => onUpdateSettings({ lineHeight: Number(e.target.value) })}
                className="rounded-lg bg-zinc-800 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Speed
              <input
                type="number"
                value={settings.speed}
                onChange={(e) => onUpdateSettings({ speed: Number(e.target.value) })}
                className="rounded-lg bg-zinc-800 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Margin
              <input
                type="number"
                value={settings.margin}
                onChange={(e) => onUpdateSettings({ margin: Number(e.target.value) })}
                className="rounded-lg bg-zinc-800 px-3 py-2"
              />
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.mirror}
              onChange={(e) => onUpdateSettings({ mirror: e.target.checked })}
            />
            Mirror text by default
          </label>
        </div>
      )}

      {scripts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-zinc-400">
          <p>No scripts yet.</p>
          <button
            type="button"
            onClick={onCreate}
            className="rounded-full bg-white px-6 py-3 font-semibold text-black active:scale-95"
          >
            Create your first script
          </button>
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto pb-24">
          {scripts.map((script) => (
            <div
              key={script.id}
              className="flex items-center justify-between rounded-2xl bg-zinc-900 p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{script.title}</p>
                <p className="truncate text-sm text-zinc-400">
                  {script.body.slice(0, 60).replace(/\n/g, ' ')}
                </p>
              </div>
              <div className="ml-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onPrompt(script)}
                  className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black active:scale-95"
                >
                  Prompt
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(script)}
                  className="rounded-full bg-zinc-800 p-2 text-zinc-300 active:scale-95"
                  aria-label="Edit"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(script.id)}
                  className="rounded-full bg-zinc-800 p-2 text-red-400 active:scale-95"
                  aria-label="Delete"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onCreate}
        className="absolute bottom-8 right-8 rounded-full bg-white p-4 text-black shadow-lg active:scale-95"
        aria-label="New script"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  )
}

function AccountView({
  session,
  onBack,
  onScriptsSynced,
}: {
  session: Session | null
  onBack: () => void
  onScriptsSynced: (scripts: Script[]) => void
}) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function sendCode() {
    if (!supabase) return
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() })
    setBusy(false)
    if (error) {
      setMessage(error.message)
    } else {
      setStage('code')
      setMessage('Check your email for a 6-digit code.')
    }
  }

  async function verifyCode() {
    if (!supabase) return
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    })
    setBusy(false)
    if (error) {
      setMessage(error.message)
    } else {
      setStage('email')
      setCode('')
      setMessage(null)
    }
  }

  async function syncNow() {
    setBusy(true)
    setMessage(null)
    try {
      const merged = await fullSync(loadScripts())
      onScriptsSynced(merged)
      setMessage(`Synced ${merged.length} script${merged.length === 1 ? '' : 's'}.`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Sync failed.')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    await supabase.auth.signOut()
    setMessage(null)
    setStage('email')
  }

  return (
    <div className="flex h-full flex-col bg-zinc-950 p-4 pt-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">Account</h1>
        <button type="button" onClick={onBack} className="text-zinc-400 active:scale-95">
          Back
        </button>
      </div>

      {!supabase ? (
        <p className="text-zinc-400">
          Cloud sync is not configured for this build. Scripts are stored on this device only.
        </p>
      ) : session ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-zinc-900 p-4">
            <p className="text-sm text-zinc-400">Signed in as</p>
            <p className="font-semibold">{session.user.email}</p>
          </div>
          <p className="text-sm text-zinc-400">
            Your scripts sync to the cloud automatically when you save or delete them. Use Sync
            now after working offline or on another device.
          </p>
          <button
            type="button"
            onClick={syncNow}
            disabled={busy}
            className="w-full rounded-full bg-white py-3 font-semibold text-black disabled:opacity-40 active:scale-95"
          >
            {busy ? 'Syncing…' : 'Sync now'}
          </button>
          <button
            type="button"
            onClick={signOut}
            disabled={busy}
            className="w-full rounded-full bg-zinc-800 py-3 font-semibold text-white disabled:opacity-40 active:scale-95"
          >
            Sign out
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            Sign in to back up your scripts and sync them across devices. We'll email you a
            one-time code — no password needed.
          </p>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={stage === 'code'}
            className="w-full rounded-xl bg-zinc-900 px-4 py-3 placeholder-zinc-500 outline-none disabled:opacity-60"
          />
          {stage === 'code' && (
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-center text-xl tracking-widest placeholder-zinc-500 outline-none"
            />
          )}
          {stage === 'email' ? (
            <button
              type="button"
              onClick={sendCode}
              disabled={busy || !email.includes('@')}
              className="w-full rounded-full bg-white py-3 font-semibold text-black disabled:opacity-40 active:scale-95"
            >
              {busy ? 'Sending…' : 'Send code'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={verifyCode}
                disabled={busy || code.trim().length < 6}
                className="w-full rounded-full bg-white py-3 font-semibold text-black disabled:opacity-40 active:scale-95"
              >
                {busy ? 'Verifying…' : 'Verify code'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStage('email')
                  setCode('')
                  setMessage(null)
                }}
                className="w-full text-sm text-zinc-400 active:scale-95"
              >
                Use a different email
              </button>
            </>
          )}
        </div>
      )}

      {message && <p className="mt-4 text-center text-sm text-zinc-300">{message}</p>}
    </div>
  )
}

function EditScriptView({
  title,
  body,
  isNew,
  onTitleChange,
  onBodyChange,
  onSave,
  onCancel,
}: {
  title: string
  body: string
  isNew: boolean
  onTitleChange: (v: string) => void
  onBodyChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex h-full flex-col bg-zinc-950 p-4 pt-12">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">{isNew ? 'New script' : 'Edit script'}</h1>
        <button type="button" onClick={onCancel} className="text-zinc-400 active:scale-95">
          Cancel
        </button>
      </div>
      <input
        type="text"
        placeholder="Script title"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        className="mb-3 rounded-xl bg-zinc-900 px-4 py-3 text-lg font-semibold placeholder-zinc-500 outline-none"
      />
      <textarea
        placeholder="Paste your script here..."
        value={body}
        onChange={(e) => onBodyChange(e.target.value)}
        className="flex-1 resize-none rounded-xl bg-zinc-900 p-4 text-base leading-relaxed placeholder-zinc-500 outline-none"
      />
      <button
        type="button"
        onClick={onSave}
        disabled={!body.trim()}
        className="mt-4 w-full rounded-full bg-white py-4 font-semibold text-black disabled:opacity-40 active:scale-95"
      >
        Save
      </button>
    </div>
  )
}

function PromptView({
  script,
  settings,
  onUpdateSettings,
  onBack,
}: {
  script: Script
  settings: Settings
  onUpdateSettings: (p: Partial<Settings>) => void
  onBack: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef<number>(0)
  const timerRef = useRef<number | null>(null)
  const progressRef = useRef(0)

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [isRecording, setIsRecording] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)

  async function startCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setError(null)
    setLoading(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Camera/microphone access failed.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void startCamera()
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode])

  // Keep the screen awake while prompting. iOS releases the lock whenever the
  // page is backgrounded, so re-request it on return.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null

    async function acquire() {
      if (!('wakeLock' in navigator)) return
      try {
        lock = await navigator.wakeLock.request('screen')
      } catch {
        // Ignore: low battery mode or unsupported — screen just dims as usual.
      }
    }

    void acquire()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      lock?.release().catch(() => {})
    }
  }, [])

  // Bluetooth clickers and page-turner remotes pair as keyboards:
  // Space/Enter/→/PageDown toggle play, ↑/←/PageUp jump back, ↓ jumps forward.
  useEffect(() => {
    function nudgeScroll(delta: number) {
      const el = textRef.current
      if (!el) return
      const maxScroll = el.scrollHeight - el.clientHeight
      progressRef.current = Math.min(maxScroll, Math.max(0, progressRef.current + delta))
      el.scrollTop = progressRef.current
    }

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

      switch (e.code) {
        case 'Space':
        case 'Enter':
        case 'ArrowRight':
        case 'PageDown':
          e.preventDefault()
          if (!e.repeat) setPlaying((p) => !p)
          break
        case 'ArrowUp':
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault()
          nudgeScroll(-200)
          break
        case 'ArrowDown':
          e.preventDefault()
          nudgeScroll(200)
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    let raf = 0
    const textEl = textRef.current
    if (!textEl) return

    function scroll() {
      if (!playing || !textEl) return
      const speedPxPerSec = settings.speed * 2
      progressRef.current += speedPxPerSec / 60
      textEl.scrollTop = progressRef.current
      const maxScroll = textEl.scrollHeight - textEl.clientHeight
      if (progressRef.current >= maxScroll) {
        progressRef.current = maxScroll
        setPlaying(false)
      } else {
        raf = requestAnimationFrame(scroll)
      }
    }

    if (playing) {
      raf = requestAnimationFrame(scroll)
    }
    return () => cancelAnimationFrame(raf)
  }, [playing, settings.speed])

  useEffect(() => {
    if (isRecording && !recordedUrl) {
      startTimeRef.current = Date.now()
      timerRef.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isRecording, recordedUrl])

  function resetScroll() {
    progressRef.current = 0
    if (textRef.current) textRef.current.scrollTop = 0
    setPlaying(false)
  }

  function togglePlay() {
    setPlaying((p) => !p)
  }

  async function startRecordingWithCountdown() {
    setRecordedUrl(null)
    setElapsed(0)
    setCountdown(3)
    for (let i = 3; i > 0; i--) {
      setCountdown(i)
      await new Promise((res) => setTimeout(res, 1000))
    }
    setCountdown(0)
    startRecording()
  }

  function startRecording() {
    const stream = streamRef.current
    if (!stream) {
      setError('Camera is not ready.')
      return
    }

    recordedChunksRef.current = []
    let mimeType = 'video/mp4'
    if (!MediaRecorder.isTypeSupported('video/mp4')) {
      mimeType = 'video/webm;codecs=h264'
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm'
      }
    }

    try {
      const recorder = new MediaRecorder(stream, { mimeType })
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType })
        const url = URL.createObjectURL(blob)
        setRecordedUrl(url)
        setElapsed(0)
      }

      recorder.onerror = () => {
        setError('Recording failed.')
        setIsRecording(false)
        setPlaying(false)
      }

      recorder.start(100)
      setIsRecording(true)
      setPlaying(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start recording.')
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
    setIsRecording(false)
    setPlaying(false)
  }

  async function shareVideo() {
    if (!recordedUrl) return
    try {
      const response = await fetch(recordedUrl)
      const blob = await response.blob()
      const fileName = `talkshot-${Date.now()}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`
      const file = new File([blob], fileName, { type: blob.type })

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'TalkShot recording' })
      } else {
        const a = document.createElement('a')
        a.href = recordedUrl
        a.download = fileName
        a.click()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not share video.')
    }
  }

  function formatTime(totalSeconds: number) {
    const m = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, '0')
    const s = (totalSeconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
      />

      <div
        ref={textRef}
        className={`no-scrollbar absolute inset-0 overflow-y-auto ${settings.mirror ? 'scale-x-[-1]' : ''}`}
        style={{
          paddingTop: '45vh',
          paddingBottom: '45vh',
          paddingLeft: settings.margin,
          paddingRight: settings.margin,
          ...(settings.focusBand
            ? { WebkitMaskImage: FOCUS_BAND_MASK, maskImage: FOCUS_BAND_MASK }
            : {}),
        }}
      >
        <p
          className="whitespace-pre-wrap text-center font-semibold text-white drop-shadow-lg"
          style={{
            fontSize: settings.fontSize,
            lineHeight: settings.lineHeight,
          }}
        >
          {script.body}
        </p>
      </div>

      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white/80">
          Starting camera…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-8 text-center text-white">
          <p>{error}</p>
          <button onClick={() => window.location.reload()} className="mt-4 rounded-full bg-white px-6 py-2 text-black">
            Reload
          </button>
        </div>
      )}
      {countdown > 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/50 text-8xl font-bold text-white">
          {countdown}
        </div>
      )}

      {showControls && !isRecording && !recordedUrl && (
        <div className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 to-transparent p-4 pt-12">
          <div className="flex items-center justify-between">
            <button onClick={onBack} className="rounded-full bg-white/20 px-4 py-2 text-sm text-white backdrop-blur-sm active:scale-95">
              ← Scripts
            </button>
            <span className="text-sm font-medium text-white/90">{script.title}</span>
            <button
              onClick={() => setShowControls(false)}
              className="rounded-full bg-white/20 p-2 text-white backdrop-blur-sm active:scale-95"
              aria-label="Hide controls"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 14h6v6M20 10h-6V4M20 20 4 4" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {!showControls && !isRecording && !recordedUrl && (
        <button
          onClick={() => setShowControls(true)}
          className="absolute left-4 top-12 z-10 rounded-full bg-white/20 p-2 text-white backdrop-blur-sm active:scale-95"
          aria-label="Show controls"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      )}

      {isRecording && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-2 p-4 pt-12">
          <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
          <span className="rounded-md bg-black/40 px-2 py-1 font-mono text-sm text-white backdrop-blur-sm">
            {formatTime(elapsed)}
          </span>
        </div>
      )}

      {recordedUrl ? (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black/90 p-6 text-center text-white">
          <p className="text-lg font-semibold">Recording complete</p>
          <p className="text-sm text-zinc-300">
            Tap Share to save to Photos, or Retake to record again.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setRecordedUrl(null)
                resetScroll()
              }}
              className="rounded-full bg-zinc-800 px-6 py-3 font-semibold text-white active:scale-95"
            >
              Retake
            </button>
            <button
              onClick={shareVideo}
              className="rounded-full bg-white px-6 py-3 font-semibold text-black active:scale-95"
            >
              Share video
            </button>
          </div>
          <button
            onClick={onBack}
            className="mt-2 text-sm text-zinc-400 active:scale-95"
          >
            Back to scripts
          </button>
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 to-transparent p-4 pb-8">
          <div className="flex items-center justify-center gap-3">
            {!isRecording && (
              <button
                onClick={resetScroll}
                className="rounded-full bg-white/20 p-3 text-white backdrop-blur-sm active:scale-95"
                aria-label="Reset"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </button>
            )}

            {!isRecording ? (
              <>
                <button
                  onClick={togglePlay}
                  className="rounded-full bg-white px-6 py-3 font-bold text-black shadow-lg active:scale-95"
                >
                  {playing ? 'Pause' : 'Play'}
                </button>
                <button
                  onClick={startRecordingWithCountdown}
                  className="flex items-center gap-2 rounded-full bg-red-500 px-6 py-3 font-bold text-white shadow-lg active:scale-95"
                >
                  <span className="h-3 w-3 rounded-full bg-white" />
                  Record
                </button>
              </>
            ) : (
              <button
                onClick={stopRecording}
                className="flex items-center gap-2 rounded-full bg-white px-6 py-3 font-bold text-black shadow-lg active:scale-95"
              >
                ■ Stop
              </button>
            )}

            {!isRecording && (
              <button
                onClick={() => setFacingMode((m) => (m === 'user' ? 'environment' : 'user'))}
                className="rounded-full bg-white/20 p-3 text-white backdrop-blur-sm active:scale-95"
                aria-label="Flip camera"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
                  <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
                  <circle cx="12" cy="12" r="3" />
                  <path d="m18 22-3-3 3-3" />
                  <path d="m6 2 3 3-3 3" />
                </svg>
              </button>
            )}
          </div>

          {showControls && !isRecording && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs text-white/80">
                Font size
                <input
                  type="range"
                  min="20"
                  max="80"
                  value={settings.fontSize}
                  onChange={(e) => onUpdateSettings({ fontSize: Number(e.target.value) })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-white/80">
                Speed
                <input
                  type="range"
                  min="10"
                  max="150"
                  value={settings.speed}
                  onChange={(e) => onUpdateSettings({ speed: Number(e.target.value) })}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-white/80">
                <input
                  type="checkbox"
                  checked={settings.mirror}
                  onChange={(e) => onUpdateSettings({ mirror: e.target.checked })}
                />
                Mirror
              </label>
              <label className="flex items-center gap-2 text-xs text-white/80">
                <input
                  type="checkbox"
                  checked={settings.focusBand}
                  onChange={(e) => onUpdateSettings({ focusBand: e.target.checked })}
                />
                Focus band
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
