import { createHash } from 'node:crypto'
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { today } from '../../../shared/dates.ts'
import { newId } from '../../../shared/id.ts'
import type { AccountDTO, Cadence, CsvMapping, CsvPreview, MonthSummary, ScheduledPaymentDTO, TransactionDTO } from '../../../shared/types.ts'
import { db } from '../../db/client.ts'
import { accounts, scheduledPayments, transactions } from '../../db/schema.ts'
import { notFound } from '../validate.ts'
import { readStatement, type StatementLine } from './csv.ts'

// Finance: accounts, transactions (logged by hand, imported from bank statements, or made by a scheduled payment
// being paid) and scheduled payments (rent, subscriptions…), with a month's totals by category.

type TxRow = typeof transactions.$inferSelect
const toTx = ({ importHash: _h, createdAt: _c, ...r }: TxRow): TransactionDTO => r

type ScheduledRow = typeof scheduledPayments.$inferSelect
const toScheduled = ({ createdAt: _c, ...r }: ScheduledRow): ScheduledPaymentDTO => r

// ── accounts ───────────────────────────────────────────────────────────────

export const listAccounts = (): AccountDTO[] => db.select({ id: accounts.id, name: accounts.name, currency: accounts.currency }).from(accounts).orderBy(asc(accounts.name)).all()

export function createAccount(name: string, currency = 'CAD'): AccountDTO {
  const row = { id: newId(), name, currency, createdAt: Date.now() }
  db.insert(accounts).values(row).run()
  return { id: row.id, name, currency }
}

export function deleteAccount(id: string) {
  db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id)).get() ?? notFound('account')
  db.delete(accounts).where(eq(accounts.id, id)).run()
}

// ── transactions ───────────────────────────────────────────────────────────

export function listTransactions(from: string, to: string): TransactionDTO[] {
  return db
    .select()
    .from(transactions)
    .where(and(gte(transactions.date, from), lte(transactions.date, to)))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .all()
    .map(toTx)
}

export type TransactionBody = Omit<TransactionDTO, 'id' | 'source'>

export function createTransaction(b: TransactionBody, source: TransactionDTO['source'] = 'manual'): TransactionDTO {
  const row = { id: newId(), ...b, source, importHash: null, createdAt: Date.now() }
  db.insert(transactions).values(row).run()
  return toTx(row)
}

const txRow = (id: string) => db.select().from(transactions).where(eq(transactions.id, id)).get() ?? notFound('transaction')

export function updateTransaction(id: string, b: Partial<TransactionBody>): TransactionDTO {
  txRow(id)
  if (Object.keys(b).length) db.update(transactions).set(b).where(eq(transactions.id, id)).run()
  return toTx(txRow(id))
}

export function deleteTransaction(id: string) {
  txRow(id)
  db.delete(transactions).where(eq(transactions.id, id)).run()
}

/** Same account, day, amount and description: the same statement line (the nth such line, for genuine repeats). */
function lineHashes(accountId: string | null, lines: StatementLine[]): string[] {
  const seen = new Map<string, number>()
  return lines.map((l) => {
    const key = `${accountId ?? ''}|${l.date}|${l.amount}|${l.payee.toLowerCase()}`
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    return createHash('sha256').update(`${key}|${n}`).digest('hex').slice(0, 32)
  })
}

function existingHashes(hashes: string[]): Set<string> {
  if (!hashes.length) return new Set()
  return new Set(
    db
      .select({ h: transactions.importHash })
      .from(transactions)
      .where(inArray(transactions.importHash, hashes))
      .all()
      .map((r) => r.h!),
  )
}

/** What importing a statement would add: its lines as read, the ones already imported marked. */
export function previewStatement(text: string, accountId: string | null, mapping?: CsvMapping): CsvPreview {
  const r = readStatement(text, mapping)
  const hashes = lineHashes(accountId, r.lines)
  const have = existingHashes(hashes)
  return { headers: r.headers, mapping: r.mapping, skipped: r.skipped, rows: r.lines.map((l, i) => ({ ...l, duplicate: have.has(hashes[i]!) })) }
}

/** Imports a statement's new lines; lines imported before (an overlapping statement) are left out. */
export function importStatement(text: string, accountId: string | null, mapping?: CsvMapping): { added: number; duplicates: number; skipped: number } {
  const r = readStatement(text, mapping)
  const hashes = lineHashes(accountId, r.lines)
  const have = existingHashes(hashes)
  const now = Date.now()
  let added = 0
  db.transaction(() => {
    r.lines.forEach((l, i) => {
      if (have.has(hashes[i]!)) return
      db.insert(transactions)
        .values({ id: newId(), accountId, date: l.date, amount: l.amount, payee: l.payee, category: guessCategory(l.payee), notes: '', source: 'csv', importHash: hashes[i]!, createdAt: now })
        .run()
      added++
    })
  })
  return { added, duplicates: r.lines.length - added, skipped: r.skipped }
}

/** The category this payee had the last time it was categorized by hand, so a statement mostly categorizes itself. */
function guessCategory(payee: string): string {
  const r = db
    .select({ category: transactions.category })
    .from(transactions)
    .where(and(eq(transactions.payee, payee), eq(transactions.source, 'manual')))
    .orderBy(desc(transactions.createdAt))
    .get()
  return r?.category ?? ''
}

export function monthSummary(month: string): MonthSummary {
  const rows = db
    .select({ amount: transactions.amount, category: transactions.category })
    .from(transactions)
    .where(and(gte(transactions.date, `${month}-01`), lte(transactions.date, `${month}-31`)))
    .all()
  const byCategory = new Map<string, number>()
  let income = 0
  let spent = 0
  for (const r of rows) {
    if (r.amount >= 0) income += r.amount
    else {
      spent -= r.amount
      byCategory.set(r.category || 'uncategorized', (byCategory.get(r.category || 'uncategorized') ?? 0) - r.amount)
    }
  }
  return { month, income, spent, byCategory: [...byCategory].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount) }
}

// ── scheduled payments ─────────────────────────────────────────────────────

export const listScheduled = (): ScheduledPaymentDTO[] => db.select().from(scheduledPayments).orderBy(asc(scheduledPayments.nextDue)).all().map(toScheduled)

export type ScheduledBody = Omit<ScheduledPaymentDTO, 'id' | 'archived'>

export function createScheduled(b: ScheduledBody): ScheduledPaymentDTO {
  const row = { id: newId(), ...b, archived: false, createdAt: Date.now() }
  db.insert(scheduledPayments).values(row).run()
  return toScheduled(row)
}

const scheduledRow = (id: string) => db.select().from(scheduledPayments).where(eq(scheduledPayments.id, id)).get() ?? notFound('scheduled payment')

export function updateScheduled(id: string, b: Partial<ScheduledBody & { archived: boolean }>): ScheduledPaymentDTO {
  scheduledRow(id)
  if (Object.keys(b).length) db.update(scheduledPayments).set(b).where(eq(scheduledPayments.id, id)).run()
  return toScheduled(scheduledRow(id))
}

export function deleteScheduled(id: string) {
  scheduledRow(id)
  db.delete(scheduledPayments).where(eq(scheduledPayments.id, id)).run()
}

/** The due date after `date` for a cadence; monthly ones stay on their day, or the month's last when it is shorter. */
export function nextDueAfter(date: string, cadence: Cadence): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  if (cadence === 'weekly') {
    const t = new Date(y, m - 1, d + 7)
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  }
  const months = cadence === 'monthly' ? 1 : cadence === 'quarterly' ? 3 : 12
  const target = new Date(y, m - 1 + months, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/** Logs a scheduled payment as paid (a transaction on `date`, today by default) and moves it to its next due date. */
export function markPaid(id: string, date = today()): { transaction: TransactionDTO; scheduled: ScheduledPaymentDTO } {
  const s = scheduledRow(id)
  const transaction = db.transaction(() => {
    const tx = createTransaction({ accountId: s.accountId, date, amount: s.amount, payee: s.payee, category: s.category, notes: '' }, 'scheduled')
    db.update(scheduledPayments).set({ nextDue: nextDueAfter(s.nextDue, s.cadence) }).where(eq(scheduledPayments.id, id)).run()
    return tx
  })
  return { transaction, scheduled: toScheduled(scheduledRow(id)) }
}
