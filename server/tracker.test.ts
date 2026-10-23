import Database from 'better-sqlite3'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CsvPreview, EventDTO, MessageDTO, OccurrenceDTO, ProgressItem, ProjectDTO, ScheduledPaymentDTO, TaskDTO, TransactionDTO, WebVisitDTO, YtWatchDTO } from '../shared/types.ts'

// The db client reads LOGTRACKER_DATA_DIR at import time, so the app is imported after setting it.
const root = mkdtempSync(path.join(os.tmpdir(), 'logtracker-'))
process.env.LOGTRACKER_DATA_DIR = path.join(root, 'data')
process.env.NODE_ENV = 'test'
let app: typeof import('./app.ts').app

beforeAll(async () => {
  app = (await import('./app.ts')).app
})
// The database closed first: Windows can't delete open database files.
afterAll(async () => {
  const { closeDb } = await import('./db/client.ts')
  closeDb()
  rmSync(root, { recursive: true, force: true })
})

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await app.request(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const json = await res.json()
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(json)}`)
  return json as T
}

async function upload<T>(url: string, name: string, content: string, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData()
  form.append('file', new File([content], name))
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  const res = await app.request(url, { method: 'POST', body: form })
  const json = await res.json()
  if (!res.ok) throw new Error(`POST ${url} → ${res.status} ${JSON.stringify(json)}`)
  return json as T
}

const local = (date: string, h = 0, m = 0) => new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime()

describe('tasks and progress', () => {
  it('keeps tasks in order, ticks them, and reports progress by the day they were done', async () => {
    const p = await req<ProjectDTO>('POST', '/api/projects', { title: 'Coop', color: '#5fb878' })
    const a = await req<TaskDTO>('POST', '/api/tasks', { projectId: p.id, text: 'frame' })
    const c = await req<TaskDTO>('POST', '/api/tasks', { projectId: p.id, text: 'roof' })
    const b = await req<TaskDTO>('POST', '/api/tasks', { projectId: p.id, text: 'walls', afterId: a.id, indent: 1 })
    const list = (await req<{ tasks: TaskDTO[] }>('GET', `/api/tasks?project=${p.id}`)).tasks
    expect(list.map((t) => [t.text, t.indent])).toEqual([
      ['frame', 0],
      ['walls', 1],
      ['roof', 0],
    ])

    const done = await req<TaskDTO>('PATCH', `/api/tasks/${b.id}`, { done: true })
    expect(done.done).toBe(true)
    // Ticking again keeps the first time it was done.
    expect((await req<TaskDTO>('PATCH', `/api/tasks/${b.id}`, { done: true })).doneAt).toBe(done.doneAt)
    await req('POST', '/api/progress/notes', { projectId: p.id, date: '2026-10-01', text: 'poured footings' })
    const items = (await req<{ items: ProgressItem[] }>('GET', '/api/progress')).items
    expect(items.map((i) => [i.kind, i.text])).toEqual([
      ['task', 'walls'],
      ['note', 'poured footings'],
    ])
    expect((await req<{ items: ProgressItem[] }>('GET', '/api/progress?from=2026-10-02&to=2026-10-02')).items).toEqual([])
    await expect(req('PATCH', `/api/tasks/${c.id}`, { indent: 9 })).rejects.toThrow(/indent/)
  })
})

describe('calendar', () => {
  it('expands recurring events into the range read, up to their last day', async () => {
    await req<EventDTO>('POST', '/api/events', { title: 'Standup', startAt: local('2026-10-05', 9), endAt: local('2026-10-05', 9, 15), recurrence: 'weekly', until: '2026-10-19' })
    await req<EventDTO>('POST', '/api/events', { title: 'Rent', startAt: local('2026-01-31'), endAt: local('2026-02-01'), allDay: true, recurrence: 'monthly' })
    await req<EventDTO>('POST', '/api/events', { title: 'Dentist', startAt: local('2026-10-14', 14), endAt: local('2026-10-14', 15) })
    const occ = (await req<{ occurrences: OccurrenceDTO[] }>('GET', `/api/events/occurrences?from=${local('2026-10-01')}&to=${local('2026-11-01')}`)).occurrences
    expect(occ.map((o) => [o.title, new Date(o.startAt).getDate()])).toEqual([
      ['Standup', 5],
      ['Standup', 12],
      ['Dentist', 14],
      ['Standup', 19],
      ['Rent', 31],
    ])
    // February has no 31st: no rent that month.
    expect((await req<{ occurrences: OccurrenceDTO[] }>('GET', `/api/events/occurrences?from=${local('2026-02-01')}&to=${local('2026-03-01')}`)).occurrences).toEqual([])
    await expect(req('POST', '/api/events', { title: 'x', startAt: 10, endAt: 5 })).rejects.toThrow(/ends after/)
  })
})

describe('finance', () => {
  const statement = 'Date,Description,Amount\n2026-10-02,GROCER,-45.10\n2026-10-03,PAYROLL,1500.00\n2026-10-03,GROCER,-45.10\n'

  it('imports a statement once, categorizing payees as they were categorized by hand', async () => {
    await req('POST', '/api/finance/transactions', { date: '2026-09-20', amount: -1000, payee: 'GROCER', category: 'groceries' })
    const preview = await upload<CsvPreview>('/api/finance/import/preview', 'oct.csv', statement)
    expect(preview.rows.map((r) => [r.date, r.amount, r.duplicate])).toEqual([
      ['2026-10-02', -4510, false],
      ['2026-10-03', 150000, false],
      ['2026-10-03', -4510, false],
    ])
    expect(await upload('/api/finance/import', 'oct.csv', statement)).toEqual({ added: 3, duplicates: 0, skipped: 0 })
    // An overlapping statement adds only its new line.
    expect(await upload('/api/finance/import', 'oct2.csv', statement + '2026-10-04,CAFE,-3.00\n')).toEqual({ added: 1, duplicates: 3, skipped: 0 })

    const txs = (await req<{ transactions: TransactionDTO[] }>('GET', '/api/finance/transactions?from=2026-10-01&to=2026-10-31')).transactions
    expect(txs.filter((t) => t.payee === 'GROCER').map((t) => t.category)).toEqual(['groceries', 'groceries'])
    const sum = await req<{ spent: number; income: number }>('GET', '/api/finance/summary?month=2026-10')
    expect([sum.spent, sum.income]).toEqual([9320, 150000])
  })

  it('logs a scheduled payment as paid and moves it on, staying on its day', async () => {
    const s = await req<ScheduledPaymentDTO>('POST', '/api/finance/scheduled', { payee: 'Landlord', amount: -120000, cadence: 'monthly', nextDue: '2026-01-31', category: 'rent' })
    const r = await req<{ transaction: TransactionDTO; scheduled: ScheduledPaymentDTO }>('POST', `/api/finance/scheduled/${s.id}/paid`, { date: '2026-01-30' })
    expect(r.transaction).toMatchObject({ date: '2026-01-30', amount: -120000, source: 'scheduled', category: 'rent' })
    expect(r.scheduled.nextDue).toBe('2026-02-28')
  })
})

describe('communications', () => {
  it('imports backups once and lists what was sent', async () => {
    const xml = '<smses><sms address="1" date="1760000000000" type="2" body="hi" /><sms address="1" date="1760000100000" type="1" body="yo" /></smses>'
    expect(await upload('/api/comms/import', 'sms.xml', xml)).toMatchObject({ added: 2, duplicates: 0 })
    expect(await upload('/api/comms/import', 'sms.xml', xml)).toMatchObject({ added: 0, duplicates: 2 })
    await expect(upload('/api/comms/import', 'WhatsApp Chat with Sam.txt', '10/22/26, 9:41 PM - Ilya: hi')).rejects.toThrow(/WhatsApp name/)
    await req('PUT', '/api/comms/identity', { names: ['Ilya'], emails: [] })
    expect(await upload('/api/comms/import', 'WhatsApp Chat with Sam.txt', '10/22/26, 9:41 PM - Ilya: hi')).toMatchObject({ added: 1 })

    const out = (await req<{ messages: MessageDTO[] }>('GET', `/api/comms/messages?from=1750000000000&to=${Date.now() + 86_400_000}&direction=out`)).messages
    expect(out.map((m) => [m.channel, m.snippet])).toEqual([
      ['whatsapp', 'hi'],
      ['sms', 'hi'],
    ])
  })
})

describe('digital activity', () => {
  /** A Chrome History file with the tables and columns the reader uses. */
  function fakeHistory(file: string, visits: [number, string, string, number][]) {
    mkdirSync(path.dirname(file), { recursive: true })
    const db = new Database(file)
    db.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT); CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER, transition INTEGER)')
    visits.forEach(([id, url, title, transition], i) => {
      db.prepare('INSERT INTO urls (id, url, title) VALUES (?, ?, ?)').run(id, url, title)
      // Chrome time: µs since 1601.
      db.prepare('INSERT INTO visits (id, url, visit_time, transition) VALUES (?, ?, ?, ?)').run(id, id, (Date.parse('2026-10-22T10:00:00Z') + i * 60_000 + 11_644_473_600_000) * 1000, transition)
    })
    db.close()
  }

  it('imports Chrome visits incrementally, with YouTube watch pages as watches', async () => {
    const home = path.join(root, 'home', 'ip')
    const history = path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'History')
    fakeHistory(history, [
      [1, 'https://example.com/a', 'Example', 0],
      [2, 'https://ads.example.net/frame', 'ad', 3], // a subframe
      [3, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', '(2) Never Gonna Give You Up - YouTube', 1],
      [4, 'chrome://settings', 'Settings', 0],
    ])
    process.env.LOGTRACKER_AI_HOMES = home
    const { scanChrome } = await import('./lib/digital/chrome.ts')
    expect(await scanChrome()).toEqual({ added: 2, errors: [] })
    expect(await scanChrome()).toEqual({ added: 0, errors: [] })

    const range = `from=${Date.parse('2026-10-22T00:00:00Z')}&to=${Date.parse('2026-10-23T00:00:00Z')}`
    const visits = (await req<{ visits: WebVisitDTO[] }>('GET', `/api/digital/chrome/visits?${range}`)).visits
    expect(visits.map((v) => [v.title, v.profile])).toEqual([
      ['(2) Never Gonna Give You Up - YouTube', 'ip/Default'],
      ['Example', 'ip/Default'],
    ])
    const watches = (await req<{ watches: YtWatchDTO[] }>('GET', `/api/digital/youtube/watches?${range}`)).watches
    expect(watches.map((w) => [w.videoId, w.title, w.channel])).toEqual([['dQw4w9WgXcQ', 'Never Gonna Give You Up', null]])

    // Takeout knows the channel, and is the same watch.
    const takeout = [{ header: 'YouTube', title: 'Watched Never Gonna Give You Up', titleUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', subtitles: [{ name: 'Rick Astley' }], time: new Date(Date.parse('2026-10-22T10:02:30Z')).toISOString() }]
    expect(await upload('/api/digital/youtube/import', 'watch-history.json', JSON.stringify(takeout))).toEqual({ added: 0, errors: [] })
    expect((await req<{ watches: YtWatchDTO[] }>('GET', `/api/digital/youtube/watches?${range}`)).watches.map((w) => w.channel)).toEqual(['Rick Astley'])
  })

  it('fills in missing channels from oEmbed', async () => {
    const { db } = await import('./db/client.ts')
    const { ytWatches } = await import('./db/schema.ts')
    db.insert(ytWatches).values({ at: 1, videoId: 'aaaaaaaaaaa', title: 't', channel: null, source: 'chrome' }).run()
    const { fillChannels } = await import('./lib/digital/youtube.ts')
    const fake = (async (url: string) => (String(url).includes('aaaaaaaaaaa') ? new Response(JSON.stringify({ author_name: 'Someone' })) : new Response('', { status: 404 }))) as typeof fetch
    expect(await fillChannels(fake)).toBe(1)
    expect(db.select().from(ytWatches).all().find((w) => w.videoId === 'aaaaaaaaaaa')?.channel).toBe('Someone')
  })
})

describe('import from a logcadence library', () => {
  it('copies GPS, activity and checklists, turning logcadence-sourced items into manual ones', async () => {
    const lib = path.join(root, 'lib')
    const { openTrackerDb } = await import('./db/open.ts')
    // A library from before the split: the same tables (and columns) as tracker.db, in db/content.db.
    mkdirSync(path.join(lib, 'db'), { recursive: true })
    const src = openTrackerDb(path.join(lib, 'db'))
    src.$client.exec(`
      INSERT INTO gps_days (date, source_stamp, day_start, point_count, processed_at) VALUES ('2026-09-17', '1:2', 0, 10, 0);
      INSERT INTO activity_spans (device, kind, start_at, end_at) VALUES ('pc', 'input', 1, 2), ('pc', 'tracked', 1, 3);
      INSERT INTO checklists (id, title, position, start_date, created_at, updated_at) VALUES ('c', 'Reddit', 1, '2026-10-01', 0, 0);
      INSERT INTO checklist_items (id, checklist_id, label, target, source, position, added_date, created_at) VALUES ('i1', 'c', 'Save posts', 50, 'reddit-posts', 1, '2026-10-01', 0), ('i2', 'c', 'Prompts', 5, 'ai-prompts', 2, '2026-10-01', 0);
      INSERT INTO checklist_marks (item_id, date, count, updated_at) VALUES ('i1', '2026-10-02', 7, 0);`)
    src.$client.close()
    renameSync(path.join(lib, 'db', 'tracker.db'), path.join(lib, 'db', 'content.db'))
    mkdirSync(path.join(lib, 'gps'))
    writeFileSync(path.join(lib, 'gps', '20260917.gpx'), '<gpx/>')
    writeFileSync(path.join(lib, 'gps-drive.json'), '{"auto":true}')

    const out = path.join(root, 'imported')
    const log = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/import-logcadence.ts', lib, '--data-dir', out], { encoding: 'utf8' })
    expect(log).toMatch(/1 checklist item\(s\) counted from logcadence/)

    const db = new Database(path.join(out, 'db', 'tracker.db'), { readonly: true })
    try {
      expect(db.prepare('SELECT count(*) AS n FROM activity_spans').get()).toEqual({ n: 2 })
      expect(db.prepare('SELECT id, source FROM checklist_items ORDER BY id').all()).toEqual([
        { id: 'i1', source: null },
        { id: 'i2', source: 'ai-prompts' },
      ])
      expect(db.prepare('SELECT count FROM checklist_marks').get()).toEqual({ count: 7 })
    } finally {
      db.close()
    }
    expect(readFileSync(path.join(out, 'gps', '20260917.gpx'), 'utf8')).toBe('<gpx/>')
    expect(readFileSync(path.join(out, 'gps-drive.json'), 'utf8')).toBe('{"auto":true}')
    // Not into a database that already has the rows.
    expect(() => execFileSync(process.execPath, ['--import', 'tsx', 'scripts/import-logcadence.ts', lib, '--data-dir', out], { stdio: 'pipe' })).toThrow()
  })
})
