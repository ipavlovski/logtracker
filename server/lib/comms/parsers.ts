import type { Channel } from '../../../shared/types.ts'

// Readers for the exports Communications imports. Each returns messages in both directions; the tab leads with the
// outgoing ones (what was written, texted or called).
//
// - SMS Backup & Restore (Android) XML: <sms> (type 2 = sent) and <call> (type 2 = outgoing) elements.
// - WhatsApp "Export chat" .txt: one line per message, "date, time - Name: text" (Android) or "[date, time] Name: text"
//   (iPhone); the chat's other side comes from the file name ("WhatsApp Chat with Sam.txt").
// - mbox (Gmail Takeout): headers only, plus the start of a plain-text body; sent when From is one of your addresses.

export interface ParsedMessage {
  channel: Channel
  direction: 'out' | 'in'
  counterpart: string
  subject: string
  snippet: string
  at: number
  durationS: number | null
}

const SNIPPET = 280

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decodeXml = (s: string) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m)))

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]!] = decodeXml(m[2]!)
  return out
}

const who = (a: Record<string, string>, key: string) => (a.contact_name && a.contact_name !== '(Unknown)' ? `${a.contact_name} (${a[key]})` : (a[key] ?? ''))

export function parseSmsBackup(xml: string): ParsedMessage[] {
  const out: ParsedMessage[] = []
  for (const m of xml.matchAll(/<(sms|call)\s[^>]*?\/?>/g)) {
    const a = attrs(m[0])
    const at = Number(a.date)
    if (!Number.isFinite(at)) continue
    if (m[1] === 'sms') out.push({ channel: 'sms', direction: a.type === '2' ? 'out' : 'in', counterpart: who(a, 'address'), subject: '', snippet: (a.body ?? '').slice(0, SNIPPET), at, durationS: null })
    else {
      // 1 incoming, 2 outgoing, 3 missed, 5 rejected, 6 blocked.
      const kind = { '1': 'incoming', '2': 'outgoing', '3': 'missed', '5': 'rejected', '6': 'blocked' }[a.type ?? ''] ?? 'call'
      out.push({ channel: 'call', direction: a.type === '2' ? 'out' : 'in', counterpart: who(a, 'number'), subject: kind, snippet: '', at, durationS: Number(a.duration) || 0 })
    }
  }
  return out
}

const WA_DATE = /^\[?\d{1,4}[./-]\d{1,2}[./-]\d{1,4},?\s+\d{1,2}:\d{2}/
const WA_LINE = /^\[?(\d{1,4}[./-]\d{1,2}[./-]\d{1,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*([AaPp]\.?\s?[Mm]\.?)?\]?\s*(?:-\s*)?([^:]+?):\s(.*)$/

function waTime(date: string, time: string, ampm: string | undefined, dayFirst: boolean): number {
  const p = date.split(/[./-]/).map(Number) as [number, number, number]
  let [y, mo, d] = p[0] > 999 ? [p[0], p[1], p[2]] : dayFirst ? [p[2], p[1], p[0]] : [p[2], p[0], p[1]]
  if (y < 100) y += 2000
  const [hh, mm, ss = 0] = time.split(':').map(Number) as [number, number, number?]
  let h = hh
  if (ampm) {
    const pm = /p/i.test(ampm)
    if (pm && h < 12) h += 12
    if (!pm && h === 12) h = 0
  }
  return new Date(y, mo - 1, d, h, mm, ss).getTime()
}

/** `me` is the name WhatsApp shows for your own messages (as in the export). */
export function parseWhatsApp(text: string, fileName: string, me: string[]): ParsedMessage[] {
  const chat = /WhatsApp Chat (?:with|-)\s*(.+?)(?:\.txt)?$/i.exec(fileName)?.[1]?.trim() ?? fileName.replace(/\.txt$/i, '')
  const lines = text.replace(/‎| /g, ' ').split(/\r?\n/)
  // Day first when a first number over 12 shows up anywhere.
  const dayFirst = lines.some((l) => {
    const m = WA_LINE.exec(l)
    return !!m && Number(m[1]!.split(/[./-]/)[0]) > 12 && m[1]!.split(/[./-]/)[0]!.length <= 2
  })
  const mine = new Set(me.map((n) => n.trim().toLowerCase()).filter(Boolean))
  const out: ParsedMessage[] = []
  for (const line of lines) {
    const m = WA_LINE.exec(line)
    if (!m) {
      // A system line ("Messages are end-to-end encrypted", "Sam joined") has a date but no sender: skipped.
      if (WA_DATE.test(line)) continue
      // A message's next line.
      const last = out.at(-1)
      if (last && line.trim() && last.snippet.length < SNIPPET) last.snippet = `${last.snippet}\n${line}`.slice(0, SNIPPET)
      continue
    }
    const [, date, time, ampm, sender, body] = m
    const out_ = mine.has(sender!.trim().toLowerCase())
    out.push({ channel: 'whatsapp', direction: out_ ? 'out' : 'in', counterpart: out_ ? chat : sender!.trim(), subject: '', snippet: body!.slice(0, SNIPPET), at: waTime(date!, time!, ampm, dayFirst), durationS: null })
  }
  return out
}

/** Decodes an RFC 2047 encoded-word header ("=?UTF-8?B?…?="). */
function decodeHeader(v: string): string {
  return v.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, _charset: string, enc: string, data: string) => {
    try {
      return enc.toUpperCase() === 'B' ? Buffer.from(data, 'base64').toString('utf8') : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8')
    } catch {
      return data
    }
  })
}

const addresses = (v: string) => [...v.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)].map((m) => m[0].toLowerCase())

/** `myAddresses`: the addresses you send from; a message from one of them is outgoing. */
export function parseMbox(text: string, myAddresses: string[]): ParsedMessage[] {
  const mine = new Set(myAddresses.map((a) => a.toLowerCase()))
  const out: ParsedMessage[] = []
  for (const raw of text.split(/^From [^\n]*\n/m)) {
    if (!raw.trim()) continue
    const split = raw.search(/\r?\n\r?\n/)
    const head = (split < 0 ? raw : raw.slice(0, split)).replace(/\r?\n[ \t]+/g, ' ')
    const headers = new Map<string, string>()
    for (const line of head.split(/\r?\n/)) {
      const i = line.indexOf(':')
      if (i > 0 && !headers.has(line.slice(0, i).toLowerCase())) headers.set(line.slice(0, i).toLowerCase(), decodeHeader(line.slice(i + 1).trim()))
    }
    const at = Date.parse(headers.get('date') ?? '')
    if (!Number.isFinite(at)) continue
    const from = headers.get('from') ?? ''
    const sent = addresses(from).some((a) => mine.has(a))
    const plain = /content-type:\s*text\/plain/i.test(head) || !/content-type/i.test(head)
    const body = split < 0 || !plain ? '' : raw.slice(split).replace(/\s+/g, ' ').trim()
    out.push({ channel: 'email', direction: sent ? 'out' : 'in', counterpart: sent ? (headers.get('to') ?? '') : from, subject: headers.get('subject') ?? '', snippet: body.slice(0, SNIPPET), at, durationS: null })
  }
  return out
}
