import { useState } from 'react'
import { api } from '../api/client.ts'
import type { Category, Word } from '../api/types.ts'
import { categoryLabel } from '../lib/categories.ts'
import Sheet from './Sheet.tsx'
import { ErrorText } from './ui.tsx'

const NEW = 'new'

// Quick labelling: the dictionary's words without a category, one picker per row, saved on
// change. Rows stay until the sheet is closed, so a wrong pick can be fixed right away.
export default function CategorizeSheet({
  words,
  categories,
  onCategoryCreated,
  onClose,
}: {
  words: Word[]
  categories: Category[]
  onCategoryCreated: (c: Category) => void
  onClose: (changed: boolean) => void
}) {
  // Snapshot of the uncategorized words when the sheet opened.
  const [rows] = useState(() => words.filter((w) => !w.category_id))
  const [chosen, setChosen] = useState<Record<number, number | null>>({})
  const [saving, setSaving] = useState<number | null>(null)
  const [error, setError] = useState('')

  const left = rows.filter((w) => !chosen[w.id]).length

  const setCategory = async (word: Word, value: string) => {
    setError('')
    let categoryId: number | null = value ? Number(value) : null
    if (value === NEW) {
      const name = prompt('Название новой категории')?.trim()
      if (!name) return
      try {
        const c = await api<Category>('/categories', {
          method: 'POST',
          body: JSON.stringify({ name }),
        })
        onCategoryCreated(c)
        categoryId = c.id
      } catch (e) {
        setError((e as Error).message)
        return
      }
    }
    setSaving(word.id)
    try {
      await api(`/words/${word.id}/category`, {
        method: 'PATCH',
        body: JSON.stringify({ category_id: categoryId }),
      })
      setChosen((m) => ({ ...m, [word.id]: categoryId }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(null)
    }
  }

  return (
    <Sheet title={`Без категории: ${left}`} onClose={() => onClose(Object.keys(chosen).length > 0)}>
      <p className="mb-3 text-sm text-slate-500">Выберите категорию — она сохраняется сразу.</p>
      <ErrorText>{error}</ErrorText>
      {rows.length === 0 ? (
        <p className="text-slate-500">Все слова этого словаря уже с категориями.</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {rows.map((w) => {
            const value = chosen[w.id]
            return (
              <li key={w.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span lang="el" className="block truncate font-medium">
                    {w.full_greek}
                  </span>
                  <span className="block truncate text-sm text-slate-500">
                    {w.translations_ru.join(', ')}
                  </span>
                </span>
                <span className="w-5 text-center text-green-600" aria-hidden="true">
                  {value ? '✓' : ''}
                </span>
                <select
                  value={value ? String(value) : ''}
                  disabled={saving === w.id}
                  onChange={(e) => setCategory(w, e.target.value)}
                  aria-label={`Категория для ${w.full_greek}`}
                  className="w-40 shrink-0 rounded-xl border border-slate-300 bg-white px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                >
                  <option value="">— выбрать —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {categoryLabel(c)}
                    </option>
                  ))}
                  <option value={NEW}>＋ Новая категория…</option>
                </select>
              </li>
            )
          })}
        </ul>
      )}
    </Sheet>
  )
}
