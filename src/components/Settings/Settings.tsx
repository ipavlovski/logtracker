import { useEffect, useState, type ReactNode } from 'react'
import type { TrayPrefs } from '../../../shared/desktop.ts'
import { versionLabel } from '../../../shared/versions.ts'
import { useStore } from '../../state/store.ts'
import { openSettings, prefsStore, setPref, uiStore } from '../../state/ui.ts'
import { openUpdates, updatesStore } from '../../state/updates.ts'
import { Modal } from '../Modal/Modal.tsx'
import styles from './Settings.module.css'

// The Settings window: appearance, the tray app (start with Windows, recording), the data folder and updates.

export function Settings() {
  const open = useStore(uiStore, (s) => s.settings)
  return open ? <SettingsWindow /> : null
}

function SettingsWindow() {
  const close = () => openSettings(false)
  const theme = useStore(prefsStore, (s) => s.theme)
  return (
    <Modal large className={styles.window} title="Settings" onClose={close}>
      <header className={styles.header}>
        <h2>Settings</h2>
        <button onClick={close} title="Close (Esc)" aria-label="Close">
          ✕
        </button>
      </header>
      <div className={styles.body}>
        <article className={styles.content}>
          {window.desktop && <DesktopGroups />}
          <Group title="Appearance">
            <Row label="Theme">
              <div className={styles.segmented} role="radiogroup" aria-label="Theme">
                {(['dark', 'light'] as const).map((t) => (
                  <button key={t} role="radio" aria-checked={theme === t} className={theme === t ? styles.on : ''} onClick={() => setPref('theme', t)}>
                    {t === 'dark' ? '☾ Dark' : '☀ Light'}
                  </button>
                ))}
              </div>
            </Row>
          </Group>
          <Group title="Keyboard">
            <p className={styles.note}>Ctrl+1 … Ctrl+0 switch tabs; Ctrl+, opens Settings; Ctrl+W closes the window to the tray.</p>
          </Group>
        </article>
      </div>
    </Modal>
  )
}

/** Desktop app only: the tray app's settings, the data folder and updates. */
function DesktopGroups() {
  const desktop = window.desktop!
  const { app, status } = useStore(updatesStore, (s) => s)
  const [prefs, setPrefs] = useState<TrayPrefs | null>(null)
  useEffect(() => void desktop.trayPrefs().then(setPrefs), [desktop])
  const set = (p: Partial<TrayPrefs>) => void desktop.setTrayPrefs(p).then(setPrefs)
  const pending = status?.state === 'available' || status?.state === 'downloading' || status?.state === 'ready'

  return (
    <>
      <Group title="Background">
        <p className={styles.note}>Closing the window keeps Logtracker running in the tray, recording activity and importing in the background. Quit it from the tray icon’s menu.</p>
        {prefs && (
          <>
            <Check checked={prefs.launchAtLogin} onChange={(v) => set({ launchAtLogin: v })} label="Start with Windows" hint="Starts hidden in the tray when you sign in (installed app only)." />
            <Check checked={prefs.recordingPaused} onChange={(v) => set({ recordingPaused: v })} label="Pause activity recording" hint="No keyboard and mouse activity is recorded until this is turned off again." />
          </>
        )}
      </Group>
      <Group title="Data">
        <Row label="Data folder" hint={app?.dataDir}>
          <button onClick={() => void desktop.showDataFolder()}>Show</button>
        </Row>
      </Group>
      <Group title="Updates">
        <Row label={app ? `Installed ${versionLabel(app.version)}${app.channel === 'dev' ? ' · LogtrackerDev' : ''}` : 'Installed version'} hint={pending ? 'An update is downloading or ready.' : undefined}>
          <button
            onClick={() => {
              openSettings(false)
              openUpdates(true)
            }}
          >
            {pending && <i className={styles.dot} />}
            Updates and releases
          </button>
        </Row>
      </Group>
    </>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div>
        <div>{label}</div>
        {hint && <div className={styles.hint}>{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className={styles.row}>
      <div>
        <div>{label}</div>
        {hint && <div className={styles.hint}>{hint}</div>}
      </div>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}
