import { asc, eq, lt } from 'drizzle-orm'
import { toIsoDate } from '../../shared/dates.ts'
import { newId } from '../../shared/id.ts'
import type { EventBody, EventDTO, OccurrenceDTO, Recurrence } from '../../shared/types.ts'
import { db } from '../db/client.ts'
import { events } from '../db/schema.ts'
import { notFound } from './validate.ts'

// Calendar events. A recurring event is stored once and expanded into its occurrences when a range is read: daily,
// weekly or monthly from its start (a monthly one on the 31st skips months without one), up to `until` if set.

type Row = typeof events.$inferSelect

const toDTO = ({ createdAt: _c, updatedAt: _u, ...r }: Row): EventDTO => r

/** Steps a local time by `n` periods of the recurrence, keeping the wall-clock time across DST. */
function step(t: number, recurrence: Recurrence, n: number): number {
  const d = new Date(t)
  if (recurrence === 'daily') d.setDate(d.getDate() + n)
  else if (recurrence === 'weekly') d.setDate(d.getDate() + 7 * n)
  else if (recurrence === 'monthly') {
    const day = d.getDate()
    d.setDate(1)
    d.setMonth(d.getMonth() + n)
    // A month without that day (Feb 30th): no occurrence.
    if (new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() < day) return NaN
    d.setDate(day)
  }
  return d.getTime()
}

// Enough for a few years of daily repeats in one view.
const MAX_OCCURRENCES = 2000

/** The occurrences of an event that overlap [from, to). */
export function occurrences(e: EventDTO, from: number, to: number): OccurrenceDTO[] {
  const length = e.endAt - e.startAt
  const occ = (startAt: number): OccurrenceDTO => ({ eventId: e.id, title: e.title, startAt, endAt: startAt + length, allDay: e.allDay, location: e.location, recurring: e.recurrence !== 'none' })
  if (e.recurrence === 'none') return e.startAt < to && e.endAt > from ? [occ(e.startAt)] : []
  const until = e.until ? new Date(e.until + 'T00:00:00').getTime() + 86_400_000 : Infinity
  const out: OccurrenceDTO[] = []
  for (let i = 0; out.length < MAX_OCCURRENCES; i++) {
    const start = step(e.startAt, e.recurrence, i)
    if (Number.isNaN(start)) continue
    if (start >= to || start >= until) break
    if (start + length > from) out.push(occ(start))
  }
  return out
}

export function listEvents(): EventDTO[] {
  return db.select().from(events).orderBy(asc(events.startAt)).all().map(toDTO)
}

/** Every occurrence overlapping [from, to), in time order. */
export function occurrencesBetween(from: number, to: number): OccurrenceDTO[] {
  return db
    .select()
    .from(events)
    .where(lt(events.startAt, to))
    .all()
    .flatMap((r) => occurrences(toDTO(r), from, to))
    .sort((a, b) => a.startAt - b.startAt)
}

const row = (id: string) => db.select().from(events).where(eq(events.id, id)).get() ?? notFound('event')

export function createEvent(b: EventBody): EventDTO {
  const now = Date.now()
  const r = { id: newId(), ...b, createdAt: now, updatedAt: now }
  db.insert(events).values(r).run()
  return toDTO(r)
}

export function updateEvent(id: string, b: Partial<EventBody>): EventDTO {
  row(id)
  db.update(events)
    .set({ ...b, updatedAt: Date.now() })
    .where(eq(events.id, id))
    .run()
  return toDTO(row(id))
}

export function deleteEvent(id: string) {
  row(id)
  db.delete(events).where(eq(events.id, id)).run()
}

/** The next `limit` occurrences from now (the dashboard's "coming up"). */
export function upcoming(limit: number, now = Date.now()): OccurrenceDTO[] {
  return occurrencesBetween(now, now + 60 * 86_400_000).slice(0, limit)
}

/** Local day of an occurrence's start, for grouping. */
export const dayOf = (o: OccurrenceDTO) => toIsoDate(new Date(o.startAt))
