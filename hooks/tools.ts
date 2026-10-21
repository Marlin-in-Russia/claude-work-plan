import type { EngineInterface, On } from 'claude-code'

import type { WorkDoc } from '../types'
import {
  PRIORITIES,
  STATUSES,
  addItems,
  addTasksTo,
  attach,
  describeBacklog,
  describeOthers,
  describePlan,
  drain,
  editPlan,
  itemId,
  myPlan,
  parseItemPatches,
  parseItems,
  parseTaskPatches,
  parseTasks,
  patchItems,
  patchTasks,
  planById,
  planId,
  promoteItems,
  stamp,
  startPlan,
  targetPlan,
  taskId,
  text,
  type Outcome,
} from './model'
import { FILE, commit, currentDoc, fresh, setExpanded, setViewing, takeInbox } from './storage'

const STATUS_SCHEMA = {
  type: 'string',
  enum: [...STATUSES],
  description:
    'todo = planned, in_progress = being worked on, review = waiting for a check, blocked = stuck (say why in a comment), done = finished, cancelled = dropped',
}

const PRIORITY_SCHEMA = { type: 'string', enum: [...PRIORITIES], description: 'Default normal' }

const PLAN_ID_SCHEMA = {
  type: 'string',
  description: "Optional: another plan of the project, e.g. \"P2\"; default this session's plan",
}

const TASK_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short task title, in the language the person writes in' },
    detail: { type: 'string', description: 'Optional: what exactly to do, acceptance criteria (markdown)' },
    phase: { type: 'string', description: 'Optional: stage the task belongs to (e.g. "Анализ", "Реализация")' },
    status: STATUS_SCHEMA,
    owner: { type: 'string', description: 'Optional: who does it (agent or person name)' },
  },
  required: ['title'],
}

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short title, in the language the person writes in' },
    detail: { type: 'string', description: 'Optional: context, why, links (markdown)' },
    priority: PRIORITY_SCHEMA,
  },
  required: ['title'],
}

export const PANE = 'work-plan'
export const TITLE = 'План работ'

export const GUIDE = `# Work plan panel
The person follows your work in the «План работ» panel beside the chat. It is stored in the project as ${FILE}, which every session of the project shares: each session has its own plan there, the backlog is common. Change it through these tools (hand edits of the file are picked up too).
For any request with more than two steps:
- Create this session's plan first with mcp__work-plan__plan_set (titles in the person's language; group tasks by phase when it helps). It does not touch the plans of other sessions.
- Keep it current as you go with mcp__work-plan__plan_update: in_progress when you start a task, done when it is finished, blocked with a comment saying why when stuck, review when it waits for the person.
- Add short comments with results, decisions, file names or findings; that is how the person tracks progress.
- Add tasks you discover with mcp__work-plan__plan_add; mark tasks you drop cancelled instead of deleting them.
- Subagents you delegate to can update the same tasks by id: tell them the ids.
Other sessions' plans are listed by plan_get. Change one only when the person asks, passing its plan_id; to continue a plan of another or an earlier session, attach to it with mcp__work-plan__plan_open.
Backlog: ideas and tasks for later, shared by all sessions. When the person asks to put something in the backlog («в бэклог», «на потом»), use mcp__work-plan__backlog_add; when they ask to take items into work, mcp__work-plan__backlog_promote; to park a plan task, plan_update with to_backlog. Do not start backlog items unless asked.
The person can change statuses, comment and add tasks in the panel; those changes reach you in tool results and with their next message. Act on them.`

async function authorOf($: EngineInterface, agentId: string | undefined): Promise<string> {
  if (agentId === undefined) return 'Claude'
  const agent = (await $.agent.list()).find(one => one.id === agentId)

  return agent?.name ?? agent?.type ?? 'Субагент'
}

/** Opens the panel unless it is open; the person may have closed it on purpose, so only for a new plan. */
async function openPane($: EngineInterface): Promise<void> {
  const panes = await $.ui.panes()
  if (!panes.some(pane => pane.id === PANE)) await $.ui.open({ id: PANE, title: TITLE })
}

/**
 * Hands the model what the person changed since it last looked: the backlog
 * changes made in this session's panel, and the changes any panel made to
 * this session's plan.
 */
export async function takeChanges($: EngineInterface): Promise<string[]> {
  const notes = await takeInbox($)
  const me = await $.session.id()
  const mine = myPlan(await currentDoc($), me)
  if (mine === undefined || mine.inbox.length === 0) return notes
  let taken: string[] = []
  await commit($, current => {
    const plan = myPlan(current, me)
    if (plan === undefined) return current
    const outcome = drain(current, plan.id)
    taken = outcome.notes

    return outcome.doc
  }).catch(() => undefined)

  return [...notes, ...taken]
}

async function withChanges($: EngineInterface, body: string): Promise<string> {
  const notes = await takeChanges($)
  if (notes.length === 0) return body

  return `${body}\n\nThe person changed the plan in the panel since you last looked:\n${notes.map(n => `- ${n}`).join('\n')}`
}

function report(outcome: Pick<Outcome, 'changed' | 'missing'>, verb: string): string {
  return [
    outcome.changed.length > 0 ? `${verb}: ${outcome.changed.join(', ')}.` : '',
    outcome.missing.length > 0 ? `Not found: ${outcome.missing.join(', ')} (check the ids).` : '',
  ]
    .filter(line => line !== '')
    .join(' ')
}

/** Who and when: what every change of a tool starts from. */
async function context($: EngineInterface, agentId: string | undefined) {
  await fresh($)

  return { me: await $.session.id(), now: await $.clock.now(), author: await authorOf($, agentId) }
}

/** Runs a change and answers the model; a file that does not parse becomes the refusal. */
async function answer($: EngineInterface, run: () => Promise<string>) {
  try {
    return { result: await withChanges($, await run()) }
  } catch (err) {
    return { deny: err instanceof Error ? err.message : String(err) }
  }
}

const NO_PLAN =
  'This session has no plan yet: create one with plan_set, or attach to a plan of the project with plan_open (plan_get lists them).'

export async function declareTools($: EngineInterface): Promise<void> {
  await Promise.all([
    $.tool.register({
      name: 'plan_set',
      description:
        "Create this session's work plan, shown to the person in the «План работ» panel; replaces the session's previous plan (archived) and leaves other sessions' plans alone. Use it at the start of any multi-step work. Returns the plan with task ids.",
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Plan title, in the language the person writes in' },
          goal: { type: 'string', description: 'Optional: the expected outcome, one sentence' },
          tasks: { type: 'array', items: TASK_SCHEMA, minItems: 1 },
          unfinished_to_backlog: {
            type: 'boolean',
            description: "Move the unfinished tasks of this session's previous plan to the backlog",
          },
        },
        required: ['title', 'tasks'],
      },
      isDeferred: false,
    }),
    $.tool.register({
      name: 'plan_update',
      description:
        "Update tasks of this session's plan (or another, by plan_id): change status, add a comment (results, decisions, why it is blocked), edit title/detail/phase/owner, move to the backlog, or remove. Several tasks in one call.",
      inputSchema: {
        type: 'object',
        properties: {
          updates: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Task id as shown in brackets, e.g. "3"' },
                status: STATUS_SCHEMA,
                comment: { type: 'string', description: 'A short note shown under the task' },
                title: { type: 'string' },
                detail: { type: 'string' },
                phase: { type: 'string' },
                owner: { type: 'string' },
                to_backlog: { type: 'boolean', description: 'Park the task in the backlog' },
                remove: { type: 'boolean', description: 'Delete the task (prefer status cancelled)' },
              },
              required: ['id'],
            },
          },
          plan_id: PLAN_ID_SCHEMA,
          plan_title: { type: 'string', description: 'Optional: rename the plan' },
          plan_goal: { type: 'string', description: 'Optional: change the plan goal' },
        },
        required: ['updates'],
      },
      isDeferred: false,
    }),
    $.tool.register({
      name: 'plan_add',
      description: "Add tasks to this session's plan (or another, by plan_id), at the end or after a given task.",
      inputSchema: {
        type: 'object',
        properties: {
          tasks: { type: 'array', items: TASK_SCHEMA, minItems: 1 },
          after: { type: 'string', description: 'Optional: id of the task to insert after' },
          plan_id: PLAN_ID_SCHEMA,
        },
        required: ['tasks'],
      },
      isDeferred: false,
    }),
    $.tool.register({
      name: 'plan_get',
      description:
        "Read this session's plan (task details, recent comments), the other plans of the project and the backlog, including what the person changed in the panel.",
      inputSchema: { type: 'object', properties: { plan_id: PLAN_ID_SCHEMA } },
      isDeferred: false,
    }),
    $.tool.register({
      name: 'plan_open',
      description:
        "Attach this session to a plan of the project (another session's, an earlier one's, or an archived one) and make it this session's plan. Use it when the person asks to continue that plan.",
      inputSchema: {
        type: 'object',
        properties: { plan_id: { type: 'string', description: 'Plan id, e.g. "P2"' } },
        required: ['plan_id'],
      },
      isDeferred: false,
    }),
    $.tool.register({
      name: 'backlog_add',
      description:
        'Put tasks or ideas into the backlog shared by the project: work for later, kept apart from the plans. Use it when the person asks to add something to the backlog.',
      inputSchema: {
        type: 'object',
        properties: { items: { type: 'array', items: ITEM_SCHEMA, minItems: 1 } },
        required: ['items'],
      },
      isDeferred: false,
    }),
    $.tool.register({
      name: 'backlog_update',
      description: 'Edit backlog items: title, detail, priority, a comment, or remove. Ids look like "B3".',
      inputSchema: {
        type: 'object',
        properties: {
          updates: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Backlog id, e.g. "B3"' },
                title: { type: 'string' },
                detail: { type: 'string' },
                priority: PRIORITY_SCHEMA,
                comment: { type: 'string' },
                remove: { type: 'boolean' },
              },
              required: ['id'],
            },
          },
        },
        required: ['updates'],
      },
      isDeferred: false,
    }),
    $.tool.register({
      name: 'backlog_promote',
      description:
        "Take backlog items into this session's plan (or another, by plan_id) as planned tasks; a plan is started when the session has none. Use it when the person asks to take backlog items into work.",
      inputSchema: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Backlog ids, e.g. ["B2", "B5"]' },
          phase: { type: 'string', description: 'Optional: plan phase for the new tasks' },
          after: { type: 'string', description: 'Optional: plan task id to insert after' },
          plan_id: PLAN_ID_SCHEMA,
        },
        required: ['ids'],
      },
      isDeferred: false,
    }),
  ])
}

export function serveTools(on: On): void {
  on('tool.call', { tool: 'mcp__work-plan__plan_set' }, async ($, e) => {
    const title = text(e.title, 200)
    const tasks = parseTasks(e.tasks)
    if (title === undefined || tasks.length === 0) {
      return { deny: 'plan_set needs a title and at least one task with a title.' }
    }
    const { me, now, author } = await context($, e.agentId)
    const keep = e.unfinished_to_backlog === true

    return answer($, async () => {
      let parked: string[] = []
      let id = ''
      const saved = await commit($, current => {
        const started = startPlan(current, me, title, text(e.goal, 600), tasks, now, author, keep)
        parked = started.parked
        id = started.plan.id

        return started.work
      })
      await setExpanded($, null)
      await setViewing($, null)
      void openPane($)
      const moved = parked.length > 0 ? `Moved to the backlog: ${parked.join(', ')}.\n\n` : ''

      return `${moved}${describePlan(planById(saved, id), false)}\n\nKeep statuses current with plan_update as you work.`
    })
  })

  on('tool.call', { tool: 'mcp__work-plan__plan_add' }, async ($, e) => {
    const tasks = parseTasks(e.tasks)
    if (tasks.length === 0) return { deny: 'plan_add needs at least one task with a title.' }
    const { me, now, author } = await context($, e.agentId)
    const wanted = planId(e.plan_id)
    if (wanted !== undefined && planById(await currentDoc($), wanted) === undefined) {
      return { deny: `No plan ${wanted} in this project.` }
    }

    return answer($, async () => {
      let added: string[] = []
      let id = ''
      const saved = await commit($, current => {
        const target = targetPlan(stamp(current, me, now), me, wanted, now, author, true)
        if (target.plan === undefined) return current
        id = target.plan.id
        const outcome = addTasksTo(target.work, id, tasks, now, author, taskId(e.after))
        added = outcome.added.map(t => `[${t.id}] ${t.title}`)

        return outcome.doc
      })

      return `Added ${added.join(', ')}.\n\n${describePlan(planById(saved, id), false)}`
    })
  })

  on('tool.call', { tool: 'mcp__work-plan__plan_update' }, async ($, e) => {
    const patches = parseTaskPatches(e.updates)
    const planTitle = text(e.plan_title, 200)
    const planGoal = typeof e.plan_goal === 'string' ? e.plan_goal.trim() : undefined
    if (patches.length === 0 && planTitle === undefined && planGoal === undefined) {
      return { deny: 'plan_update needs updates: [{ id, status?, comment?, ... }].' }
    }
    const { me, now, author } = await context($, e.agentId)
    const wanted = planId(e.plan_id)
    const target = wanted === undefined ? myPlan(await currentDoc($), me) : planById(await currentDoc($), wanted)
    if (target === undefined) return { deny: wanted === undefined ? NO_PLAN : `No plan ${wanted} in this project.` }

    return answer($, async () => {
      let outcome: Outcome | undefined
      const saved = await commit($, current => {
        outcome = patchTasks(stamp(current, me, now), target.id, patches, now, author, false)

        return editPlan(outcome.doc, target.id, planTitle, planGoal)
      })
      const head = outcome === undefined ? '' : report(outcome, 'Updated')

      return `${head}\n\n${describePlan(planById(saved, target.id), false)}`.trim()
    })
  })

  on('tool.call', { tool: 'mcp__work-plan__plan_get' }, async ($, e) => {
    const { me, now } = await context($, e.agentId)
    const wanted = planId(e.plan_id)

    return answer($, async () => {
      const work = await currentDoc($)
      const plan = wanted === undefined ? myPlan(work, me) : planById(work, wanted)
      const head = wanted !== undefined && plan === undefined ? `No plan ${wanted} in this project.` : describePlan(plan, true)

      return `${head}\n\n${describeOthers(work, me, now)}\n\n${describeBacklog(work.backlog, false)}`
    })
  })

  on('tool.call', { tool: 'mcp__work-plan__plan_open' }, async ($, e) => {
    const wanted = planId(e.plan_id)
    const { me, now } = await context($, e.agentId)
    if (wanted === undefined) return { deny: 'plan_open needs a plan_id, e.g. "P2".' }
    if (planById(await currentDoc($), wanted) === undefined) {
      return { deny: `No plan ${wanted} in this project; plan_get lists them.` }
    }

    return answer($, async () => {
      const saved = await commit($, current => attach(current, wanted, me, now))
      await setViewing($, null)
      const others = planById(saved, wanted)?.sessions.filter(s => s.id !== me).length ?? 0
      const shared = others > 0 ? `\n\n${others} other session(s) work on this plan too: their changes show up here.` : ''

      return `This session now works on plan ${wanted}.${shared}\n\n${describePlan(planById(saved, wanted), true)}`
    })
  })

  on('tool.call', { tool: 'mcp__work-plan__backlog_add' }, async ($, e) => {
    const items = parseItems(e.items)
    if (items.length === 0) return { deny: 'backlog_add needs at least one item with a title.' }
    const { now, author } = await context($, e.agentId)

    return answer($, async () => {
      let added: string[] = []
      const saved = await commit($, current => {
        const outcome = addItems(current, items, now, author)
        added = outcome.added.map(i => `[${i.id}] ${i.title}`)

        return outcome.doc
      })

      return `Added to the backlog: ${added.join(', ')}.\n\n${describeBacklog(saved.backlog, false)}`
    })
  })

  on('tool.call', { tool: 'mcp__work-plan__backlog_update' }, async ($, e) => {
    const patches = parseItemPatches(e.updates)
    if (patches.length === 0) return { deny: 'backlog_update needs updates: [{ id, ... }].' }
    const { now, author } = await context($, e.agentId)

    return answer($, async () => {
      let outcome: Outcome | undefined
      const saved = await commit($, current => {
        outcome = patchItems(current, patches, now, author, false)

        return outcome.doc
      })
      const head = outcome === undefined ? '' : report(outcome, 'Updated')

      return `${head}\n\n${describeBacklog(saved.backlog, true)}`.trim()
    })
  })

  on('tool.call', { tool: 'mcp__work-plan__backlog_promote' }, async ($, e) => {
    const ids = (Array.isArray(e.ids) ? e.ids : [e.ids]).flatMap(id => itemId(id) ?? [])
    if (ids.length === 0) return { deny: 'backlog_promote needs ids, e.g. ["B2"].' }
    const { me, now, author } = await context($, e.agentId)
    const wanted = planId(e.plan_id)
    if (wanted !== undefined && planById(await currentDoc($), wanted) === undefined) {
      return { deny: `No plan ${wanted} in this project.` }
    }

    return answer($, async () => {
      let outcome: Outcome | undefined
      let id = ''
      const saved: WorkDoc = await commit($, current => {
        const target = targetPlan(stamp(current, me, now), me, wanted, now, author, true)
        if (target.plan === undefined) return current
        id = target.plan.id
        outcome = promoteItems(target.work, id, ids, now, author, false, text(e.phase, 80), taskId(e.after))

        return outcome.doc
      })
      const head = outcome === undefined ? '' : report(outcome, `Taken into plan ${id}`)

      return `${head}\n\n${describePlan(planById(saved, id), false)}\n\n${describeBacklog(saved.backlog, false)}`.trim()
    })
  })
}
