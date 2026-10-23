import { createStore, persistedStore } from './store.ts'

// Which tab is open, the Settings window, toasts and viewer preferences.

export const TABS = ['dashboard', 'checklists', 'tasks', 'progress', 'calendar', 'finance', 'comms', 'digital', 'activity', 'map'] as const
export type TabId = (typeof TABS)[number]

interface UiState {
  settings: boolean
  toast: { id: number; message: string } | null
}

export const uiStore = createStore<UiState>({ settings: false, toast: null })

export function openSettings(open: boolean) {
  uiStore.set((s) => ({ ...s, settings: open }))
}

let toastId = 0
export function notify(message: string) {
  const id = ++toastId
  uiStore.set((s) => ({ ...s, toast: { id, message } }))
  setTimeout(() => uiStore.set((s) => (s.toast?.id === id ? { ...s, toast: null } : s)), 4000)
}

// Viewer preferences that survive reloads.
interface Prefs {
  theme: 'dark' | 'light'
  tab: TabId
}

const DEFAULT_PREFS: Prefs = { theme: 'dark', tab: 'dashboard' }

export const prefsStore = persistedStore<Prefs>('prefs.v1', DEFAULT_PREFS, (s) => {
  const p = { ...DEFAULT_PREFS, ...(s as Partial<Prefs>) }
  return { ...p, tab: TABS.includes(p.tab) ? p.tab : 'dashboard' }
})

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  prefsStore.set((s) => ({ ...s, [key]: value }))
}

export const openTab = (tab: TabId) => setPref('tab', tab)
