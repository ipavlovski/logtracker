import { shiftDate } from '../shared/dates.ts'
import type { ProgressItem, ProjectDTO } from '../shared/types.ts'

// Progress tab: project progress over time, one line per project (Tasks), one circle per day with tasks ticked or
// progress notes written.

export type ProgressScale = 'true' | 'compact'

/** project id → day → what was done that day (tasks, then notes). */
export type ProgressMap = Map<string, Map<string, ProgressItem[]>>

export function groupProgress(items: ProgressItem[]): ProgressMap {
  const map: ProgressMap = new Map()
  for (const i of [...items].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'task' ? -1 : 1))) {
    const days = map.get(i.projectId) ?? new Map<string, ProgressItem[]>()
    map.set(i.projectId, days)
    days.set(i.date, [...(days.get(i.date) ?? []), i])
  }
  return map
}

/** Projects in the order of the Tasks tab, archived ones last. */
export function sortProjects(projects: ProjectDTO[]): ProjectDTO[] {
  return [...projects].sort((a, b) => Number(a.archived) - Number(b.archived) || a.position - b.position)
}

/**
 * Timeline days, oldest first, ending at `end` (today) where every line terminates.
 * True scale lists every calendar day from the first activity; compact keeps only active days.
 */
export function progressRows(active: Iterable<string>, end: string, scale: ProgressScale): string[] {
  const dates = [...new Set(active)].sort()
  if (!dates.length) return []
  const last = dates[dates.length - 1]! > end ? dates[dates.length - 1]! : end
  if (scale === 'compact') return dates.includes(last) ? dates : [...dates, last]
  const rows: string[] = []
  for (let d = dates[0]!; d <= last; d = shiftDate(d, 1)) rows.push(d)
  return rows
}
