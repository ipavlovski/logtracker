import { useMemo, useState } from 'react'
import { formatJournalDate, shiftDate, toIsoDate, today } from '../../../shared/dates.ts'
import type { EventBody, EventDTO, OccurrenceDTO, Recurrence } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import { useFetch } from '../../hooks/useFetch.ts'
import { notify } from '../../state/ui.ts'
import { Modal, ModalActions } from '../Modal/Modal.tsx'
import tab from '../Tab/Tab.module.css'
import styles from './Calendar.module.css'

// The Calendar tab: a month of events (recurring ones expanded by the server), the picked day's agenda next to it,
// and an editor for adding, changing and deleting events. Double-click a day to add an event on it.

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const midnight = (date: string) => new Date(date + 'T00:00:00').getTime()
const time = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** The six weeks shown for a month, Monday first. */
function monthGrid(month: string): string[] {
  const first = `${month}-01`
  const offset = (new Date(first + 'T12:00:00').getDay() + 6) % 7
  const start = shiftDate(first, -offset)
  return Array.from({ length: 42 }, (_, i) => shiftDate(start, i))
}

const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Days an occurrence covers (an all-day event ends at a midnight, which isn't its day). */
function daysOf(o: OccurrenceDTO): string[] {
  const out: string[] = []
  const last = toIsoDate(new Date(Math.max(o.startAt, o.endAt - 1)))
  for (let d = toIsoDate(new Date(o.startAt)); d <= last && out.length < 62; d = shiftDate(d, 1)) out.push(d)
  return out
}

export function Calendar() {
  const [month, setMonth] = useState(today().slice(0, 7))
  const [picked, setPicked] = useState(today())
  const [editing, setEditing] = useState<EventDTO | { date: string } | null>(null)
  const [bump, setBump] = useState(0)
  const days = useMemo(() => monthGrid(month), [month])
  const from = midnight(days[0]!)
  const to = midnight(shiftDate(days.at(-1)!, 1))
  const occ = useFetch(`occ|${from}|${bump}`, (signal) => unwrap(api.events.occurrences.$get({ query: { from: String(from), to: String(to) } }, { init: { signal } })))
  const all = useFetch(`events|${bump}`, (signal) => unwrap(api.events.$get({}, { init: { signal } })))

  const byDay = useMemo(() => {
    const m = new Map<string, OccurrenceDTO[]>()
    for (const o of occ.data?.occurrences ?? []) for (const d of daysOf(o)) m.set(d, [...(m.get(d) ?? []), o])
    return m
  }, [occ.data])
  const edit = (o: OccurrenceDTO) => {
    const e = all.data?.events.find((x) => x.id === o.eventId)
    if (e) setEditing(e)
  }
  const t = today()

  return (
    <div className={tab.frame}>
      <header className={tab.header}>
        <h2>Calendar</h2>
        <div className={tab.row}>
          <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
            ‹
          </button>
          <b className={styles.month}>{new Date(month + '-01T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b>
          <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
            ›
          </button>
          <button
            onClick={() => {
              setMonth(t.slice(0, 7))
              setPicked(t)
            }}
          >
            Today
          </button>
        </div>
        <span className={tab.spacer} />
        <button className={tab.primary} onClick={() => setEditing({ date: picked })}>
          + event
        </button>
      </header>
      <div className={`${tab.body} ${tab.columns}`}>
        <div>
          {occ.error && <p className={tab.error}>{occ.error.message}</p>}
          <div className={styles.grid}>
            {WEEKDAYS.map((w) => (
              <div key={w} className={styles.weekday}>
                {w}
              </div>
            ))}
            {days.map((d) => (
              <button
                key={d}
                className={`${styles.day} ${d.slice(0, 7) !== month ? styles.other : ''} ${d === t ? styles.today : ''} ${d === picked ? styles.picked : ''}`}
                onClick={() => setPicked(d)}
                onDoubleClick={() => setEditing({ date: d })}
              >
                <span className={styles.num}>{Number(d.slice(8))}</span>
                {(byDay.get(d) ?? []).slice(0, 3).map((o) => (
                  <span key={`${o.eventId}|${o.startAt}`} className={styles.chip} title={o.title}>
                    {!o.allDay && <i>{time(o.startAt)}</i>} {o.title}
                  </span>
                ))}
                {(byDay.get(d)?.length ?? 0) > 3 && <span className={styles.more}>+{byDay.get(d)!.length - 3} more</span>}
              </button>
            ))}
          </div>
        </div>
        <section className={tab.card}>
          <h3>{formatJournalDate(picked)}</h3>
          {!(byDay.get(picked) ?? []).length ? (
            <p className={tab.empty}>Nothing on this day. Double-click a day to add an event.</p>
          ) : (
            <ul className={styles.agenda}>
              {byDay.get(picked)!.map((o) => (
                <li key={`${o.eventId}|${o.startAt}`}>
                  <button onClick={() => edit(o)}>
                    <span className={styles.when}>{o.allDay ? 'all day' : `${time(o.startAt)}–${time(o.endAt)}`}</span>
                    <span>
                      {o.title}
                      {o.recurring && <span className={tab.muted}> ↻</span>}
                      {o.location && <span className={tab.muted}> · {o.location}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {editing && <EventEditor initial={editing} onClose={() => setEditing(null)} onSaved={() => setBump((n) => n + 1)} />}
    </div>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')
const localInput = (t: number) => {
  const d = new Date(t)
  return `${toIsoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function EventEditor({ initial, onClose, onSaved }: { initial: EventDTO | { date: string }; onClose: () => void; onSaved: () => void }) {
  const existing = 'id' in initial ? initial : null
  const startDefault = existing ? existing.startAt : midnight((initial as { date: string }).date) + 9 * 3_600_000
  const [title, setTitle] = useState(existing?.title ?? '')
  const [allDay, setAllDay] = useState(existing?.allDay ?? false)
  const [start, setStart] = useState(localInput(startDefault))
  const [end, setEnd] = useState(localInput(existing ? existing.endAt : startDefault + 3_600_000))
  const [location, setLocation] = useState(existing?.location ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [recurrence, setRecurrence] = useState<Recurrence>(existing?.recurrence ?? 'none')
  const [until, setUntil] = useState(existing?.until ?? '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    let startAt = new Date(start).getTime()
    let endAt = new Date(end).getTime()
    if (allDay) {
      startAt = midnight(start.slice(0, 10))
      endAt = midnight(shiftDate(end.slice(0, 10), 1))
    }
    const body: EventBody = { title, startAt, endAt, allDay, location, notes, recurrence, until: recurrence !== 'none' && until ? until : null }
    setBusy(true)
    try {
      if (existing) await unwrap(api.events[':id'].$patch({ param: { id: existing.id }, json: body }))
      else await unwrap(api.events.$post({ json: body }))
      onSaved()
      onClose()
    } catch (err) {
      notify((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const del = async () => {
    if (!existing || !confirm(`Delete “${existing.title}”${existing.recurrence !== 'none' ? ' and all its repeats' : ''}?`)) return
    await unwrap(api.events[':id'].$delete({ param: { id: existing.id } })).then(onSaved, (err: Error) => notify(err.message))
    onClose()
  }

  return (
    <Modal title={existing ? 'Edit event' : 'New event'} onClose={onClose}>
      <div className={`${tab.form} ${styles.editor}`}>
        <label className={tab.wide}>
          Title
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        </label>
        <label>
          <span>
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> all day
          </span>
        </label>
        <label>
          Starts
          <input type={allDay ? 'date' : 'datetime-local'} value={allDay ? start.slice(0, 10) : start} onChange={(e) => setStart(allDay ? `${e.target.value}T09:00` : e.target.value)} />
        </label>
        <label>
          Ends
          <input type={allDay ? 'date' : 'datetime-local'} value={allDay ? end.slice(0, 10) : end} onChange={(e) => setEnd(allDay ? `${e.target.value}T10:00` : e.target.value)} />
        </label>
        <label>
          Repeats
          <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
            <option value="none">never</option>
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
            <option value="monthly">monthly</option>
          </select>
        </label>
        {recurrence !== 'none' && (
          <label>
            Until
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
        )}
        <label className={tab.wide}>
          Location
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label className={styles.notes}>
          Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <ModalActions>
        {existing && (
          <button onClick={del} data-danger>
            Delete
          </button>
        )}
        <button onClick={onClose}>Cancel</button>
        <button data-primary onClick={save} disabled={busy || !title.trim()}>
          {existing ? 'Save' : 'Add'}
        </button>
      </ModalActions>
    </Modal>
  )
}
