import { today } from '../../shared/dates.ts'
import { createStore, useStore } from './store.ts'
import { openTab, type TabId } from './ui.ts'

// The day the day tabs (Activity, Map) show, shared so stepping one steps the other. Starts on today.

const dayStore = createStore(today())

export function useDay(): [string, (date: string) => void] {
  return [useStore(dayStore, (d) => d), (d) => dayStore.set(() => d)]
}

/** Shows `date` in a day tab (a click on a dashboard bar). */
export function openDay(date: string, tab: TabId = 'activity') {
  dayStore.set(() => date)
  openTab(tab)
}
