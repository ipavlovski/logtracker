import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { today } from '../../../shared/dates.ts'
import type { ProjectDTO, TaskDTO } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import { useFetch } from '../../hooks/useFetch.ts'
import { emitChange, useRevision } from '../../state/bus.ts'
import { notify } from '../../state/ui.ts'
import tab from '../Tab/Tab.module.css'
import styles from './Tasks.module.css'

// The Tasks tab: every project as a bullet list of its tasks. Typing edits a task (saved when the caret leaves it);
// Enter adds one below, Tab / Shift+Tab indent, Backspace on an empty task deletes it, a click on the bullet ticks it.
// A project's "progress" line logs a note for today (the Progress tab shows notes with the tasks ticked). Double-click a
// project's name to rename it.

const PALETTE = ['#6d9df0', '#5fb878', '#d9a25f', '#a48be0', '#e08a74', '#7fb4ad', '#d77fb0', '#e0c36b']
const MAX_INDENT = 6

const fail = (err: Error) => notify(err.message)

export function Tasks() {
  const rev = useRevision('tasks')
  const [showDone, setShowDone] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [local, setLocal] = useState<TaskDTO[] | null>(null)
  const { data, error } = useFetch(`tasks|${rev}`, async (signal) => {
    const [p, t] = await Promise.all([unwrap(api.projects.$get({}, { init: { signal } })), unwrap(api.tasks.$get({ query: {} }, { init: { signal } }))])
    return { projects: p.projects, tasks: t.tasks }
  })
  // Edits apply here at once and are saved in the background; a refetch replaces them.
  useEffect(() => setLocal(data?.tasks ?? null), [data])
  const tasks = local ?? []

  const reload = () => emitChange('global')
  const patch = (id: string, p: Partial<TaskDTO>) => {
    setLocal((l) => l?.map((t) => (t.id === id ? { ...t, ...p } : t)) ?? null)
    unwrap(api.tasks[':id'].$patch({ param: { id }, json: p })).then(() => emitChange('tasks'), fail)
  }
  const add = async (projectId: string, afterId?: string, indent?: number) => {
    try {
      const t = await unwrap(api.tasks.$post({ json: { projectId, text: '', ...(afterId ? { afterId } : {}), ...(indent !== undefined ? { indent } : {}) } }))
      setLocal((l) => [...(l ?? []), t])
      setFocusId(t.id)
      emitChange('tasks')
    } catch (err) {
      fail(err as Error)
    }
  }
  const remove = (t: TaskDTO, focusPrev: boolean) => {
    const list = tasks.filter((x) => x.projectId === t.projectId).sort((a, b) => a.position - b.position)
    const prev = list[list.findIndex((x) => x.id === t.id) - 1]
    setLocal((l) => l?.filter((x) => x.id !== t.id) ?? null)
    if (focusPrev && prev) setFocusId(prev.id)
    unwrap(api.tasks[':id'].$delete({ param: { id: t.id } })).then(() => emitChange('tasks'), fail)
  }

  const [naming, setNaming] = useState(false)
  const newProject = (title: string) => {
    setNaming(false)
    if (!title.trim()) return
    const color = PALETTE[(data?.projects.length ?? 0) % PALETTE.length]!
    unwrap(api.projects.$post({ json: { title: title.trim(), color } })).then(reload, fail)
  }

  const projects = (data?.projects ?? []).filter((p) => showArchived || !p.archived)
  const open = tasks.filter((t) => !t.done).length

  return (
    <div className={tab.frame}>
      <header className={tab.header}>
        <h2>Tasks</h2>
        {data && <span className={tab.muted}>{open} open</span>}
        <span className={tab.spacer} />
        <button className={showDone ? tab.on : ''} onClick={() => setShowDone((v) => !v)} title="Show ticked tasks">
          done
        </button>
        <button className={showArchived ? tab.on : ''} onClick={() => setShowArchived((v) => !v)} title="Show archived projects">
          archived
        </button>
        {naming ? (
          <NameInput placeholder="Project name" onDone={newProject} />
        ) : (
          <button className={tab.primary} onClick={() => setNaming(true)}>
            + project
          </button>
        )}
      </header>
      <div className={tab.body}>
        {error && <p className={tab.error}>{error.message}</p>}
        {data && !data.projects.length && <p className={tab.empty}>No projects yet. A project is a list of tasks; ticking them (and progress notes) draws its line in the Progress tab.</p>}
        {projects.map((p) => (
          <ProjectList
            key={p.id}
            project={p}
            tasks={tasks.filter((t) => t.projectId === p.id && (showDone || !t.done)).sort((a, b) => a.position - b.position)}
            focusId={focusId}
            onFocused={() => setFocusId(null)}
            onAdd={(afterId, indent) => add(p.id, afterId, indent)}
            onPatch={patch}
            onRemove={remove}
            onChanged={reload}
          />
        ))}
      </div>
    </div>
  )
}

interface ListProps {
  project: ProjectDTO
  tasks: TaskDTO[]
  focusId: string | null
  onFocused: () => void
  onAdd: (afterId?: string, indent?: number) => void
  onPatch: (id: string, p: Partial<TaskDTO>) => void
  onRemove: (t: TaskDTO, focusPrev: boolean) => void
  onChanged: () => void
}

function ProjectList({ project, tasks, focusId, onFocused, onAdd, onPatch, onRemove, onChanged }: ListProps) {
  const [note, setNote] = useState('')
  const saveNote = () => {
    const text = note.trim()
    if (!text) return
    unwrap(api.progress.notes.$post({ json: { projectId: project.id, date: today(), text } })).then(() => {
      setNote('')
      notify(`Progress noted on ${project.title}`)
      onChanged()
    }, fail)
  }
  const [renaming, setRenaming] = useState(false)
  const rename = (value: string) => {
    setRenaming(false)
    const title = value.trim()
    if (title && title !== project.title) unwrap(api.projects[':id'].$patch({ param: { id: project.id }, json: { title } })).then(onChanged, fail)
  }
  const archive = () => unwrap(api.projects[':id'].$patch({ param: { id: project.id }, json: { archived: !project.archived } })).then(onChanged, fail)
  const del = () => {
    if (confirm(`Delete ${project.title} and its ${tasks.length} task(s)?`)) unwrap(api.projects[':id'].$delete({ param: { id: project.id } })).then(onChanged, fail)
  }

  return (
    <section className={`${styles.project} ${project.archived ? styles.archived : ''}`} style={{ '--c': project.color ?? 'var(--accent)' } as CSSProperties}>
      <header>
        <span className={styles.swatch} />
        {renaming ? (
          <NameInput initial={project.title} placeholder="Project name" onDone={rename} />
        ) : (
          <h3 onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
            {project.title}
          </h3>
        )}
        <span className={tab.muted}>{tasks.filter((t) => !t.done).length} open</span>
        <span className={tab.spacer} />
        <div className={tab.row}>
          <button onClick={() => onAdd()}>+ task</button>
          <button onClick={archive}>{project.archived ? 'unarchive' : 'archive'}</button>
          <button onClick={del}>delete</button>
        </div>
      </header>
      <ul className={styles.tasks}>
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} focus={focusId === t.id} onFocused={onFocused} onAdd={onAdd} onPatch={onPatch} onRemove={onRemove} />
        ))}
        {!tasks.length && (
          <li className={styles.none}>
            <button onClick={() => onAdd()}>Add a task</button>
          </li>
        )}
      </ul>
      <div className={styles.note}>
        <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveNote()} placeholder="Progress today… (Enter to log it)" />
      </div>
    </section>
  )
}

function TaskRow({ task, focus, onFocused, onAdd, onPatch, onRemove }: { task: TaskDTO; focus: boolean; onFocused: () => void } & Pick<ListProps, 'onAdd' | 'onPatch' | 'onRemove'>) {
  const ref = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(task.text)
  useEffect(() => setText(task.text), [task.text])
  useEffect(() => {
    if (!focus) return
    ref.current?.focus()
    onFocused()
  }, [focus, onFocused])

  const commit = () => text !== task.text && onPatch(task.id, { text })
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
      onAdd(task.id, task.indent)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const indent = Math.max(0, Math.min(MAX_INDENT, task.indent + (e.shiftKey ? -1 : 1)))
      if (indent !== task.indent) onPatch(task.id, { indent })
    } else if (e.key === 'Backspace' && !text) {
      e.preventDefault()
      onRemove(task, true)
    } else if (e.key === 'Escape') ref.current?.blur()
  }

  return (
    <li className={task.done ? styles.done : ''} style={{ paddingLeft: task.indent * 22 }}>
      <button className={styles.bullet} onClick={() => onPatch(task.id, { done: !task.done })} aria-label={task.done ? 'Mark open' : 'Mark done'} title={task.done ? 'Done: click to reopen' : 'Click to tick'} />
      <input ref={ref} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onKey} placeholder="Task" spellCheck={false} />
      {task.due && <span className={styles.due}>{task.due}</span>}
    </li>
  )
}

/** A one-line name editor: Enter or leaving it saves, Esc cancels (an empty name too). */
function NameInput({ initial = '', placeholder, onDone }: { initial?: string; placeholder: string; onDone: (value: string) => void }) {
  const done = useRef(false)
  const finish = (v: string) => {
    if (done.current) return
    done.current = true
    onDone(v)
  }
  return (
    <input
      className={styles.name}
      autoFocus
      defaultValue={initial}
      placeholder={placeholder}
      onFocus={(e) => e.target.select()}
      onBlur={(e) => finish(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish('')
      }}
    />
  )
}
