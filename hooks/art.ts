import type { BacklogPriority, PlanStatus } from '../types'
import { PRIORITY, STATUS, type Stats } from './model'

/** Order of the segments in the progress bar. */
const BAR_ORDER: readonly PlanStatus[] = ['done', 'review', 'in_progress', 'blocked', 'todo', 'cancelled']

/** A warm grey that reads as a quiet line on a light and on a dark background. */
const LINE = '#A8A29E'

function svg(width: number, height: number, body: string, isCrisp = true): string {
  const rendering = isCrisp ? ' shape-rendering="crispEdges"' : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"${rendering}>${body}</svg>`
}

/** The plan's progress: one flat bar, a square segment per status, no rounding. */
export function barSvg(stats: Stats, width: number, height = 6): string {
  const W = Math.max(40, Math.round(width))
  const H = height
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="${LINE}" fill-opacity="0.22"/>`]
  if (stats.total > 0) {
    const shown = BAR_ORDER.filter(s => stats.count[s] > 0)
    let x = 0
    shown.forEach((status, i) => {
      const w = (W * stats.count[status]) / stats.total
      const gap = i < shown.length - 1 ? 2 : 0
      const opacity = status === 'cancelled' ? ' fill-opacity="0.55"' : ''
      parts.push(
        `<rect x="${x.toFixed(1)}" width="${Math.max(0, w - gap).toFixed(1)}" height="${H}" fill="${STATUS[status].color}"${opacity}/>`,
      )
      x += w
    })
  }

  return svg(W, H, parts.join(''))
}

/** A hairline under a section heading. */
export function ruleSvg(width: number): string {
  const W = Math.max(120, Math.round(width))

  return svg(W, 1, `<rect width="${W}" height="1" fill="${LINE}" fill-opacity="0.35"/>`)
}

/** A 14-pixel square status mark. */
export function statusSvg(status: PlanStatus): string {
  const c = STATUS[status].color
  const frame = `<rect x="1.75" y="1.75" width="10.5" height="10.5" fill="none" stroke="${c}" stroke-width="1.5"/>`
  const marks: Record<PlanStatus, string> = {
    todo: frame,
    in_progress: `${frame}<rect x="4" y="4" width="3" height="6" fill="${c}"/>`,
    review: `${frame}<rect x="4" y="4" width="6" height="6" fill="${c}"/>`,
    blocked: `<rect x="1" y="1" width="12" height="12" fill="${c}"/><rect x="3.5" y="6.25" width="7" height="1.5" fill="#FFFFFF"/>`,
    done: `<rect x="1" y="1" width="12" height="12" fill="${c}"/><path d="M3.8 7.2 L6 9.4 L10.3 4.9" stroke="#FFFFFF" stroke-width="1.6" fill="none" stroke-linecap="square"/>`,
    cancelled: `${frame}<path d="M4.5 9.5 L9.5 4.5" stroke="${c}" stroke-width="1.5"/>`,
  }

  return svg(14, 14, marks[status], false)
}

/** A 14-pixel priority mark: three bars, as many lit as the priority is high. */
export function prioritySvg(priority: BacklogPriority): string {
  const lit = priority === 'high' ? 3 : priority === 'normal' ? 2 : 1
  const c = PRIORITY[priority].color
  const bars = [0, 1, 2]
    .map(i => {
      const h = 4 + i * 3.5
      const isLit = i < lit

      return `<rect x="${1 + i * 4.5}" y="${13 - h}" width="3" height="${h}" fill="${isLit ? c : LINE}" fill-opacity="${isLit ? 1 : 0.35}"/>`
    })
    .join('')

  return svg(14, 14, bars)
}
