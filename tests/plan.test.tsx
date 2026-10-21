import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'work-plan',
  component: 'Pane',
  requestId: 'work-plan',
  props: {
    title: 'План работ',
    isFocused: false,
    bodyColumns: 52,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const PATH = '/proj/.claude/work-plan.json'
const T0 = 1_700_000_000_000

/** The host resolves paths its own way (a drive letter, backslashes on Windows). */
const norm = (path: string) => path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

const TASKS = [
  { title: 'Изучить API модов', phase: 'Анализ', status: 'done' },
  { title: 'Спроектировать панель', phase: 'Анализ', status: 'in_progress' },
  { title: 'Написать хуки', phase: 'Реализация', detail: 'Инструменты и **панель**' },
]

/**
 * The engine beneath the plugin, answered from memory: a project folder
 * holding one file, and a session whose id the test switches to play another.
 */
function engine(on: On) {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const files = new Map<string, string>()
  const mtimes = new Map<string, number>()
  const world = { session: 'session-a', reads: 0, onRead: undefined as (() => void) | undefined }
  let tick = 0
  const put = (path: string, text: string) => {
    tick += 1
    files.set(norm(path), text)
    mtimes.set(norm(path), T0 + tick)
  }
  on('fs.stat', (_, e) => {
    const body = files.get(norm(e.path))

    return body === undefined
      ? { deny: 'ENOENT' }
      : { value: { kind: 'file', size: body.length, mtimeMs: mtimes.get(norm(e.path)) ?? 0, isLink: false } }
  })
  on('fs.read', (_, e) => {
    world.reads += 1
    const body = files.get(norm(e.path))
    const hook = world.onRead
    if (hook !== undefined) {
      world.onRead = undefined
      hook()
    }

    return body === undefined ? { deny: 'ENOENT' } : { value: body }
  })
  on('fs.write', (_, e) => {
    put(e.path, e.text)

    return { value: undefined }
  })
  on('tool.register', (_, e) => ({ value: { tool: `mcp__work-plan__${e.name}` } }))
  on('command.register', () => ({ value: { command: 'work-plan' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.id', () => ({ value: world.session }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  return { clock, files, put, world }
}

async function start($: Parameters<Parameters<typeof test>[1]>[0]) {
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
}

function saved(files: Map<string, string>) {
  return JSON.parse(files.get(PATH) ?? '{}')
}

test('an agent builds a plan and the backlog; the panel draws them, on every surface', async ($, on) => {
  const { files } = engine(on)
  await start($)

  const set = await $.tool.call({
    tool: 'mcp__work-plan__plan_set',
    title: 'Мод «План работ»',
    goal: 'Панель для отслеживания работ',
    tasks: TASKS,
  })
  expect(String(set.result)).toContain('Plan P1')
  expect(String(set.result)).toContain('[2] in_progress')

  const upd = await $.tool.call({
    tool: 'mcp__work-plan__plan_update',
    updates: [{ id: '3', status: 'blocked', comment: 'Жду ответа по API' }, { id: '9', status: 'done' }],
  })
  expect(String(upd.result)).toContain('Not found: 9')

  await $.tool.call({
    tool: 'mcp__work-plan__backlog_add',
    items: [{ title: 'Экспорт плана в Markdown', priority: 'high' }, { title: 'Тёмная тема для графиков' }],
  })

  const file = saved(files)
  expect(file.version).toBe(2)
  expect(file.plans[0].tasks[2].status).toBe('blocked')
  expect(file.plans[0].sessions[0].id).toBe('session-a')
  expect(file.backlog.items[0].createdAt).toBe(new Date(T0).toISOString())

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Спроектировать панель/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /РЕАЛИЗАЦИЯ/ })).toBeDefined()
    await ui.press({ key: 'open-3' })
    expect(await ui.find({ type: 'Text', text: /Жду ответа по API/ })).toBeDefined()
    await ui.press({ key: 'open-3' })
    await ui.press({ key: 'tab-backlog' })
    expect(await ui.find({ type: 'Text', text: /ВЫСОКИЙ ПРИОРИТЕТ/ })).toBeDefined()
    await ui.press({ key: 'tab-plans' })
    expect(await ui.find({ type: 'Text', text: /эта сессия/ })).toBeDefined()
    await ui.press({ key: 'tab-plan' })
    await ui.unmount()
  }
})

test('two sessions keep their own plans and share the backlog', async ($, on) => {
  const { files, world, clock } = engine(on)
  await start($)

  await $.tool.call({ tool: 'mcp__work-plan__plan_set', title: 'План A', tasks: TASKS })
  world.session = 'session-b'
  const b = await $.tool.call({ tool: 'mcp__work-plan__plan_set', title: 'План B', tasks: [{ title: 'Задача B' }] })
  expect(String(b.result)).toContain('Plan P2 «План B»')
  await $.tool.call({ tool: 'mcp__work-plan__plan_update', updates: [{ id: '1', status: 'done' }] })
  await $.tool.call({ tool: 'mcp__work-plan__backlog_add', items: [{ title: 'Общая идея' }] })

  world.session = 'session-a'
  const a = await $.tool.call({ tool: 'mcp__work-plan__plan_get' })
  const body = String(a.result)
  expect(body).toContain('Plan P1 «План A»')
  expect(body).toContain('[1] done — Изучить API модов')
  expect(body).toContain('[2] in_progress — Спроектировать панель')
  expect(body).toContain('[P2] «План B»: 1/1 done · another session')
  expect(body).toContain('[B1] normal — Общая идея')

  const file = saved(files)
  expect(file.plans.map((p: { id: string }) => p.id)).toEqual(['P1', 'P2'])

  await clock.advance(2_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /План A/ })).toBeDefined()
  await ui.press({ key: 'tab-plans' })
  expect(await ui.find({ type: 'Text', text: /другая сессия/ })).toBeDefined()
  await ui.press({ key: 'open-plan-P2' })
  await ui.press({ key: 'show-P2' })
  expect(await ui.find({ type: 'Text', text: /ПЛАН ДРУГОЙ СЕССИИ/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Задача B/ })).toBeDefined()

  // The person comments on B's plan from A's panel: B's agent hears of it, A's does not.
  await ui.press({ key: 'open-1' })
  await ui.input({ key: 'comment-P2-1-1', text: 'Проверь ещё раз' })
  await ui.press({ key: 'back-mine' })
  expect(await ui.find({ type: 'Text', text: /План A/ })).toBeDefined()
  await ui.unmount()

  const quiet = await $.tool.call({ tool: 'mcp__work-plan__plan_get' })
  expect(String(quiet.result)).not.toContain('Проверь ещё раз')
  world.session = 'session-b'
  const heard = await $.tool.call({ tool: 'mcp__work-plan__plan_get' })
  expect(String(heard.result)).toContain('comment on [1] «Задача B»: Проверь ещё раз')
})

test('a write by another session between read and write is not lost', async ($, on) => {
  const { files, put, world } = engine(on)
  await start($)
  await $.tool.call({ tool: 'mcp__work-plan__plan_set', title: 'План A', tasks: TASKS })

  // Session B writes the file right after A's commit has read it.
  const before = world.reads
  world.onRead = () => {
    const other = saved(files)
    other.backlog.items.push({ id: 'B1', title: 'Записано другой сессией' })
    other.backlog.seq = 1
    put(PATH, JSON.stringify(other))
  }
  await $.tool.call({ tool: 'mcp__work-plan__plan_update', updates: [{ id: '3', status: 'done' }] })
  expect(world.reads).toBeGreaterThan(before + 2)

  const file = saved(files)
  expect(file.plans[0].tasks[2].status).toBe('done')
  expect(file.backlog.items[0].title).toBe('Записано другой сессией')
})

test('a session attaches to a plan of the project and continues it', async ($, on) => {
  const { files, put } = engine(on)
  // The first format: one plan, nobody's.
  put(
    PATH,
    JSON.stringify({
      version: 1,
      plan: { title: 'Старый план', seq: 1, tasks: [{ id: '1', title: 'Старая задача', status: 'in_progress' }] },
      backlog: { seq: 0, items: [] },
    }),
  )
  await start($)

  const none = await $.tool.call({ tool: 'mcp__work-plan__plan_update', updates: [{ id: '1', status: 'done' }] })
  expect(none.deny).toContain('no plan yet')
  const list = await $.tool.call({ tool: 'mcp__work-plan__plan_get' })
  expect(String(list.result)).toContain('[P1] «Старый план»: 0/1 done · no session')

  const opened = await $.tool.call({ tool: 'mcp__work-plan__plan_open', plan_id: 'P1' })
  expect(String(opened.result)).toContain('now works on plan P1')
  await $.tool.call({ tool: 'mcp__work-plan__plan_update', updates: [{ id: '1', status: 'done' }] })
  expect(saved(files).plans[0].tasks[0].status).toBe('done')
  expect(saved(files).version).toBe(2)
})

test('the person works the plan and the backlog in the panel; the agent hears of it', async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: 'mcp__work-plan__plan_set', title: 'План', tasks: TASKS })
  await $.tool.call({ tool: 'mcp__work-plan__backlog_add', items: [{ title: 'Идея на потом' }] })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'open-2' })
  await ui.select({ key: 'status-2', value: 'review' })
  await ui.input({ key: 'comment-P1-2-1', text: 'Сделай палитру теплее' })
  expect(await ui.find({ type: 'Text', text: /Сделай палитру теплее/ })).toBeDefined()
  await ui.press({ key: 'park-2' })
  expect(await ui.find({ type: 'Text', text: /Спроектировать панель/ })).toBeUndefined()

  await ui.press({ key: 'tab-backlog' })
  await ui.input({ key: 'new-item-2', text: 'Своя задача' })
  await ui.press({ key: 'open-B1' })
  await ui.press({ key: 'promote-B1' })
  expect(await ui.find({ type: 'Text', text: /Идея на потом/ })).toBeDefined()
  await ui.press({ key: 'tab-backlog' })
  await ui.press({ key: 'open-B3' })
  await ui.press({ key: 'ask-B3' })
  await ui.press({ key: 'drop-B3' })
  expect(await ui.find({ type: 'Text', text: /Своя задача/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Агент увидит ваши изменения/ })).toBeDefined()
  await ui.unmount()

  const got = await $.tool.call({ tool: 'mcp__work-plan__plan_get' })
  const body = String(got.result)
  expect(body).toContain('[4] todo — Идея на потом')
  expect(body).toContain('[B2] normal — Спроектировать панель')
  expect(body).toContain('status of [2]')
  expect(body).toContain('deleted backlog [B3]')

  const again = await $.tool.call({ tool: 'mcp__work-plan__plan_get' })
  expect(String(again.result)).not.toContain('The person changed')
})

test('a hand edit of the file shows in the panel; a broken file is never overwritten', async ($, on) => {
  const { clock, files, put } = engine(on)
  await start($)
  await $.tool.call({ tool: 'mcp__work-plan__plan_set', title: 'План', tasks: TASKS })

  const edited = saved(files)
  edited.plans[0].tasks.push({ title: 'Добавлено руками' })
  put(PATH, JSON.stringify(edited))
  await clock.advance(2_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Добавлено руками/ })).toBeDefined()

  put(PATH, '{ "plans": ')
  await clock.advance(2_000)
  expect(await ui.find({ type: 'Text', text: /не читается/ })).toBeDefined()
  const refused = await $.tool.call({ tool: 'mcp__work-plan__plan_update', updates: [{ id: '1', status: 'done' }] })
  expect(refused.deny).toContain('cannot be changed')
  expect(files.get(PATH)).toBe('{ "plans": ')
  await ui.unmount()
})

test('the empty panel invites to ask for a plan', async ($, on) => {
  engine(on)
  await start($)
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /составь план работ/ })).toBeDefined()
    await ui.press({ key: 'tab-backlog' })
    expect(await ui.find({ type: 'Text', text: /Бэклог пуст/ })).toBeDefined()
    await ui.press({ key: 'tab-plan' })
    await ui.unmount()
  }
})
