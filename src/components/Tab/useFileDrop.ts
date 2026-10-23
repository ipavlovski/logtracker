import { useState, type DragEvent } from 'react'

/** Files dropped anywhere on an element: spread `props` on it; `over` is true while files are dragged over it. */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false)
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setOver(true)
      },
      onDragLeave: (e: DragEvent) => {
        if (e.currentTarget === e.target) setOver(false)
      },
      onDrop: (e: DragEvent) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setOver(false)
        onFiles([...e.dataTransfer.files])
      },
    },
  }
}
