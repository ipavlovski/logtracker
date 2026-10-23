import { useMemo, type ReactNode } from 'react'
import { dayBounds, union, type ActivitySpansDTO } from '../../../shared/activity.ts'
import { formatJournalDate, shiftDate, today, weekday } from '../../../shared/dates.ts'
import type { DayCount } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import { useFetch, useTicker } from '../../hooks/useFetch.ts'
import { openDay } from '../../state/day.ts'
import { openTab } from '../../state/ui.ts'
import { Heatmap } from '../Heatmap/Heatmap.tsx'
import { duration, km } from '../Map/kinds.ts'
import styles from './Dashboard.module.css'

// The dashboard: today's report, as charts. Computer activity and travel for today and the 6 days before it; up to a
// year of AI prompts, web pages and YouTube videos as heatmaps (as many weeks as fit); then tasks done this week, what's
// coming up in the calendar and this month's spending. Click a day to open it in Activity or Map. The day's checklists
// are their own tab.

const WEEK = 7
const YEAR_DAYS = 371 // 53 weeks, the most a heatmap shows
const REFRESH_MS = 60_000

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`
const countMap = (days: DayCount[] | undefined) => new Map(days?.map((d) => [d.date, d.count]))

export function Dashboard() {
  const tick = useTicker(REFRESH_MS)
  // A new day rolls the report over (the ticker re-renders, today() moves on).
  const end = today()
  const first = shiftDate(end, -(WEEK - 1))
  const week = useMemo(() => Array.from({ length: WEEK }, (_, i) => shiftDate(first, i)), [first])

  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        <h2>Today</h2>
        <span className={styles.muted}>
          {weekday(end)}, {formatJournalDate(end)}
        </span>
        <button className={styles.more} onClick={() => openTab('checklists')}>
          checklists →
        </button>
      </header>
      {/* The week bar charts on top, the year heatmaps under them (they narrow down to a few weeks), then the rest. */}
      <div className={styles.grid}>
        <ActivityCard week={week} tick={tick} />
        <TravelCard week={week} tick={tick} />
      </div>
      <div className={styles.grid3}>
        <Heatmaps end={end} tick={tick} />
      </div>
      <div className={styles.grid3}>
        <TasksCard week={week} tick={tick} />
        <UpcomingCard tick={tick} />
        <SpendingCard end={end} tick={tick} />
      </div>
    </div>
  )
}

function ActivityCard({ week, tick }: { week: string[]; tick: number }) {
  const from = dayBounds(week[0]!)[0]
  const to = dayBounds(week.at(-1)!)[1]
  const { data, error } = useFetch<ActivitySpansDTO>(`dash-activity|${from}|${to}|${tick}`, (signal) =>
    unwrap(api.activity.spans.$get({ query: { from: String(from), to: String(to) } }, { init: { signal } })),
  )
  const values = useMemo(
    () =>
      week.map((date) => {
        const [start, end] = dayBounds(date)
        return union(data?.input ?? [], start, end).reduce((n, s) => n + s.endAt - s.startAt, 0)
      }),
    [data, week],
  )
  const empty = !!data && !values.some(Boolean)

  return (
    <Card
      title="Computer activity"
      note={data && !data.recording ? 'not recording' : undefined}
      value={data ? duration(values.at(-1)!) : '—'}
      sub={data ? `${duration(values.reduce((a, b) => a + b, 0))} in 7 days` : ''}
      error={error?.message}
      empty={empty ? 'No activity recorded this week. The desktop app records keyboard and mouse activity while it runs.' : undefined}
    >
      {data && <WeekBars week={week} values={values} label={(ms) => (ms ? duration(ms) : 'none')} onPick={(d) => openDay(d, 'activity')} />}
    </Card>
  )
}

function TravelCard({ week, tick }: { week: string[]; tick: number }) {
  const { data, error } = useFetch(`dash-travel|${week[0]}|${tick}`, (signal) =>
    unwrap(api.gps.travel.$get({ query: { from: week[0]!, to: week.at(-1)! } }, { init: { signal } })),
  )
  const byDate = new Map(data?.days.map((d) => [d.date, d]))
  const todays = byDate.get(week.at(-1)!)
  const total = data?.days.reduce((n, d) => n + d.distanceM, 0) ?? 0

  return (
    <Card
      title="Travel"
      value={!data ? '—' : todays ? km(todays.distanceM) : 'no GPS'}
      sub={data ? `${todays ? `${duration(todays.movingMs)} moving · ` : ''}${km(total)} in 7 days` : ''}
      error={error?.message}
      empty={data && !data.days.length ? 'No GPS data this week. GPS files are imported in the Map tab.' : undefined}
    >
      {data && (
        <WeekBars
          week={week}
          values={week.map((d) => byDate.get(d)?.distanceM ?? 0)}
          onPick={(d) => openDay(d, 'map')}
          label={(m, date) => {
            const d = byDate.get(date)
            return !d ? 'no GPS data' : `${km(m)} · ${duration(d.movingMs)} moving`
          }}
        />
      )}
    </Card>
  )
}

function Heatmaps({ end, tick }: { end: string; tick: number }) {
  const from = shiftDate(end, -(YEAR_DAYS - 1))
  const prompts = useFetch(`dash-prompts|${from}|${tick}`, (signal) => unwrap(api.digital.ai['prompt-days'].$get({ query: { from } }, { init: { signal } })))
  const pages = useFetch(`dash-pages|${from}|${tick}`, (signal) => unwrap(api.digital.chrome.days.$get({ query: { from } }, { init: { signal } })))
  const videos = useFetch(`dash-videos|${from}|${tick}`, (signal) => unwrap(api.digital.youtube.days.$get({ query: { from } }, { init: { signal } })))
  const promptCounts = useMemo(() => countMap(prompts.data?.days), [prompts.data])
  const pageCounts = useMemo(() => countMap(pages.data?.days), [pages.data])
  const videoCounts = useMemo(() => countMap(videos.data?.days), [videos.data])
  const toDigital = () => openTab('digital')

  return (
    <>
      <section className={styles.card}>
        {prompts.error ? (
          <p className={styles.error}>AI prompts: {prompts.error.message}</p>
        ) : (
          <Heatmap title="AI prompts" tone="pink" counts={promptCounts} end={end} describe={(n) => plural(n, 'prompt')} onSelect={toDigital} hint="Hover a day; click for the AI history" />
        )}
      </section>
      <section className={styles.card}>
        {pages.error ? (
          <p className={styles.error}>Web pages: {pages.error.message}</p>
        ) : (
          <Heatmap title="Web pages" tone="green" counts={pageCounts} end={end} describe={(n) => plural(n, 'page')} onSelect={toDigital} hint="Hover a day; click for the Chrome history" />
        )}
      </section>
      <section className={styles.card}>
        {videos.error ? (
          <p className={styles.error}>YouTube: {videos.error.message}</p>
        ) : (
          <Heatmap title="YouTube videos" tone="pink" counts={videoCounts} end={end} describe={(n) => plural(n, 'video')} onSelect={toDigital} hint="Hover a day; click for the YouTube history" />
        )}
      </section>
    </>
  )
}

const money = (cents: number) => (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'CAD' })

function TasksCard({ week, tick }: { week: string[]; tick: number }) {
  const { data, error } = useFetch(`dash-tasks|${week[0]}|${tick}`, (signal) => unwrap(api.progress.$get({ query: { from: week[0]!, to: week.at(-1)! } }, { init: { signal } })))
  const done = data?.items.filter((i) => i.kind === 'task') ?? []
  const today_ = done.filter((i) => i.date === week.at(-1)).length
  return (
    <Card title="Tasks done" value={data ? String(today_) : '—'} sub={data ? `${plural(done.length, 'task')} in 7 days` : ''} error={error?.message} empty={data && !done.length ? 'No tasks ticked this week.' : undefined}>
      {data && <WeekBars week={week} values={week.map((d) => done.filter((i) => i.date === d).length)} label={(n) => plural(n, 'task')} onPick={() => openTab('progress')} />}
    </Card>
  )
}

function UpcomingCard({ tick }: { tick: number }) {
  const { data, error } = useFetch(`dash-upcoming|${tick}`, (signal) => unwrap(api.events.upcoming.$get({ query: { limit: '5' } }, { init: { signal } })))
  return (
    <section className={styles.card}>
      <header>
        <h3>Coming up</h3>
        <button className={styles.more} onClick={() => openTab('calendar')}>
          calendar →
        </button>
      </header>
      {error ? (
        <p className={styles.error}>{error.message}</p>
      ) : data && !data.occurrences.length ? (
        <p className={styles.empty}>Nothing in the next 60 days.</p>
      ) : (
        <ul className={styles.list}>
          {data?.occurrences.map((o) => (
            <li key={`${o.eventId}|${o.startAt}`}>
              <span className={styles.when}>{new Date(o.startAt).toLocaleString(undefined, o.allDay ? { weekday: 'short', month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              {o.title}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SpendingCard({ end, tick }: { end: string; tick: number }) {
  const month = end.slice(0, 7)
  const { data, error } = useFetch(`dash-spending|${month}|${tick}`, (signal) => unwrap(api.finance.summary.$get({ query: { month } }, { init: { signal } })))
  const top = data?.byCategory.slice(0, 4) ?? []
  return (
    <Card title="Spent this month" value={data ? money(data.spent) : '—'} sub={data ? `${money(data.income)} in` : ''} error={error?.message} empty={data && !data.spent ? 'No spending logged this month.' : undefined}>
      <ul className={styles.list}>
        {top.map((c) => (
          <li key={c.category}>
            <span className={styles.when}>{money(c.amount)}</span>
            {c.category}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Card(props: { title: string; note?: string; value: string; sub: string; error?: string; empty?: string; children?: ReactNode }) {
  return (
    <section className={styles.card}>
      <header>
        <h3>{props.title}</h3>
        {props.note && <span className={styles.muted}>{props.note}</span>}
      </header>
      {props.error ? (
        <p className={styles.error}>{props.error}</p>
      ) : (
        <>
          <div className={styles.value}>
            <b>{props.value}</b>
            <span>today</span>
          </div>
          <p className={styles.sub}>{props.sub}</p>
          {props.empty ? <p className={styles.empty}>{props.empty}</p> : props.children}
        </>
      )}
    </section>
  )
}

/** One bar per day, today on the right; click a day to open it. */
function WeekBars({ week, values, label, onPick }: { week: string[]; values: number[]; label: (v: number, date: string) => string; onPick: (date: string) => void }) {
  const max = Math.max(...values)
  return (
    <div className={styles.bars}>
      {week.map((date, i) => {
        const v = values[i]!
        return (
          <button key={date} className={i === week.length - 1 ? styles.today : ''} onClick={() => onPick(date)} title={`${formatJournalDate(date)}: ${label(v, date)}`}>
            <span className={styles.track}>{v > 0 && <span style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />}</span>
            <span className={styles.day}>{weekday(date).slice(0, 1)}</span>
          </button>
        )
      })}
    </div>
  )
}
