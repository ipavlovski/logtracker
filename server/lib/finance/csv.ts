import type { CsvMapping } from '../../../shared/types.ts'

// Bank statement CSVs: banks disagree on everything, so the columns are guessed from the header (date, description,
// amount, or debit + credit) and, failing that, from what the cells look like. Dates may be ISO, M/D/Y or D/M/Y (told
// apart by a day over 12 anywhere in the column); amounts may carry currency signs, thousands separators, parentheses
// or a trailing CR/DR.

/** Splits CSV text into rows of cells: quoted fields, doubled quotes, CRLF, and `,` or `;` separators. */
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, '')
  const firstLine = body.slice(0, body.indexOf('\n') >>> 0)
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') cell += '"', i++
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) row.push(cell), (cell = '')
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((c) => c.trim())) rows.push(row.map((c) => c.trim()))
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim())) rows.push(row.map((c) => c.trim()))
  return rows
}

/** Cents from "1,234.56", "$-12.00", "(12.00)", "12.00 DR"; null when it isn't an amount. */
export function parseAmount(s: string): number | null {
  let t = s.replace(/[\s$€£¥]|CAD|USD|EUR|GBP/gi, '')
  if (!t) return null
  let sign = 1
  if (/^\(.*\)$/.test(t)) (sign = -1), (t = t.slice(1, -1))
  if (/DR$/i.test(t)) (sign = -1), (t = t.slice(0, -2))
  else if (/CR$/i.test(t)) t = t.slice(0, -2)
  if (t.endsWith('-')) (sign = -sign), (t = t.slice(0, -1))
  // "1.234,56" (comma decimals) vs "1,234.56".
  if (/,\d{2}$/.test(t) && !/\.\d{2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.')
  else t = t.replace(/,/g, '')
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null
  return sign * Math.round(Number(t) * 100)
}

type DateOrder = 'ymd' | 'mdy' | 'dmy'

const DATE_RE = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})/

/** YYYY-MM-DD from a cell, in the given order; null when it isn't a date. */
export function parseDate(s: string, order: DateOrder): string | null {
  const m = DATE_RE.exec(s)
  if (!m) return null
  let [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])]
  let y: number, mo: number, d: number
  if (m[1]!.length === 4) [y, mo, d] = [a, b, c]
  else {
    if (c < 100) c += 2000
    ;[y, mo, d] = order === 'dmy' ? [c, b, a] : [c, a, b]
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return Number.isNaN(Date.parse(iso)) ? null : iso
}

/** D/M/Y when a first part over 12 shows up, otherwise M/D/Y (ISO dates read the same either way). */
function dateOrder(cells: string[]): DateOrder {
  for (const c of cells) {
    const m = DATE_RE.exec(c)
    if (m && m[1]!.length !== 4 && Number(m[1]) > 12) return 'dmy'
  }
  return 'mdy'
}

const HEADER = {
  date: /date|posted|transaction date/i,
  description: /desc|payee|merchant|details|memo|narrative|name|transaction$/i,
  amount: /^amount|^value|^sum/i,
  debit: /debit|withdrawal|paid out|money out|out$/i,
  credit: /credit|deposit|paid in|money in|in$/i,
}

/** Which columns hold what, and whether the first row is a header. */
export function detectMapping(rows: string[][]): { mapping: CsvMapping; header: boolean } {
  const first = rows[0] ?? []
  const header = first.length > 0 && !first.some((c) => DATE_RE.test(c)) && first.every((c) => parseAmount(c) === null)
  const data = header ? rows.slice(1, 50) : rows.slice(0, 50)
  const width = Math.max(...rows.map((r) => r.length), 0)
  const col = (i: number) => data.map((r) => r[i] ?? '')
  const share = (i: number, test: (s: string) => boolean) => col(i).filter((c) => c && test(c)).length / Math.max(1, data.length)
  const find = (re: RegExp) => (header ? first.findIndex((h) => re.test(h)) : -1)

  let date = find(HEADER.date)
  if (date < 0) date = [...Array(width).keys()].find((i) => share(i, (c) => DATE_RE.test(c)) > 0.8) ?? 0
  const debit = find(HEADER.debit)
  const credit = find(HEADER.credit)
  let amount = find(HEADER.amount)
  const split = amount < 0 && debit >= 0 && credit >= 0 && debit !== credit
  if (amount < 0 && !split) amount = [...Array(width).keys()].find((i) => i !== date && share(i, (c) => parseAmount(c) !== null) > 0.8) ?? -1
  let description = find(HEADER.description)
  if (description < 0 || description === date) {
    // The column with the longest text that isn't a date or an amount.
    const avg = (i: number) => col(i).reduce((n, c) => n + (parseAmount(c) === null && !DATE_RE.test(c) ? c.length : 0), 0)
    description = [...Array(width).keys()].filter((i) => i !== date && i !== amount).sort((a, b) => avg(b) - avg(a))[0] ?? 1
  }
  return { header, mapping: { date, description, amount: split ? null : amount, debit: split ? debit : null, credit: split ? credit : null } }
}

export interface StatementLine {
  date: string
  payee: string
  amount: number
}

/** Reads a statement's lines with `mapping` (detected when not given). */
export function readStatement(text: string, given?: CsvMapping): { headers: string[]; mapping: CsvMapping; lines: StatementLine[]; skipped: number } {
  const rows = parseCsv(text)
  const detected = detectMapping(rows)
  const mapping = given ?? detected.mapping
  const data = detected.header ? rows.slice(1) : rows
  const order = dateOrder(data.map((r) => r[mapping.date] ?? ''))
  const lines: StatementLine[] = []
  let skipped = 0
  for (const r of data) {
    const date = parseDate(r[mapping.date] ?? '', order)
    let amount: number | null
    if (mapping.amount != null) amount = parseAmount(r[mapping.amount] ?? '')
    else {
      const out = parseAmount(r[mapping.debit ?? -1] ?? '')
      const inn = parseAmount(r[mapping.credit ?? -1] ?? '')
      amount = out == null && inn == null ? null : (inn ?? 0) - Math.abs(out ?? 0)
    }
    if (!date || amount == null) {
      skipped++
      continue
    }
    lines.push({ date, payee: (r[mapping.description] ?? '').replace(/\s+/g, ' '), amount })
  }
  return { headers: detected.header ? rows[0]! : (rows[0] ?? []).map((_, i) => `Column ${i + 1}`), mapping, lines, skipped }
}
