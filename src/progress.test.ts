import { describe, expect, it } from 'vitest'
import type { ProgressItem, ProjectDTO } from '../shared/types.ts'
import { groupProgress, progressRows, sortProjects } from './progress.ts'

const item = (id: string, projectId: string, date: string, kind: ProgressItem['kind'] = 'task'): ProgressItem => ({ id, projectId, date, kind, text: id })
const project = (id: string, position: number, archived = false): ProjectDTO => ({ id, title: id, color: null, archived, position })

describe('progress', () => {
  it('groups by project, then by day, tasks before notes', () => {
    const map = groupProgress([item('n', 'a', '2026-09-06', 'note'), item('t1', 'a', '2026-09-06'), item('t2', 'b', '2026-09-04'), item('t3', 'a', '2026-09-05')])
    expect([...map.keys()].sort()).toEqual(['a', 'b'])
    expect(map.get('a')!.get('2026-09-06')!.map((i) => i.id)).toEqual(['t1', 'n'])
    expect([...map.get('b')!.keys()]).toEqual(['2026-09-04'])
  })

  it('orders projects as the Tasks tab does, archived ones last', () => {
    expect(sortProjects([project('c', 1, true), project('b', 2), project('a', 3)]).map((p) => p.id)).toEqual(['b', 'a', 'c'])
  })

  it('lays out true scale with gaps and compact without, ending today', () => {
    const active = ['2026-09-06', '2026-09-04', '2026-09-06']
    expect(progressRows(active, '2026-09-09', 'true')).toEqual([
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
    ])
    expect(progressRows(active, '2026-09-09', 'compact')).toEqual(['2026-09-04', '2026-09-06', '2026-09-09'])
    expect(progressRows(['2026-09-09'], '2026-09-09', 'compact')).toEqual(['2026-09-09'])
    expect(progressRows([], '2026-09-09', 'true')).toEqual([])
  })
})
