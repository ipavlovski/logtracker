import type { ReactNode } from 'react'
import type { TabId } from './state/ui.ts'

// Line icons for the tab bar: 24-unit grid, drawn in currentColor.

const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)

export const TAB_ICONS: Record<TabId, ReactNode> = {
  dashboard: (
    <Icon>
      <rect x="3.5" y="3.5" width="7" height="9" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
      <rect x="3.5" y="15.5" width="7" height="5" rx="1.5" />
    </Icon>
  ),
  checklists: (
    <Icon>
      <path d="m4 7 2 2 4-4M4 16l2 2 4-4M13 7.5h7M13 16.5h7" />
    </Icon>
  ),
  tasks: (
    <Icon>
      <circle cx="5" cy="6" r="1.2" />
      <circle cx="8.5" cy="12" r="1.2" />
      <circle cx="5" cy="18" r="1.2" />
      <path d="M9 6h11M12.5 12h7.5M9 18h11" />
    </Icon>
  ),
  progress: (
    <Icon>
      <path d="M3.5 20.5h17" />
      <circle cx="6" cy="15" r="1.6" />
      <circle cx="11" cy="11" r="1.6" />
      <circle cx="15" cy="13" r="1.6" />
      <circle cx="19.5" cy="6.5" r="1.6" />
      <path d="m7.3 14 2.4-2M12.5 11.8l1 .5M16 11.7l2.6-3.9" />
    </Icon>
  ),
  calendar: (
    <Icon>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Icon>
  ),
  finance: (
    <Icon>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M16 15h2" />
    </Icon>
  ),
  comms: (
    <Icon>
      <path d="M4 5.5h16v10H9l-5 4z" />
      <path d="m14 9 2 1.5-2 1.5" />
    </Icon>
  ),
  digital: (
    <Icon>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.3 3.5 5.2 3.5 8.5s-1 6.2-3.5 8.5c-2.5-2.3-3.5-5.2-3.5-8.5s1-6.2 3.5-8.5z" />
    </Icon>
  ),
  activity: (
    <Icon>
      <path d="M2.5 12h4l2.5-6 4.5 12 2.5-6h5.5" />
    </Icon>
  ),
  map: (
    <Icon>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </Icon>
  ),
}

export const SETTINGS_ICON = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)
