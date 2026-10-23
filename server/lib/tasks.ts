import { and, asc, eq, gte, isNotNull, lt, lte, sql } from 'drizzle-orm'
import { shiftDate, toIsoDate } from '../../shared/dates.ts'
import { between, newId } from '../../shared/id.ts'
import type { ProgressItem, ProgressNoteDTO, ProjectDTO, TaskDTO } from '../../shared/types.ts'
import { db } from '../db/client.ts'
import { progressNotes, projects, tasks } from '../db/schema.ts'
import { notFound } from './validate.ts'

// Tasks: bullet lists of tasks, one per project. A task is done once ticked (doneAt); Progress shows, per project and
// day, the tasks done that day and the progress notes written for it.

type TaskRow = typeof tasks.$inferSelect

const toTask = (t: TaskRow): TaskDTO => ({ id: t.id, projectId: t.projectId, text: t.text, done: t.doneAt != null, doneAt: t.doneAt, indent: t.indent, position: t.position, due: t.due })

export function listProjects(): ProjectDTO[] {
  return db.select({ id: projects.id, title: projects.title, color: projects.color, archived: projects.archived, position: projects.position }).from(projects).orderBy(asc(projects.position)).all()
}

const projectRow = (id: string) => db.select().from(projects).where(eq(projects.id, id)).get() ?? notFound('project')

export function createProject(title: string, color: string | null = null): ProjectDTO {
  const last = db.select({ p: sql<number | null>`max(${projects.position})` }).from(projects).get()
  const row = { id: newId(), title, color, archived: false, position: (last?.p ?? 0) + 1, createdAt: Date.now() }
  db.insert(projects).values(row).run()
  return { id: row.id, title, color, archived: false, position: row.position }
}

export function updateProject(id: string, patch: Partial<Pick<ProjectDTO, 'title' | 'color' | 'archived' | 'position'>>): ProjectDTO {
  projectRow(id)
  if (Object.keys(patch).length) db.update(projects).set(patch).where(eq(projects.id, id)).run()
  return listProjects().find((p) => p.id === id)!
}

export function deleteProject(id: string) {
  projectRow(id)
  db.delete(projects).where(eq(projects.id, id)).run()
}

export function listTasks(projectId?: string): TaskDTO[] {
  return db
    .select()
    .from(tasks)
    .where(projectId ? eq(tasks.projectId, projectId) : undefined)
    .orderBy(asc(tasks.projectId), asc(tasks.position))
    .all()
    .map(toTask)
}

const taskRow = (id: string) => db.select().from(tasks).where(eq(tasks.id, id)).get() ?? notFound('task')

/** A task at the end of its project, or right after `afterId` (taking its indent unless given). */
export function createTask(b: { projectId: string; text: string; afterId?: string; indent?: number; due?: string | null }): TaskDTO {
  projectRow(b.projectId)
  const siblings = listTasks(b.projectId)
  const i = b.afterId ? siblings.findIndex((t) => t.id === b.afterId) : -1
  const prev = i >= 0 ? siblings[i] : siblings.at(-1)
  const next = i >= 0 ? siblings[i + 1] : undefined
  const now = Date.now()
  const row = { id: newId(), projectId: b.projectId, text: b.text, doneAt: null, indent: b.indent ?? (i >= 0 ? prev!.indent : 0), position: between(prev?.position, next?.position), due: b.due ?? null, createdAt: now, updatedAt: now }
  db.insert(tasks).values(row).run()
  return toTask(row)
}

export function updateTask(id: string, patch: { text?: string; done?: boolean; indent?: number; due?: string | null; projectId?: string; position?: number }): TaskDTO {
  const before = taskRow(id)
  const { done, ...cols } = patch
  const doneAt = done === undefined ? before.doneAt : done ? (before.doneAt ?? Date.now()) : null
  db.update(tasks)
    .set({ ...cols, doneAt, updatedAt: Date.now() })
    .where(eq(tasks.id, id))
    .run()
  return toTask(taskRow(id))
}

export function deleteTask(id: string) {
  taskRow(id)
  db.delete(tasks).where(eq(tasks.id, id)).run()
}

// ── progress ───────────────────────────────────────────────────────────────

export function addProgressNote(projectId: string, date: string, text: string): ProgressNoteDTO {
  projectRow(projectId)
  const row = { id: newId(), projectId, date, text, createdAt: Date.now() }
  db.insert(progressNotes).values(row).run()
  return { id: row.id, projectId, date, text }
}

export function deleteProgressNote(id: string) {
  db.select({ id: progressNotes.id }).from(progressNotes).where(eq(progressNotes.id, id)).get() ?? notFound('progress note')
  db.delete(progressNotes).where(eq(progressNotes.id, id)).run()
}

const localMidnight = (date: string) => new Date(date + 'T00:00:00').getTime()

/** Everything done in [from, to] (or ever, without a range): tasks by the day they were ticked, notes by their day. */
export function progressItems(from?: string, to?: string): ProgressItem[] {
  const done = db
    .select()
    .from(tasks)
    .where(and(isNotNull(tasks.doneAt), from ? gte(tasks.doneAt, localMidnight(from)) : undefined, to ? lt(tasks.doneAt, localMidnight(shiftDate(to, 1))) : undefined))
    .all()
  const notes = db
    .select()
    .from(progressNotes)
    .where(and(from ? gte(progressNotes.date, from) : undefined, to ? lte(progressNotes.date, to) : undefined))
    .all()
  return [
    ...done.map((t): ProgressItem => ({ projectId: t.projectId, date: toIsoDate(new Date(t.doneAt!)), kind: 'task', id: t.id, text: t.text })),
    ...notes.map((n): ProgressItem => ({ projectId: n.projectId, date: n.date, kind: 'note', id: n.id, text: n.text })),
  ]
}
