import { lazy, Suspense, useEffect, type ComponentType } from 'react'
import { versionLabel } from '../shared/versions.ts'
import { Activity } from './components/Activity/Activity.tsx'
import { Calendar } from './components/Calendar/Calendar.tsx'
import { Checklists } from './components/Checklists/Checklists.tsx'
import { Comms } from './components/Comms/Comms.tsx'
import { Dashboard } from './components/Dashboard/Dashboard.tsx'
import { Digital } from './components/Digital/Digital.tsx'
import { Finance } from './components/Finance/Finance.tsx'
import { Progress } from './components/Progress/Progress.tsx'
import { Settings } from './components/Settings/Settings.tsx'
import { Tasks } from './components/Tasks/Tasks.tsx'
import { Updates } from './components/Updates/Updates.tsx'
import { SETTINGS_ICON, TAB_ICONS } from './icons.tsx'
import { useStore } from './state/store.ts'
import { openSettings, openTab, prefsStore, TABS, uiStore, type TabId } from './state/ui.ts'
import { updatesStore } from './state/updates.ts'
import styles from './App.module.css'

// One window, one tab at a time: the tab bar on the left, the tab filling the rest.

const TAB_TITLES: Record<TabId, string> = {
  dashboard: 'Dashboard',
  checklists: 'Checklists',
  tasks: 'Tasks',
  progress: 'Progress',
  calendar: 'Calendar',
  finance: 'Finance',
  comms: 'Communications',
  digital: 'Digital activity',
  activity: 'Activity',
  map: 'Map',
}

// MapLibre + deck.gl are large: loaded only when the tab opens.
const MapTab = lazy(() => import('./components/Map/MapTab.tsx').then((m) => ({ default: m.MapTab })))

const VIEWS: Record<TabId, ComponentType> = {
  dashboard: Dashboard,
  checklists: Checklists,
  tasks: Tasks,
  progress: Progress,
  calendar: Calendar,
  finance: Finance,
  comms: Comms,
  digital: Digital,
  activity: Activity,
  map: MapTab,
}

export function App() {
  const theme = useStore(prefsStore, (s) => s.theme)
  const tab = useStore(prefsStore, (s) => s.tab)
  const View = VIEWS[tab]

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Ctrl+1…9, 0 switch tabs; Ctrl+, opens Settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      if (e.key === ',') {
        e.preventDefault()
        openSettings(!uiStore.get().settings)
      }
      const n = '1234567890'.indexOf(e.key)
      if (n >= 0 && TABS[n]) {
        e.preventDefault()
        openTab(TABS[n])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={styles.app}>
      <nav className={styles.tabs} role="tablist" aria-orientation="vertical">
        <span className={styles.brand}>logtracker</span>
        {TABS.map((t, i) => (
          <button key={t} role="tab" aria-selected={t === tab} className={t === tab ? styles.active : ''} onClick={() => openTab(t)} title={`${TAB_TITLES[t]} (Ctrl+${(i + 1) % 10})`}>
            {TAB_ICONS[t]}
            <span>{TAB_TITLES[t]}</span>
          </button>
        ))}
        <span className={styles.spacer} />
        <SettingsButton />
      </nav>
      <main className={styles.main}>
        <Suspense fallback={null}>
          <View key={tab} />
        </Suspense>
      </main>
      <Settings />
      <Updates />
      <UpdatePrompt />
      <Toast />
    </div>
  )
}

/** Opens Settings (theme, tray, updates…); the dot means an update is downloading or ready. */
function SettingsButton() {
  const state = useStore(updatesStore, (s) => s.status?.state)
  const pending = state === 'available' || state === 'downloading' || state === 'ready'
  return (
    <button onClick={() => openSettings(true)} title={pending ? 'Settings (Ctrl+,): an update is downloading or ready' : 'Settings (Ctrl+,)'}>
      {SETTINGS_ICON}
      <span>Settings</span>
      {pending && <i className={styles.badge} />}
    </button>
  )
}

/** Desktop app only: offers a restart once an update has downloaded (it also installs on quit). */
function UpdatePrompt() {
  const status = useStore(updatesStore, (s) => s.status)
  if (status?.state !== 'ready') return null
  return (
    <div className={styles.update} role="status">
      Version {versionLabel(status.version)} is ready.
      <button onClick={() => window.desktop!.installUpdate()}>Restart to update</button>
    </div>
  )
}

function Toast() {
  const toast = useStore(uiStore, (s) => s.toast)
  return toast ? (
    <div className={styles.toast} role="status">
      {toast.message}
    </div>
  ) : null
}
