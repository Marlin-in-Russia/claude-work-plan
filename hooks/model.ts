import type {
  Backlog,
  BacklogItem,
  BacklogPriority,
  Plan,
  PlanNote,
  PlanStatus,
  PlanTask,
  WorkDoc,
} from '../types'

export const STATUSES: readonly PlanStatus[] = [
  'todo',
  'in_progress',
  'review',
  'blocked',
  'done',
  'cancelled',
]

export const PRIORITIES: readonly BacklogPriority[] = ['high', 'normal', 'low']

export type StatusMeta = { label: string; glyph: string; color: string }

/** A warm palette that reads on a light and on a dark background alike. */
export const STATUS: Record<PlanStatus, StatusMeta> = {
  todo: { label: 'В плане', glyph: '□', color: '#A8A29E' },
  in_progress: { label: 'В работе', glyph: '◧', color: '#E8743B' },
  review: { label: 'На проверке', glyph: '▣', color: '#D9A425' },
  blocked: { label: 'Блокер', glyph: '⊟', color: '#D9483B' },
  done: { label: 'Готово', glyph: '■', color: '#7FA650' },
  cancelled: { label: 'Отменено', glyph: '⊠', color: '#8A817C' },
}

export const PRIORITY: Record<BacklogPriority, StatusMeta & { group: string }> = {
  high: { label: 'Высокий', group: 'Высокий приоритет', glyph: '▲', color: '#D9483B' },
  normal: { label: 'Обычный', group: 'Обычный приоритет', glyph: '■', color: '#C08A5B' },
  low: { label: 'Низкий', group: 'Низкий приоритет', glyph: '▽', color: '#A8A29E' },
}

export const ACCENT = '#D97757'
export const USER = 'Пользователь'

const MAX_PLANS = 100
const MAX_TASKS = 200
const MAX_ITEMS = 500
const MAX_NOTES = 100
const MAX_INBOX = 50

export const EMPTY: WorkDoc = { plans: [], planSeq: 0, backlog: { seq: 0, items: [] } }

export type TaskInput = {
  title: string
  detail?: string
  phase?: string
  status?: PlanStatus
  owner?: string
}

export type TaskPatch = {
  id: string
  title?: string
  detail?: string
  phase?: string
  status?: PlanStatus
  owner?: string
  comment?: string
  remove?: boolean
  toBacklog?: boolean
}

export type ItemInput = { title: string; detail?: string; priority?: BacklogPriority }

export type ItemPatch = {
  id: string
  title?: string
  detail?: string
  priority?: BacklogPriority
  comment?: string
  remove?: boolean
}

export type Stats = {
  count: Record<PlanStatus, number>
  total: number
  counted: number
  percent: number
}

export function isStatus(value: unknown): value is PlanStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
}

export function isPriority(value: unknown): value is BacklogPriority {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value)
}

export function text(value: unknown, max = 4000): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()

  return trimmed === '' ? undefined : trimmed.slice(0, max)
}

/** A text field a patch may clear: `''` clears it, absent keeps it. */
function clearable(value: unknown, max: number): string | undefined {
  return typeof value === 'string' ? value.trim().slice(0, max) : undefined
}

/** Drops the fields left `undefined`, so the value stays plain JSON. */
export function clean<T extends object>(value: T): T {
  const out = { ...value } as Record<string, unknown>
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key]
  }

  return out as T
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') return { title: value }

  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

export function taskId(value: unknown): string | undefined {
  const raw = typeof value === 'number' ? String(value) : text(value, 40)

  return raw?.replace(/^#/, '')
}

function prefixed(prefix: string, value: unknown): string | undefined {
  const raw = taskId(value)
  if (raw === undefined) return undefined

  return /^\d+$/.test(raw) ? `${prefix}${raw}` : raw.toUpperCase()
}

export function itemId(value: unknown): string | undefined {
  return prefixed('B', value)
}

export function planId(value: unknown): string | undefined {
  return prefixed('P', value)
}

export function parseTasks(value: unknown): TaskInput[] {
  const tasks: TaskInput[] = []
  for (const item of Array.isArray(value) ? value : []) {
    const rec = record(item)
    const title = text(rec?.title, 300)
    if (rec === undefined || title === undefined) continue
    tasks.push(
      clean({
        title,
        detail: text(rec.detail),
        phase: text(rec.phase, 80),
        status: isStatus(rec.status) ? rec.status : undefined,
        owner: text(rec.owner, 80),
      }),
    )
  }

  return tasks
}

export function parseTaskPatches(value: unknown): TaskPatch[] {
  const patches: TaskPatch[] = []
  for (const item of Array.isArray(value) ? value : [value]) {
    const rec = record(item)
    const id = taskId(rec?.id)
    if (rec === undefined || id === undefined) continue
    patches.push(
      clean({
        id,
        title: text(rec.title, 300),
        detail: clearable(rec.detail, 4000),
        phase: clearable(rec.phase, 80),
        status: isStatus(rec.status) ? rec.status : undefined,
        owner: clearable(rec.owner, 80),
        comment: text(rec.comment),
        remove: rec.remove === true ? true : undefined,
        toBacklog: rec.to_backlog === true ? true : undefined,
      }),
    )
  }

  return patches
}

export function parseItems(value: unknown): ItemInput[] {
  const items: ItemInput[] = []
  for (const item of Array.isArray(value) ? value : []) {
    const rec = record(item)
    const title = text(rec?.title, 300)
    if (rec === undefined || title === undefined) continue
    items.push(
      clean({
        title,
        detail: text(rec.detail),
        priority: isPriority(rec.priority) ? rec.priority : undefined,
      }),
    )
  }

  return items
}

export function parseItemPatches(value: unknown): ItemPatch[] {
  const patches: ItemPatch[] = []
  for (const item of Array.isArray(value) ? value : [value]) {
    const rec = record(item)
    const id = itemId(rec?.id)
    if (rec === undefined || id === undefined) continue
    patches.push(
      clean({
        id,
        title: text(rec.title, 300),
        detail: clearable(rec.detail, 4000),
        priority: isPriority(rec.priority) ? rec.priority : undefined,
        comment: text(rec.comment),
        remove: rec.remove === true ? true : undefined,
      }),
    )
  }

  return patches
}

function note(at: number, author: string, isUser: boolean, body: string, status?: PlanStatus): PlanNote {
  return clean({ at, author, isUser, text: body, status })
}

function withNote<T extends { notes: PlanNote[]; updatedAt: number }>(target: T, entry: PlanNote): T {
  return { ...target, notes: [...target.notes, entry].slice(-MAX_NOTES), updatedAt: entry.at }
}

function makeTask(input: TaskInput, id: string, now: number, author: string): PlanTask {
  return clean({
    id,
    title: input.title,
    detail: input.detail,
    phase: input.phase,
    status: input.status ?? 'todo',
    owner: input.owner ?? (input.status === 'in_progress' ? author : undefined),
    notes: [],
    createdAt: now,
    updatedAt: now,
  })
}

// Plans and sessions

export function planById(work: WorkDoc, id: string): Plan | undefined {
  return work.plans.find(p => p.id === id)
}

/** The plan this session works on: the latest open plan it is attached to. */
export function myPlan(work: WorkDoc, me: string): Plan | undefined {
  return work.plans
    .filter(p => p.archived !== true && p.sessions.some(s => s.id === me))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

function replacePlan(work: WorkDoc, plan: Plan): WorkDoc {
  return { ...work, plans: work.plans.map(p => (p.id === plan.id ? plan : p)) }
}

/** Notes the session's activity on its plan, so the other panels show it as live. */
export function stamp(work: WorkDoc, me: string, now: number): WorkDoc {
  const plan = myPlan(work, me)
  if (plan === undefined) return work

  return replacePlan(work, { ...plan, sessions: plan.sessions.map(s => (s.id === me ? { id: me, at: now } : s)) })
}

/** Attaches the session to a plan (reopening it from the archive) and detaches it from any other. */
export function attach(work: WorkDoc, id: string, me: string, now: number): WorkDoc {
  return {
    ...work,
    plans: work.plans.map(plan => {
      const others = plan.sessions.filter(s => s.id !== me)
      if (plan.id === id) {
        const { archived: _, ...open } = plan

        return { ...open, sessions: [...others, { id: me, at: now }] }
      }

      return others.length === plan.sessions.length ? plan : { ...plan, sessions: others }
    }),
  }
}

export function setArchived(work: WorkDoc, id: string, isArchived: boolean): WorkDoc {
  const plan = planById(work, id)
  if (plan === undefined) return work
  const { archived: _, ...open } = plan

  return replacePlan(work, isArchived ? { ...open, archived: true, sessions: [] } : open)
}

export function removePlan(work: WorkDoc, id: string): WorkDoc {
  return { ...work, plans: work.plans.filter(p => p.id !== id) }
}

/** Keeps the newest plans; the oldest archived ones go first. */
function trimPlans(plans: Plan[]): Plan[] {
  if (plans.length <= MAX_PLANS) return plans
  const archived = plans.filter(p => p.archived === true).sort((a, b) => a.updatedAt - b.updatedAt)
  const drop = new Set(archived.slice(0, plans.length - MAX_PLANS).map(p => p.id))

  return plans.filter(p => !drop.has(p.id))
}

/**
 * Starts a new plan for the session. Its previous plan is archived when no
 * other session works on it, or left to them; `keepUnfinished` parks the open
 * tasks of the previous plan in the backlog first.
 */
export function startPlan(
  work: WorkDoc,
  me: string,
  title: string,
  goal: string | undefined,
  inputs: TaskInput[],
  now: number,
  author: string,
  keepUnfinished = false,
): { work: WorkDoc; plan: Plan; parked: string[] } {
  let next = work
  let parked: string[] = []
  const previous = myPlan(work, me)
  if (previous !== undefined) {
    if (keepUnfinished) {
      const open = previous.tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled')
      const outcome = patchTasks(next, previous.id, open.map(t => ({ id: t.id, toBacklog: true })), now, author, false)
      next = outcome.doc
      parked = outcome.changed
    }
    const current = planById(next, previous.id) ?? previous
    const others = current.sessions.filter(s => s.id !== me)
    next = others.length > 0 ? replacePlan(next, { ...current, sessions: others }) : setArchived(next, current.id, true)
  }
  const tasks = inputs.slice(0, MAX_TASKS).map((input, i) => makeTask(input, String(i + 1), now, author))
  const plan: Plan = clean({
    id: `P${next.planSeq + 1}`,
    title,
    goal,
    tasks,
    seq: tasks.length,
    sessions: [{ id: me, at: now }],
    inbox: [],
    createdAt: now,
    updatedAt: now,
  })

  return { work: { ...next, planSeq: next.planSeq + 1, plans: trimPlans([...next.plans, plan]) }, plan, parked }
}

/** The plan a change goes to: the one named, else the session's; one is started when asked and none is. */
export function targetPlan(
  work: WorkDoc,
  me: string,
  id: string | undefined,
  now: number,
  author: string,
  isStarting: boolean,
): { work: WorkDoc; plan: Plan | undefined } {
  const plan = id === undefined ? myPlan(work, me) : planById(work, id)
  if (plan !== undefined || !isStarting || id !== undefined) return { work, plan }
  const started = startPlan(work, me, 'План работ', undefined, [], now, author)

  return { work: started.work, plan: started.plan }
}

/** Inserts tasks at the end, or after `after`, inheriting that task's phase. */
export function addTasks(
  plan: Plan,
  inputs: TaskInput[],
  now: number,
  author: string,
  after?: string,
): { plan: Plan; added: PlanTask[] } {
  const room = Math.max(0, MAX_TASKS - plan.tasks.length)
  const anchor = after === undefined ? -1 : plan.tasks.findIndex(t => t.id === after)
  const inherited = anchor >= 0 ? plan.tasks[anchor]?.phase : undefined
  let seq = plan.seq
  const added = inputs.slice(0, room).map(input => {
    seq += 1

    return makeTask({ ...input, phase: input.phase ?? inherited }, String(seq), now, author)
  })
  const tasks =
    anchor >= 0
      ? [...plan.tasks.slice(0, anchor + 1), ...added, ...plan.tasks.slice(anchor + 1)]
      : [...plan.tasks, ...added]

  return { plan: { ...plan, tasks, seq, updatedAt: now }, added }
}

export function addTasksTo(work: WorkDoc, id: string, inputs: TaskInput[], now: number, author: string, after?: string) {
  const plan = planById(work, id)
  if (plan === undefined) return { doc: work, added: [] as PlanTask[] }
  const outcome = addTasks(plan, inputs, now, author, after)

  return { doc: replacePlan(work, outcome.plan), added: outcome.added }
}

export type Outcome = { doc: WorkDoc; changed: string[]; missing: string[] }

/** Applies task patches to one plan in order; `isUser` marks who made them, for the activity log. */
export function patchTasks(
  doc: WorkDoc,
  id: string,
  patches: TaskPatch[],
  now: number,
  author: string,
  isUser: boolean,
): Outcome {
  const plan = planById(doc, id)
  if (plan === undefined) return { doc, changed: [], missing: patches.map(p => p.id) }
  let tasks = plan.tasks
  let backlog = doc.backlog
  const changed: string[] = []
  const missing: string[] = []
  for (const patch of patches) {
    const found = tasks.find(t => t.id === patch.id)
    if (found === undefined) {
      missing.push(patch.id)
      continue
    }
    if (patch.remove === true) {
      tasks = tasks.filter(t => t.id !== patch.id)
      changed.push(patch.id)
      continue
    }
    let task: PlanTask = clean({
      ...found,
      title: patch.title ?? found.title,
      detail: patch.detail === undefined ? found.detail : patch.detail || undefined,
      phase: patch.phase === undefined ? found.phase : patch.phase || undefined,
      owner: patch.owner === undefined ? found.owner : patch.owner || undefined,
      updatedAt: now,
    })
    if (patch.status !== undefined && patch.status !== found.status) {
      task = { ...withNote(task, note(now, author, isUser, '', patch.status)), status: patch.status }
      if (patch.status === 'in_progress' && task.owner === undefined && !isUser) {
        task = { ...task, owner: author }
      }
    }
    if (patch.comment !== undefined) task = withNote(task, note(now, author, isUser, patch.comment))
    if (patch.toBacklog === true) {
      const moved = toItem(task, plan.id, backlog.seq + 1, now, author, isUser)
      backlog = { seq: backlog.seq + 1, items: [...backlog.items, moved].slice(-MAX_ITEMS) }
      tasks = tasks.filter(t => t.id !== task.id)
      changed.push(`${patch.id}→${moved.id}`)
      continue
    }
    tasks = tasks.map(t => (t.id === task.id ? task : t))
    changed.push(patch.id)
  }

  return { doc: { ...replacePlan(doc, { ...plan, tasks, updatedAt: now }), backlog }, changed, missing }
}

function toItem(task: PlanTask, from: string, seq: number, now: number, author: string, isUser: boolean): BacklogItem {
  const status = STATUS[task.status].label.toLowerCase()
  const entry = note(now, author, isUser, `Перенесено из плана ${from} (задача ${task.id}, ${status})`)

  return clean({
    id: `B${seq}`,
    title: task.title,
    detail: task.detail,
    priority: 'normal' as const,
    author,
    notes: [...task.notes, entry].slice(-MAX_NOTES),
    createdAt: now,
    updatedAt: now,
  })
}

export function editPlan(work: WorkDoc, id: string, title: string | undefined, goal: string | undefined): WorkDoc {
  const plan = planById(work, id)
  if (plan === undefined || (title === undefined && goal === undefined)) return work
  const { goal: _, ...rest } = { ...plan, title: title ?? plan.title }
  const kept = goal === undefined ? plan.goal : goal || undefined

  return replacePlan(work, kept === undefined ? rest : { ...rest, goal: kept })
}

/** Queues what the person changed for the agent of a session on that plan. */
export function notify(work: WorkDoc, id: string, message: string): WorkDoc {
  const plan = planById(work, id)
  if (plan === undefined) return work

  return replacePlan(work, { ...plan, inbox: [...plan.inbox, message].slice(-MAX_INBOX) })
}

/** Hands over a plan's queued changes and empties the queue. */
export function drain(work: WorkDoc, id: string): { doc: WorkDoc; notes: string[] } {
  const plan = planById(work, id)
  if (plan === undefined || plan.inbox.length === 0) return { doc: work, notes: [] }

  return { doc: replacePlan(work, { ...plan, inbox: [] }), notes: plan.inbox }
}

// Backlog

export function addItems(
  doc: WorkDoc,
  inputs: ItemInput[],
  now: number,
  author: string,
): { doc: WorkDoc; added: BacklogItem[] } {
  let seq = doc.backlog.seq
  const added = inputs.map(input => {
    seq += 1

    return clean({
      id: `B${seq}`,
      title: input.title,
      detail: input.detail,
      priority: input.priority ?? 'normal',
      author,
      notes: [],
      createdAt: now,
      updatedAt: now,
    })
  })
  const items = [...doc.backlog.items, ...added].slice(-MAX_ITEMS)

  return { doc: { ...doc, backlog: { seq, items } }, added }
}

export function patchItems(
  doc: WorkDoc,
  patches: ItemPatch[],
  now: number,
  author: string,
  isUser: boolean,
): Outcome {
  let items = doc.backlog.items
  const changed: string[] = []
  const missing: string[] = []
  for (const patch of patches) {
    const found = items.find(i => i.id === patch.id)
    if (found === undefined) {
      missing.push(patch.id)
      continue
    }
    if (patch.remove === true) {
      items = items.filter(i => i.id !== patch.id)
      changed.push(patch.id)
      continue
    }
    let item: BacklogItem = clean({
      ...found,
      title: patch.title ?? found.title,
      detail: patch.detail === undefined ? found.detail : patch.detail || undefined,
      priority: patch.priority ?? found.priority,
      updatedAt: now,
    })
    if (patch.comment !== undefined) item = withNote(item, note(now, author, isUser, patch.comment))
    items = items.map(i => (i.id === item.id ? item : i))
    changed.push(patch.id)
  }

  return { doc: { ...doc, backlog: { ...doc.backlog, items } }, changed, missing }
}

/** Moves backlog items into a plan as `todo` tasks. */
export function promoteItems(
  doc: WorkDoc,
  id: string,
  ids: string[],
  now: number,
  author: string,
  isUser: boolean,
  phase?: string,
  after?: string,
): Outcome {
  const target = planById(doc, id)
  const picked = ids.map(one => doc.backlog.items.find(i => i.id === one))
  const found = picked.filter((i): i is BacklogItem => i !== undefined)
  const missing = ids.filter((_, i) => picked[i] === undefined)
  if (target === undefined || found.length === 0) return { doc, changed: [], missing }
  const { plan, added } = addTasks(
    target,
    found.map(i => clean({ title: i.title, detail: i.detail, phase })),
    now,
    author,
    after,
  )
  const tasks = plan.tasks.map(task => {
    const index = added.findIndex(a => a.id === task.id)
    const source = found[index]
    if (index < 0 || source === undefined) return task
    const entry = note(now, author, isUser, `Взято из бэклога (${source.id})`)

    return { ...task, notes: [...source.notes, entry].slice(-MAX_NOTES) }
  })
  const left = doc.backlog.items.filter(i => !found.includes(i))

  return {
    doc: { ...replacePlan(doc, { ...plan, tasks }), backlog: { ...doc.backlog, items: left } },
    changed: found.map((item, i) => `${item.id}→${added[i]?.id ?? '?'}`),
    missing,
  }
}

// Reading

export function stats(plan: Plan | undefined): Stats {
  const count: Record<PlanStatus, number> = {
    todo: 0,
    in_progress: 0,
    review: 0,
    blocked: 0,
    done: 0,
    cancelled: 0,
  }
  for (const task of plan?.tasks ?? []) count[task.status] += 1
  const total = plan?.tasks.length ?? 0
  const counted = total - count.cancelled
  const percent = counted === 0 ? 0 : Math.round((count.done / counted) * 100)

  return { count, total, counted, percent }
}

export function sortedItems(backlog: Backlog): BacklogItem[] {
  return PRIORITIES.flatMap(p => backlog.items.filter(i => i.priority === p))
}

function comments(notes: PlanNote[]): PlanNote[] {
  return notes.filter(n => n.status === undefined)
}

function quote(entry: PlanNote): string {
  return `    > ${entry.isUser ? 'USER' : entry.author}: ${entry.text.replace(/\n/g, ' ')}`
}

/** The plan as the model reads it in a tool result. */
export function describePlan(plan: Plan | undefined, isFull: boolean): string {
  if (plan === undefined) {
    return 'This session has no plan yet: create one with plan_set, or attach to a plan of the project with plan_open.'
  }
  const s = stats(plan)
  const lines = [`Plan ${plan.id} «${plan.title}»: ${s.count.done}/${s.counted} done (${s.percent}%)`]
  if (plan.goal !== undefined) lines.push(`Goal: ${plan.goal}`)
  let phase: string | undefined
  for (const task of plan.tasks) {
    if (task.phase !== phase) {
      phase = task.phase
      lines.push('', `## ${phase ?? 'Other'}`)
    }
    const owner = task.owner === undefined ? '' : ` @${task.owner}`
    const said = comments(task.notes)
    const tail = !isFull && said.length > 0 ? ` · ${said.length} comment(s)` : ''
    lines.push(`- [${task.id}] ${task.status} — ${task.title}${owner}${tail}`)
    if (isFull && task.detail !== undefined) lines.push(`    ${task.detail.replace(/\n/g, '\n    ')}`)
    if (isFull) lines.push(...said.slice(-5).map(quote))
  }

  return lines.join('\n')
}

/** The other open plans of the project, one line each. */
export function describeOthers(work: WorkDoc, me: string, now: number): string {
  const mine = myPlan(work, me)
  const others = work.plans.filter(p => p.archived !== true && p.id !== mine?.id)
  if (others.length === 0) return 'Other plans in this project: none.'
  const lines = others.map(plan => {
    const s = stats(plan)
    const live = plan.sessions.map(one => one.at).sort((a, b) => b - a)[0]
    const who = live === undefined ? 'no session' : `another session, active ${Math.round((now - live) / 60_000)} min ago`

    return `- [${plan.id}] «${plan.title}»: ${s.count.done}/${s.counted} done · ${who}`
  })

  return `Other plans in this project (not yours; touch them only when the person asks, with plan_id):\n${lines.join('\n')}`
}

/** The backlog as the model reads it. */
export function describeBacklog(backlog: Backlog, isFull: boolean): string {
  if (backlog.items.length === 0) return 'Backlog (shared by the project): empty.'
  const lines = [`Backlog (shared by the project): ${backlog.items.length} item(s)`]
  for (const item of sortedItems(backlog)) {
    const said = comments(item.notes)
    const tail = !isFull && said.length > 0 ? ` · ${said.length} comment(s)` : ''
    lines.push(`- [${item.id}] ${item.priority} — ${item.title}${tail}`)
    if (isFull && item.detail !== undefined) lines.push(`    ${item.detail.replace(/\n/g, '\n    ')}`)
    if (isFull) lines.push(...said.slice(-5).map(quote))
  }

  return lines.join('\n')
}

export function ago(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 45) return 'только что'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ч назад`

  return `${Math.round(hours / 24)} дн назад`
}
