import { useState } from 'react'
import { formatJournalDate, today } from '../../../shared/dates.ts'
import type { AccountDTO, Cadence, CsvPreview, ScheduledPaymentDTO, TransactionDTO } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import { useFetch } from '../../hooks/useFetch.ts'
import { notify } from '../../state/ui.ts'
import { Modal, ModalActions } from '../Modal/Modal.tsx'
import tab from '../Tab/Tab.module.css'
import styles from './Finance.module.css'

// The Finance tab: a month of transactions with its totals by category, expenses logged by hand, bank statements
// imported from CSV (with a preview, and lines imported before left out), and scheduled payments, which log a
// transaction and move to their next due date when marked paid. Amounts are cents; negative is money out.

const CADENCES: Cadence[] = ['weekly', 'monthly', 'quarterly', 'yearly']

export const money = (cents: number) => (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'CAD' })

/** "12.50" → 1250 cents; null when it isn't an amount. */
const toCents = (s: string): number | null => {
  const n = Number(s.replace(/[,$\s]/g, ''))
  return s.trim() && Number.isFinite(n) ? Math.round(n * 100) : null
}

const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const fail = (err: Error) => notify(err.message)

export function Finance() {
  const [month, setMonth] = useState(today().slice(0, 7))
  const [bump, setBump] = useState(0)
  const [importing, setImporting] = useState(false)
  const reload = () => setBump((n) => n + 1)
  const key = `${month}|${bump}`
  const txs = useFetch(`fin-tx|${key}`, (signal) => unwrap(api.finance.transactions.$get({ query: { from: `${month}-01`, to: `${month}-31` } }, { init: { signal } })))
  const summary = useFetch(`fin-sum|${key}`, (signal) => unwrap(api.finance.summary.$get({ query: { month } }, { init: { signal } })))
  const scheduled = useFetch(`fin-sched|${bump}`, (signal) => unwrap(api.finance.scheduled.$get({}, { init: { signal } })))
  const accounts = useFetch(`fin-acc|${bump}`, (signal) => unwrap(api.finance.accounts.$get({}, { init: { signal } })))
  const accountList = accounts.data?.accounts ?? []

  return (
    <div className={tab.frame}>
      <header className={tab.header}>
        <h2>Finance</h2>
        <div className={tab.row}>
          <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
            ‹
          </button>
          <b className={styles.month}>{new Date(month + '-01T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b>
          <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
            ›
          </button>
        </div>
        <span className={tab.spacer} />
        <button onClick={() => setImporting(true)}>Import statement…</button>
      </header>
      <div className={`${tab.body} ${tab.columns}`}>
        <div className={tab.section}>
          <ExpenseForm accounts={accountList} onAdded={reload} />
          {txs.error && <p className={tab.error}>{txs.error.message}</p>}
          {txs.data && !txs.data.transactions.length ? (
            <p className={tab.empty}>Nothing this month. Log an expense above, import a bank statement (CSV), or mark a scheduled payment paid.</p>
          ) : (
            <table className={tab.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Payee</th>
                  <th>Category</th>
                  <th className={tab.num}>Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {txs.data?.transactions.map((t) => (
                  <TxRow key={t.id} tx={t} onChanged={reload} />
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className={tab.section}>
          <section className={tab.card}>
            <h3>This month</h3>
            {summary.data && (
              <>
                <div className={styles.totals}>
                  <span>
                    Out <b className={tab.neg}>{money(summary.data.spent)}</b>
                  </span>
                  <span>
                    In <b className={tab.pos}>{money(summary.data.income)}</b>
                  </span>
                </div>
                <ul className={styles.cats}>
                  {summary.data.byCategory.map((c) => (
                    <li key={c.category}>
                      <span>{c.category}</span>
                      <span className={styles.bar} style={{ width: `${(c.amount / Math.max(1, summary.data!.spent)) * 100}%` }} />
                      <b>{money(c.amount)}</b>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
          <Scheduled list={scheduled.data?.scheduled ?? []} accounts={accountList} onChanged={reload} />
          <Accounts list={accountList} onChanged={reload} />
        </div>
      </div>
      {importing && <ImportDialog accounts={accountList} onClose={() => setImporting(false)} onImported={reload} />}
    </div>
  )
}

function ExpenseForm({ accounts, onAdded }: { accounts: AccountDTO[]; onAdded: () => void }) {
  const [date, setDate] = useState(today())
  const [payee, setPayee] = useState('')
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [income, setIncome] = useState(false)
  const [accountId, setAccountId] = useState('')
  const add = () => {
    const cents = toCents(amount)
    if (cents == null) return notify('The amount isn’t a number')
    unwrap(api.finance.transactions.$post({ json: { date, payee, category, amount: income ? Math.abs(cents) : -Math.abs(cents), accountId: accountId || null } })).then(() => {
      setPayee('')
      setAmount('')
      onAdded()
    }, fail)
  }
  return (
    <div className={tab.form} onKeyDown={(e) => e.key === 'Enter' && add()}>
      <label>
        Date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className={tab.wide}>
        Payee
        <input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Where it went" />
      </label>
      <label>
        Category
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="groceries" size={12} />
      </label>
      <label>
        Amount
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" size={8} inputMode="decimal" />
      </label>
      {accounts.length > 0 && (
        <label>
          Account
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">—</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button className={income ? tab.on : ''} onClick={() => setIncome((v) => !v)} title="Money in rather than out">
        income
      </button>
      <button className={tab.primary} onClick={add} disabled={!amount}>
        Log
      </button>
    </div>
  )
}

function TxRow({ tx, onChanged }: { tx: TransactionDTO; onChanged: () => void }) {
  const [category, setCategory] = useState(tx.category)
  const save = () => category !== tx.category && unwrap(api.finance.transactions[':id'].$patch({ param: { id: tx.id }, json: { category } })).then(onChanged, fail)
  return (
    <tr>
      <td className={tab.time}>{tx.date.slice(5)}</td>
      <td className={tab.clip} title={tx.payee}>
        {tx.payee || <span className={tab.muted}>—</span>}
        {tx.source !== 'manual' && <span className={tab.muted}> · {tx.source}</span>}
      </td>
      <td>
        <input className={styles.cat} value={category} onChange={(e) => setCategory(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} placeholder="—" />
      </td>
      <td className={`${tab.num} ${tx.amount < 0 ? tab.neg : tab.pos}`}>{money(tx.amount)}</td>
      <td className={tab.row}>
        <button onClick={() => confirm('Delete this transaction?') && unwrap(api.finance.transactions[':id'].$delete({ param: { id: tx.id } })).then(onChanged, fail)} aria-label="Delete">
          ×
        </button>
      </td>
    </tr>
  )
}

function Scheduled({ list, accounts, onChanged }: { list: ScheduledPaymentDTO[]; accounts: AccountDTO[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false)
  const [payee, setPayee] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('')
  const [cadence, setCadence] = useState<Cadence>('monthly')
  const [nextDue, setNextDue] = useState(today())
  const t = today()
  const add = () => {
    const cents = toCents(amount)
    if (cents == null || !payee.trim()) return notify('A payment needs a payee and an amount')
    unwrap(api.finance.scheduled.$post({ json: { payee, amount: -Math.abs(cents), category, cadence, nextDue, accountId: accounts[0]?.id ?? null } })).then(() => {
      setAdding(false)
      setPayee('')
      setAmount('')
      onChanged()
    }, fail)
  }
  const active = list.filter((s) => !s.archived)
  return (
    <section className={tab.card}>
      <h3>Scheduled payments</h3>
      {!active.length && !adding && <p className={tab.empty}>Rent, subscriptions, bills: add them to see what’s due.</p>}
      <ul className={styles.scheduled}>
        {active.map((s) => (
          <li key={s.id} className={s.nextDue < t ? styles.overdue : ''}>
            <span className={styles.due}>{s.nextDue <= t ? (s.nextDue < t ? 'overdue' : 'today') : formatJournalDate(s.nextDue).replace(/, \d{4}$/, '')}</span>
            <span className={styles.payee} title={`${s.cadence}${s.category ? ` · ${s.category}` : ''}`}>
              {s.payee}
            </span>
            <b>{money(s.amount)}</b>
            <span className={tab.row}>
              <button onClick={() => unwrap(api.finance.scheduled[':id'].paid.$post({ param: { id: s.id }, json: {} })).then(onChanged, fail)} title="Log it as paid today and move to the next due date">
                paid
              </button>
              <button onClick={() => confirm(`Stop tracking ${s.payee}?`) && unwrap(api.finance.scheduled[':id'].$delete({ param: { id: s.id } })).then(onChanged, fail)} aria-label="Delete">
                ×
              </button>
            </span>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className={tab.form} onKeyDown={(e) => e.key === 'Enter' && add()}>
          <label className={tab.wide}>
            Payee
            <input autoFocus value={payee} onChange={(e) => setPayee(e.target.value)} />
          </label>
          <label>
            Amount
            <input value={amount} onChange={(e) => setAmount(e.target.value)} size={7} inputMode="decimal" />
          </label>
          <label>
            Category
            <input value={category} onChange={(e) => setCategory(e.target.value)} size={10} />
          </label>
          <label>
            Every
            <select value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
              {CADENCES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Next due
            <input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
          </label>
          <button className={tab.primary} onClick={add}>
            Add
          </button>
          <button onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <div className={tab.toolbar}>
          <button onClick={() => setAdding(true)}>+ scheduled payment</button>
        </div>
      )}
    </section>
  )
}

function Accounts({ list, onChanged }: { list: AccountDTO[]; onChanged: () => void }) {
  const [name, setName] = useState('')
  const add = () => name.trim() && unwrap(api.finance.accounts.$post({ json: { name } })).then(() => (setName(''), onChanged()), fail)
  return (
    <section className={tab.card}>
      <h3>Accounts</h3>
      <ul className={styles.scheduled}>
        {list.map((a) => (
          <li key={a.id}>
            <span className={styles.payee}>{a.name}</span>
            <span className={tab.muted}>{a.currency}</span>
            <span className={tab.row}>
              <button onClick={() => confirm(`Delete the account ${a.name}? Its transactions are kept.`) && unwrap(api.finance.accounts[':id'].$delete({ param: { id: a.id } })).then(onChanged, fail)} aria-label="Delete">
                ×
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className={tab.form} onKeyDown={(e) => e.key === 'Enter' && add()}>
        <label className={tab.wide}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New account (e.g. Chequing)" />
        </label>
        <button onClick={add} disabled={!name.trim()}>
          Add
        </button>
      </div>
    </section>
  )
}

function ImportDialog({ accounts, onClose, onImported }: { accounts: AccountDTO[]; onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [preview, setPreview] = useState<CsvPreview | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async (f: File | null, account = accountId) => {
    setFile(f)
    setPreview(null)
    if (!f) return
    try {
      setPreview(await unwrap(api.finance.import.preview.$post({ form: { file: f, ...(account ? { accountId: account } : {}) } })))
    } catch (err) {
      fail(err as Error)
    }
  }
  const run = async () => {
    if (!file || !preview) return
    setBusy(true)
    try {
      const r = await unwrap(api.finance.import.$post({ form: { file, ...(accountId ? { accountId } : {}), mapping: JSON.stringify(preview.mapping) } }))
      notify(`Imported ${r.added} transaction(s)${r.duplicates ? `, ${r.duplicates} already there` : ''}${r.skipped ? `, ${r.skipped} line(s) unreadable` : ''}`)
      onImported()
      onClose()
    } catch (err) {
      fail(err as Error)
    } finally {
      setBusy(false)
    }
  }
  const fresh = preview?.rows.filter((r) => !r.duplicate).length ?? 0
  const col = (i: number | null) => (i == null ? '—' : (preview?.headers[i] ?? `column ${i + 1}`))

  return (
    <Modal title="Import a bank statement" onClose={onClose}>
      <div className={`${tab.form} ${styles.import}`}>
        <label className={tab.wide}>
          CSV file
          <input type="file" accept=".csv,text/csv" onChange={(e) => void load(e.target.files?.[0] ?? null)} />
        </label>
        {accounts.length > 0 && (
          <label>
            Account
            <select
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value)
                void load(file, e.target.value)
              }}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {preview && (
        <>
          <p className={tab.muted}>
            Read as: date from “{col(preview.mapping.date)}”, payee from “{col(preview.mapping.description)}”,{' '}
            {preview.mapping.amount != null ? `amount from “${col(preview.mapping.amount)}”` : `out from “${col(preview.mapping.debit)}”, in from “${col(preview.mapping.credit)}”`}.{' '}
            {fresh} new, {preview.rows.length - fresh} already imported{preview.skipped ? `, ${preview.skipped} unreadable` : ''}.
          </p>
          <div className={styles.previewTable}>
            <table className={tab.table}>
              <tbody>
                {preview.rows.slice(0, 200).map((r, i) => (
                  <tr key={i} className={r.duplicate ? styles.dup : ''}>
                    <td className={tab.time}>{r.date}</td>
                    <td className={tab.clip}>{r.payee}</td>
                    <td className={`${tab.num} ${r.amount < 0 ? tab.neg : tab.pos}`}>{money(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <ModalActions>
        <button onClick={onClose}>Cancel</button>
        <button data-primary onClick={run} disabled={busy || !fresh}>
          Import {fresh || ''}
        </button>
      </ModalActions>
    </Modal>
  )
}
