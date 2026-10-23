import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { isIsoDate } from '../../shared/dates.ts'
import { addProgressNote, createProject, createTask, deleteProgressNote, deleteProject, deleteTask, listProjects, listTasks, progressItems, updateProject, updateTask } from '../lib/tasks.ts'
import { bad, date, defined, obj, optBool, optNum, optStr, str, type Obj } from '../lib/validate.ts'

const MAX_INDENT = 6

const title = (o: Obj) => str(o, 'title').trim() || bad('A project needs a title')

function indent(o: Obj): number | undefined {
  const n = optNum(o, 'indent')
  if (n !== undefined && (!Number.isInteger(n) || n < 0 || n > MAX_INDENT)) bad(`indent is 0 to ${MAX_INDENT}`)
  return n
}

function due(o: Obj): string | null | undefined {
  const v = o.due
  if (v === undefined || v === null) return v
  if (typeof v !== 'string' || !isIsoDate(v)) bad('due must be a YYYY-MM-DD date or null')
  return v
}

export const taskRoutes = new Hono()
  .get('/projects', (c) => c.json({ projects: listProjects() }))
  .post(
    '/projects',
    validator('json', (v) => {
      const o = obj(v)
      return { title: title(o), color: optStr(o, 'color') ?? null }
    }),
    (c) => {
      const b = c.req.valid('json')
      return c.json(createProject(b.title, b.color))
    },
  )
  .patch(
    '/projects/:id',
    validator('json', (v): { title?: string; color?: string; archived?: boolean; position?: number } => {
      const o = obj(v)
      return defined({ title: o.title === undefined ? undefined : title(o), color: optStr(o, 'color'), archived: optBool(o, 'archived'), position: optNum(o, 'position') })
    }),
    (c) => c.json(updateProject(c.req.param('id'), c.req.valid('json'))),
  )
  .delete('/projects/:id', (c) => {
    deleteProject(c.req.param('id'))
    return c.json({ ok: true })
  })
  .get('/tasks', (c) => c.json({ tasks: listTasks(c.req.query('project')) }))
  .post(
    '/tasks',
    validator('json', (v): { projectId: string; text: string; afterId?: string; indent?: number; due?: string | null } => {
      const o = obj(v)
      return defined({ projectId: str(o, 'projectId'), text: str(o, 'text'), afterId: optStr(o, 'afterId'), indent: indent(o), due: due(o) })
    }),
    (c) => c.json(createTask(c.req.valid('json'))),
  )
  .patch(
    '/tasks/:id',
    validator('json', (v): { text?: string; done?: boolean; indent?: number; due?: string | null; projectId?: string; position?: number } => {
      const o = obj(v)
      return defined({ text: optStr(o, 'text'), done: optBool(o, 'done'), indent: indent(o), due: due(o), projectId: optStr(o, 'projectId'), position: optNum(o, 'position') })
    }),
    (c) => c.json(updateTask(c.req.param('id'), c.req.valid('json'))),
  )
  .delete('/tasks/:id', (c) => {
    deleteTask(c.req.param('id'))
    return c.json({ ok: true })
  })
  // Tasks done and progress notes, per project and day (Progress tab); from/to are optional YYYY-MM-DD.
  .get('/progress', (c) => {
    const from = c.req.query('from')
    const to = c.req.query('to')
    if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) bad('from and to must be YYYY-MM-DD')
    return c.json({ items: progressItems(from, to) })
  })
  .post(
    '/progress/notes',
    validator('json', (v) => {
      const o = obj(v)
      return { projectId: str(o, 'projectId'), date: date(o, 'date'), text: str(o, 'text').trim() || bad('A note needs text') }
    }),
    (c) => {
      const b = c.req.valid('json')
      return c.json(addProgressNote(b.projectId, b.date, b.text))
    },
  )
  .delete('/progress/notes/:id', (c) => {
    deleteProgressNote(c.req.param('id'))
    return c.json({ ok: true })
  })
