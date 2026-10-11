import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api/client.ts'
import type { ActiveSummary } from '../api/types.ts'

export type StudyVia = 'dictionary' | 'category'

// «Использовать в тренировках» of a dictionary or a category: ticks «Изучать» on all its
// words; «–» when only some of them are ticked (a click then ticks all).
export function ActiveCheckbox({
  active,
  partial,
  onChange,
  label,
}: {
  active: boolean
  partial: boolean
  onChange: () => void
  label: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !active && partial
  }, [active, partial])
  return (
    <input
      ref={ref}
      type="checkbox"
      className="size-6 accent-blue-600"
      checked={active}
      onChange={onChange}
      aria-label={label}
    />
  )
}

/** The dictionary / category after its «Использовать в тренировках» was clicked. */
export function afterActiveToggle<T extends { is_active: boolean; study_count: number }>(
  x: T,
  wordCount: number,
): T {
  const active = !x.is_active
  return { ...x, is_active: active, study_count: active ? wordCount : 0 }
}

// «Изучать» on one word in a list (dictionary or category page) — saved right on click.
export function StudyCheckbox({
  wordId,
  greek,
  study,
  via,
  onChange,
  onSummary,
}: {
  wordId: number
  greek: string
  study: boolean
  via: StudyVia
  onChange: (study: boolean) => void
  onSummary?: (s: ActiveSummary) => void
}) {
  const [busy, setBusy] = useState(false)
  const toggle = async () => {
    const next = !study
    onChange(next) // optimistic
    setBusy(true)
    try {
      // Not inside `onSummary?.(…)`: without onSummary the request wouldn't be sent at all.
      const summary = await api<ActiveSummary>(`/words/${wordId}/study`, {
        method: 'PUT',
        body: JSON.stringify({ study: next, via }),
      })
      onSummary?.(summary)
    } catch {
      onChange(!next)
    } finally {
      setBusy(false)
    }
  }
  return (
    <label
      className="flex shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 self-stretch pl-2 text-[10px] text-slate-400"
      title={
        via === 'dictionary'
          ? 'Изучать — слово попадёт в тренировки'
          : 'Изучать в этой категории — слово попадёт в тренировки'
      }
    >
      <input
        type="checkbox"
        checked={study}
        disabled={busy}
        onChange={toggle}
        className="size-5 accent-blue-600"
        aria-label={`Изучать: ${greek}`}
      />
      учить
    </label>
  )
}

// «Есть в словарях»: the other dictionaries with the same word — to find duplicates.
export function AlsoIn({ dictionaries }: { dictionaries: { id: number; title: string }[] }) {
  if (dictionaries.length === 0) return null
  return (
    <span className="block truncate text-xs text-amber-700 dark:text-amber-400">
      Есть в словарях: {dictionaries.map((d) => d.title).join(', ')}
    </span>
  )
}

// The same in a word's card, with links — to open the other dictionary and delete the twin.
export function AlsoInLinks({
  dictionaries,
  onOpen,
}: {
  dictionaries: { id: number; title: string }[]
  onOpen?: () => void
}) {
  if (dictionaries.length === 0) return null
  return (
    <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      Есть в словарях:{' '}
      {dictionaries.map((d, i) => (
        <span key={d.id}>
          {i > 0 && ', '}
          <Link to={`/dictionaries/${d.id}`} onClick={onOpen} className="underline">
            {d.title}
          </Link>
        </span>
      ))}
    </p>
  )
}
