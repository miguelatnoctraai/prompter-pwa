import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import {
  countWords,
  formatRelativeTime,
  loadScripts,
  saveScripts,
  addTombstone,
  pushScript,
  pushDeletion,
  fullSync,
  seedDemoScriptIfFirstRun,
  type Script,
} from './lib/scriptStore'

interface Settings {
  fontSize: number
  lineHeight: number
  speed: number
  mirror: boolean
  margin: number
  focusBand: boolean
  focusMode: boolean
  backgroundBlur: boolean
  autoCueCards: boolean
}

const DEFAULT_SETTINGS: Settings = {
  fontSize: 42,
  lineHeight: 1.6,
  speed: 50,
  mirror: false,
  margin: 16,
  focusBand: true,
  focusMode: false,
  backgroundBlur: false,
  autoCueCards: true,
}

// Fades text below the active reading area. The sharp zone starts at the actual
// script text baseline (card top + padding) and fades quickly below it.
function focusBandMask(textTopVh: number) {
  const sharpEnd = textTopVh + 20
  const fadeEnd = textTopVh + 34
  return `linear-gradient(to bottom, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.02) ${textTopVh}%, rgba(0,0,0,1) ${textTopVh}%, rgba(0,0,0,1) ${sharpEnd}%, rgba(0,0,0,0.02) ${fadeEnd}%, rgba(0,0,0,0.02) 100%)`
}

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
  const [scripts, setScripts] = useState<Script[]>(() => {
    seedDemoScriptIfFirstRun()
    return loadScripts()
  })
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [session, setSession] = useState<Session | null>(null)

  const [title, setTitle] = useState('')
  const [hook, setHook] = useState('')
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
    setHook('')
    setBody('')
    setActiveScriptId(null)
    setView('edit')
  }

  function editScript(script: Script) {
    setTitle(script.title)
    setHook(script.hook)
    setBody(script.body)
    setActiveScriptId(script.id)
    setView('edit')
  }

  function saveScript() {
    const trimmedTitle = title.trim() || 'Untitled script'
    const trimmedHook = hook.trim()
    const trimmedBody = body.trim()
    if (!trimmedBody) return

    const now = Date.now()
    let nextScripts: Script[]
    if (activeScript) {
      nextScripts = scripts.map((s) =>
        s.id === activeScript.id ? { ...s, title: trimmedTitle, hook: trimmedHook, body: trimmedBody, updatedAt: now } : s,
      )
    } else {
      const newScript: Script = {
        id: crypto.randomUUID(),
        title: trimmedTitle,
        hook: trimmedHook,
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

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
  }, [settings])

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
          hook={hook}
          body={body}
          isNew={!activeScript}
          onTitleChange={setTitle}
          onHookChange={setHook}
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
  const [showBetaBlurDialog, setShowBetaBlurDialog] = useState(false)

  return (
    <div className="flex h-full flex-col bg-zinc-950 p-4 pt-12">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">TalkShot</h1>
        <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onAccount}
          className="relative flex items-center gap-2 rounded-full bg-zinc-800 px-3 py-2 text-sm text-white active:scale-95"
          aria-label="Account"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span className="hidden sm:inline">{signedIn ? 'Account' : 'Sync'}</span>
          {signedIn ? (
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-zinc-500" />
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
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Default display</h2>
            <button
              type="button"
              onClick={onAccount}
              className="text-sm font-medium text-white underline-offset-2 hover:underline"
            >
              {signedIn ? 'Account' : 'Sign in to sync'}
            </button>
          </div>
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
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.focusMode}
              onChange={(e) => onUpdateSettings({ focusMode: e.target.checked })}
            />
            Focus mode (one cue card at a time)
          </label>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.autoCueCards}
              onChange={(e) => onUpdateSettings({ autoCueCards: e.target.checked })}
            />
            Auto-cue cards in Focus mode
          </label>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.backgroundBlur}
              onChange={(e) => {
                if (e.target.checked) {
                  setShowBetaBlurDialog(true)
                } else {
                  onUpdateSettings({ backgroundBlur: false })
                }
              }}
            />
            Background blur (Beta)
          </label>
        </div>
      )}

      {showBetaBlurDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
          <div className="max-w-sm rounded-2xl bg-zinc-900/90 p-6 text-center backdrop-blur-xl">
            <h3 className="mb-2 text-lg font-bold text-white">Beta: background blur</h3>
            <p className="mb-4 text-sm text-zinc-300">
              This feature uses AI to blur your background in real time. It may heat up your phone, reduce frame rate, or have rough edges around hair. Turn it off if performance drops.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowBetaBlurDialog(false)
                  onUpdateSettings({ backgroundBlur: true })
                }}
                className="rounded-full bg-sky-500 px-6 py-3 font-semibold text-white active:scale-95"
              >
                Enable anyway
              </button>
              <button
                type="button"
                onClick={() => setShowBetaBlurDialog(false)}
                className="rounded-full bg-zinc-800 px-6 py-3 font-semibold text-white active:scale-95"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {scripts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-sky-400 to-violet-500 text-4xl shadow-lg shadow-violet-500/20">
            🎬
          </div>
          <p className="max-w-xs text-lg text-zinc-300">
            Write what you want to say. TalkShot scrolls it at eye level while you film.
          </p>
          <button
            type="button"
            onClick={onCreate}
            className="rounded-full bg-white px-7 py-3.5 font-semibold text-black shadow-lg shadow-white/10 active:scale-95"
          >
            Write your first script
          </button>
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto pb-24">
          {scripts.map((script) => (
            <div
              key={script.id}
              className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-950 p-4 shadow-sm transition-transform active:scale-[0.98]"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1 pr-3">
                  <p className="truncate font-semibold text-white">{script.title}</p>
                  <p className="truncate text-sm text-zinc-400">
                    {script.hook || script.body.slice(0, 60).replace(/\n/g, ' ')}
                    {((script.hook?.length && script.hook.length > 60) || script.body.length > 60) && '…'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onPrompt(script)}
                  className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black shadow-md shadow-white/10 active:scale-95"
                >
                  Prompt
                </button>
              </div>

              <div className="mt-3 flex items-center gap-3 text-xs text-zinc-500">
                <span className="rounded-full bg-zinc-800 px-2.5 py-1">
                  {countWords(script.hook + ' ' + script.body)} words
                </span>
                <span className="rounded-full bg-zinc-800 px-2.5 py-1">
                  {formatRelativeTime(script.updatedAt)}
                </span>
                <button
                  type="button"
                  onClick={() => onEdit(script)}
                  className="ml-auto rounded-full bg-zinc-800 px-3 py-1 text-zinc-300 active:scale-95"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(script.id)}
                  className="rounded-full bg-zinc-800 p-1.5 text-zinc-400 active:scale-95"
                  aria-label="Delete"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onCreate}
        className="absolute bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-white text-2xl font-bold text-black shadow-lg shadow-white/10 active:scale-95"
        aria-label="New script"
      >
        +
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
  const [stage, setStage] = useState<'email' | 'code' | 'signedIn'>('email')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)

  useEffect(() => {
    if (session) {
      setStage('signedIn')
      setEmail(session.user.email ?? '')
    } else {
      setStage('email')
      setEmail('')
      setCode('')
    }
  }, [session])

  function show(text: string, type: 'info' | 'success' | 'error' = 'info') {
    setMessage({ text, type })
  }

  async function sendCode() {
    if (!supabase) return
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() })
    setBusy(false)
    if (error) {
      show(error.message, 'error')
    } else {
      setStage('code')
      show('We emailed you a one-time code.', 'info')
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
      show(error.message, 'error')
    } else {
      setStage('signedIn')
      show('You’re signed in.', 'success')
      setCode('')
    }
  }

  async function syncNow() {
    setBusy(true)
    setMessage(null)
    try {
      const merged = await fullSync(loadScripts())
      onScriptsSynced(merged)
      setLastSyncAt(Date.now())
      show(`Synced ${merged.length} script${merged.length === 1 ? '' : 's'}.`, 'success')
    } catch (err) {
      show(err instanceof Error ? err.message : 'Sync failed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    const confirmSignOut = window.confirm(
      'Sign out? Scripts on this device stay here; cloud sync stops until you sign in again.',
    )
    if (!confirmSignOut) return
    setBusy(true)
    await supabase.auth.signOut()
    setBusy(false)
    setMessage(null)
  }

  function formatSyncTime(ts: number) {
    const seconds = Math.floor((Date.now() - ts) / 1000)
    if (seconds < 60) return 'just now'
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    return `${Math.floor(seconds / 3600)}h ago`
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
        <div className="rounded-2xl bg-zinc-900 p-4 text-zinc-400">
          <p>Cloud sync is not configured for this build.</p>
          <p className="mt-2 text-sm">Scripts are stored on this device only.</p>
        </div>
      ) : stage === 'signedIn' || session ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-zinc-900 p-4">
            <p className="text-sm text-zinc-400">Signed in as</p>
            <p className="font-semibold">{session?.user.email}</p>
          </div>
          <p className="text-sm text-zinc-400">
            Your scripts sync automatically when you save or delete. Tap Sync now after working
            offline or on another device.
          </p>
          <button
            type="button"
            onClick={syncNow}
            disabled={busy}
            className="w-full rounded-full bg-white py-3 font-semibold text-black disabled:opacity-40 active:scale-95"
          >
            {busy ? 'Syncing…' : lastSyncAt ? `Sync now (${formatSyncTime(lastSyncAt)})` : 'Sync now'}
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
            Sign in to back up your scripts and sync them across devices. We’ll email you a
            one-time code — no password needed.
          </p>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={stage === 'code' || busy}
            className="w-full rounded-xl bg-zinc-900 px-4 py-3 placeholder-zinc-500 outline-none disabled:opacity-60"
          />
          {stage === 'code' && (
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Code from email"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
              className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-center text-xl tracking-widest placeholder-zinc-500 outline-none disabled:opacity-60"
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
                disabled={busy}
                className="w-full text-sm text-zinc-400 active:scale-95 disabled:opacity-40"
              >
                Use a different email
              </button>
            </>
          )}
        </div>
      )}

      {message && (
        <div
          className={`mt-4 rounded-xl p-3 text-center text-sm ${
            message.type === 'success'
              ? 'bg-emerald-500/15 text-emerald-300'
              : message.type === 'error'
                ? 'bg-red-500/15 text-red-300'
                : 'bg-zinc-800 text-zinc-300'
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  )
}

interface ScriptScore {
  scores: { hook: number; clarity: number; pacing: number; cta: number; overall: number }
  estimated_seconds: number
  strengths: string[]
  suggestions: string[]
  rewrite_hook: string
  rewrite_body: string
}

function EditScriptView({
  title,
  hook,
  body,
  isNew,
  onTitleChange,
  onHookChange,
  onBodyChange,
  onSave,
  onCancel,
}: {
  title: string
  hook: string
  body: string
  isNew: boolean
  onTitleChange: (v: string) => void
  onHookChange: (v: string) => void
  onBodyChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  const [score, setScore] = useState<ScriptScore | null>(null)
  const [scoring, setScoring] = useState(false)
  const [scoreError, setScoreError] = useState<string | null>(null)

  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0
  // ~150 spoken words per minute is a natural short-form pace.
  const readSeconds = Math.round((wordCount / 150) * 60)

  async function scoreScript() {
    setScoring(true)
    setScoreError(null)
    setScore(null)
    try {
      const resp = await fetch('/api/score-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, hook, body }),
      })
      if (!resp.ok) {
        let message = 'Scoring failed. Try again.'
        try {
          const data = (await resp.json()) as { error?: string }
          if (data.error) message = data.error
        } catch {
          if (resp.status === 404) message = 'Scoring is only available on the deployed app.'
        }
        setScoreError(message)
        return
      }
      setScore((await resp.json()) as ScriptScore)
    } catch {
      setScoreError('Could not reach the scoring service. Are you online?')
    } finally {
      setScoring(false)
    }
  }

  async function applyRewrite() {
    if (!score) return
    onHookChange(score.rewrite_hook)
    onBodyChange(score.rewrite_body)
    setScore(null)
  }

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
        placeholder="Script title (only you see this)"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        className="mb-3 rounded-xl bg-zinc-900 px-4 py-3 text-lg font-semibold placeholder-zinc-500 outline-none"
      />
      <input
        type="text"
        placeholder="Hook — the opening line that stops the scroll"
        value={hook}
        onChange={(e) => onHookChange(e.target.value)}
        className="mb-3 rounded-xl border border-amber-500/30 bg-zinc-900 px-4 py-3 text-lg font-semibold text-amber-100 placeholder-amber-500/50 outline-none"
      />
      <textarea
        placeholder="Paste the rest of your script here..."
        value={body}
        onChange={(e) => onBodyChange(e.target.value)}
        className="flex-1 resize-none rounded-xl bg-zinc-900 p-4 text-base leading-relaxed placeholder-zinc-500 outline-none"
      />
      {wordCount > 0 && (
        <p className="mt-2 text-xs text-zinc-500">
          {wordCount} words · ~{readSeconds}s spoken
        </p>
      )}

      {score && (
        <div className="mt-3 max-h-64 overflow-y-auto rounded-2xl bg-zinc-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
              Script score
            </h2>
            <button
              type="button"
              onClick={() => setScore(null)}
              className="text-xs text-zinc-500 active:scale-95"
            >
              Dismiss
            </button>
          </div>
          <div className="mb-3 grid grid-cols-5 gap-2 text-center">
            {(
              [
                ['Hook', score.scores.hook],
                ['Clarity', score.scores.clarity],
                ['Pacing', score.scores.pacing],
                ['CTA', score.scores.cta],
                ['Overall', score.scores.overall],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-lg bg-zinc-800 py-2">
                <p className="text-lg font-bold">{value}</p>
                <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
              </div>
            ))}
          </div>
          <p className="mb-2 text-xs text-zinc-400">
            Estimated duration: ~{score.estimated_seconds}s
          </p>
          {score.strengths.length > 0 && (
            <div className="mb-2">
              <p className="text-xs font-semibold text-emerald-400">Working well</p>
              <ul className="list-disc pl-4 text-sm text-zinc-300">
                {score.strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {score.suggestions.length > 0 && (
            <div className="mb-2">
              <p className="text-xs font-semibold text-amber-400">Improve</p>
              <ul className="list-disc pl-4 text-sm text-zinc-300">
                {score.suggestions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {(score.rewrite_hook || score.rewrite_body) && (
            <div className="mb-2">
              <p className="text-xs font-semibold text-sky-400">AI rewrite</p>
              {score.rewrite_hook && (
                <p className="mb-1 text-sm italic text-zinc-300">“{score.rewrite_hook}”</p>
              )}
              {score.rewrite_body && score.rewrite_body !== body && (
                <p className="text-sm text-zinc-400">Body rewritten. Tap Apply to preview.</p>
              )}
              <button
                type="button"
                onClick={applyRewrite}
                className="mt-2 w-full rounded-full bg-sky-500 py-2 text-sm font-semibold text-white active:scale-95"
              >
                Apply rewrite
              </button>
            </div>
          )}
        </div>
      )}
      {scoreError && <p className="mt-2 text-center text-sm text-red-400">{scoreError}</p>}

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={scoreScript}
          disabled={!body.trim() || scoring}
          className="flex-1 rounded-full bg-zinc-800 py-4 font-semibold text-white disabled:opacity-40 active:scale-95"
        >
          {scoring ? 'Scoring…' : '✨ Score'}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!body.trim()}
          className="flex-[2] rounded-full bg-white py-4 font-semibold text-black disabled:opacity-40 active:scale-95"
        >
          Save
        </button>
      </div>
    </div>
  )
}

function splitIntoCueCards(text: string, auto = true, maxWords = 16, minWords = 6): string[] {
  const raw = text.trim()
  if (!raw) return []

  // Manual mode: respect the user's line breaks exactly.
  if (!auto) {
    return raw
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }

  // Auto mode: sentence-first, then major breaks, then fallback word splits.
  const sentences = raw
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  const cards: string[] = []

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean)

    // Short sentence = one cue card.
    if (words.length <= maxWords) {
      cards.push(sentence)
      continue
    }

    // Long sentence: split on major breaks first (:, —, ;), then commas if needed.
    const majorBreakRe = /[:—;]|,(?=\s+(?:and|but|because|so|which|that|or|yet|however|instead|actually|basically|honestly|look|listen|here))/i
    const parts = sentence
      .split(majorBreakRe)
      .map((p) => p.trim())
      .filter(Boolean)

    for (const part of parts) {
      const partWords = part.split(/\s+/).filter(Boolean)
      if (partWords.length <= maxWords) {
        cards.push(part)
      } else {
        // Fallback: hard split near maxWords, preferring commas if nearby.
        let start = 0
        while (start < partWords.length) {
          const target = Math.min(start + maxWords, partWords.length)
          let end = target
          if (end < partWords.length) {
            for (let i = end - 1; i > start + minWords; i--) {
              if (/[,;]$/.test(partWords[i])) {
                end = i + 1
                break
              }
            }
          }
          cards.push(partWords.slice(start, end).join(' '))
          start = end
        }
      }
    }
  }

  // Merge tiny trailing fragments backward so you don't get single-word cards.
  const merged: string[] = []
  for (const card of cards) {
    const wc = card.split(/\s+/).filter(Boolean).length
    if (wc < minWords && merged.length > 0) {
      merged[merged.length - 1] += ' ' + card
    } else {
      merged.push(card)
    }
  }

  return merged
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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const canvasStreamRef = useRef<MediaStream | null>(null)
  const segmenterRef = useRef<ImageSegmenter | null>(null)
  const segmenterReadyRef = useRef(false)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef<number>(0)
  const timerRef = useRef<number | null>(null)
  const progressRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [showScript, setShowScript] = useState(true)
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const pausedAtRef = useRef<number | null>(null)
  const totalPausedMsRef = useRef(0)

  const chunks = useMemo(() => splitIntoCueCards(`${script.hook}\n${script.body}`.trim(), settings.autoCueCards), [script.hook, script.body, settings.autoCueCards])
  const [chunkIndex, setChunkIndex] = useState(0)

  async function startCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setError(null)
    setLoading(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.onloadedmetadata = () => {
          const video = videoRef.current
          const canvas = canvasRef.current
          if (!video || !canvas) return
          canvas.width = video.videoWidth || 1280
          canvas.height = video.videoHeight || 720
          if (settings.backgroundBlur) {
            void initSegmenter().then(() => renderFrame())
          } else {
            renderFrame()
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Camera/microphone access failed.')
    } finally {
      setLoading(false)
    }
  }

  async function initSegmenter() {
    if (segmenterReadyRef.current || segmenterRef.current) return
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
      )
      segmenterRef.current = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      })
      segmenterReadyRef.current = true
    } catch (err) {
      console.error('Failed to load background blur segmenter:', err)
      setError('Background blur failed to load. Turn it off to continue.')
    }
  }

  function renderFrame() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const drawPlain = () => {
      ctx.filter = 'none'
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    }

    const drawBlurred = async () => {
      const segmenter = segmenterRef.current
      if (!segmenter || video.readyState < 2) {
        drawPlain()
        return
      }
      try {
        const result = segmenter.segmentForVideo(video, performance.now())
        const mask = result.categoryMask
        if (!mask) {
          drawPlain()
          return
        }

        // Convert MPMask (uint8) to an alpha-only ImageData
        const maskData = mask.getAsUint8Array()
        const maskImageData = new ImageData(mask.width, mask.height)
        for (let i = 0; i < maskData.length; i++) {
          // Foreground confidence > 0.5 treated as fully opaque; smooth edges if supported.
          const alpha = maskData[i] > 128 ? 255 : 0
          maskImageData.data[i * 4 + 3] = alpha
        }

        // 1. Blurred background
        ctx.filter = 'blur(16px)'
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        // 2. Mask the canvas to the person shape
        const maskCanvas = document.createElement('canvas')
        maskCanvas.width = maskImageData.width
        maskCanvas.height = maskImageData.height
        const maskCtx = maskCanvas.getContext('2d')
        if (!maskCtx) {
          ctx.filter = 'none'
          drawPlain()
          return
        }
        maskCtx.putImageData(maskImageData, 0, 0)

        ctx.save()
        ctx.filter = 'none'
        ctx.globalCompositeOperation = 'source-in'
        ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height)

        // 3. Paint sharp foreground over the blurred person region
        ctx.globalCompositeOperation = 'source-over'
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        ctx.restore()
      } catch (err) {
        drawPlain()
      }
    }

    function tick() {
      if (!settings.backgroundBlur) {
        drawPlain()
      } else {
        void drawBlurred()
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    tick()
  }

  useEffect(() => {
    void startCamera()
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode])

  useEffect(() => {
    if (settings.backgroundBlur) {
      if (segmenterReadyRef.current) {
        renderFrame()
      } else {
        void initSegmenter().then(() => renderFrame())
      }
    } else {
      segmenterRef.current?.close()
      segmenterRef.current = null
      segmenterReadyRef.current = false
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      // Draw plain video on the canvas so recording without blur still works
      const video = videoRef.current
      const canvas = canvasRef.current
      if (video && canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.filter = 'none'
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        }
      }
    }
  }, [settings.backgroundBlur])

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
          if (!e.repeat) {
            if (settings.focusMode) {
              nextChunk()
            } else {
              setPlaying((p) => !p)
            }
          }
          break
        case 'ArrowUp':
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault()
          if (settings.focusMode) {
            setChunkIndex((i) => Math.max(0, i - 1))
          } else {
            nudgeScroll(-200)
          }
          break
        case 'ArrowDown':
          e.preventDefault()
          if (settings.focusMode) {
            nextChunk()
          } else {
            nudgeScroll(200)
          }
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
    if (isRecording && !recordedUrl && !isPaused) {
      if (!startTimeRef.current) startTimeRef.current = Date.now() - totalPausedMsRef.current
      timerRef.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current! - totalPausedMsRef.current) / 1000))
      }, 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isRecording, recordedUrl, isPaused])

  function resetScroll() {
    progressRef.current = 0
    if (textRef.current) textRef.current.scrollTop = 0
    setPlaying(false)
    setChunkIndex(0)
  }

  function nextChunk() {
    setChunkIndex((i) => {
      if (i >= chunks.length - 1) {
        setPlaying(false)
        return i
      }
      return i + 1
    })
  }

  function togglePlay() {
    setPlaying((p) => {
      if (!p && textRef.current) {
        // Resume from wherever the user scrolled, not from stale progress.
        progressRef.current = textRef.current.scrollTop
      }
      return !p
    })
  }

  function resetRecordingState() {
    setElapsed(0)
    setIsPaused(false)
    startTimeRef.current = 0
    totalPausedMsRef.current = 0
    pausedAtRef.current = 0
  }

  async function startRecordingWithCountdown() {
    resetScroll()
    setRecordedUrl(null)
    resetRecordingState()
    setCountdown(3)
    for (let i = 3; i > 0; i--) {
      setCountdown(i)
      await new Promise((res) => setTimeout(res, 1000))
    }
    setCountdown(0)
    startRecording()
  }

  function startRecording() {
    let stream = streamRef.current
    if (!stream) {
      setError('Camera is not ready.')
      return
    }

    if (settings.backgroundBlur && canvasRef.current) {
      canvasStreamRef.current?.getTracks().forEach((t) => t.stop())
      canvasStreamRef.current = null
      // Ensure canvas has a rendered frame before capturing
      const captureCanvas = canvasRef.current
      const captureCtx = captureCanvas.getContext('2d')
      if (captureCtx && videoRef.current) {
        captureCtx.filter = 'none'
        captureCtx.drawImage(videoRef.current, 0, 0, captureCanvas.width, captureCanvas.height)
      }
      const canvasStream = canvasRef.current.captureStream(30)
      // Add original audio track
      const audioTrack = stream.getAudioTracks()[0]
      if (audioTrack) {
        canvasStream.addTrack(audioTrack)
      }
      canvasStreamRef.current = canvasStream
      stream = canvasStream
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
        setIsRecording(false)
        setIsPaused(false)
        setPlaying(false)
        startTimeRef.current = 0
        totalPausedMsRef.current = 0
        pausedAtRef.current = 0
      }

      recorder.onerror = () => {
        setError('Recording failed.')
        setIsRecording(false)
        setIsPaused(false)
        setPlaying(false)
      }

      recorder.start(100)
      setIsRecording(true)
      setIsPaused(false)
      setPlaying(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start recording.')
    }
  }

  function pauseRecording() {
    recorderRef.current?.pause()
    pausedAtRef.current = Date.now()
    setIsPaused(true)
    setPlaying(false)
  }

  function resumeRecording() {
    if (pausedAtRef.current) {
      totalPausedMsRef.current += Date.now() - pausedAtRef.current
      pausedAtRef.current = null
    }
    recorderRef.current?.resume()
    setIsPaused(false)
    setPlaying(true)
  }

  function stopRecording() {
    recorderRef.current?.stop()
    canvasStreamRef.current?.getTracks().forEach((t) => t.stop())
    canvasStreamRef.current = null
    setIsRecording(false)
    setIsPaused(false)
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

  const [touchStartX, setTouchStartX] = useState<number | null>(null)

  function onTouchStart(e: React.TouchEvent) {
    if (!settings.focusMode || !isRecording) return
    setTouchStartX(e.changedTouches[0].clientX)
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX == null || !settings.focusMode || !isRecording) return
    const dx = e.changedTouches[0].clientX - touchStartX
    if (dx < -40) {
      nextChunk()
    }
    setTouchStartX(null)
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
        style={{ opacity: settings.backgroundBlur ? 0 : 1 }}
      />
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full object-cover ${settings.mirror ? 'scale-x-[-1]' : ''}`}
      />

      <div
        ref={textRef}
        onClick={() => {
          if (settings.focusMode && isRecording) nextChunk()
        }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className={`no-scrollbar absolute inset-0 overflow-y-auto ${settings.mirror ? 'scale-x-[-1]' : ''} ${showScript ? '' : 'opacity-0'}`}
        style={{
          paddingTop: settings.focusMode ? '22vh' : '12vh',
          paddingBottom: '40vh',
          paddingLeft: settings.margin,
          paddingRight: settings.margin,
          transition: 'opacity 200ms ease',
          pointerEvents: showScript ? 'auto' : 'none',
          ...(settings.focusBand && !settings.focusMode
            ? { WebkitMaskImage: focusBandMask(12), maskImage: focusBandMask(12) }
            : {}),
        }}
      >
        {settings.focusMode ? (
          <div className="mx-4 rounded-3xl border border-white/10 bg-black/40 px-6 py-10 backdrop-blur-xl"
            style={{
              minHeight: '38vh',
            }}
          >
            <div className="flex flex-1 items-center justify-center">
              <p
                key={chunkIndex}
                className="w-full animate-in fade-in slide-in-from-right-4 whitespace-pre-wrap text-center font-semibold text-white drop-shadow-lg duration-200"
                style={{
                  fontSize: settings.fontSize,
                  lineHeight: settings.lineHeight,
                }}
              >
                {chunks[chunkIndex]}
              </p>
            </div>
          </div>
        ) : (
          <div
            className="mx-4 rounded-3xl border border-white/10 bg-black/40 px-6 py-8 backdrop-blur-xl"
          >
            <p
              className="whitespace-pre-wrap text-center font-semibold text-white drop-shadow-lg"
              style={{
                fontSize: settings.fontSize,
                lineHeight: settings.lineHeight,
              }}
            >
              {script.hook && (
                <span className="block text-sky-300">{script.hook}</span>
              )}
              {script.hook && script.body && <br />}
              {script.body}
            </p>
          </div>
        )}
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
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowScript((s) => !s)}
                className="rounded-full bg-white/20 px-4 py-2 text-sm text-white backdrop-blur-sm active:scale-95"
                aria-label={showScript ? 'Hide script' : 'Show script'}
              >
                {showScript ? 'Hide script' : 'Show script'}
              </button>
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
        <div className="pointer-events-none absolute inset-x-0 top-12 z-10 flex items-center justify-center gap-2 p-4">
          <span className={`h-3 w-3 rounded-full ${isPaused ? 'bg-yellow-500' : 'animate-pulse bg-red-500'}`} />
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
        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-4 pb-10">
          <div className="mb-3 flex items-center justify-center">
            {isRecording && !settings.focusMode && (
              <span className="rounded-full bg-black/50 px-4 py-1 text-sm font-semibold text-white backdrop-blur-sm">
                {formatTime(elapsed)}
              </span>
            )}
            {settings.focusMode && isRecording && (
              <span className="rounded-full bg-black/50 px-4 py-1 text-sm font-semibold text-white backdrop-blur-sm">
                {chunkIndex + 1} / {chunks.length}
              </span>
            )}
          </div>
          <div className="flex items-center justify-center gap-3">
            {!isRecording && settings.focusMode && (
              <button
                onClick={() => onUpdateSettings({ autoCueCards: !settings.autoCueCards })}
                className="rounded-full bg-white/20 px-4 py-2 text-sm text-white backdrop-blur-sm active:scale-95"
              >
                {settings.autoCueCards ? 'Auto-cue cards' : 'Use line breaks'}
              </button>
            )}
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

            {isRecording ? (
              isPaused ? (
                <button
                  onClick={resumeRecording}
                  className="flex items-center gap-2 rounded-full bg-white px-6 py-3 font-bold text-black shadow-lg active:scale-95"
                >
                  ▶ Resume
                </button>
              ) : (
                <button
                  onClick={pauseRecording}
                  className="flex items-center gap-2 rounded-full bg-white px-6 py-3 font-bold text-black shadow-lg active:scale-95"
                >
                  ⏸ Pause
                </button>
              )
            ) : null}
            {isRecording && (
              <button
                onClick={stopRecording}
                className="flex items-center gap-2 rounded-full bg-red-500 px-6 py-3 font-bold text-white shadow-lg active:scale-95"
              >
                ■ Stop
              </button>
            )}
            {!isRecording && (
              <button
                onClick={settings.focusMode ? nextChunk : togglePlay}
                className="rounded-full bg-white px-6 py-3 font-bold text-black shadow-lg active:scale-95"
              >
                {settings.focusMode ? 'Next' : playing ? 'Pause' : 'Play'}
              </button>
            )}
            {!isRecording && (
              <button
                onClick={startRecordingWithCountdown}
                className="flex items-center gap-2 rounded-full bg-red-500 px-6 py-3 font-bold text-white shadow-lg active:scale-95"
              >
                <span className="h-3 w-3 rounded-full bg-white" />
                Record
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
              <label className="flex items-center gap-2 text-xs text-white/80">
                <input
                  type="checkbox"
                  checked={settings.focusMode}
                  onChange={(e) => onUpdateSettings({ focusMode: e.target.checked })}
                />
                Focus mode
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
