import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { isIsoDate } from '../../shared/dates.ts'
import type { EventBody, Recurrence } from '../../shared/types.ts'
import { createEvent, deleteEvent, listEvents, occurrencesBetween, upcoming, updateEvent } from '../lib/calendar.ts'
import { bad, defined, num, obj, optBool, optStr, str, type Obj } from '../lib/validate.ts'

const RECURRENCES: Recurrence[] = ['none', 'daily', 'weekly', 'monthly']
const DAY_MS = 86_400_000

function recurrence(o: Obj): Recurrence | undefined {
  const v = o.recurrence
  if (v === undefined) return undefined
  if (!RECURRENCES.includes(v as Recurrence)) bad(`recurrence is one of ${RECURRENCES.join(', ')}`)
  return v as Recurrence
}

function until(o: Obj): string | null | undefined {
  const v = o.until
  if (v === undefined || v === null) return v
  if (typeof v !== 'string' || !isIsoDate(v)) bad('until must be a YYYY-MM-DD date or null')
  return v
}

function body(o: Obj, partial: boolean): Partial<EventBody> {
  const b = defined({
    title: o.title === undefined && partial ? undefined : str(o, 'title').trim() || bad('An event needs a title'),
    startAt: o.startAt === undefined && partial ? undefined : num(o, 'startAt'),
    endAt: o.endAt === undefined && partial ? undefined : num(o, 'endAt'),
    allDay: optBool(o, 'allDay'),
    location: optStr(o, 'location'),
    notes: optStr(o, 'notes'),
    recurrence: recurrence(o),
    until: until(o),
  })
  if (b.startAt !== undefined && b.endAt !== undefined && b.endAt < b.startAt) bad('An event ends after it starts')
  return b
}

export const calendarRoutes = new Hono()
  .get('/events', (c) => c.json({ events: listEvents() }))
  // Occurrences overlapping [from, to) (epoch ms), recurring events expanded.
  .get('/events/occurrences', (c) => {
    const from = Number(c.req.query('from'))
    const to = Number(c.req.query('to'))
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) bad('from and to must be epoch ms, from < to')
    if (to - from > 400 * DAY_MS) bad('range too long')
    return c.json({ occurrences: occurrencesBetween(from, to) })
  })
  .get('/events/upcoming', (c) => c.json({ occurrences: upcoming(Math.min(50, Number(c.req.query('limit')) || 5)) }))
  .post(
    '/events',
    validator('json', (v) => ({ allDay: false, location: '', notes: '', recurrence: 'none', until: null, ...body(obj(v), false) }) as EventBody),
    (c) => c.json(createEvent(c.req.valid('json'))),
  )
  .patch(
    '/events/:id',
    validator('json', (v) => body(obj(v), true)),
    (c) => c.json(updateEvent(c.req.param('id'), c.req.valid('json'))),
  )
  .delete('/events/:id', (c) => {
    deleteEvent(c.req.param('id'))
    return c.json({ ok: true })
  })
