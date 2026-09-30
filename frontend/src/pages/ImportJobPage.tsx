import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api } from '../api/client.ts'
import {
  pluralWords,
  type Category,
  type Dictionary,
  type DraftWord,
  type ImportJobDetail,
  type WordInput,
} from '../api/types.ts'
import BBoxEditor, { type BBox } from '../components/BBoxEditor.tsx'
import Sheet from '../components/Sheet.tsx'
import WordForm from '../components/WordForm.tsx'
import { categoryLabel, useCategories } from '../lib/categories.ts'
import { Button, Card, ErrorText, Field, Input, Spinner } from '../components/ui.tsx'

export default function ImportJobPage() {
  const { id } = useParams()
  const [job, setJob] = useState<ImportJobDetail | null>(null)
  const [error, setError] = useState('')
  // In review the admin may go back and paste a new answer from Claude.
  const [repaste, setRepaste] = useState(false)

  const load = useCallback(async () => setJob(await api<ImportJobDetail>(`/imports/${id}`)), [id])

  useEffect(() => {
    load().catch((e: Error) => setError(e.message))
  }, [load])

  if (!job) return error ? <ErrorText>{error}</ErrorText> : <Spinner />

  const update = (next: ImportJobDetail) => {
    setJob(next)
    setRepaste(false)
  }

  return (
    <section className="space-y-4">
      <Link to="/import" className="text-sm text-blue-600 dark:text-blue-400">
        ← Импорты
      </Link>
      <h1 className="text-2xl font-semibold">
        {job.title || job.source_filename || `Импорт ${job.id}`}
      </h1>

      {job.status === 'done' ? (
        <Done job={job} />
      ) : job.status === 'review' && !repaste ? (
        <Draft
          job={job}
          setJob={setJob}
          onRepaste={job.mode === 'paste' ? () => setRepaste(true) : undefined}
        />
      ) : job.status === 'uploaded' ? (
        <PagesStep job={job} onDone={update} />
      ) : (
        <>
          <PagesStep job={job} onDone={update} collapsed />
          <ClaudeStep job={job} onDone={update} />
        </>
      )}
    </section>
  )
}

// --- step 1: pages ---

function PagesStep({
  job,
  onDone,
  collapsed,
}: {
  job: ImportJobDetail
  onDone: (j: ImportJobDetail) => void
  collapsed?: boolean
}) {
  const all = Array.from({ length: job.page_count }, (_, i) => i + 1)
  const [open, setOpen] = useState(!collapsed)
  const [selected, setSelected] = useState<number[]>(
    job.selected_pages.length ? job.selected_pages : all,
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!open) {
    return (
      <Card className="flex items-center justify-between gap-2 text-sm">
        <span>
          Страницы: {job.selected_pages.join(', ')} из {job.page_count}
        </span>
        <Button variant="ghost" onClick={() => setOpen(true)}>
          Изменить
        </Button>
      </Card>
    )
  }

  const toggle = (p: number) =>
    setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p].sort((a, b) => a - b)))

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      onDone(
        await api<ImportJobDetail>(`/imports/${job.id}/pages`, {
          method: 'POST',
          body: JSON.stringify({ pages: selected }),
        }),
      )
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-3">
      <h2 className="font-medium">1. Какие страницы разобрать?</h2>
      <p className="text-sm text-slate-500">
        За один раз лучше не больше 5–10 страниц, иначе ответ Claude может оборваться.
      </p>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {all.map((p) => (
          <li key={p}>
            <label
              className={`block cursor-pointer overflow-hidden rounded-xl border-2 ${
                selected.includes(p) ? 'border-blue-600' : 'border-transparent opacity-50'
              }`}
            >
              <img
                src={`/api/imports/${job.id}/previews/${p}.jpg`}
                alt={`Страница ${p}`}
                loading="lazy"
                className="block w-full bg-white"
              />
              <span className="flex items-center gap-2 px-2 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(p)}
                  onChange={() => toggle(p)}
                  className="accent-blue-600"
                />
                {p}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
      <Button disabled={busy || selected.length === 0} onClick={submit} className="w-full">
        {busy ? 'Готовлю PDF…' : `Дальше: ${selected.length} стр.`}
      </Button>
    </Card>
  )
}

// --- step 2: Claude ---

function ClaudeStep({
  job,
  onDone,
}: {
  job: ImportJobDetail
  onDone: (j: ImportJobDetail) => void
}) {
  const [prompt, setPrompt] = useState('')
  const [copied, setCopied] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Loaded up front: on iOS the clipboard write must happen right inside the tap.
  useEffect(() => {
    fetch('/api/imports/prompt')
      .then((r) => r.text())
      .then(setPrompt)
      .catch(() => setError('Не удалось загрузить промпт'))
  }, [])

  const copy = async () => {
    await navigator.clipboard.writeText(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const pasteFromClipboard = async () => {
    try {
      setText(await navigator.clipboard.readText())
    } catch {
      setError('Браузер не дал прочитать буфер — вставьте вручную в поле ниже')
    }
  }

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      onDone(
        await api<ImportJobDetail>(`/imports/${job.id}/json`, {
          method: 'POST',
          body: JSON.stringify({ text }),
        }),
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-4">
      <h2 className="font-medium">2. Разбор в Claude</h2>
      <ol className="space-y-3 text-sm">
        <li className="flex flex-wrap items-center gap-2">
          <span className="w-full">
            <b>а.</b> Скачайте PDF для Claude — выбранные страницы с сеткой координат:
          </span>
          <a
            href={`/api/imports/${job.id}/claude.pdf`}
            download
            className="inline-flex rounded-xl bg-slate-200 px-4 py-2.5 font-medium hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700"
          >
            Скачать PDF ({job.claude_pages} стр.)
          </a>
        </li>
        <li className="flex flex-wrap items-center gap-2">
          <span className="w-full">
            <b>б.</b> Скопируйте промпт:
          </span>
          <Button variant="secondary" onClick={copy} disabled={!prompt}>
            {copied ? 'Скопировано ✓' : 'Скопировать промпт'}
          </Button>
        </li>
        <li>
          <b>в.</b> В{' '}
          <a
            href="https://claude.ai/new"
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 underline dark:text-blue-400"
          >
            новом чате claude.ai
          </a>{' '}
          приложите PDF, вставьте промпт и отправьте. Когда ответит — нажмите «Copy» на блоке с
          JSON.
        </li>
        <li className="space-y-2">
          <span className="block">
            <b>г.</b> Вставьте ответ сюда:
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder='{"schema_version": 1, "words": [ … ] }'
            className="w-full rounded-xl border border-slate-300 bg-white p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={pasteFromClipboard}>
              Вставить из буфера
            </Button>
            <Button onClick={submit} disabled={busy || !text.trim()}>
              {busy ? 'Проверяю и вырезаю картинки…' : 'Проверить'}
            </Button>
          </div>
        </li>
      </ol>
      <ErrorText>{error}</ErrorText>
    </Card>
  )
}

// --- step 3: draft ---

function Draft({
  job,
  setJob,
  onRepaste,
}: {
  job: ImportJobDetail
  setJob: (j: ImportJobDetail) => void
  onRepaste?: () => void
}) {
  const navigate = useNavigate()
  const [title, setTitle] = useState(job.title)
  const [editing, setEditing] = useState<DraftWord | 'new' | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [categories, reloadCategories] = useCategories()

  const replaceWord = (w: DraftWord) =>
    setJob({ ...job, words: job.words.map((x) => (x.id === w.id ? w : x)) })

  const saveWord = async (w: DraftWord, patch: Partial<DraftWord>) => {
    const body = { ...w, ...patch }
    replaceWord(
      await api<DraftWord>(`/imports/${job.id}/words/${w.id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    )
  }

  const toggle = async (w: DraftWord) => {
    replaceWord({ ...w, include: !w.include })
    try {
      await saveWord(w, { include: !w.include })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const publish = async () => {
    setBusy(true)
    setError('')
    try {
      const d = await api<Dictionary>(`/imports/${job.id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ title }),
      })
      navigate(`/dictionaries/${d.id}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const chosen = job.words.filter((w) => w.include)
  const withImage = chosen.filter((w) => w.image_url).length
  const dups = chosen.filter((w) => w.duplicates.length).length
  const uncategorized = chosen.filter((w) => !w.category_id && !w.category_suggestion).length
  const catById = new Map((categories ?? []).map((c) => [c.id, c]))

  // New categories Claude proposed, with how many (selected) words each would get.
  const suggestions = [
    ...chosen
      .filter((w) => w.category_suggestion)
      .reduce(
        (m, w) => m.set(w.category_suggestion!, (m.get(w.category_suggestion!) ?? 0) + 1),
        new Map<string, number>(),
      ),
  ]

  const acceptCategory = async (name: string) => {
    setError('')
    try {
      setJob(
        await api<ImportJobDetail>(`/imports/${job.id}/categories`, {
          method: 'POST',
          body: JSON.stringify({ name }),
        }),
      )
      reloadCategories()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h2 className="font-medium">3. Проверьте черновик</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Выбрано {chosen.length} из {job.words.length} · с картинкой {withImage}
          {dups > 0 && ` · уже есть в словарях: ${dups}`}
          {uncategorized > 0 && ` · без категории: ${uncategorized}`}. Нажмите на слово, чтобы
          исправить его, категорию или рамку картинки.
        </p>
        {suggestions.length > 0 && (
          <div className="space-y-2 rounded-xl bg-amber-50 p-3 dark:bg-amber-950">
            <p className="text-sm text-amber-900 dark:text-amber-200">
              Claude предлагает новые категории. Создайте их или выберите словам другую категорию.
            </p>
            {suggestions.map(([name, n]) => (
              <div key={name} className="flex items-center justify-between gap-2">
                <span className="text-sm">
                  «{name}» · {n} {pluralWords(n)}
                </span>
                <Button variant="secondary" onClick={() => acceptCategory(name)}>
                  Создать
                </Button>
              </div>
            ))}
          </div>
        )}
        <Field label="Название словаря">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Урок 3. Еда"
            maxLength={120}
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex flex-wrap gap-2">
          <Button onClick={publish} disabled={busy || !title.trim() || chosen.length === 0}>
            Опубликовать: {chosen.length} {pluralWords(chosen.length)}
          </Button>
          <Button variant="secondary" onClick={() => setEditing('new')}>
            + Слово
          </Button>
          {onRepaste && (
            <Button variant="ghost" onClick={onRepaste}>
              Вставить ответ Claude заново
            </Button>
          )}
        </div>
      </Card>

      <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {job.words.map((w) => (
          <li key={w.id} className={`flex items-center gap-1 ${w.include ? '' : 'opacity-45'}`}>
            <label className="flex cursor-pointer items-center self-stretch pr-1 pl-3">
              <input
                type="checkbox"
                className="size-5 accent-blue-600"
                checked={w.include}
                onChange={() => toggle(w)}
                aria-label={`Включить ${w.full_greek}`}
              />
            </label>
            <button
              onClick={() => setEditing(w)}
              className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-3 text-left"
            >
              <Thumb word={w} />
              <span className="min-w-0 flex-1">
                <span lang="el" className="block truncate text-lg font-medium">
                  {w.full_greek}
                </span>
                <span className="block truncate text-sm text-slate-500">
                  {w.transcription && <i>{w.transcription} · </i>}
                  {w.translations_ru.join(', ')}
                </span>
                <CategoryLine word={w} category={catById.get(w.category_id ?? -1)} />
                {w.note && <span className="block truncate text-xs text-slate-400">{w.note}</span>}
                {w.duplicates.length > 0 && (
                  <span className="block truncate text-xs text-amber-600 dark:text-amber-400">
                    уже есть в «{w.duplicates.join('», «')}»
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {editing === 'new' && (
        <Sheet title="Новое слово" onClose={() => setEditing(null)}>
          <WordForm
            categories={categories ?? []}
            onSubmit={async (data) => {
              const w = await api<DraftWord>(`/imports/${job.id}/words`, {
                method: 'POST',
                body: JSON.stringify(data),
              })
              setJob({ ...job, words: [...job.words, w] })
              setEditing(null)
            }}
          />
        </Sheet>
      )}
      {editing && editing !== 'new' && (
        <DraftWordSheet
          key={editing.id}
          categories={categories}
          job={job}
          word={editing}
          onClose={() => setEditing(null)}
          onSaved={(w) => {
            replaceWord(w)
            setEditing(null)
          }}
          onDeleted={(w) => {
            setJob({ ...job, words: job.words.filter((x) => x.id !== w.id) })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function CategoryLine({ word, category }: { word: DraftWord; category?: Category }) {
  if (word.category_suggestion) {
    return (
      <span className="block truncate text-xs text-amber-600 dark:text-amber-400">
        ✨ новая категория: «{word.category_suggestion}»
      </span>
    )
  }
  if (!category) return <span className="block text-xs text-slate-400">без категории</span>
  return (
    <span className="block truncate text-xs text-slate-500">
      {categoryLabel(category)}
      {word.category_source === 'match' && ' · как в другом словаре'}
    </span>
  )
}

function Thumb({ word }: { word: Pick<DraftWord, 'image_url' | 'image_emoji'> }) {
  return (
    <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white text-2xl ring-1 ring-slate-200 dark:ring-slate-700">
      {word.image_url ? (
        <img src={word.image_url} alt="" className="size-full object-contain" loading="lazy" />
      ) : (
        (word.image_emoji ?? <span className="text-base text-slate-400">—</span>)
      )}
    </span>
  )
}

function DraftWordSheet({
  job,
  word,
  categories,
  onClose,
  onSaved,
  onDeleted,
}: {
  job: ImportJobDetail
  word: DraftWord
  categories: Category[] | null
  onClose: () => void
  onSaved: (w: DraftWord) => void
  onDeleted: (w: DraftWord) => void
}) {
  const canCrop = job.claude_pages > 0
  const [page, setPage] = useState(word.page ?? 1)
  const [bbox, setBbox] = useState<BBox | null>(word.bbox)
  const [cropping, setCropping] = useState(false)
  const [error, setError] = useState('')

  const put = async (patch: Partial<DraftWord>) =>
    api<DraftWord>(`/imports/${job.id}/words/${word.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...word, ...patch }),
    })

  const saveImage = async (next: BBox | null) => {
    setError('')
    try {
      onSaved(await put({ bbox: next, page: next ? page : word.page }))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Sheet title={word.full_greek} onClose={onClose}>
      <div className="mb-5 space-y-3">
        {cropping ? (
          <>
            {job.claude_pages > 1 && (
              <label className="flex items-center gap-2 text-sm">
                Страница
                <select
                  value={page}
                  onChange={(e) => setPage(Number(e.target.value))}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                >
                  {Array.from({ length: job.claude_pages }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <BBoxEditor
              src={`/api/imports/${job.id}/pageimg/${page}.jpg`}
              value={bbox ?? [0.35, 0.35, 0.65, 0.65]}
              onChange={setBbox}
            />
            <div className="flex gap-2">
              <Button onClick={() => saveImage(bbox ?? [0.35, 0.35, 0.65, 0.65])}>
                Сохранить рамку
              </Button>
              <Button variant="ghost" onClick={() => setCropping(false)}>
                Отмена
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <span className="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white text-5xl ring-1 ring-slate-200 dark:ring-slate-700">
              {word.image_url ? (
                <img src={word.image_url} alt="" className="size-full object-contain" />
              ) : (
                (word.image_emoji ?? '—')
              )}
            </span>
            <div className="flex flex-col items-start gap-1">
              {canCrop && (
                <Button variant="secondary" onClick={() => setCropping(true)}>
                  {word.image_url ? 'Поправить рамку' : 'Взять со страницы'}
                </Button>
              )}
              {word.image_url && (
                <Button variant="dangerGhost" onClick={() => saveImage(null)}>
                  Убрать картинку
                </Button>
              )}
            </div>
          </div>
        )}
        {word.note && (
          <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {word.note}
          </p>
        )}
        {word.category_suggestion && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Claude предлагает новую категорию «{word.category_suggestion}» — создайте её в блоке
            вверху черновика или выберите другую ниже.
          </p>
        )}
        {word.category_source === 'match' && (
          <p className="text-sm text-slate-500">
            Категория взята у такого же слова в другом словаре.
          </p>
        )}
        {word.duplicates.length > 0 && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Уже есть в «{word.duplicates.join('», «')}». Снимите галочку, если повтор не нужен.
          </p>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
      {!cropping && (
        <WordForm
          word={word}
          categories={categories ?? []}
          submitLabel="Сохранить"
          onSubmit={async (data: WordInput) => onSaved(await put(data))}
          onDelete={async () => {
            await api(`/imports/${job.id}/words/${word.id}`, { method: 'DELETE' })
            onDeleted(word)
          }}
        />
      )}
    </Sheet>
  )
}

function Done({ job }: { job: ImportJobDetail }) {
  return (
    <Card className="space-y-2">
      <p>Словарь опубликован.</p>
      {job.dictionary_id && (
        <Link
          to={`/dictionaries/${job.dictionary_id}`}
          className="text-blue-600 underline dark:text-blue-400"
        >
          Открыть словарь
        </Link>
      )}
    </Card>
  )
}
