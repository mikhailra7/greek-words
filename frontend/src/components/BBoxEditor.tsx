import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export type BBox = [number, number, number, number]

type Mode = 'move' | 'nw' | 'ne' | 'sw' | 'se'
type Win = { x: number; y: number; w: number; h: number }

const MIN = 0.01
const FULL: Win = { x: 0, y: 0, w: 1, h: 1 }
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))

// A page region around the box, so a small picture is big enough to adjust on a phone.
function zoomWindow([x0, y0, x1, y1]: BBox): Win {
  const size = Math.min(1, Math.max(0.3, 2.2 * (x1 - x0), 2.2 * (y1 - y0)))
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return {
    x: clamp(cx - size / 2, 0, 1 - size),
    y: clamp(cy - size / 2, 0, 1 - size),
    w: size,
    h: size,
  }
}

// Rectangle over a page image; drag inside to move, drag a corner to resize.
// Coordinates are fractions of the page (0..1), same as Claude's bbox.
export default function BBoxEditor({
  src,
  value,
  onChange,
}: {
  src: string
  value: BBox
  onChange: (b: BBox) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ mode: Mode; x: number; y: number; start: BBox } | null>(null)
  const [aspect, setAspect] = useState<number | null>(null) // page width / height
  const [zoomed, setZoomed] = useState(true)
  const [win, setWin] = useState<Win>(() => zoomWindow(value))
  const view = zoomed ? win : FULL

  const begin = (mode: Mode) => (e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = { mode, x: e.clientX, y: e.clientY, start: value }
  }

  const move = (e: ReactPointerEvent) => {
    const d = drag.current
    const rect = box.current?.getBoundingClientRect()
    if (!d || !rect) return
    const dx = ((e.clientX - d.x) / rect.width) * view.w
    const dy = ((e.clientY - d.y) / rect.height) * view.h
    let [x0, y0, x1, y1] = d.start
    if (d.mode === 'move') {
      const w = x1 - x0
      const h = y1 - y0
      x0 = clamp(x0 + dx, 0, 1 - w)
      y0 = clamp(y0 + dy, 0, 1 - h)
      x1 = x0 + w
      y1 = y0 + h
    } else {
      if (d.mode.includes('w')) x0 = clamp(x0 + dx, 0, x1 - MIN)
      if (d.mode.includes('e')) x1 = clamp(x1 + dx, x0 + MIN, 1)
      if (d.mode.includes('n')) y0 = clamp(y0 + dy, 0, y1 - MIN)
      if (d.mode.includes('s')) y1 = clamp(y1 + dy, y0 + MIN, 1)
    }
    onChange([x0, y0, x1, y1])
  }

  const end = () => {
    drag.current = null
  }

  const toggleZoom = () => {
    if (!zoomed) setWin(zoomWindow(value)) // re-center on where the box is now
    setZoomed(!zoomed)
  }

  // Box position inside the visible window, in %.
  const [x0, y0, x1, y1] = value
  const pct = (v: number, o: number, s: number) => `${((v - o) / s) * 100}%`
  const handle = (mode: Mode, pos: string) => (
    <div
      onPointerDown={begin(mode)}
      className={`absolute size-7 -translate-1/2 ${pos} flex items-center justify-center`}
      style={{ touchAction: 'none' }}
    >
      <span className="size-3.5 rounded-full border-2 border-white bg-blue-600 shadow" />
    </div>
  )

  return (
    <div className="space-y-2">
      <div
        ref={box}
        className="relative w-full overflow-hidden rounded-lg bg-white select-none"
        style={{ aspectRatio: aspect ? `${(view.w * aspect) / view.h}` : '0.7' }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <img
          src={src}
          alt="Страница учебника"
          draggable={false}
          onLoad={(e) => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
          className="absolute max-w-none"
          style={{
            width: `${100 / view.w}%`,
            left: `${(-view.x / view.w) * 100}%`,
            top: `${(-view.y / view.h) * 100}%`,
          }}
        />
        {aspect && (
          <div
            onPointerDown={begin('move')}
            className="absolute cursor-move border-2 border-blue-600 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]"
            style={{
              left: pct(x0, view.x, view.w),
              top: pct(y0, view.y, view.h),
              width: `${((x1 - x0) / view.w) * 100}%`,
              height: `${((y1 - y0) / view.h) * 100}%`,
              touchAction: 'none',
            }}
          >
            {handle('nw', 'left-0 top-0')}
            {handle('ne', 'left-full top-0')}
            {handle('sw', 'left-0 top-full')}
            {handle('se', 'left-full top-full')}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={toggleZoom}
        className="text-sm text-blue-600 dark:text-blue-400"
      >
        {zoomed ? 'Показать всю страницу' : 'Приблизить к рамке'}
      </button>
    </div>
  )
}
