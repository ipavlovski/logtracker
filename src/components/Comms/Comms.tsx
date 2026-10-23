import { Fragment, useEffect, useState } from 'react'
import { formatJournalDate, toIsoDate } from '../../../shared/dates.ts'
import { CHANNELS, type Channel, type MessageDTO } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import { useDebounced, useFetch } from '../../hooks/useFetch.ts'
import { notify } from '../../state/ui.ts'
import tab from '../Tab/Tab.module.css'
import { useFileDrop } from '../Tab/useFileDrop.ts'
import styles from './Comms.module.css'

// The Communications tab: emails written, texts sent and calls made (and, toggled on, what came in), by day. Filled by
// importing backups and exports (SMS Backup & Restore XML, WhatsApp "Export chat" .txt, an mbox of mail) and by
// logging a call or message by hand. Who "you" are (your WhatsApp name, your addresses) is set under "me".

const CHANNEL_LABEL: Record<Channel, string> = { email: 'Email', sms: 'SMS', call: 'Call', whatsapp: 'WhatsApp' }
const RANGES = [7, 30, 90, 365]
const DAY_MS = 86_400_000

const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
const mins = (s: number) => (s < 60 ? `${s}s` : `${Math.round(s / 60)} min`)

export function Comms() {
  const [days, setDays] = useState(30)
  const [direction, setDirection] = useState<'out' | 'in' | ''>('out')
  const [channel, setChannel] = useState<Channel | ''>('')
  const [q, setQ] = useState('')
  const query = useDebounced(q, 250)
  const [bump, setBump] = useState(0)
  const [panel, setPanel] = useState<'log' | 'me' | null>(null)
  const to = Date.now() + DAY_MS
  const from = to - (days + 1) * DAY_MS
  const reload = () => setBump((n) => n + 1)
  const { data, error } = useFetch(`comms|${days}|${direction}|${channel}|${query}|${bump}`, (signal) =>
    unwrap(
      api.comms.messages.$get(
        { query: { from: String(Math.floor(from / DAY_MS) * DAY_MS), to: String(to), ...(direction ? { direction } : {}), ...(channel ? { channel } : {}), ...(query ? { q: query } : {}) } },
        { init: { signal } },
      ),
    ),
  )
  const upload = async (files: File[]) => {
    for (const file of files)
      try {
        const r = await unwrap(api.comms.import.$post({ form: { file } }))
        notify(`${file.name}: ${r.added} added${r.duplicates ? `, ${r.duplicates} already there` : ''}`)
      } catch (err) {
        notify((err as Error).message)
      }
    reload()
  }
  const drop = useFileDrop(upload)

  const byDay = new Map<string, MessageDTO[]>()
  for (const m of data?.messages ?? []) {
    const d = toIsoDate(new Date(m.at))
    byDay.set(d, [...(byDay.get(d) ?? []), m])
  }
  const counts = CHANNELS.map((c) => [c, data?.messages.filter((m) => m.channel === c).length ?? 0] as const)

  return (
    <div className={tab.frame} {...drop.props}>
      <header className={tab.header}>
        <h2>Communications</h2>
        <div className={tab.row}>
          {(['out', 'in', ''] as const).map((d) => (
            <button key={d} className={direction === d ? tab.on : ''} onClick={() => setDirection(d)}>
              {d === 'out' ? 'outgoing' : d === 'in' ? 'incoming' : 'both'}
            </button>
          ))}
        </div>
        <select value={channel} onChange={(e) => setChannel(e.target.value as Channel | '')} aria-label="Channel">
          <option value="">all channels</option>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {CHANNEL_LABEL[c]}
            </option>
          ))}
        </select>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Range">
          {RANGES.map((d) => (
            <option key={d} value={d}>
              last {d} days
            </option>
          ))}
        </select>
        <span className={tab.spacer} />
        <button className={panel === 'log' ? tab.on : ''} onClick={() => setPanel(panel === 'log' ? null : 'log')}>
          + log
        </button>
        <button className={panel === 'me' ? tab.on : ''} onClick={() => setPanel(panel === 'me' ? null : 'me')} title="Your WhatsApp name and email addresses">
          me
        </button>
        <label className={styles.upload}>
          Import…
          <input type="file" multiple accept=".xml,.txt,.mbox" onChange={(e) => void upload([...(e.target.files ?? [])])} hidden />
        </label>
      </header>
      <div className={tab.body}>
        {panel === 'log' && <LogForm onDone={() => (setPanel(null), reload())} />}
        {panel === 'me' && <Identity onDone={() => setPanel(null)} />}
        <div className={tab.toolbar}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people, subjects, text…" className={styles.search} />
          <span className={tab.muted}>{counts.filter(([, n]) => n).map(([c, n]) => `${n} ${CHANNEL_LABEL[c].toLowerCase()}`).join(' · ')}</span>
        </div>
        <div className={`${tab.drop} ${drop.over ? tab.dropping : ''}`}>
          Drop an SMS Backup & Restore <code>.xml</code> (texts and calls), a WhatsApp chat export <code>.txt</code> or an <code>.mbox</code> of mail here to import it.
        </div>
        {error && <p className={tab.error}>{error.message}</p>}
        {data && !data.messages.length && <p className={tab.empty}>Nothing {direction === 'out' ? 'sent' : direction === 'in' ? 'received' : 'here'} in the last {days} days.</p>}
        {data && data.messages.length > 0 && (
          <table className={tab.table}>
            <tbody>
              {[...byDay].map(([day, list]) => (
                <Fragment key={day}>
                  <tr className={tab.dayHead}>
                    <td colSpan={5}>
                      {formatJournalDate(day)} <span className={tab.muted}>· {list.length}</span>
                    </td>
                  </tr>
                  {list.map((m) => (
                    <tr key={m.id} className={m.direction === 'out' ? tab.out : tab.in}>
                      <td className={tab.time}>{clock(m.at)}</td>
                      <td>
                        <span className={`${styles.channel} ${styles[m.channel]}`}>{CHANNEL_LABEL[m.channel]}</span>
                      </td>
                      <td className={styles.who}>
                        {m.direction === 'out' ? '→ ' : '← '}
                        {m.counterpart}
                      </td>
                      <td className={tab.clip} title={m.snippet}>
                        {m.channel === 'call' ? `${m.subject}${m.durationS ? ` · ${mins(m.durationS)}` : ''}` : m.subject ? <b>{m.subject} </b> : null}
                        {m.channel !== 'call' && m.snippet}
                      </td>
                      <td>
                        <button className={styles.del} onClick={() => confirm('Delete this?') && unwrap(api.comms.messages[':id'].$delete({ param: { id: m.id } })).then(reload)} aria-label="Delete">
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function LogForm({ onDone }: { onDone: () => void }) {
  const [channel, setChannel] = useState<Channel>('call')
  const [counterpart, setCounterpart] = useState('')
  const [subject, setSubject] = useState('')
  const [snippet, setSnippet] = useState('')
  const [minutes, setMinutes] = useState('')
  const [at, setAt] = useState(() => {
    const d = new Date()
    return `${toIsoDate(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })
  const save = () =>
    unwrap(
      api.comms.messages.$post({
        json: { channel, direction: 'out', counterpart, subject: channel === 'call' ? 'outgoing' : subject, snippet, at: new Date(at).getTime(), ...(channel === 'call' && minutes ? { durationS: Math.round(Number(minutes) * 60) } : {}) },
      }),
    ).then(onDone, (err: Error) => notify(err.message))
  return (
    <div className={`${tab.card} ${tab.form}`}>
      <label>
        What
        <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {CHANNEL_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      <label>
        When
        <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
      </label>
      <label>
        To
        <input autoFocus value={counterpart} onChange={(e) => setCounterpart(e.target.value)} placeholder="Name or number" />
      </label>
      {channel === 'call' ? (
        <label>
          Minutes
          <input value={minutes} onChange={(e) => setMinutes(e.target.value)} size={5} inputMode="decimal" />
        </label>
      ) : (
        channel === 'email' && (
          <label>
            Subject
            <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
        )
      )}
      <label className={tab.wide}>
        Note
        <input value={snippet} onChange={(e) => setSnippet(e.target.value)} placeholder="What it was about" />
      </label>
      <button className={tab.primary} onClick={save} disabled={!counterpart.trim()}>
        Log it
      </button>
    </div>
  )
}

function Identity({ onDone }: { onDone: () => void }) {
  const { data } = useFetch('comms-identity', (signal) => unwrap(api.comms.identity.$get({}, { init: { signal } })))
  const [names, setNames] = useState('')
  const [emails, setEmails] = useState('')
  useEffect(() => {
    if (!data) return
    setNames(data.names.join(', '))
    setEmails(data.emails.join(', '))
  }, [data])
  const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
  const save = () => unwrap(api.comms.identity.$put({ json: { names: split(names), emails: split(emails) } })).then(onDone, (err: Error) => notify(err.message))
  return (
    <div className={`${tab.card} ${tab.form}`}>
      <label className={tab.wide}>
        Your name in WhatsApp exports (comma-separated)
        <input value={names} onChange={(e) => setNames(e.target.value)} placeholder="Ilya, IP" />
      </label>
      <label className={tab.wide}>
        Addresses you send email from
        <input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="me@example.com" />
      </label>
      <button className={tab.primary} onClick={save}>
        Save
      </button>
    </div>
  )
}
