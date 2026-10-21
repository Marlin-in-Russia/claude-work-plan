import type { EngineInterface, Register } from 'claude-code'

import type { BacklogItem, BacklogPriority, Plan, PlanNote, PlanStatus, PlanTask, WorkDoc } from '../types'
import { barSvg, prioritySvg, ruleSvg, statusSvg } from './art'
import {
  ACCENT,
  PRIORITIES,
  PRIORITY,
  STATUS,
  STATUSES,
  USER,
  addItems,
  addTasksTo,
  ago,
  attach,
  myPlan,
  notify,
  patchItems,
  patchTasks,
  planById,
  promoteItems,
  removePlan,
  setArchived,
  sortedItems,
  startPlan,
  stats,
} from './model'
import {
  FILE,
  commit,
  poll,
  pushInbox,
  setConfirm,
  setView,
  setViewing,
  snapshot,
  startSync,
  toggleArchive,
  toggleExpanded,
  toggleHideDone,
} from './storage'
import { GUIDE, PANE, TITLE, declareTools, serveTools, takeChanges } from './tools'

/** How the panel names the person in the activity log. */
const ME = 'Вы'

/** A whisper of the accent under the pointer. */
const HOVER = '#D9775712'

/**
 * A change the person made in the panel, written to the file. A change to a
 * plan is queued in that plan for the agent of a session working on it; a
 * change to the backlog, for this session's agent. A file that does not
 * parse refuses it; the panel says so.
 */
async function act(
  $: EngineInterface,
  change: (current: WorkDoc, now: number) => WorkDoc,
  message?: { plan: string; text: string } | string,
): Promise<boolean> {
  const now = await $.clock.now()
  try {
    await commit($, current => {
      const next = change(current, now)

      return typeof message === 'object' ? notify(next, message.plan, message.text) : next
    })
  } catch {
    return false
  }
  if (typeof message === 'string') await pushInbox($, message)

  return true
}

export const register: Register = on => {
  serveTools(on)

  on('session.start', async ($, e, next) => {
    await Promise.all([
      declareTools($),
      $.command.register({
        name: 'work-plan',
        description: 'Открыть панель «План работ»; clear — убрать план этой сессии в архив',
        argumentHint: '[clear]',
      }),
    ])
    await startSync($)
    // Other sessions write the same file; hand edits and checkouts change it too.
    $.clock.every(2_000, () => {
      void poll($).catch(() => undefined)
    })
    // Relative times ("5 мин назад") stay true.
    $.clock.every(60_000, () => $.ui.invalidate('ui.render'))
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'work-plan' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      const me = await $.session.id()
      try {
        await commit($, current => {
          const mine = myPlan(current, me)

          return mine === undefined ? current : setArchived(current, mine.id, true)
        })
      } catch (err) {
        return { text: err instanceof Error ? err.message : String(err) }
      }

      return { text: 'План этой сессии убран в архив; бэклог и планы других сессий на месте.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Панель «План работ» открыта.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return { sections: [...composed.sections, { id: 'work-plan:guide', text: GUIDE, scope: 'session' }] }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined) return next(e)
    const notes = await takeChanges($)
    if (notes.length === 0) return next(e)
    const note = `The person changed the work plan in the panel:\n${notes.map(n => `- ${n}`).join('\n')}`

    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  // The panel

  on('ui.render', { component: 'Pane', requestId: 'work-plan' }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = table
    const Svg = 'Svg' in table ? table.Svg : undefined
    const Select = 'Select' in table ? table.Select : undefined
    const Input = 'Input' in table ? table.Input : undefined
    const isGraphic = Svg !== undefined

    const snap = await snapshot($)
    const { work, file: known, view: tab, isHiding, expanded: open, confirm: asking } = snap
    const me = await $.session.id()
    const now = await $.clock.now()
    const width = Math.min(900, e.props.bodyColumns * 7.4)

    const mine = myPlan(work, me)
    const plan = (snap.viewing === null ? undefined : planById(work, snap.viewing)) ?? mine
    const isMine = plan !== undefined && plan.id === mine?.id
    const s = stats(plan)
    const closed = s.count.done + s.count.cancelled
    const openPlans = work.plans.filter(p => p.archived !== true)
    const archived = work.plans.filter(p => p.archived === true)

    const toggle = (id: string) => toggleExpanded($, id)
    const who = (entry: PlanNote) => (entry.isUser ? ME : entry.author)

    /** Who works on a plan, as the panel says it. */
    const owners = (one: Plan) => {
      if (one.archived === true) return 'в архиве'
      if (one.id === mine?.id) {
        const others = one.sessions.length - 1

        return others > 0 ? `эта сессия и ещё ${others}` : 'эта сессия'
      }
      const live = one.sessions.map(x => x.at).sort((a, b) => b - a)[0]
      if (live === undefined) return 'без сессии'
      const count = one.sessions.length > 1 ? `${one.sessions.length} сессии` : 'другая сессия'

      return `${count}, активна ${ago(live, now)}`
    }

    // Pieces

    const mark = (source: string, glyph: string, color: string, alt: string) =>
      Svg !== undefined ? (
        <Svg source={source} alt={alt} width={14} height={14} />
      ) : (
        <Text color={color}>{glyph}</Text>
      )

    const heading = (label: string, count: string) => (
      <Box flexDirection="column" gap="xs" paddingTop="sm">
        <Box flexDirection="row" justifyContent="space-between">
          <Text size="caption" weight="bold" color={ACCENT}>
            {label.toUpperCase()}
          </Text>
          <Text size="caption" dimColor tabular>
            {count}
          </Text>
        </Box>
        {Svg !== undefined && <Svg source={ruleSvg(width)} alt="разделитель" />}
      </Box>
    )

    const activity = (notes: PlanNote[]) => {
      const shown = notes.slice(-8)
      const hidden = notes.length - shown.length

      return (
        <Box flexDirection="column" gap="xs">
          {hidden > 0 && (
            <Text size="caption" dimColor>
              … ещё {hidden} записей раньше
            </Text>
          )}
          {shown.map(entry =>
            entry.status !== undefined ? (
              <Text size="caption" dimColor>
                <Text color={STATUS[entry.status].color}>{STATUS[entry.status].glyph}</Text> {who(entry)} →{' '}
                {STATUS[entry.status].label} · {ago(entry.at, now)}
              </Text>
            ) : (
              <Box flexDirection="column">
                <Text size="caption">
                  <Text weight="semibold" color={entry.isUser ? ACCENT : undefined}>
                    {who(entry)}
                  </Text>
                  <Text dimColor> · {ago(entry.at, now)}</Text>
                </Text>
                <Text wrap="wrap">{entry.text}</Text>
              </Box>
            ),
          )}
        </Box>
      )
    }

    const commentField = (key: string, onSubmit: (value: string) => void) =>
      Input !== undefined && (
        <Input key={key} placeholder="Комментарий для агента…" submitLabel="отправить" onSubmit={onSubmit} />
      )

    // Header

    const legend = STATUSES.filter(st => s.count[st] > 0).map(st => (
      <Text>
        <Text color={STATUS[st].color}>■</Text>
        <Text dimColor>{` ${s.count[st]} ${STATUS[st].label.toLowerCase()}    `}</Text>
      </Text>
    ))
    const cells = Math.max(10, e.props.bodyColumns - 2)
    const kind =
      plan === undefined || isMine
        ? 'ПЛАН РАБОТ'
        : plan.archived === true
          ? 'АРХИВНЫЙ ПЛАН'
          : plan.sessions.length === 0
            ? 'ПЛАН БЕЗ СЕССИИ'
            : 'ПЛАН ДРУГОЙ СЕССИИ'

    const header = (
      <Box flexDirection="column" gap="xs">
        <Text size="caption" weight="semibold" color={ACCENT}>
          {kind}
          {plan !== undefined && (
            <Text dimColor weight="regular">{`  ·  ${plan.id}  ·  обновлён ${ago(plan.updatedAt, now)}`}</Text>
          )}
        </Text>
        <Text size="heading" weight="bold" wrap="wrap">
          {plan?.title ?? 'Плана пока нет'}
        </Text>
        {plan?.goal !== undefined && (
          <Text dimColor wrap="wrap">
            {plan.goal}
          </Text>
        )}
        {plan === undefined && (
          <Text dimColor wrap="wrap">
            {openPlans.length > 0
              ? 'У этой сессии своего плана нет. Попросите агента составить план или подключите план из вкладки «Планы проекта».'
              : 'Попросите агента: «составь план работ и веди его в панели». Задачи, статусы и комментарии появятся здесь.'}
          </Text>
        )}
        {plan !== undefined && !isMine && (
          <Box flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap" paddingTop="xs">
            <Button
              key="attach-shown"
              variant="primary"
              label="Подключить к этой сессии"
              onPress={async () => {
                if (await act($, (current, at) => attach(current, plan.id, me, at))) await setViewing($, null)
              }}
            />
            <Button key="back-mine" plain dimColor label={mine === undefined ? 'Закрыть' : '← Мой план'} onPress={() => setViewing($, null)} />
          </Box>
        )}
      </Box>
    )

    const progress = plan !== undefined && s.total > 0 && (
      <Box flexDirection="column" gap="xs">
        <Text>
          <Text size="title" weight="bold" color={STATUS.done.color} tabular>
            {s.percent}%
          </Text>
          <Text size="caption" dimColor>{`   ${s.count.done} из ${s.counted} готово`}</Text>
        </Text>
        {Svg !== undefined ? (
          <Svg source={barSvg(s, width)} alt={`${s.percent}% готово`} />
        ) : (
          <Text>
            {(['done', 'review', 'in_progress', 'blocked', 'todo'] as const).map(st => (
              <Text color={STATUS[st].color}>{'━'.repeat(Math.round((cells * s.count[st]) / s.total))}</Text>
            ))}
          </Text>
        )}
        <Text size="caption" wrap="wrap">
          {legend}
        </Text>
      </Box>
    )

    // Tabs

    const tabs = (
      <Box flexDirection="row" gap="xs" alignItems="center" flexWrap="wrap">
        <Button
          key="tab-plan"
          label={`План · ${s.total}`}
          variant={tab === 'plan' ? 'primary' : 'secondary'}
          onPress={() => setView($, 'plan')}
        />
        <Button
          key="tab-backlog"
          label={`Бэклог · ${work.backlog.items.length}`}
          variant={tab === 'backlog' ? 'primary' : 'secondary'}
          onPress={() => setView($, 'backlog')}
        />
        <Button
          key="tab-plans"
          label={`Планы проекта · ${openPlans.length}`}
          variant={tab === 'plans' ? 'primary' : 'secondary'}
          onPress={() => setView($, 'plans')}
        />
        <Box flexGrow={1} />
        {tab === 'plan' && closed > 0 && (
          <Button
            key="hide-done"
            plain
            dimColor
            label={isHiding ? `Показать завершённые · ${closed}` : 'Скрыть завершённые'}
            onPress={() => toggleHideDone($)}
          />
        )}
      </Box>
    )

    // Plan

    const planChange = (target: Plan, change: (current: WorkDoc, at: number) => WorkDoc, message: string) =>
      act($, change, { plan: target.id, text: message })

    const taskDetails = (target: Plan, task: PlanTask) => (
      <Box flexDirection="column" gap="sm" paddingLeft={3} paddingTop="xs" paddingBottom="xs">
        {task.detail !== undefined && <Markdown text={task.detail} />}
        <Box flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap">
          {Select !== undefined ? (
            <Select
              key={`status-${task.id}`}
              label="Статус"
              value={task.status}
              options={STATUSES.map(st => ({ value: st, label: STATUS[st].label }))}
              onSelect={value => {
                const status = STATUSES.find(st => st === value)
                if (status === undefined || status === task.status) return
                void planChange(
                  target,
                  (current, at) => patchTasks(current, target.id, [{ id: task.id, status }], at, USER, true).doc,
                  `status of [${task.id}] «${task.title}»: ${task.status} → ${status}`,
                )
              }}
            />
          ) : (
            STATUSES.filter(st => st !== task.status).map(status => (
              <Button
                key={`set-${task.id}-${status}`}
                label={STATUS[status].label}
                onPress={() =>
                  planChange(
                    target,
                    (current, at) => patchTasks(current, target.id, [{ id: task.id, status }], at, USER, true).doc,
                    `status of [${task.id}] «${task.title}»: ${task.status} → ${status}`,
                  )
                }
              />
            ))
          )}
          <Button
            key={`park-${task.id}`}
            plain
            dimColor
            label="Отложить в бэклог"
            onPress={() =>
              planChange(
                target,
                (current, at) => patchTasks(current, target.id, [{ id: task.id, toBacklog: true }], at, USER, true).doc,
                `moved plan task [${task.id}] «${task.title}» to the backlog`,
              )
            }
          />
        </Box>
        {task.notes.length > 0 && activity(task.notes)}
        {commentField(`comment-${target.id}-${task.id}-${task.notes.length}`, value => {
          const comment = value.trim()
          if (comment === '') return
          void planChange(
            target,
            (current, at) => patchTasks(current, target.id, [{ id: task.id, comment }], at, USER, true).doc,
            `comment on [${task.id}] «${task.title}»: ${comment}`,
          )
        })}
      </Box>
    )

    const taskRow = (target: Plan, task: PlanTask) => {
      const meta = STATUS[task.status]
      const isOpen = open === `${target.id}:${task.id}`
      const comments = task.notes.filter(n => n.status === undefined).length
      const facts = [
        task.owner === undefined ? '' : `@${task.owner}`,
        comments > 0 ? `💬 ${comments}` : '',
        ago(task.updatedAt, now),
      ].filter(f => f !== '')

      return (
        <Box
          key={`task-${task.id}`}
          flexDirection="column"
          paddingY="xs"
          paddingX="xs"
          backgroundColor={isOpen && isGraphic ? HOVER : undefined}
          hover={isGraphic ? { backgroundColor: HOVER } : undefined}
        >
          <Box flexDirection="row" gap="sm" alignItems="flex-start">
            {mark(statusSvg(task.status), meta.glyph, meta.color, meta.label)}
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Text
                wrap="wrap"
                weight="medium"
                dimColor={task.status === 'done' || task.status === 'cancelled'}
                strikethrough={task.status === 'cancelled'}
              >
                <Text dimColor tabular>{`${task.id}  `}</Text>
                {task.title}
              </Text>
              <Text size="caption" dimColor wrap="wrap">
                <Text color={meta.color}>{meta.label}</Text>
                {`  ·  ${facts.join('  ·  ')}`}
              </Text>
            </Box>
            <Button
              key={`open-${task.id}`}
              plain
              dimColor
              label={isOpen ? '▴' : '▾'}
              onPress={() => toggle(`${target.id}:${task.id}`)}
            />
          </Box>
          {isOpen && taskDetails(target, task)}
        </Box>
      )
    }

    const newTask = (key: string) =>
      Input !== undefined && (
        <Input
          key={key}
          placeholder="Новая задача в план…"
          submitLabel="добавить"
          onSubmit={value => {
            const title = value.trim()
            if (title === '') return
            if (plan === undefined) {
              void act($, (current, at) => startPlan(current, me, 'План работ', undefined, [{ title }], at, USER).work, `added a plan task «${title}»`)
              return
            }
            void planChange(plan, (current, at) => addTasksTo(current, plan.id, [{ title }], at, USER).doc, `added a plan task «${title}»`)
          }}
        />
      )

    const planBody = () => {
      if (plan === undefined) return newTask('new-task-none')
      const visible = plan.tasks.filter(t => !isHiding || (t.status !== 'done' && t.status !== 'cancelled'))
      const phases: { name: string | undefined; tasks: PlanTask[] }[] = []
      for (const task of visible) {
        const group = phases.find(p => p.name === task.phase)
        if (group === undefined) phases.push({ name: task.phase, tasks: [task] })
        else group.tasks.push(task)
      }
      const hasPhases = plan.tasks.some(t => t.phase !== undefined)

      return (
        <Box flexDirection="column" gap="xs">
          {visible.length === 0 && (
            <Text dimColor>{plan.tasks.length === 0 ? 'Задач пока нет.' : 'Все задачи завершены.'}</Text>
          )}
          {phases.map(group => {
            const all = plan.tasks.filter(t => t.phase === group.name)
            const done = all.filter(t => t.status === 'done').length

            return (
              <Box flexDirection="column" gap="xs">
                {hasPhases && heading(group.name ?? 'Прочее', `${done} / ${all.length}`)}
                {group.tasks.map(task => taskRow(plan, task))}
              </Box>
            )
          })}
          <Box paddingTop="sm">{newTask(`new-task-${plan.id}-${plan.seq}`)}</Box>
        </Box>
      )
    }

    // Backlog

    const itemDetails = (item: BacklogItem) => (
      <Box flexDirection="column" gap="sm" paddingLeft={3} paddingTop="xs" paddingBottom="xs">
        {item.detail !== undefined && <Markdown text={item.detail} />}
        {Select !== undefined && (
          <Select
            key={`priority-${item.id}`}
            label="Приоритет"
            value={item.priority}
            options={PRIORITIES.map(p => ({ value: p, label: PRIORITY[p].label }))}
            onSelect={value => {
              const picked = PRIORITIES.find(p => p === value)
              if (picked === undefined || picked === item.priority) return
              void act(
                $,
                (current, at) => patchItems(current, [{ id: item.id, priority: picked }], at, USER, true).doc,
                `priority of backlog [${item.id}] «${item.title}»: ${item.priority} → ${picked}`,
              )
            }}
          />
        )}
        {item.notes.length > 0 && activity(item.notes)}
        {commentField(`comment-${item.id}-${item.notes.length}`, value => {
          const comment = value.trim()
          if (comment === '') return
          void act(
            $,
            (current, at) => patchItems(current, [{ id: item.id, comment }], at, USER, true).doc,
            `comment on backlog [${item.id}] «${item.title}»: ${comment}`,
          )
        })}
        <Box flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap">
          <Button
            key={`promote-${item.id}`}
            variant="primary"
            label={mine === undefined ? 'Начать план с этой задачи' : 'Взять в мой план'}
            onPress={async () => {
              const isDone = await act(
                $,
                (current, at) => {
                  const own = myPlan(current, me)
                  const base = own === undefined ? startPlan(current, me, 'План работ', undefined, [], at, USER) : undefined
                  const target = own ?? base?.plan
                  if (target === undefined) return current

                  return promoteItems(base?.work ?? current, target.id, [item.id], at, USER, true).doc
                },
                `took backlog [${item.id}] «${item.title}» into this session's plan`,
              )
              if (isDone) {
                await setViewing($, null)
                await setView($, 'plan')
              }
            }}
          />
          {asking === item.id ? (
            <>
              <Button
                key={`drop-${item.id}`}
                label="Удалить насовсем"
                onPress={async () => {
                  await act(
                    $,
                    (current, at) => patchItems(current, [{ id: item.id, remove: true }], at, USER, true).doc,
                    `deleted backlog [${item.id}] «${item.title}»`,
                  )
                  await setConfirm($, null)
                }}
              />
              <Button key={`keep-${item.id}`} plain dimColor label="Отмена" onPress={() => setConfirm($, null)} />
            </>
          ) : (
            <Button key={`ask-${item.id}`} plain dimColor label="Удалить" onPress={() => setConfirm($, item.id)} />
          )}
        </Box>
      </Box>
    )

    const itemRow = (item: BacklogItem) => {
      const meta = PRIORITY[item.priority]
      const isOpen = open === item.id
      const comments = item.notes.filter(n => n.status === undefined).length
      const facts = [
        `${item.author === USER ? 'вы' : item.author}, ${ago(item.createdAt, now)}`,
        comments > 0 ? `💬 ${comments}` : '',
      ].filter(f => f !== '')

      return (
        <Box
          key={`item-${item.id}`}
          flexDirection="column"
          paddingY="xs"
          paddingX="xs"
          backgroundColor={isOpen && isGraphic ? HOVER : undefined}
          hover={isGraphic ? { backgroundColor: HOVER } : undefined}
        >
          <Box flexDirection="row" gap="sm" alignItems="flex-start">
            {mark(prioritySvg(item.priority), meta.glyph, meta.color, meta.label)}
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Text wrap="wrap" weight="medium">
                <Text dimColor tabular>{`${item.id}  `}</Text>
                {item.title}
              </Text>
              <Text size="caption" dimColor wrap="wrap">
                {facts.join('  ·  ')}
              </Text>
            </Box>
            <Button
              key={`open-${item.id}`}
              plain
              dimColor
              label={isOpen ? '▴' : '▾'}
              onPress={() => toggle(item.id)}
            />
          </Box>
          {isOpen && itemDetails(item)}
        </Box>
      )
    }

    const backlogBody = () => {
      const groups = PRIORITIES.map(p => ({
        priority: p as BacklogPriority,
        items: sortedItems(work.backlog).filter(i => i.priority === p),
      })).filter(g => g.items.length > 0)

      return (
        <Box flexDirection="column" gap="xs">
          {Input !== undefined && (
            <Input
              key={`new-item-${work.backlog.seq}`}
              placeholder="Добавить в бэклог…"
              submitLabel="добавить"
              onSubmit={value => {
                const title = value.trim()
                if (title === '') return
                void act($, (current, at) => addItems(current, [{ title }], at, USER).doc, `added to the backlog «${title}»`)
              }}
            />
          )}
          {groups.length === 0 && (
            <Text dimColor wrap="wrap">
              Бэклог пуст. Скажите агенту «добавь в бэклог …» или впишите задачу выше: сюда складываются задачи на
              потом, общие для всех сессий проекта.
            </Text>
          )}
          {groups.map(group => (
            <Box flexDirection="column" gap="xs">
              {heading(PRIORITY[group.priority].group, String(group.items.length))}
              {group.items.map(itemRow)}
            </Box>
          ))}
        </Box>
      )
    }

    // Plans of the project

    const planActions = (one: Plan) => (
      <Box flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap" paddingLeft={3} paddingTop="xs">
        <Button
          key={`show-${one.id}`}
          variant="primary"
          label="Открыть"
          onPress={async () => {
            await setViewing($, one.id === mine?.id ? null : one.id)
            await setView($, 'plan')
          }}
        />
        {one.id !== mine?.id && (
          <Button
            key={`join-${one.id}`}
            label="Подключить к этой сессии"
            onPress={async () => {
              if (await act($, (current, at) => attach(current, one.id, me, at))) {
                await setViewing($, null)
                await setView($, 'plan')
              }
            }}
          />
        )}
        {one.archived === true ? (
          asking === `plan:${one.id}` ? (
            <>
              <Button
                key={`erase-${one.id}`}
                label="Удалить насовсем"
                onPress={async () => {
                  await act($, current => removePlan(current, one.id))
                  await setConfirm($, null)
                }}
              />
              <Button key={`spare-${one.id}`} plain dimColor label="Отмена" onPress={() => setConfirm($, null)} />
            </>
          ) : (
            <Button key={`erase-ask-${one.id}`} plain dimColor label="Удалить" onPress={() => setConfirm($, `plan:${one.id}`)} />
          )
        ) : (
          <Button
            key={`shelve-${one.id}`}
            plain
            dimColor
            label="В архив"
            onPress={() => act($, current => setArchived(current, one.id, true))}
          />
        )}
      </Box>
    )

    const planRow = (one: Plan) => {
      const st = stats(one)
      const isOpen = open === `plan:${one.id}`
      const isOwn = one.id === mine?.id

      return (
        <Box
          key={`plan-${one.id}`}
          flexDirection="column"
          paddingY="xs"
          paddingX="xs"
          backgroundColor={isOpen && isGraphic ? HOVER : undefined}
          hover={isGraphic ? { backgroundColor: HOVER } : undefined}
        >
          <Box flexDirection="row" gap="sm" alignItems="flex-start">
            <Box flexDirection="column" flexGrow={1} flexShrink={1} gap="xs">
              <Text wrap="wrap" weight="medium" dimColor={one.archived === true}>
                <Text dimColor tabular>{`${one.id}  `}</Text>
                {one.title}
              </Text>
              <Text size="caption" dimColor wrap="wrap">
                <Text color={isOwn ? ACCENT : undefined}>{owners(one)}</Text>
                {`  ·  ${st.count.done} из ${st.counted} готово  ·  ${ago(one.updatedAt, now)}`}
                {one.inbox.length > 0 ? `  ·  ✉ ${one.inbox.length}` : ''}
              </Text>
              {Svg !== undefined && st.total > 0 && (
                <Svg source={barSvg(st, Math.min(width - 40, 280), 4)} alt={`${st.percent}% готово`} />
              )}
            </Box>
            <Button
              key={`open-plan-${one.id}`}
              plain
              dimColor
              label={isOpen ? '▴' : '▾'}
              onPress={() => toggle(`plan:${one.id}`)}
            />
          </Box>
          {isOpen && planActions(one)}
        </Box>
      )
    }

    const plansBody = () => {
      const ordered = [...openPlans].sort((a, b) =>
        a.id === mine?.id ? -1 : b.id === mine?.id ? 1 : b.updatedAt - a.updatedAt,
      )

      return (
        <Box flexDirection="column" gap="xs">
          <Text dimColor wrap="wrap" size="caption">
            У каждой сессии проекта свой план; бэклог общий. Откройте план, чтобы посмотреть его, или подключите к этой
            сессии, чтобы её агент продолжил его.
          </Text>
          {heading('Открытые планы', String(openPlans.length))}
          {ordered.length === 0 && <Text dimColor>Открытых планов нет.</Text>}
          {ordered.map(planRow)}
          {archived.length > 0 && (
            <Box paddingTop="sm">
              <Button
                key="toggle-archive"
                plain
                dimColor
                label={`${snap.isShowingArchive ? '▴' : '▾'} Архив · ${archived.length}`}
                onPress={() => toggleArchive($)}
              />
            </Box>
          )}
          {snap.isShowingArchive && [...archived].sort((a, b) => b.updatedAt - a.updatedAt).map(planRow)}
        </Box>
      )
    }

    // Footer

    const waiting = (plan?.inbox.length ?? 0) + snap.inbox.length
    const footer = (
      <Box flexDirection="column" gap="xs" paddingTop="sm">
        {known.error !== null && (
          <Text size="caption" color={STATUS.blocked.color} wrap="wrap">
            {`${FILE} не читается: ${known.error}. Показана последняя версия; изменения сохранятся, когда файл исправят.`}
          </Text>
        )}
        {waiting > 0 && (
          <Text size="caption" color={STATUS.review.color} wrap="wrap">
            {isMine || plan === undefined
              ? `Агент увидит ваши изменения (${waiting}) со следующим сообщением.`
              : `Агент сессии этого плана увидит ваши изменения (${waiting}) при следующем обращении к плану.`}
          </Text>
        )}
        <Text size="caption" dimColor>
          {FILE}
        </Text>
      </Box>
    )

    const body = tab === 'plans' ? plansBody() : tab === 'backlog' ? backlogBody() : planBody()

    return (
      <Box flexDirection="column" gap="md" paddingX="xs">
        {header}
        {progress}
        {tabs}
        {body}
        {footer}
      </Box>
    )
  })
}
