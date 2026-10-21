import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type {
  Backlog,
  BacklogItem,
  Plan,
  PlanNote,
  PlanSession,
  PlanTask,
  PlanView,
  WorkDoc,
  WorkFile,
} from '../types'
import { EMPTY, USER, clean, isPriority, isStatus, text } from './model'

/** Where the plans and the backlog live, relative to the project root. */
export const FILE = '.claude/work-plan.json'

/** The file format this version reads and writes; a newer one is left alone. */
const VERSION = 2

// Every value of the session's state is read and written here alone, so the
// engine's scan sees each atom where it is made.
// The format of `doc` and `file`: bump it when their shape changes, so the
// state an earlier version of the code left in a running session is dropped.
const SHAPE = { shape: 'v2' }
const doc = atom({ plugin: 'work-plan', key: 'doc' } as const, EMPTY, SHAPE)
const file = atom({ plugin: 'work-plan', key: 'file' } as const, { path: '', mtime: 0, error: null }, SHAPE)
const view = atom({ plugin: 'work-plan', key: 'view' } as const, 'plan')
const viewing = atom({ plugin: 'work-plan', key: 'viewing' } as const, null)
const hideDone = atom({ plugin: 'work-plan', key: 'hideDone' } as const, false)
const showArchive = atom({ plugin: 'work-plan', key: 'showArchive' } as const, false)
const expanded = atom({ plugin: 'work-plan', key: 'expanded' } as const, null)
const confirm = atom({ plugin: 'work-plan', key: 'confirm' } as const, null)
const inbox = atom({ plugin: 'work-plan', key: 'inbox' } as const, [])

export type Snapshot = {
  work: WorkDoc
  file: WorkFile
  view: PlanView
  viewing: string | null
  isHiding: boolean
  isShowingArchive: boolean
  expanded: string | null
  confirm: string | null
  inbox: string[]
}

/** Everything the panel draws from; read while drawing, it subscribes the drawing. */
export async function snapshot($: EngineInterface): Promise<Snapshot> {
  return {
    work: await read($, doc),
    file: await read($, file),
    view: await read($, view),
    viewing: await read($, viewing),
    isHiding: await read($, hideDone),
    isShowingArchive: await read($, showArchive),
    expanded: await read($, expanded),
    confirm: await read($, confirm),
    inbox: await read($, inbox),
  }
}

export async function currentDoc($: EngineInterface): Promise<WorkDoc> {
  return read($, doc)
}

export async function setView($: EngineInterface, next: PlanView): Promise<void> {
  await update($, view, () => next)
}

/** Shows a plan of the project in the panel; `null` goes back to the session's own. */
export async function setViewing($: EngineInterface, id: string | null): Promise<void> {
  await update($, viewing, () => id)
}

export async function toggleHideDone($: EngineInterface): Promise<void> {
  await update($, hideDone, value => !value)
}

export async function toggleArchive($: EngineInterface): Promise<void> {
  await update($, showArchive, value => !value)
}

export async function setExpanded($: EngineInterface, id: string | null): Promise<void> {
  await update($, expanded, () => id)
}

export async function toggleExpanded($: EngineInterface, id: string): Promise<void> {
  await update($, expanded, current => (current === id ? null : id))
}

export async function setConfirm($: EngineInterface, id: string | null): Promise<void> {
  await update($, confirm, () => id)
}

/** Queues a change the person made to the backlog, for this session's model. */
export async function pushInbox($: EngineInterface, message: string): Promise<void> {
  await update($, inbox, list => [...list, message].slice(-50))
}

/** Hands over the queued backlog changes and empties the queue. */
export async function takeInbox($: EngineInterface): Promise<string[]> {
  const notes = await read($, inbox)
  if (notes.length > 0) await update($, inbox, () => [])

  return notes
}

// The file

const TIME_KEYS = new Set(['at', 'createdAt', 'updatedAt'])

/** Rewrites every timestamp field: epoch milliseconds inside, ISO text in the file. */
function mapTimes(value: unknown, fn: (time: unknown) => unknown): unknown {
  if (Array.isArray(value)) return value.map(one => mapTimes(one, fn))
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, one] of Object.entries(value)) {
    out[key] = TIME_KEYS.has(key) ? fn(one) : mapTimes(one, fn)
  }

  return out
}

export function serialize(work: WorkDoc): string {
  const body = mapTimes(work, time => new Date(Number(time)).toISOString()) as Record<string, unknown>

  return `${JSON.stringify(
    {
      about:
        'Планы работ и бэклог Claude Code (мод work-plan): у каждой сессии свой план, бэклог общий. Агенты ведут его через инструменты; правки вручную подхватываются панелью.',
      version: VERSION,
      ...body,
    },
    null,
    2,
  )}\n`
}

function time(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN

  return Number.isFinite(parsed) ? parsed : fallback
}

function objects(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []

  return value.flatMap(one => {
    if (typeof one === 'string') return [{ title: one }]

    return one !== null && typeof one === 'object' ? [one as Record<string, unknown>] : []
  })
}

function notesOf(value: unknown, now: number): PlanNote[] {
  return objects(value).flatMap(rec => {
    const status = isStatus(rec.status) ? rec.status : undefined
    const body = typeof rec.text === 'string' ? rec.text : ''
    if (status === undefined && body.trim() === '') return []

    return [
      clean({
        at: time(rec.at, now),
        author: text(rec.author, 80) ?? USER,
        isUser: rec.isUser === true,
        text: body,
        status,
      }),
    ]
  })
}

function planOf(raw: Record<string, unknown>, fallbackId: string, now: number): Plan {
  const used = new Set<string>()
  let seq = typeof raw.seq === 'number' ? raw.seq : 0
  const rawTasks = objects(raw.tasks)
  for (const one of rawTasks) {
    const n = Number(one.id)
    if (Number.isInteger(n)) seq = Math.max(seq, n)
  }
  const tasks: PlanTask[] = rawTasks.flatMap(t => {
    const title = text(t.title, 300)
    if (title === undefined) return []
    let id = typeof t.id === 'number' ? String(t.id) : text(t.id, 40)
    if (id === undefined || used.has(id)) {
      seq += 1
      id = String(seq)
    }
    used.add(id)

    return [
      clean({
        id,
        title,
        detail: text(t.detail),
        phase: text(t.phase, 80),
        status: isStatus(t.status) ? t.status : 'todo',
        owner: text(t.owner, 80),
        notes: notesOf(t.notes, now),
        createdAt: time(t.createdAt, now),
        updatedAt: time(t.updatedAt, now),
      }),
    ]
  })
  const sessions: PlanSession[] = objects(raw.sessions).flatMap(s => {
    const id = text(s.id, 200)

    return id === undefined ? [] : [{ id, at: time(s.at, now) }]
  })

  return clean({
    id: text(raw.id, 40)?.toUpperCase() ?? fallbackId,
    title: text(raw.title, 200) ?? 'План работ',
    goal: text(raw.goal, 600),
    tasks,
    seq,
    sessions,
    inbox: Array.isArray(raw.inbox) ? raw.inbox.filter((n): n is string => typeof n === 'string') : [],
    archived: raw.archived === true ? true : undefined,
    createdAt: time(raw.createdAt, now),
    updatedAt: time(raw.updatedAt, now),
  })
}

/**
 * Reads the file's JSON leniently, so a task added by hand (no id, no times)
 * still counts. Reads the first format too: its one plan, nobody's, becomes P1.
 */
export function parseDoc(raw: unknown, now: number): WorkDoc {
  if (raw === null || typeof raw !== 'object') throw new Error('the file holds no JSON object')
  const rec = mapTimes(raw, one => time(one, now)) as Record<string, unknown>
  if (typeof rec.version === 'number' && rec.version > VERSION) {
    throw new Error(`a newer version of the work-plan mod wrote it (format ${rec.version}); update the mod`)
  }

  const legacy = rec.plan !== null && typeof rec.plan === 'object' ? [rec.plan as Record<string, unknown>] : []
  const plans: Plan[] = []
  let planSeq = typeof rec.planSeq === 'number' ? rec.planSeq : 0
  for (const [i, one] of [...objects(rec.plans), ...legacy].entries()) {
    const plan = planOf(one, `P${i + 1}`, now)
    const n = Number(plan.id.replace(/^P/, ''))
    if (Number.isInteger(n)) planSeq = Math.max(planSeq, n)
    if (plans.some(p => p.id === plan.id)) {
      planSeq += 1
      plans.push({ ...plan, id: `P${planSeq}` })
    } else {
      plans.push(plan)
    }
  }

  const rawBacklog = (rec.backlog ?? {}) as Record<string, unknown>
  const rawItems = objects(rawBacklog.items)
  let seq = typeof rawBacklog.seq === 'number' ? rawBacklog.seq : 0
  for (const one of rawItems) {
    const n = Number(String(one.id ?? '').replace(/^B/i, ''))
    if (Number.isInteger(n)) seq = Math.max(seq, n)
  }
  const used = new Set<string>()
  const items: BacklogItem[] = rawItems.flatMap(t => {
    const title = text(t.title, 300)
    if (title === undefined) return []
    let id = text(t.id, 40)?.toUpperCase()
    if (id === undefined || used.has(id)) {
      seq += 1
      id = `B${seq}`
    }
    used.add(id)

    return [
      clean({
        id,
        title,
        detail: text(t.detail),
        priority: isPriority(t.priority) ? t.priority : 'normal',
        author: text(t.author, 80) ?? USER,
        notes: notesOf(t.notes, now),
        createdAt: time(t.createdAt, now),
        updatedAt: time(t.updatedAt, now),
      }),
    ]
  })
  const backlog: Backlog = { seq, items }

  return { plans, planSeq, backlog }
}

export async function filePath($: EngineInterface): Promise<string> {
  return `${(await $.session.root()).replace(/[\\/]+$/, '')}/${FILE}`
}

async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  return $.fs.read(path).catch(() => undefined)
}

function reasonOf(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 240)
}

/**
 * Brings the session's state up to the file when it changed since the last
 * read: another session's write, an edit by hand, a checkout.
 */
export async function sync($: EngineInterface): Promise<void> {
  const path = await filePath($)
  const known = await read($, file)
  const stat = await $.fs.stat(path).catch(() => undefined)

  if (stat === undefined) {
    if (known.path !== path || known.mtime !== 0) {
      // No file yet, or it was deleted: no plans and no backlog.
      await update($, doc, () => EMPTY)
      await update($, file, () => ({ path, mtime: 0, error: null }))
    }
    return
  }
  if (known.path === path && stat.mtimeMs === known.mtime) return

  try {
    const parsed = parseDoc(JSON.parse((await readText($, path)) ?? ''), await $.clock.now())
    await update($, doc, () => parsed)
    await update($, file, () => ({ path, mtime: stat.mtimeMs, error: null }))
  } catch (err) {
    await update($, file, () => ({ path, mtime: stat.mtimeMs, error: reasonOf(err) }))
  }
}

/**
 * Changes the plans and the backlog. Several sessions write the one file, so
 * each change is made on the file as it is now: read, apply, and read again
 * right before writing; when another session wrote in between, start over on
 * its version. The session's state follows (the panel redraws). Refuses while
 * the file does not parse, so a hand edit in progress is never overwritten.
 */
export async function commit($: EngineInterface, change: (current: WorkDoc) => WorkDoc): Promise<WorkDoc> {
  writing += 1
  try {
    const path = await filePath($)
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const before = await readText($, path)
      let current: WorkDoc
      try {
        current = before === undefined ? EMPTY : parseDoc(JSON.parse(before), await $.clock.now())
      } catch (err) {
        const stat = await $.fs.stat(path).catch(() => undefined)
        await update($, file, () => ({ path, mtime: stat?.mtimeMs ?? 0, error: reasonOf(err) }))
        throw new Error(`${FILE} cannot be changed: ${reasonOf(err)}. Fix the file first.`)
      }
      const next = change(current)
      if ((await readText($, path)) !== before) continue
      await $.fs.write(path, serialize(next))
      const stat = await $.fs.stat(path).catch(() => undefined)
      await update($, doc, () => next)
      await update($, file, () => ({ path, mtime: stat?.mtimeMs ?? 0, error: null }))

      return next
    }
    throw new Error(`${FILE} keeps changing under other sessions; try again`)
  } finally {
    writing -= 1
  }
}

/** The first look at the file, started with the session; tools wait for it. */
let first: Promise<void> | undefined

export function startSync($: EngineInterface): Promise<void> {
  first = sync($).catch(() => undefined)

  return first
}

/** Waits for the first look, then brings the state up to the file. */
export async function fresh($: EngineInterface): Promise<void> {
  await first
  await sync($).catch(() => undefined)
}

/** Commits under way in this module; the poll keeps out of their way. */
let writing = 0

/** The timer's look at the file: skipped while a commit writes it. */
export async function poll($: EngineInterface): Promise<void> {
  if (writing === 0) await sync($)
}
