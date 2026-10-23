import { EVERY_DAY, type ChecklistBody } from '../../../shared/checklists.ts'

// The starter set offered while there are no checklists yet: everyday, ongoing, editable once added.

type Starter = Pick<ChecklistBody, 'title' | 'items'>

export const STARTERS: Starter[] = [
  {
    title: 'Projects',
    items: [
      { label: 'Finish tasks', target: 3, source: 'tasks-done' },
      { label: 'Write a progress note', target: 1, source: null },
    ],
  },
  {
    title: 'Learning',
    items: [
      { label: 'Watch talks or tutorials', target: 2, source: 'youtube-watched' },
      { label: 'Work through problems with AI', target: 5, source: 'ai-prompts' },
    ],
  },
  {
    title: 'Logtracker',
    items: [
      { label: 'Annotate the map', target: 1, source: null },
      { label: 'Annotate activity', target: 1, source: null },
      { label: 'Log expenses', target: 1, source: null },
      { label: 'Mark out sleep from the previous day', target: 1, source: null },
    ],
  },
]

/** A starter as a new checklist, due every day from `startDate`. */
export const starterBody = (s: Starter, startDate: string): ChecklistBody => ({ ...s, startDate, endDate: null, weekdays: EVERY_DAY })
