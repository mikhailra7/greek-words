import { useState } from 'react'
import { api } from '../api/client.ts'

/** «Я знаю это слово» — saved on the server for the current user right on click. */
export async function setKnown(wordId: number, known: boolean): Promise<void> {
  await api(`/words/${wordId}/known`, { method: 'PUT', body: JSON.stringify({ known }) })
}

// Compact tick for word lists (dictionary, category).
export function KnownCheckbox({
  wordId,
  greek,
  known,
  onChange,
}: {
  wordId: number
  greek: string
  known: boolean
  onChange: (known: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const toggle = async () => {
    const next = !known
    onChange(next) // optimistic
    setBusy(true)
    try {
      await setKnown(wordId, next)
    } catch {
      onChange(!next)
    } finally {
      setBusy(false)
    }
  }
  return (
    <label
      className="flex shrink-0 cursor-pointer flex-col items-center gap-0.5 self-stretch justify-center px-2 text-[10px] text-slate-400"
      title="Я знаю это слово — не показывать в упражнениях"
    >
      <input
        type="checkbox"
        checked={known}
        disabled={busy}
        onChange={toggle}
        className="size-5 accent-green-600"
        aria-label={`Я знаю это слово: ${greek}`}
      />
      знаю
    </label>
  )
}

// «Сбросить выученные» for a dictionary or a category.
export function ResetKnownButton({
  count,
  url,
  onDone,
}: {
  count: number
  url: string
  onDone: () => void
}) {
  if (count === 0) return null
  const reset = async () => {
    if (!confirm(`Снять отметку «знаю» с ${count} сл.? Они снова появятся в упражнениях.`)) return
    await api(url, { method: 'POST' })
    onDone()
  }
  return (
    <button
      onClick={reset}
      className="rounded-xl px-4 py-2.5 text-sm font-medium text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950"
    >
      Сбросить выученные ({count})
    </button>
  )
}
