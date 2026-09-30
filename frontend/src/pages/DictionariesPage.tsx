import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { api } from '../api/client.ts'
import {
  activeSummaryText,
  pluralWords,
  type ActiveSummary,
  type Dictionary,
} from '../api/types.ts'
import { useAuth } from '../auth/AuthContext.tsx'
import Sheet from '../components/Sheet.tsx'
import { Button, Card, ErrorText, Field, Input, Spinner } from '../components/ui.tsx'
import CategoriesTab from './CategoriesTab.tsx'
import HowToAddTab from './HowToAddTab.tsx'

type ListResponse = { dictionaries: Dictionary[]; active: ActiveSummary }

export default function DictionariesPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab =
    requested === 'categories' || (requested === 'help' && user?.is_admin)
      ? requested
      : 'dictionaries'

  const load = useCallback(async () => setData(await api<ListResponse>('/dictionaries')), [])

  useEffect(() => {
    load().catch((e: Error) => setError(e.message))
  }, [load])

  const toggle = async (d: Dictionary) => {
    if (!data) return
    const active = !d.is_active
    // Optimistic: the checkbox should react instantly on a phone.
    setData({
      ...data,
      dictionaries: data.dictionaries.map((x) => (x.id === d.id ? { ...x, is_active: active } : x)),
    })
    try {
      const summary = await api<ActiveSummary>(`/dictionaries/${d.id}/active`, {
        method: 'PUT',
        body: JSON.stringify({ active }),
      })
      setData((prev) => prev && { ...prev, active: summary })
    } catch (e) {
      setError((e as Error).message)
      await load()
    }
  }

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    if (file.name.toLowerCase().endsWith('.zip')) {
      // Archive with pictures → goes through the import draft.
      const form = new FormData()
      form.append('file', file)
      try {
        const job = await api<{ id: number }>('/imports/package', { method: 'POST', body: form })
        navigate(`/import/${job.id}`)
      } catch (err) {
        setError((err as Error).message)
      }
      return
    }
    try {
      const body = JSON.parse(await file.text())
      const created = await api<Dictionary>('/dictionaries/import', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      navigate(`/dictionaries/${created.id}`)
    } catch (err) {
      setError(
        err instanceof SyntaxError ? 'Файл не похож на JSON словаря' : (err as Error).message,
      )
    }
  }

  if (!data) return error ? <ErrorText>{error}</ErrorText> : <Spinner />

  const { active } = data

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Словари</h1>

      <p className="text-sm text-slate-600 dark:text-slate-400">{activeSummaryText(active)}</p>

      <div
        className={`grid rounded-xl bg-slate-200 p-1 dark:bg-slate-800 ${
          user?.is_admin ? 'grid-cols-3' : 'grid-cols-2'
        }`}
        role="tablist"
      >
        {(
          [
            ['dictionaries', 'Словари', null],
            ['categories', 'Категории', null],
            // Instructions only matter to those who can add dictionaries.
            ...(user?.is_admin ? [['help', 'Как добавить словари', 'Как добавить'] as const] : []),
          ] as const
        ).map(([value, label, short]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() =>
              setParams(value === 'dictionaries' ? {} : { tab: value }, { replace: true })
            }
            className={`rounded-lg px-1 py-2 text-sm font-medium ${
              tab === value
                ? 'bg-white shadow dark:bg-slate-950'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {short ? (
              <>
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{label}</span>
              </>
            ) : (
              label
            )}
          </button>
        ))}
      </div>

      {tab === 'help' ? (
        <HowToAddTab />
      ) : tab === 'categories' ? (
        <CategoriesTab
          isAdmin={!!user?.is_admin}
          onSummary={(summary) => setData((prev) => prev && { ...prev, active: summary })}
        />
      ) : (
        <>
          {user?.is_admin && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => navigate('/import')}>Импорт из учебника</Button>
              <Button variant="secondary" onClick={() => setCreating(true)}>
                + Новый словарь
              </Button>
              <Button variant="ghost" onClick={() => fileInput.current?.click()}>
                Загрузить JSON / архив
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json,.zip,application/zip"
                className="hidden"
                onChange={importFile}
              />
            </div>
          )}

          <ErrorText>{error}</ErrorText>

          {data.dictionaries.length === 0 ? (
            <Card className="text-center text-slate-500">
              Словарей пока нет.
              {user?.is_admin ? ' Создайте первый.' : ' Их добавит администратор.'}
            </Card>
          ) : (
            <ul className="space-y-2">
              {data.dictionaries.map((d) => (
                <li key={d.id}>
                  <Card className="flex items-stretch gap-1 p-0">
                    <label className="flex cursor-pointer items-center py-4 pr-2 pl-4">
                      <input
                        type="checkbox"
                        className="size-6 accent-blue-600"
                        checked={d.is_active}
                        onChange={() => toggle(d)}
                        aria-label={`Использовать «${d.title}» в тренировках`}
                      />
                    </label>
                    <Link
                      to={`/dictionaries/${d.id}`}
                      className="flex min-w-0 flex-1 items-center justify-between gap-2 py-3 pr-4"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{d.title}</span>
                        <span className="block text-sm text-slate-500">
                          {d.word_count} {pluralWords(d.word_count)}
                          {!d.is_published && ' · скрыт от группы'}
                        </span>
                      </span>
                      <span className="text-slate-400">›</span>
                    </Link>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {creating && (
        <Sheet title="Новый словарь" onClose={() => setCreating(false)}>
          <DictionaryForm
            onSubmit={async (title, description) => {
              const d = await api<Dictionary>('/dictionaries', {
                method: 'POST',
                body: JSON.stringify({ title, description }),
              })
              navigate(`/dictionaries/${d.id}`)
            }}
          />
        </Sheet>
      )}
    </section>
  )
}

export function DictionaryForm({
  initial,
  onSubmit,
}: {
  initial?: { title: string; description: string | null }
  onSubmit: (title: string, description: string | null) => Promise<void>
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSubmit(title, description || null)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Название">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Урок 5. Семья"
          maxLength={120}
          required
          autoFocus
        />
      </Field>
      <Field label="Описание (необязательно)">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <Button type="submit" disabled={busy} className="w-full">
        {initial ? 'Сохранить' : 'Создать'}
      </Button>
    </form>
  )
}
