import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { CHANNELS, type Channel } from '../../shared/types.ts'
import { deleteMessage, importFile, listMessages, logMessage } from '../lib/comms/comms.ts'
import { getIdentity, setIdentity } from '../lib/settings.ts'
import { bad, num, obj, optNum, optStr, optStrArr, str } from '../lib/validate.ts'

const MAX_UPLOAD = 500 * 1024 * 1024
const DAY_MS = 86_400_000

const channel = (v: unknown): Channel | undefined => {
  if (v === undefined || v === '') return undefined
  if (!CHANNELS.includes(v as Channel)) bad(`channel is one of ${CHANNELS.join(', ')}`)
  return v as Channel
}

export const commsRoutes = new Hono()
  // Messages in [from, to) (epoch ms); direction (out | in), channel and q narrow it down.
  .get('/comms/messages', (c) => {
    const from = Number(c.req.query('from'))
    const to = Number(c.req.query('to'))
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) bad('from and to must be epoch ms, from < to')
    if (to - from > 3700 * DAY_MS) bad('range too long')
    const direction = c.req.query('direction')
    if (direction && direction !== 'out' && direction !== 'in') bad('direction is out or in')
    return c.json({ messages: listMessages({ from, to, direction: direction as 'out' | 'in' | undefined, channel: channel(c.req.query('channel')), q: c.req.query('q') || undefined }) })
  })
  .post(
    '/comms/messages',
    validator('json', (v): { channel: Channel; direction?: 'out' | 'in'; counterpart: string; subject?: string; snippet?: string; at: number; durationS?: number | null } => {
      const o = obj(v)
      const direction = o.direction ?? 'out'
      if (direction !== 'out' && direction !== 'in') bad('direction is out or in')
      return {
        channel: channel(o.channel) ?? bad('channel is required'),
        direction: direction as 'out' | 'in',
        counterpart: str(o, 'counterpart').trim() || bad('Who was it to?'),
        subject: optStr(o, 'subject') ?? '',
        snippet: optStr(o, 'snippet') ?? '',
        at: num(o, 'at'),
        durationS: optNum(o, 'durationS') ?? null,
      }
    }),
    (c) => c.json(logMessage({ direction: 'out', subject: '', snippet: '', durationS: null, ...c.req.valid('json') })),
  )
  .delete('/comms/messages/:id', (c) => {
    deleteMessage(c.req.param('id'))
    return c.json({ ok: true })
  })
  .post(
    '/comms/import',
    validator('form', (v) => {
      const file = v.file
      if (!(file instanceof File)) bad('file is required')
      if (file.size > MAX_UPLOAD) bad('file too large')
      return { file }
    }),
    async (c) => {
      const { file } = c.req.valid('form')
      return c.json(importFile(file.name, await file.text()))
    },
  )
  // Your own WhatsApp names and email addresses, which tell outgoing messages from incoming ones.
  .get('/comms/identity', (c) => c.json(getIdentity()))
  .put(
    '/comms/identity',
    validator('json', (v): { names: string[]; emails: string[] } => {
      const o = obj(v)
      const clean = (a: string[] | undefined) => [...new Set((a ?? []).map((s) => s.trim()).filter(Boolean))]
      return { names: clean(optStrArr(o, 'names')), emails: clean(optStrArr(o, 'emails')).map((e) => e.toLowerCase()) }
    }),
    (c) => {
      setIdentity(c.req.valid('json'))
      return c.json(getIdentity())
    },
  )
