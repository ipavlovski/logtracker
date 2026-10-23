import { Fragment, useState, type ReactNode } from 'react'
import { formatJournalDate, shiftDate, toIsoDate, today } from '../../../shared/dates.ts'
import type { ChatSource, ImportReport } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import { useDebounced, useFetch } from '../../hooks/useFetch.ts'
import { persistedStore, useStore } from '../../state/store.ts'
import { notify } from '../../state/ui.ts'
import tab from '../Tab/Tab.module.css'
import { useFileDrop } from '../Tab/useFileDrop.ts'
import styles from './Digital.module.css'

// The Digital activity tab: what happened on screen, by day. Chrome history (timestamp, title, url) read from Chrome's
// own History files; YouTube videos watched (timestamp, channel, title, url), from those visits and Takeout's watch
// history; AI chats (timestamp, AI/model, title, and a logcadence:// link to the chat in logcadence's AI tab). Chrome
// and AI scan in the background every 15 minutes; Scan does it now.

type View = 'chrome' | 'youtube' | 'ai'

const viewStore = persistedStore<{ view: View }>('digital.v1', { view: 'chrome' }, (s) => {
  const v = (s as { view?: string } | null)?.view
  return { view: v === 'youtube' || v === 'ai' ? v : 'chrome' }
})

const SOURCE_LABEL: Record<ChatSource, string> = { claude: 'Claude', 'claude-code': 'Claude Code', gemini: 'Gemini', antigravity: 'Antigravity' }
const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
const midnight = (date: string) => new Date(date + 'T00:00:00').getTime()

export function Digital() {
  const view = useStore(viewStore, (s) => s.view)
  const [day, setDay] = useState(today())
  const [span, setSpan] = useState<1 | 7>(1)
  const [q, setQ] = useState('')
  const query = useDebounced(q, 250)
  const [bump, setBump] = useState(0)
  const [scanning, setScanning] = useState(false)
  const from = midnight(shiftDate(day, 1 - span))
  const to = midnight(shiftDate(day, 1))
  const range = { from: String(from), to: String(to), ...(query ? { q: query } : {}) }
  const reload = () => setBump((n) => n + 1)

  const scan = async () => {
    setScanning(true)
    try {
      if (view === 'ai') notify(reportText(await unwrap(api.digital.ai.scan.$post()).then((r) => r.report)))
      else {
        const r = await unwrap(api.digital.scan.$post())
        notify(`${r.chrome.added} new visit(s)${r.channels ? `, ${r.channels} channel(s) looked up` : ''}${r.chrome.errors.length ? ` · ${r.chrome.errors[0]}` : ''}`)
      }
      reload()
    } catch (err) {
      notify((err as Error).message)
    } finally {
      setScanning(false)
    }
  }
  const upload = async (files: File[]) => {
    for (const file of files)
      try {
        if (view === 'ai') notify(reportText((await unwrap(api.digital.ai.import.$post({ form: { file } }))).report))
        else notify(`${file.name}: ${(await unwrap(api.digital.youtube.import.$post({ form: { file } }))).added} watch(es) added`)
      } catch (err) {
        notify((err as Error).message)
      }
    reload()
  }
  const drop = useFileDrop(upload)

  return (
    <div className={tab.frame} {...drop.props}>
      <header className={tab.header}>
        <h2>Digital activity</h2>
        <div className={tab.row}>
          {(['chrome', 'youtube', 'ai'] as const).map((v) => (
            <button key={v} className={view === v ? tab.on : ''} onClick={() => viewStore.set(() => ({ view: v }))}>
              {v === 'chrome' ? 'Chrome' : v === 'youtube' ? 'YouTube' : 'AI'}
            </button>
          ))}
        </div>
        <div className={tab.row}>
          <button onClick={() => setDay(shiftDate(day, -span))} aria-label="Earlier">
            ‹
          </button>
          <input type="date" value={day} max={today()} onChange={(e) => e.target.value && setDay(e.target.value)} className={styles.date} />
          <button onClick={() => setDay(shiftDate(day, span))} disabled={day >= today()} aria-label="Later">
            ›
          </button>
          <button className={span === 7 ? tab.on : ''} onClick={() => setSpan(span === 7 ? 1 : 7)} title="The 7 days up to this day">
            week
          </button>
        </div>
        <span className={tab.spacer} />
        <input className={styles.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
        <button onClick={scan} disabled={scanning}>
          {scanning ? 'Scanning…' : 'Scan'}
        </button>
      </header>
      <div className={tab.body}>
        {view !== 'chrome' && (
          <div className={`${tab.drop} ${drop.over ? tab.dropping : ''}`}>
            {view === 'youtube' ? (
              <>
                Drop a Google Takeout zip (YouTube → history, <b>JSON</b> format) or its <code>watch-history.json</code> here for channels and watches from other devices.
              </>
            ) : (
              <>
                Drop a Claude data export, a Gemini Takeout or a Claude Code <code>.jsonl</code> here. <AiSources />
              </>
            )}
          </div>
        )}
        {view === 'chrome' && <ChromeTable range={range} bump={bump} />}
        {view === 'youtube' && <YoutubeTable range={range} bump={bump} />}
        {view === 'ai' && <AiTable range={range} bump={bump} />}
      </div>
    </div>
  )
}

function reportText(r: ImportReport): string {
  const parts = Object.entries(r).map(([s, c]) => `${SOURCE_LABEL[s as ChatSource]}: ${c.created} new, ${c.updated} updated${c.errors.length ? `, ${c.errors.length} error(s)` : ''}`)
  return parts.join(' · ') || 'No chats found'
}

type Range = { from: string; to: string; q?: string }

/** Rows grouped under day headings, newest first. */
function ByDay<T extends { at: number }>({ rows, cols, render, empty }: { rows: T[] | undefined; cols: string[]; render: (r: T) => ReactNode; empty: string }) {
  if (!rows) return null
  if (!rows.length) return <p className={tab.empty}>{empty}</p>
  const days = new Map<string, T[]>()
  for (const r of rows) {
    const d = toIsoDate(new Date(r.at))
    days.set(d, [...(days.get(d) ?? []), r])
  }
  return (
    <table className={tab.table}>
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {[...days].map(([d, list]) => (
          <Fragment key={d}>
            <tr className={tab.dayHead}>
              <td colSpan={cols.length}>
                {formatJournalDate(d)} <span className={tab.muted}>· {list.length}</span>
              </td>
            </tr>
            {list.map(render)}
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}

const host = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function ChromeTable({ range, bump }: { range: Range; bump: number }) {
  const { data, error } = useFetch(`visits|${JSON.stringify(range)}|${bump}`, (signal) => unwrap(api.digital.chrome.visits.$get({ query: range }, { init: { signal } })))
  const profiles = useFetch('chrome-profiles', (signal) => unwrap(api.digital.chrome.profiles.$get({}, { init: { signal } })))
  return (
    <>
      {error && <p className={tab.error}>{error.message}</p>}
      {profiles.data && !profiles.data.profiles.length && <p className={tab.error}>No Chrome profiles found on this machine (Chrome’s History files are read from each Windows and Linux home).</p>}
      <ByDay
        rows={data?.visits}
        cols={['Time', 'Title', 'Url']}
        empty="No pages visited in this range."
        render={(v) => (
          <tr key={v.id}>
            <td className={tab.time}>{clock(v.at)}</td>
            <td className={tab.clip} title={v.title}>
              {v.title}
            </td>
            <td className={styles.url}>
              <a className={tab.link} href={v.url} target="_blank" rel="noreferrer" title={v.url}>
                {host(v.url)}
              </a>
            </td>
          </tr>
        )}
      />
    </>
  )
}

function YoutubeTable({ range, bump }: { range: Range; bump: number }) {
  const { data, error } = useFetch(`watches|${JSON.stringify(range)}|${bump}`, (signal) => unwrap(api.digital.youtube.watches.$get({ query: range }, { init: { signal } })))
  return (
    <>
      {error && <p className={tab.error}>{error.message}</p>}
      <ByDay
        rows={data?.watches}
        cols={['Time', 'Channel', 'Video', 'Url']}
        empty="No YouTube videos watched in this range."
        render={(w) => (
          <tr key={w.id}>
            <td className={tab.time}>{clock(w.at)}</td>
            <td className={styles.channel}>{w.channel ?? <span className={tab.muted}>…</span>}</td>
            <td className={tab.clip} title={w.title}>
              {w.title}
            </td>
            <td className={styles.url}>
              <a className={tab.link} href={w.url} target="_blank" rel="noreferrer">
                {w.videoId}
              </a>
            </td>
          </tr>
        )}
      />
    </>
  )
}

function AiTable({ range, bump }: { range: Range; bump: number }) {
  const { data, error } = useFetch(`ai-chats|${JSON.stringify(range)}|${bump}`, (signal) => unwrap(api.digital.ai.chats.$get({ query: range }, { init: { signal } })))
  const rows = data?.chats.map((c) => ({ ...c, at: c.startedAt }))
  return (
    <>
      {error && <p className={tab.error}>{error.message}</p>}
      <ByDay
        rows={rows}
        cols={['Time', 'AI / model', 'Title', 'Url']}
        empty="No AI chats in this range."
        render={(c) => (
          <tr key={c.id}>
            <td className={tab.time}>{clock(c.startedAt)}</td>
            <td className={styles.channel}>
              {SOURCE_LABEL[c.source]}
              {c.model && <span className={tab.muted}> · {c.model}</span>}
            </td>
            <td className={tab.clip} title={`${c.title} (${c.turns} prompt${c.turns === 1 ? '' : 's'})`}>
              {c.title}
            </td>
            <td className={styles.url}>
              <a className={tab.link} href={c.logcadenceUrl} title="Open in logcadence">
                logcadence
              </a>
              {c.url && (
                <>
                  {' · '}
                  <a className={tab.link} href={c.url} target="_blank" rel="noreferrer">
                    claude.ai
                  </a>
                </>
              )}
            </td>
          </tr>
        )}
      />
    </>
  )
}

/** Where chats come from, and claude.ai's live sync (desktop app). */
function AiSources() {
  const [bump, setBump] = useState(0)
  const { data } = useFetch(`ai-sources|${bump}`, (signal) => unwrap(api.digital.ai.sources.$get({}, { init: { signal } })))
  const claude = data?.sources.find((s) => s.source === 'claude')
  const desktop = window.desktop
  if (!desktop || !claude || claude.connected === undefined) return null
  return claude.connected ? (
    <span>
      claude.ai is connected.{' '}
      <button className={styles.inline} onClick={() => void desktop.disconnectClaude().then(() => setBump((n) => n + 1))}>
        Disconnect
      </button>
    </span>
  ) : (
    <button className={styles.inline} onClick={() => void desktop.connectClaude().then(() => setBump((n) => n + 1))}>
      Connect claude.ai for live sync
    </button>
  )
}
