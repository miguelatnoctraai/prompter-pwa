import { supabase } from './supabase'

export interface Script {
  id: string
  title: string
  body: string
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'prompter.scripts.v1'
// Ids deleted locally but possibly still in the cloud; applied on next full sync
// so a deletion made offline doesn't get resurrected by the remote copy.
const TOMBSTONE_KEY = 'prompter.deleted.v1'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function loadScripts(): Script[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const scripts = raw ? (JSON.parse(raw) as Script[]) : []
    // The cloud id column is uuid-typed; heal any script whose id isn't one
    // (e.g. seeded test data) so sync doesn't reject the whole batch.
    let migrated = false
    for (const s of scripts) {
      if (!UUID_RE.test(s.id)) {
        s.id = crypto.randomUUID()
        migrated = true
      }
    }
    if (migrated) saveScripts(scripts)
    return scripts
  } catch {
    return []
  }
}

export function saveScripts(scripts: Script[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts))
}

function loadTombstones(): string[] {
  try {
    const raw = localStorage.getItem(TOMBSTONE_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export function addTombstone(id: string) {
  const ids = loadTombstones()
  if (!ids.includes(id)) {
    ids.push(id)
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(ids))
  }
}

interface ScriptRow {
  id: string
  title: string
  body: string
  created_at: number
  updated_at: number
}

function toRow(s: Script): ScriptRow {
  return { id: s.id, title: s.title, body: s.body, created_at: s.createdAt, updated_at: s.updatedAt }
}

function fromRow(r: ScriptRow): Script {
  return { id: r.id, title: r.title, body: r.body, createdAt: r.created_at, updatedAt: r.updated_at }
}

// Best-effort write-through: called after every local save while signed in.
// Failures are ignored — the next full sync reconciles.
export async function pushScript(script: Script) {
  if (!supabase) return
  try {
    await supabase.from('scripts').upsert(toRow(script))
  } catch {
    // offline or transient error; full sync will catch up
  }
}

export async function pushDeletion(id: string) {
  if (!supabase) return
  try {
    await supabase.from('scripts').delete().eq('id', id)
  } catch {
    // tombstone remains; full sync will retry
  }
}

// Merge local and cloud copies, last write wins per script. Runs on sign-in
// and on manual "Sync now". Returns the merged list (already persisted locally).
export async function fullSync(local: Script[]): Promise<Script[]> {
  if (!supabase) return local

  const tombstones = loadTombstones().filter((id) => UUID_RE.test(id))
  if (tombstones.length > 0) {
    const { error } = await supabase.from('scripts').delete().in('id', tombstones)
    if (error) throw new Error(error.message)
  }

  const { data, error } = await supabase.from('scripts').select('id,title,body,created_at,updated_at')
  if (error) throw new Error(error.message)

  const merged = new Map<string, Script>()
  for (const s of local) merged.set(s.id, s)
  for (const row of (data ?? []) as ScriptRow[]) {
    const remote = fromRow(row)
    const localCopy = merged.get(remote.id)
    if (!localCopy || remote.updatedAt > localCopy.updatedAt) merged.set(remote.id, remote)
  }

  const all = [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  if (all.length > 0) {
    const { error: upsertError } = await supabase.from('scripts').upsert(all.map(toRow))
    if (upsertError) throw new Error(upsertError.message)
  }

  localStorage.removeItem(TOMBSTONE_KEY)
  saveScripts(all)
  return all
}
