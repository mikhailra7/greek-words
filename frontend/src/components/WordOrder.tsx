import { useRef, useState, type PointerEvent } from 'react'
import type { Word } from '../api/types.ts'

// «Порядок слов» on a dictionary page (admins): hold the ⋮⋮ handle and drag a word to its
// place (finger or mouse), or nudge it with ↑ ↓. Every change is handed to `onChange` — the
// page saves it. The order is what «Порядок по словарю» in the trainers follows.

const EDGE = 70 // px from the top/bottom of the screen where the page scrolls by itself

export default function WordOrder({
  words,
  onChange,
}: {
  words: Word[]
  onChange: (words: Word[]) => void
}) {
  const [order, setOrderState] = useState(words)
  // The live order: pointer events come faster than re-renders.
  const current = useRef(words)
  const setOrder = (next: Word[]) => {
    current.current = next
    setOrderState(next)
  }
  const [dragging, setDragging] = useState<number | null>(null) // word id
  const rows = useRef(new Map<number, HTMLLIElement>())
  const changed = useRef(false)

  const move = (from: number, to: number, list = current.current) => {
    if (to < 0 || to >= list.length || to === from) return list
    const next = [...list]
    const [w] = next.splice(from, 1)
    next.splice(to, 0, w)
    setOrder(next)
    return next
  }

  // Where the pointer is: the row under it (by the middle of each row).
  const slotAt = (y: number) => {
    const list = current.current
    let slot = list.length - 1
    for (let i = 0; i < list.length; i++) {
      const r = rows.current.get(list[i].id)?.getBoundingClientRect()
      if (r && y < r.top + r.height / 2) {
        slot = i
        break
      }
    }
    return slot
  }

  const onDown = (e: PointerEvent, id: number) => {
    e.preventDefault()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    changed.current = false
    setDragging(id)
  }
  const onMove = (e: PointerEvent) => {
    if (dragging === null) return
    if (e.clientY < EDGE) window.scrollBy(0, -12)
    else if (e.clientY > window.innerHeight - EDGE) window.scrollBy(0, 12)
    const from = current.current.findIndex((w) => w.id === dragging)
    const to = slotAt(e.clientY)
    if (to !== from) {
      move(from, to)
      changed.current = true
    }
  }
  const onUp = () => {
    if (dragging === null) return
    setDragging(null)
    if (changed.current) onChange(current.current)
  }

  const nudge = (i: number, step: -1 | 1) => {
    const before = current.current
    const next = move(i, i + step)
    if (next !== before) onChange(next)
  }

  return (
    <ul
      className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white select-none dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900"
      aria-label="Порядок слов"
    >
      {order.map((w, i) => (
        <li
          key={w.id}
          ref={(el) => {
            if (el) rows.current.set(w.id, el)
            else rows.current.delete(w.id)
          }}
          className={`flex items-center gap-1 py-1.5 pr-1 ${
            dragging === w.id ? 'relative z-10 bg-blue-50 shadow-lg dark:bg-blue-950' : ''
          }`}
        >
          <button
            type="button"
            aria-label={`Перетащить ${w.full_greek}`}
            onPointerDown={(e) => onDown(e, w.id)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            // No page scrolling while the finger holds the handle.
            className="cursor-grab touch-none px-3 py-3 text-xl leading-none text-slate-400 active:cursor-grabbing"
          >
            ⋮⋮
          </button>
          <span className="w-6 shrink-0 text-right text-sm text-slate-400 tabular-nums">
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 pl-2">
            <span lang="el" className="block truncate font-medium">
              {w.full_greek}
            </span>
            <span className="block truncate text-sm text-slate-500">
              {w.translations_ru.join(', ')}
            </span>
          </span>
          <button
            type="button"
            aria-label={`Выше: ${w.full_greek}`}
            disabled={i === 0}
            onClick={() => nudge(i, -1)}
            className="rounded-lg px-2.5 py-2 text-lg text-slate-500 hover:bg-slate-100 disabled:opacity-25 dark:hover:bg-slate-800"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`Ниже: ${w.full_greek}`}
            disabled={i === order.length - 1}
            onClick={() => nudge(i, 1)}
            className="rounded-lg px-2.5 py-2 text-lg text-slate-500 hover:bg-slate-100 disabled:opacity-25 dark:hover:bg-slate-800"
          >
            ↓
          </button>
        </li>
      ))}
    </ul>
  )
}
