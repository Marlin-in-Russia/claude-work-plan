export type PlanStatus = 'todo' | 'in_progress' | 'review' | 'blocked' | 'done' | 'cancelled'

export type BacklogPriority = 'high' | 'normal' | 'low'

/** One entry of a task's activity: a comment, or a status change (`status` set). */
export type PlanNote = {
  at: number
  author: string
  isUser: boolean
  text: string
  status?: PlanStatus
}

export type PlanTask = {
  id: string
  title: string
  detail?: string
  phase?: string
  status: PlanStatus
  owner?: string
  notes: PlanNote[]
  createdAt: number
  updatedAt: number
}

/** A session working on a plan, and when it last touched it. */
export type PlanSession = { id: string; at: number }

export type Plan = {
  id: string
  title: string
  goal?: string
  tasks: PlanTask[]
  seq: number
  /** The sessions working on it; none for a plan nobody has open. */
  sessions: PlanSession[]
  /** What the person changed in a panel, waiting for the agent of a session on this plan. */
  inbox: string[]
  archived?: boolean
  createdAt: number
  updatedAt: number
}

export type BacklogItem = {
  id: string
  title: string
  detail?: string
  priority: BacklogPriority
  author: string
  notes: PlanNote[]
  createdAt: number
  updatedAt: number
}

export type Backlog = { seq: number; items: BacklogItem[] }

/** What the project file holds: every session's plan and the shared backlog. */
export type WorkDoc = { plans: Plan[]; planSeq: number; backlog: Backlog }

/** The project file as last read: where, its mtime, and why it did not parse. */
export type WorkFile = { path: string; mtime: number; error: string | null }

export type PlanView = 'plan' | 'backlog' | 'plans'

declare module 'claude-code' {
  interface PluginState {
    'work-plan': {
      /** Shaped: a reload whose code reads another format finds it absent and reads the file again. */
      doc: Shaped<WorkDoc>
      file: Shaped<WorkFile>
      view: PlanView
      viewing: string | null
      hideDone: boolean
      showArchive: boolean
      expanded: string | null
      confirm: string | null
      inbox: string[]
    }
  }
}
