import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../api/client.ts'
import { pluralWords, type ActiveSummary, type Category } from '../api/types.ts'
import Sheet from '../components/Sheet.tsx'
import { Button, Card, ErrorText, Field, Input, Spinner } from '../components/ui.tsx'
import { categoryLabel } from '../lib/categories.ts'

// «Категории» tab of the Dictionaries page: tick categories to train on their words from
// every dictionary.
export default function CategoriesTab({
  isAdmin,
  onSummary,
}: {
  isAdmin: boolean
  onSummary: (s: ActiveSummary) => void
}) {
  const navigate = useNavigate()
  const [list, setList] = useState<Category[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => setList(await api<Category[]>('/categories')), [])

  useEffect(() => {
    load().catch((e: Error) => setError(e.message))
  }, [load])

  const toggle = async (c: Category) => {
    const active = !c.is_active
    setList((l) => l && l.map((x) => (x.id === c.id ? { ...x, is_active: active } : x)))
    try {
      onSummary(
        await api<ActiveSummary>(`/categories/${c.id}/active`, {
          method: 'PUT',
          body: JSON.stringify({ active }),
        }),
      )
    } catch (e) {
      setError((e as Error).message)
      await load()
    }
  }

  if (!list) return error ? <ErrorText>{error}</ErrorText> : <Spinner />

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Отмеченная категория добавляет в тренировки свои слова из всех словарей.
      </p>
      {isAdmin && <Button onClick={() => setCreating(true)}>+ Новая категория</Button>}
      <ErrorText>{error}</ErrorText>

      {list.length === 0 ? (
        <Card className="text-center text-slate-500">Категорий пока нет.</Card>
      ) : (
        <ul className="space-y-2">
          {list.map((c) => (
            <li key={c.id}>
              <Card className="flex items-stretch gap-1 p-0">
                <label className="flex cursor-pointer items-center py-4 pr-2 pl-4">
                  <input
                    type="checkbox"
                    className="size-6 accent-blue-600"
                    checked={c.is_active}
                    onChange={() => toggle(c)}
                    aria-label={`Использовать категорию «${c.name}» в тренировках`}
                  />
                </label>
                <Link
                  to={`/categories/${c.id}`}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 py-3 pr-4"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{categoryLabel(c)}</span>
                    <span className="block text-sm text-slate-500">
                      {c.word_count} {pluralWords(c.word_count)}
                    </span>
                  </span>
                  <span className="text-slate-400">›</span>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <Sheet title="Новая категория" onClose={() => setCreating(false)}>
          <CategoryForm
            onSubmit={async (name, emoji) => {
              const c = await api<Category>('/categories', {
                method: 'POST',
                body: JSON.stringify({ name, emoji }),
              })
              navigate(`/categories/${c.id}`)
            }}
          />
        </Sheet>
      )}
    </div>
  )
}

export function CategoryForm({
  initial,
  onSubmit,
}: {
  initial?: { name: string; emoji: string | null }
  onSubmit: (name: string, emoji: string | null) => Promise<void>
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [emoji, setEmoji] = useState(initial?.emoji ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSubmit(name, emoji || null)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-[1fr_5.5rem] gap-3">
        <Field label="Название">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Профессии"
            maxLength={60}
            required
            autoFocus
          />
        </Field>
        <Field label="Эмодзи">
          <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} className="text-center" />
        </Field>
      </div>
      <ErrorText>{error}</ErrorText>
      <Button type="submit" disabled={busy} className="w-full">
        {initial ? 'Сохранить' : 'Создать'}
      </Button>
    </form>
  )
}
