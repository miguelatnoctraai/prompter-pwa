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
import { extractFirstFrame, type ExtractedFrame } from './lib/extractFirstFrame'

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
      .catch((err) => {
        // Offline is fine (write-through catches up), but log it — a schema
        // mismatch here once failed every sync invisibly.
        console.warn('Sign-in sync failed:', err instanceof Error ? err.message : err)
      })
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

  function saveScript(cueCards?: string[] | null) {
    const trimmedTitle = title.trim() || 'Untitled script'
    const trimmedHook = hook.trim()
    const trimmedBody = body.trim()
    if (!trimmedBody) return

    const now = Date.now()
    let nextScripts: Script[]
    if (activeScript) {
      nextScripts = scripts.map((s) =>
        s.id === activeScript.id
          ? {
              ...s,
              title: trimmedTitle,
              hook: trimmedHook,
              body: trimmedBody,
              // Preserve AI cue cards already persisted during scoring, or
              // adopt the pending ones from a just-scored new script.
              cueCards: cueCards && cueCards.length > 0 ? cueCards : s.cueCards,
              updatedAt: now,
            }
          : s,
      )
    } else {
      const newScript: Script = {
        id: crypto.randomUUID(),
        title: trimmedTitle,
        hook: trimmedHook,
        body: trimmedBody,
        cueCards: cueCards && cueCards.length > 0 ? cueCards : undefined,
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

  // Persist AI cue cards onto an existing script (from the scoring endpoint).
  // Writes through to localStorage immediately so Focus mode can use them on
  // the next prompt. Not synced to Supabase (no DB column); re-scoring on
  // another device regenerates them. Pass an empty array to clear stale cards
  // after the script text is edited.
  function persistCueCards(id: string | undefined, cards: string[]) {
    if (!id) return
    const nextScripts = scripts.map((s) =>
      s.id === id
        ? { ...s, cueCards: cards.length > 0 ? cards : undefined, updatedAt: Date.now() }
        : s,
    )
    setScripts(nextScripts)
    saveScripts(nextScripts)
    if (session) {
      const saved = nextScripts.find((s) => s.id === id)
      if (saved) void pushScript(saved)
    }
  }

  // Lightweight clear of stale AI cue cards when the creator edits the hook or
  // body after scoring. Only touches local state + localStorage — does not
  // bump updatedAt or push to Supabase (the text edit itself will save+sync
  // normally on Save).
  function clearCueCards(id: string | undefined) {
    if (!id) return
    const nextScripts = scripts.map((s) =>
      s.id === id && s.cueCards ? { ...s, cueCards: undefined } : s,
    )
    setScripts(nextScripts)
    saveScripts(nextScripts)
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
          activeScript={activeScript}
          onTitleChange={setTitle}
          onHookChange={setHook}
          onBodyChange={setBody}
          onSave={saveScript}
          onCancel={() => setView('list')}
          onPersistCueCards={(cards) => persistCueCards(activeScript?.id, cards)}
          onClearCueCards={() => clearCueCards(activeScript?.id)}
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

const TEXT_SIZE_PRESETS = [
  { label: 'Small', value: 34 },
  { label: 'Comfortable', value: 48 },
  { label: 'Large', value: 64 },
]

const SPEED_PRESETS = [
  { label: 'Slow', value: 30 },
  { label: 'Normal', value: 55 },
  { label: 'Fast', value: 90 },
]

// Segmented preset picker. Highlights the preset nearest the current value so
// any stored/legacy number still maps to a selected chip.
function PresetPicker({
  label,
  presets,
  value,
  onChange,
}: {
  label: string
  presets: { label: string; value: number }[]
  value: number
  onChange: (v: number) => void
}) {
  const activeIdx = presets.reduce(
    (best, p, i) =>
      Math.abs(p.value - value) < Math.abs(presets[best].value - value) ? i : best,
    0,
  )
  return (
    <div>
      <p className="mb-2 text-sm text-white/90">{label}</p>
      <div className="flex gap-1 rounded-full bg-white/10 p-1">
        {presets.map((p, i) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(p.value)}
            className={`flex-1 rounded-full py-2 text-sm transition-colors active:scale-95 ${
              i === activeIdx ? 'btn-segment-active' : 'text-white/70'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
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
    <div className="ts-view atmosphere-page flex h-full flex-col p-4 pt-16">
      <div className="mb-6 flex items-center justify-between">
        <h1
          className="font-display text-2xl font-extrabold bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent"
          aria-label="TalkShot"
        >
          TalkShot
        </h1>
        <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onAccount}
          className="relative flex items-center gap-2 rounded-full atmosphere-chip px-3 py-2 text-sm text-white active:scale-95"
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
          className="rounded-full atmosphere-chip p-3 text-white active:scale-95"
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
        <div className="mb-4 rounded-2xl atmosphere-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-zinc-400">Default display</h2>
            <button
              type="button"
              onClick={onAccount}
              className="text-sm font-medium text-white underline-offset-2 hover:underline"
            >
              {signedIn ? 'Account' : 'Sign in to sync'}
            </button>
          </div>
          <div className="space-y-4">
            <PresetPicker
              label="Text size"
              presets={TEXT_SIZE_PRESETS}
              value={settings.fontSize}
              onChange={(v) => onUpdateSettings({ fontSize: v })}
            />
            <PresetPicker
              label="Scroll speed"
              presets={SPEED_PRESETS}
              value={settings.speed}
              onChange={(v) => onUpdateSettings({ speed: v })}
            />
          </div>
          <label className="mt-3 flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={settings.mirror}
              onChange={(e) => onUpdateSettings({ mirror: e.target.checked })}
            />
            Mirror text by default
          </label>
          <label className="mt-2 flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={settings.focusMode}
              onChange={(e) => onUpdateSettings({ focusMode: e.target.checked })}
            />
            Cards mode (one cue card at a time)
          </label>
          <label className="mt-2 flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={settings.autoCueCards}
              onChange={(e) => onUpdateSettings({ autoCueCards: e.target.checked })}
            />
            Auto-split cards at sentence breaks
          </label>
          <label className="mt-2 flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
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
          <div className="max-w-sm rounded-2xl atmosphere-surface p-6 text-center">
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
                className="rounded-full btn-primary px-6 py-3 font-semibold active:scale-95"
              >
                Enable anyway
              </button>
              <button
                type="button"
                onClick={() => setShowBetaBlurDialog(false)}
                className="rounded-full atmosphere-chip px-6 py-3 font-semibold text-white active:scale-95"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {scripts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 text-4xl shadow-lg shadow-amber-500/30">
            🎬
          </div>
          <p className="max-w-xs font-display text-lg text-zinc-300">
            Write what you want to say. TalkShot scrolls it at eye level while you film.
          </p>
          <button
            type="button"
            onClick={onCreate}
            className="rounded-full btn-primary px-7 py-3.5 font-semibold active:scale-95"
          >
            Write your first script
          </button>
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto pb-24">
          {scripts.map((script) => (
            <div
              key={script.id}
              className="group relative overflow-hidden rounded-2xl atmosphere-surface p-4 transition-transform active:scale-[0.98]"
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
                  className="rounded-full btn-primary px-5 py-2.5 text-sm font-bold active:scale-95"
                >
                  Prompt
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                <span className="rounded-full atmosphere-chip px-2.5 py-1">
                  {countWords(script.hook + ' ' + script.body)} words
                </span>
                <span className="rounded-full atmosphere-chip px-2.5 py-1">
                  {formatRelativeTime(script.updatedAt)}
                </span>
                <button
                  type="button"
                  onClick={() => onEdit(script)}
                  className="ml-auto rounded-full atmosphere-chip px-4 py-2.5 font-medium text-zinc-200 active:scale-95"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(script.id)}
                  className="flex h-10 w-10 items-center justify-center rounded-full atmosphere-chip text-zinc-400 active:scale-95"
                  aria-label="Delete"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    <path d="M10 11v6M14 11v6" />
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
        className="absolute bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full btn-primary text-2xl font-bold active:scale-95"
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
    <div className="ts-view atmosphere-page flex h-full flex-col p-4 pt-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-xl font-bold">Account</h1>
        <button type="button" onClick={onBack} className="-m-2 p-2 text-zinc-400 active:scale-95">
          Back
        </button>
      </div>

      {!supabase ? (
        <div className="rounded-2xl atmosphere-surface p-4 text-zinc-400">
          <p>Cloud sync is not configured for this build.</p>
          <p className="mt-2 text-sm">Scripts are stored on this device only.</p>
        </div>
      ) : stage === 'signedIn' || session ? (
        <div className="space-y-4">
          <div className="rounded-2xl atmosphere-surface p-4">
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
            className="w-full rounded-full btn-primary py-3 font-semibold disabled:opacity-40 active:scale-95"
          >
            {busy ? 'Syncing…' : lastSyncAt ? `Sync now (${formatSyncTime(lastSyncAt)})` : 'Sync now'}
          </button>
          <button
            type="button"
            onClick={signOut}
            disabled={busy}
            className="w-full rounded-full atmosphere-chip py-3 font-semibold text-white disabled:opacity-40 active:scale-95"
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
            className="w-full rounded-xl atmosphere-surface px-4 py-3 placeholder-zinc-500 outline-none disabled:opacity-60"
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
              className="w-full rounded-xl atmosphere-surface px-4 py-3 text-center text-xl tracking-widest placeholder-zinc-500 outline-none disabled:opacity-60"
            />
          )}
          {stage === 'email' ? (
            <button
              type="button"
              onClick={sendCode}
              disabled={busy || !email.includes('@')}
              className="w-full rounded-full btn-primary py-3 font-semibold disabled:opacity-40 active:scale-95"
            >
              {busy ? 'Sending…' : 'Send code'}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={verifyCode}
                disabled={busy || code.trim().length < 6}
                className="w-full rounded-full btn-primary py-3 font-semibold disabled:opacity-40 active:scale-95"
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
                : 'atmosphere-chip text-zinc-300'
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
  cue_cards: string[]
  rewrite_cue_cards: string[]
}

function EditScriptView({
  title,
  hook,
  body,
  isNew,
  activeScript,
  onTitleChange,
  onHookChange,
  onBodyChange,
  onSave,
  onCancel,
  onPersistCueCards,
  onClearCueCards,
}: {
  title: string
  hook: string
  body: string
  isNew: boolean
  activeScript: Script | null
  onTitleChange: (v: string) => void
  onHookChange: (v: string) => void
  onBodyChange: (v: string) => void
  onSave: (cueCards?: string[] | null) => void
  onCancel: () => void
  onPersistCueCards: (cards: string[]) => void
  onClearCueCards: () => void
}) {
  const [score, setScore] = useState<ScriptScore | null>(null)
  const [scoring, setScoring] = useState(false)
  const [scoreError, setScoreError] = useState<string | null>(null)
  // For a brand-new (not-yet-saved) script there is no id to persist cue cards
  // against, so hold them here and attach them on save. For existing scripts
  // we persist immediately via onPersistCueCards; this stays in sync as a
  // fallback and is what applyRewrite updates.
  const [pendingCueCards, setPendingCueCards] = useState<string[] | null>(null)

  // Rewrite preview + undo. "Preview rewrite" swaps the editor into a
  // read-only view of the proposed hook + body; the creator then chooses
  // "Use rewrite" or "Keep mine". After using the rewrite, a 5-second undo
  // toast restores the original text if they change their mind.
  const [previewing, setPreviewing] = useState(false)
  const [applied, setApplied] = useState(false)
  const [undo, setUndo] = useState<{
    hook: string
    body: string
    cueCards: string[] | null
  } | null>(null)
  const undoTimerRef = useRef<number | null>(null)

  const spoken = `${hook} ${body}`.trim()
  const wordCount = spoken ? spoken.split(/\s+/).length : 0
  // ~150 spoken words per minute is a natural short-form pace.
  const readSeconds = Math.round((wordCount / 150) * 60)
  // Duration meter: 90s spans the short-form range; markers at platform beats.
  const METER_MAX = 90
  const meterPct = Math.min(100, (readSeconds / METER_MAX) * 100)
  const tooLong = readSeconds > 60
  const zone =
    readSeconds <= 15 ? 'quick' : readSeconds <= 35 ? 'punchy' : readSeconds <= 60 ? 'solid' : 'long'

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
      const result = (await resp.json()) as ScriptScore
      setScore(result)
      setPendingCueCards(result.cue_cards)
      // Persist the AI cue cards for the ORIGINAL script so Focus mode can use
      // them immediately, even if the creator never applies the rewrite.
      if (activeScript && result.cue_cards && result.cue_cards.length > 0) {
        onPersistCueCards(result.cue_cards)
      }
    } catch {
      setScoreError('Could not reach the scoring service. Are you online?')
    } finally {
      setScoring(false)
    }
  }

  const previewRef = useRef<HTMLDivElement>(null)

  function previewRewrite() {
    if (!score) return
    setPreviewing(true)
    // The preview renders at the end of the score panel's scroll area — on
    // short phones its Use/Keep buttons land below the panel's fold. Scroll
    // the panel to its end so the decision is visible immediately.
    window.setTimeout(() => {
      const panel = previewRef.current?.closest('.overflow-y-auto')
      if (panel) panel.scrollTop = panel.scrollHeight
    }, 60)
  }

  function keepMine() {
    setPreviewing(false)
  }

  function useRewrite() {
    if (!score) return
    // Stash the originals so a 5s undo can restore them — including the cue
    // cards that were valid for that exact text (null if the text was edited
    // after scoring, which is equally correct to restore).
    setUndo({ hook, body, cueCards: pendingCueCards })
    onHookChange(score.rewrite_hook)
    onBodyChange(score.rewrite_body)
    setPendingCueCards(score.rewrite_cue_cards)
    if (activeScript && score.rewrite_cue_cards && score.rewrite_cue_cards.length > 0) {
      onPersistCueCards(score.rewrite_cue_cards)
    }
    setPreviewing(false)
    setApplied(true)
    // Keep the score panel visible (annotated "Applied") so the creator
    // still sees why they accepted — do NOT null the score.
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current)
    undoTimerRef.current = window.setTimeout(() => {
      setUndo(null)
      undoTimerRef.current = null
    }, 5000)
  }

  function undoRewrite() {
    if (!undo) return
    onHookChange(undo.hook)
    onBodyChange(undo.body)
    // Restore the cards that matched the restored text. The rewrite's cards
    // no longer apply; the original ones (if any) do again.
    setPendingCueCards(undo.cueCards)
    if (undo.cueCards && undo.cueCards.length > 0) {
      onPersistCueCards(undo.cueCards)
    } else {
      onClearCueCards()
    }
    setUndo(null)
    setApplied(false)
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
  }

  // Clear the undo timer if the component unmounts mid-countdown.
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current)
    }
  }, [])

  return (
    <div className="ts-view atmosphere-page flex h-full flex-col p-4 pt-12">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-xl font-bold">{isNew ? 'New script' : 'Edit script'}</h1>
        <button type="button" onClick={onCancel} className="-m-2 p-2 text-zinc-400 active:scale-95">
          Cancel
        </button>
      </div>
      <input
        type="text"
        placeholder="Script title (only you see this)"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        className="mb-3 rounded-xl atmosphere-surface px-4 py-3 text-lg font-semibold placeholder-zinc-500 outline-none"
      />
      <input
        type="text"
        placeholder="Hook — the opening line that stops the scroll"
        value={hook}
        onChange={(e) => {
          onHookChange(e.target.value)
          // Editing the script invalidates any AI cue cards we persisted,
          // and clears the "Applied" badge + undo from a prior rewrite.
          setPendingCueCards(null)
          onClearCueCards()
          setApplied(false)
          setUndo(null)
        }}
        className="mb-3 rounded-xl border border-amber-500/30 atmosphere-surface px-4 py-3 text-lg font-semibold text-amber-100 placeholder-amber-500/50 outline-none"
      />
      <textarea
        placeholder="Paste the rest of your script here..."
        value={body}
        onChange={(e) => {
          onBodyChange(e.target.value)
          setPendingCueCards(null)
          onClearCueCards()
          setApplied(false)
          setUndo(null)
        }}
        className="min-h-28 flex-1 resize-none rounded-xl atmosphere-surface p-4 text-base leading-relaxed placeholder-zinc-500 outline-none"
      />
      {wordCount > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-zinc-400">{wordCount} words</span>
            <span className={tooLong ? 'font-semibold text-orange-400' : 'font-semibold text-white'}>
              ~{readSeconds}s · {zone}
            </span>
          </div>
          <div className="relative h-2 w-full rounded-full atmosphere-chip">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                tooLong ? 'bg-orange-500' : 'bg-gradient-to-r from-sky-400 to-violet-500'
              }`}
              style={{ width: `${meterPct}%` }}
            />
          </div>
          <div className="relative mt-1 h-3 text-[10px] text-muted">
            {[15, 30, 60].map((t) => (
              <span
                key={t}
                className="absolute -translate-x-1/2"
                style={{ left: `${(t / METER_MAX) * 100}%` }}
              >
                {t}s
              </span>
            ))}
          </div>
        </div>
      )}

      {score && (
        <div className="mt-3 max-h-72 space-y-4 overflow-y-auto rounded-2xl atmosphere-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-zinc-400">
              Script score
            </h2>
            <button
              type="button"
              onClick={() => setScore(null)}
              className="-m-2 p-2 text-xs text-muted active:scale-95"
            >
              Dismiss
            </button>
          </div>
          <div className="grid grid-cols-5 gap-2 text-center">
            {(
              [
                ['Hook', score.scores.hook],
                ['Clarity', score.scores.clarity],
                ['Pacing', score.scores.pacing],
                ['CTA', score.scores.cta],
                ['Overall', score.scores.overall],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-xl atmosphere-chip py-2.5">
                <p className="text-xl font-bold">{value}</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-400">
            Estimated duration: ~{score.estimated_seconds}s
          </p>
          {pendingCueCards && pendingCueCards.length > 0 && (
            <p className="rounded-xl bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
              🎴 {pendingCueCards.length} cue cards ready — switch to{' '}
              <span className="font-semibold">Cards</span> on the filming screen to read one
              line at a time.
            </p>
          )}
          {score.strengths.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-emerald-400">Working well</p>
              <ul className="list-disc space-y-1 pl-4 text-sm text-zinc-300">
                {score.strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {score.suggestions.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-amber-400">Improve</p>
              <ul className="list-disc space-y-1 pl-4 text-sm text-zinc-300">
                {score.suggestions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {(score.rewrite_hook || score.rewrite_body) && (
            <div className="mb-2">
              <div className="mb-2 flex items-center gap-2">
                <p className="text-xs font-semibold text-sky-400">AI rewrite</p>
                {applied && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                    Applied ✓
                  </span>
                )}
              </div>

              {previewing ? (
                <div ref={previewRef} className="mb-2 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-sky-300/80">
                    New hook
                  </p>
                  {score.rewrite_hook && (
                    <p className="mb-2 rounded-lg atmosphere-chip px-3 py-2 text-sm font-semibold text-amber-100">
                      {score.rewrite_hook}
                    </p>
                  )}
                  {score.rewrite_body && (
                    <>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-sky-300/80">
                        New body
                      </p>
                      <div className="max-h-48 overflow-y-auto rounded-lg atmosphere-chip px-3 py-2 text-sm text-zinc-200">
                        <p className="whitespace-pre-wrap">{score.rewrite_body}</p>
                      </div>
                    </>
                  )}
                  {/* Sticky within the score panel's scroll area so the
                      decision buttons stay visible on short screens. */}
                  <div className="sticky bottom-0 mt-3 flex gap-2 rounded-lg atmosphere-chip py-1">
                    <button
                      type="button"
                      onClick={keepMine}
                      className="flex-1 rounded-full atmosphere-chip py-2.5 text-sm font-semibold text-white active:scale-95"
                    >
                      Keep mine
                    </button>
                    <button
                      type="button"
                      onClick={useRewrite}
                      className="flex-1 rounded-full btn-primary py-2.5 text-sm font-semibold active:scale-95"
                    >
                      Use rewrite
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {score.rewrite_hook && !applied && (
                    <p className="mb-1 text-sm italic text-zinc-300">“{score.rewrite_hook}”</p>
                  )}
                  {!applied && (
                    <button
                      type="button"
                      onClick={previewRewrite}
                      className="mt-2 w-full rounded-full btn-secondary py-2 text-sm font-semibold active:scale-95"
                    >
                      Preview rewrite
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
      {scoreError && <p className="mt-2 text-center text-sm text-red-400">{scoreError}</p>}

      {/* Undo toast: shows for 5s after applying a rewrite. */}
      {undo && (
        <div className="mt-3 flex items-center justify-between rounded-xl atmosphere-chip px-4 py-3">
          <span className="text-sm text-zinc-200">Rewrite applied</span>
          <button
            type="button"
            onClick={undoRewrite}
            className="rounded-full btn-primary px-4 py-1.5 text-sm font-semibold active:scale-95"
          >
            Undo
          </button>
        </div>
      )}

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={scoreScript}
          disabled={!body.trim() || scoring}
          className="flex-1 rounded-full atmosphere-chip py-4 font-semibold text-white disabled:opacity-40 active:scale-95"
        >
          {scoring ? 'Scoring…' : '✨ Score'}
        </button>
        <button
          type="button"
          onClick={() => onSave(pendingCueCards)}
          disabled={!body.trim()}
          className="flex-[2] rounded-full btn-primary py-4 font-semibold disabled:opacity-40 active:scale-95"
        >
          Save
        </button>
      </div>
    </div>
  )
}

// Split a script into teleprompter cue cards. The hook is ALWAYS a single
// complete card — it is never split, never merged into the first body card,
// in any mode. In auto mode the body is broken at natural spoken boundaries;
// in manual mode the creator's line breaks are respected exactly.
function splitIntoCueCards(hook: string, body: string, auto = true, maxWords = 16, minWords = 6): string[] {
  const trimmedHook = hook.trim()
  const trimmedBody = body.trim()

  // Manual mode: respect the user's line breaks exactly. The hook, if present,
  // is always its own first card.
  if (!auto) {
    const cards: string[] = []
    if (trimmedHook) cards.push(trimmedHook)
    if (trimmedBody) {
      for (const line of trimmedBody.split(/\n+/).map((s) => s.trim()).filter(Boolean)) {
        cards.push(line)
      }
    }
    return cards
  }

  // Auto mode: split the body at natural spoken boundaries.
  const bodyCards = splitBodyAuto(trimmedBody, maxWords, minWords)
  return trimmedHook ? [trimmedHook, ...bodyCards] : bodyCards
}

function splitBodyAuto(text: string, maxWords: number, minWords: number): string[] {
  const raw = text.trim()
  if (!raw) return []

  // Sentence-first, then major breaks, then fallback word splits.
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
  const reviewVideoRef = useRef<HTMLVideoElement>(null)
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
  const [showTune, setShowTune] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [goSignal, setGoSignal] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const pausedAtRef = useRef<number | null>(null)
  const totalPausedMsRef = useRef(0)
  // Lets the creator cancel during the 3-2-1 countdown by tapping anywhere.
  const countdownCancelledRef = useRef(false)

  // Post-record virality scoring: extracts one still frame at t=4s
  // (past the 3-2-1 countdown) and asks /api/score-video for a fix-list.
  // We intentionally do NOT extract multiple frames or show a picker —
  // the user just records, taps "Get feedback," and gets the result. The
  // single still is the simplest UX, even if a multi-frame "flipbook"
  // would give the model more temporal data to judge expression. UX over
  // coverage.
  const [videoFrame, setVideoFrame] = useState<ExtractedFrame | null>(null)
  const [videoScore, setVideoScore] = useState<{
    hook_strength: 'weak' | 'ok' | 'strong'
    payoff: 'weak' | 'ok' | 'strong'
    fixes: string[]
    hook_rewrite: string
  } | null>(null)
  const [videoScoreLoading, setVideoScoreLoading] = useState(false)
  const [videoScoreError, setVideoScoreError] = useState<string | null>(null)

  // AI cue cards (from the scoring endpoint) are preferred when present — they
  // break at natural spoken beats instead of the client-side regex. Falls back
  // to the regex splitter for unscored scripts. The hook is always card 0.
  const chunks = useMemo(() => {
    if (script.cueCards && script.cueCards.length > 0) return script.cueCards
    return splitIntoCueCards(script.hook, script.body, settings.autoCueCards)
  }, [script.cueCards, script.hook, script.body, settings.autoCueCards])
  const [chunkIndex, setChunkIndex] = useState(0)

  // Keep chunkIndex in range when the card set changes (sync clears cue cards,
  // auto/manual toggle, or script edit while the prompt view is open).
  useEffect(() => {
    if (chunkIndex > chunks.length - 1) {
      setChunkIndex(Math.max(0, chunks.length - 1))
    }
  }, [chunks.length, chunkIndex])

  async function startCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setError(null)
    setLoading(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        // TalkShot records a take; it is not a call. Voice-call processing can
        // combine badly with Bluetooth mics, whose signal is already processed
        // by iOS/the headset, producing a hollow or underwater result.
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
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

  function reconnectMicrophone() {
    // iOS Safari can retain the input route it chose when getUserMedia first
    // ran. Recreating the complete stream is the reliable way to pick up a
    // Bluetooth mic that was connected or switched after TalkShot opened.
    if (isRecording || countdown > 0 || goSignal) return
    void startCamera()
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
    // Fail fast instead of running a 3-2-1 against a dead camera.
    if (!streamRef.current) {
      setError('Camera is not ready.')
      return
    }
    resetScroll()
    setRecordedUrl(null)
    resetRecordingState()
    countdownCancelledRef.current = false
    // Accelerating cadence: 3 (1.0s) → 2 (0.8s) → 1 (0.6s), then a brief
    // "Go" beat before recording starts. Predictable rhythm reduces the
    // pre-take jitters; the creator can tap anywhere to cancel.
    const cadence = [1000, 800, 600]
    for (let i = 0; i < 3; i++) {
      setCountdown(3 - i)
      await new Promise((res) => setTimeout(res, cadence[i]))
      if (countdownCancelledRef.current) {
        setCountdown(0)
        return
      }
    }
    setCountdown(0)
    setGoSignal(true)
    await new Promise((res) => setTimeout(res, 400))
    setGoSignal(false)
    if (countdownCancelledRef.current) return
    startRecording()
  }

  function cancelCountdown() {
    if (countdown > 0 || goSignal) {
      countdownCancelledRef.current = true
      setCountdown(0)
      setGoSignal(false)
    }
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

  // Leave the review screen (Retake or Back): pause the review video and
  // release its object URL so repeated takes don't leak blob memory.
  function discardRecording() {
    reviewVideoRef.current?.pause()
    if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    setRecordedUrl(null)
    setVideoFrame(null)
    setVideoScore(null)
    setVideoScoreError(null)
    setVideoScoreLoading(false)
    resetScroll()
  }

  // Extract a still from the recorded video the moment the review screen
  // mounts (or re-mounts after a re-record). Runs once per take. Failure
  // (corrupt video, missing codec) leaves videoFrame null and the score UI
  // will surface an error. Also clears the previous take's score so a stale
  // result doesn't carry over to the new recording.
  useEffect(() => {
    if (!recordedUrl) return
    setVideoScore(null)
    setVideoScoreError(null)
    let cancelled = false
    void (async () => {
      try {
        const resp = await fetch(recordedUrl)
        const blob = await resp.blob()
        const frames = await extractFirstFrame(blob, { timesSeconds: [4.0] })
        if (cancelled) return
        setVideoFrame(frames[0] ?? null)
        if (frames.length === 0) {
          setVideoScoreError("Couldn't read a frame from your video. Try re-recording.")
        }
      } catch {
        if (cancelled) return
        setVideoScoreError("Couldn't load your video for analysis.")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [recordedUrl])

  // Call the virality-score endpoint. Triggered manually from the UI so we
  // don't burn API calls on takes the user is about to discard.
  async function scoreVideo() {
    if (!videoFrame) {
      setVideoScoreError("Couldn't read a frame from your video. Try re-recording.")
      return
    }
    if (!script.hook.trim() && !script.body.trim()) {
      setVideoScoreError('No script found for this recording. Add a script and re-record.')
      return
    }
    setVideoScoreLoading(true)
    setVideoScoreError(null)
    setVideoScore(null)
    try {
      const resp = await fetch('/api/score-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstFrameBase64: videoFrame.base64,
          firstFrameMediaType: videoFrame.mediaType,
          hook: script.hook,
          body: script.body,
        }),
      })
      if (!resp.ok) {
        let message = 'Scoring failed. Try again.'
        try {
          const data = (await resp.json()) as { error?: string }
          if (data.error) message = data.error
        } catch {
          if (resp.status === 404) message = 'Scoring is only available on the deployed app.'
        }
        setVideoScoreError(message)
        return
      }
      const result = (await resp.json()) as {
        hook_strength: 'weak' | 'ok' | 'strong'
        payoff: 'weak' | 'ok' | 'strong'
        fixes: string[]
        hook_rewrite: string
      }
      setVideoScore(result)
    } catch {
      setVideoScoreError('Could not reach the scoring service. Are you online?')
    } finally {
      setVideoScoreLoading(false)
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
  const [touchStartY, setTouchStartY] = useState<number | null>(null)
  // A swipe navigates cue cards; a tap advances. Track whether the current
  // touch became a swipe so the click that fires right after a swipe-touch can
  // be suppressed (otherwise a left-swipe also nudges forward via onClick).
  const swipedRef = useRef(false)

  function onTouchStart(e: React.TouchEvent) {
    if (!settings.focusMode) return
    const t = e.changedTouches[0]
    setTouchStartX(t.clientX)
    setTouchStartY(t.clientY)
    swipedRef.current = false
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX == null || touchStartY == null || !settings.focusMode) return
    const t = e.changedTouches[0]
    const dx = t.clientX - touchStartX
    const dy = t.clientY - touchStartY
    setTouchStartX(null)
    setTouchStartY(null)
    // Only treat as a horizontal swipe when horizontal motion dominates and
    // travels far enough — otherwise let vertical scroll/clicks through.
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    swipedRef.current = true
    if (dx < 0) {
      nextChunk()
    } else {
      setChunkIndex((i) => Math.max(0, i - 1))
    }
  }

  return (
    <div className="ts-fade relative h-full w-full overflow-hidden bg-black">
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
          // A swipe already advanced/rewound the card; don't also fire a tap.
          if (swipedRef.current) {
            swipedRef.current = false
            return
          }
          if (settings.focusMode) nextChunk()
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
                className="ts-card w-full whitespace-pre-wrap text-center font-semibold text-white drop-shadow-lg"
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
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/80 p-8 text-center text-white">
          <p>{error}</p>
          <button onClick={() => window.location.reload()} className="mt-4 rounded-full bg-white px-6 py-2 text-black">
            Reload
          </button>
        </div>
      )}
      {/* Countdown: a small bottom-center ring that scale-pulses each tick.
          Camera + hook stay visible (no full-screen blackout). Tap anywhere
          to cancel. A brief "Go" flash signals the start. */}
      {(countdown > 0 || goSignal) && (
        <div
          className="absolute inset-0 z-20 flex items-end justify-center pb-28"
          onClick={cancelCountdown}
        >
          {countdown > 0 ? (
            <div
              key={countdown}
              className="ts-pop ts-countdown-glow flex h-20 w-20 items-center justify-center rounded-full bg-black/50 text-5xl font-bold text-amber-300 backdrop-blur-md"
            >
              {countdown}
            </div>
          ) : (
            <div
              key="go"
              className="ts-go-bloom text-4xl font-bold text-amber-300 drop-shadow-lg"
            >
              Go
            </div>
          )}
        </div>
      )}
      {countdown > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-16 z-20 text-center text-xs text-white/70">
          Tap to cancel
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
                onClick={reconnectMicrophone}
                disabled={loading}
                className="rounded-full bg-white/20 px-3 py-2 text-xs text-white backdrop-blur-sm active:scale-95 disabled:opacity-50"
                aria-label="Reconnect microphone after connecting a Bluetooth microphone"
              >
                {loading ? 'Connectingâ€¦' : 'Mic'}
              </button>
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
          <span className={`h-3 w-3 rounded-full ${isPaused ? 'bg-zinc-300' : 'animate-pulse bg-amber-400'}`} />
          <span className="rounded-md bg-black/40 px-2 py-1 font-mono text-sm text-white backdrop-blur-sm">
            {formatTime(elapsed)}
          </span>
        </div>
      )}

      {recordedUrl ? (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-end bg-black/40 text-white">
          {/* Recorded clip plays back as the background so the creator can
              see themselves before deciding Retake vs Share. */}
          <video
            ref={reviewVideoRef}
            src={recordedUrl}
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* Legibility gradient behind the controls (bottom thumb zone).
              Picks up a trace of the amber cast so the review screen feels
              like the system is in 'payoff' state, not a generic overlay. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[#1c0e08]/95 via-[#0c0a09]/70 to-transparent" />

          {/* Replay affordance, top-center, out of the thumb zone. */}
          <button
            type="button"
            onClick={() => {
              const v = reviewVideoRef.current
              if (v) {
                v.currentTime = 0
                void v.play().catch(() => {})
              }
            }}
            className="absolute left-1/2 top-12 z-10 -translate-x-1/2 rounded-full bg-white/20 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm active:scale-95"
            aria-label="Replay recording"
          >
            ↻ Replay
          </button>

          <div className="relative z-10 w-full max-w-sm px-6 pb-10 text-center">
            <p className="ts-view font-display mb-1 text-lg font-bold drop-shadow-lg">How did it look?</p>
            <p className="mb-4 text-sm text-zinc-300 drop-shadow">
              Save it, or take it again.
            </p>

            {/* Post-record virality score. We extract a single still at t=4s
                (past the countdown) and send it to /api/score-video. The user
                taps "Get feedback" — no picker, no decisions. Result card
                shows 2-4 specific fixes plus a one-sentence hook rewrite. */}
            {!videoScore && !videoScoreLoading && !videoScoreError && (
              <button
                type="button"
                onClick={() => void scoreVideo()}
                disabled={!videoFrame}
                className="mb-4 w-full rounded-full bg-white/15 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/25 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {videoFrame ? 'Get feedback on this take' : 'Preparing feedback…'}
              </button>
            )}
            {videoScoreLoading && (
              <div className="mb-4 flex items-center justify-center gap-2 text-sm text-zinc-300">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                Looking at your first frame and script…
              </div>
            )}
            {videoScoreError && (
              <div className="mb-4 rounded-lg bg-red-500/20 px-3 py-2 text-left text-sm text-red-100">
                {videoScoreError}
                <button
                  type="button"
                  onClick={() => void scoreVideo()}
                  className="mt-1 block text-xs font-semibold text-red-200 underline"
                >
                  Try again
                </button>
              </div>
            )}
            {videoScore && (
              <div className="mb-4 rounded-2xl border border-white/10 bg-black/55 p-4 text-left backdrop-blur-sm">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-300">
                  How to make it stronger
                </p>
                <ul className="mb-3 space-y-1.5 text-sm text-white">
                  {videoScore.fixes.map((fix, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-amber-400">•</span>
                      <span>{fix}</span>
                    </li>
                  ))}
                </ul>
                {videoScore.hook_rewrite &&
                  videoScore.hook_rewrite.trim() !== script.hook.trim() && (
                    <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-left">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                        Try this opening
                      </p>
                      <p className="text-sm text-amber-50">{videoScore.hook_rewrite}</p>
                    </div>
                  )}
                <button
                  type="button"
                  onClick={() => void scoreVideo()}
                  className="mt-3 text-xs font-semibold text-zinc-300 underline"
                >
                  Re-score
                </button>
              </div>
            )}

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={discardRecording}
                className="rounded-full atmosphere-chip px-6 py-3 font-semibold text-white active:scale-95"
              >
                Retake
              </button>
              <button
                onClick={shareVideo}
                className="rounded-full btn-primary px-6 py-3 font-semibold active:scale-95"
              >
                Share video
              </button>
            </div>
            <button
              onClick={discardRecording}
              className="mt-3 text-sm text-zinc-300 active:scale-95"
            >
              Back to scripts
            </button>
          </div>
        </div>
      ) : isRecording ? (
        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-4 pb-10">
          <div className="mb-5 flex min-h-[28px] items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {settings.focusMode && (
                <span className="rounded-full bg-black/50 px-4 py-1 text-sm font-semibold text-white backdrop-blur-sm">
                  {chunkIndex + 1} / {chunks.length}
                </span>
              )}
            </div>
            {/* Dedicated Stop button. Single tap ends the take; the review
                screen's Retake is the safety net for accidental taps. The
                earlier long-press-to-stop model was invisible to anyone who
                didn't already know about it. */}
            <button
              type="button"
              onClick={stopRecording}
              aria-label="Stop and review recording"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500 text-white shadow-lg shadow-red-500/30 active:scale-95"
            >
              <span className="block h-4 w-4 rounded-sm bg-white" />
            </button>
          </div>
          <div className="flex items-center justify-center">
            <button
              onClick={isPaused ? resumeRecording : pauseRecording}
              className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-white text-3xl text-black shadow-lg active:scale-95"
              aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
            >
              {isPaused ? '▶' : '⏸'}
            </button>
          </div>
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-4 pb-10">
          {/* Utility row: reset + status + adjust, kept small and out of the way */}
          <div className="mb-5 flex min-h-[28px] items-center justify-between gap-2">
            <button
              onClick={resetScroll}
              className="rounded-full bg-white/10 px-3.5 py-3 text-xs font-medium text-white/90 backdrop-blur-sm active:scale-95"
              aria-label="Reset to start"
            >
              ↺ Reset
            </button>
            {/* Mode switch: scrolling teleprompter vs one-cue-card-at-a-time.
                Always visible so cue cards are discoverable; sparkle marks
                scripts that carry AI-generated cards from scoring. */}
            <div className="flex flex-1 justify-center">
              <div className="flex gap-0.5 rounded-full bg-white/10 p-0.5 backdrop-blur-sm">
                <button
                  onClick={() => onUpdateSettings({ focusMode: false })}
                  className={`rounded-full px-4 py-2.5 text-xs active:scale-95 ${
                    !settings.focusMode ? 'btn-segment-active' : 'text-white/70'
                  }`}
                >
                  Scroll
                </button>
                <button
                  onClick={() => onUpdateSettings({ focusMode: true })}
                  className={`rounded-full px-4 py-2.5 text-xs active:scale-95 ${
                    settings.focusMode ? 'btn-segment-active' : 'text-white/70'
                  }`}
                >
                  {script.cueCards && script.cueCards.length > 0 ? '✨ Cards' : 'Cards'}
                </button>
              </div>
            </div>
            <button
              onClick={() => setShowTune(true)}
              className="rounded-full bg-white/10 px-3.5 py-3 text-xs font-medium text-white/90 backdrop-blur-sm active:scale-95"
              aria-label="Adjust text and display"
            >
              Aa Adjust
            </button>
          </div>

          {/* Main row: hero record flanked by Play/Next and Flip */}
          <div className="flex items-center justify-center gap-8">
            <button
              onClick={settings.focusMode ? nextChunk : togglePlay}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-lg font-semibold text-white backdrop-blur-sm active:scale-95"
              aria-label={settings.focusMode ? 'Next card' : playing ? 'Pause scroll' : 'Play scroll'}
            >
              {settings.focusMode ? <span className="text-xs">Next</span> : playing ? '⏸' : '▶'}
            </button>

            <button
              onClick={startRecordingWithCountdown}
              className={`flex h-[76px] w-[76px] items-center justify-center rounded-full border-4 border-white/80 shadow-lg shadow-amber-500/40 active:scale-95 ${
                countdown > 0 || goSignal ? 'ts-breath-intense' : 'ts-breath'
              }`}
              aria-label="Record"
            >
              <span className="h-14 w-14 rounded-full bg-amber-400" />
            </button>

            <button
              onClick={() => setFacingMode((m) => (m === 'user' ? 'environment' : 'user'))}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm active:scale-95"
              aria-label="Flip camera"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
                <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
                <circle cx="12" cy="12" r="3" />
                <path d="m18 22-3-3 3-3" />
                <path d="m6 2 3 3-3 3" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Adjust sheet: display settings, moved off the camera into a slide-up. */}
      {showTune && !isRecording && !recordedUrl && (
        <div
          className="absolute inset-0 z-40 flex items-end bg-black/40"
          onClick={() => setShowTune(false)}
        >
          <div
            className="w-full rounded-t-3xl atmosphere-sheet p-6 pb-10 backdrop-blur-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-zinc-600" />
            <div className="mb-6 space-y-4">
              <PresetPicker
                label="Text size"
                presets={TEXT_SIZE_PRESETS}
                value={settings.fontSize}
                onChange={(v) => onUpdateSettings({ fontSize: v })}
              />
              <PresetPicker
                label="Scroll speed"
                presets={SPEED_PRESETS}
                value={settings.speed}
                onChange={(v) => onUpdateSettings({ speed: v })}
              />
            </div>
            <div className="space-y-4">
              <label className="flex items-center justify-between text-sm text-white/90">
                Mirror text
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={settings.mirror}
                  onChange={(e) => onUpdateSettings({ mirror: e.target.checked })}
                />
              </label>
              <label className="flex items-center justify-between text-sm text-white/90">
                Focus band (dim edges)
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={settings.focusBand}
                  onChange={(e) => onUpdateSettings({ focusBand: e.target.checked })}
                />
              </label>
              <label className="flex items-center justify-between text-sm text-white/90">
                Auto-split cards at sentence breaks
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={settings.autoCueCards}
                  onChange={(e) => onUpdateSettings({ autoCueCards: e.target.checked })}
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => setShowTune(false)}
              className="mt-7 w-full rounded-full bg-white py-3.5 font-semibold text-black active:scale-95"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
