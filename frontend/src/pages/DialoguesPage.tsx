import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../api/client.ts'
import { pluralLines, type Dialogue } from '../api/types.ts'
import { useAuth } from '../auth/AuthContext.tsx'
import { Button, ErrorText, Spinner } from '../components/ui.tsx'
import { PromptBox } from './HowToAddTab.tsx'

// «Диалоги» (SPEC): the list; admins add, replace, download and delete dialogues.
export default function DialoguesPage() {
  const { user } = useAuth()
  const [dialogues, setDialogues] = useState<Dialogue[] | null>(null)
  const [error, setError] = useState('')

  const load = () =>
    api<Dialogue[]>('/dialogues')
      .then(setDialogues)
      .catch((e: Error) => setError(e.message))
  useEffect(() => {
    load()
  }, [])

  if (!dialogues) return error ? <ErrorText>{error}</ErrorText> : <Spinner />

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Диалоги</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Читайте и слушайте диалог, потом учите его по ролям.
      </p>

      {user?.is_admin && <AddDialogue onError={setError} />}
      <ErrorText>{error}</ErrorText>

      {dialogues.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Диалогов пока нет.
          {user?.is_admin && ' Загрузите JSON или вставьте ответ Claude.'}
        </p>
      ) : (
        <ul className="grid gap-3">
          {dialogues.map((d) => (
            <DialogueCard key={d.id} dialogue={d} onChanged={load} onError={setError} />
          ))}
        </ul>
      )}
    </section>
  )
}

/** POST a dialogue file; `id` given — replace that dialogue («Заменить из JSON»). */
async function uploadFile(file: File, id?: number): Promise<{ id: number }> {
  let body: unknown
  try {
    body = JSON.parse(await file.text())
  } catch {
    throw new Error('Файл не похож на JSON диалога')
  }
  return api<{ id: number }>(id ? `/dialogues/${id}/import` : '/dialogues/import', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(body),
  })
}

function AddDialogue({ onError }: { onError: (e: string) => void }) {
  const navigate = useNavigate()
  const fileInput = useRef<HTMLInputElement>(null)
  const [pasting, setPasting] = useState(false)

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    onError('')
    try {
      navigate(`/dialogues/${(await uploadFile(file)).id}`)
    } catch (err) {
      onError((err as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => fileInput.current?.click()}>Загрузить JSON</Button>
        <Button variant="secondary" onClick={() => setPasting(!pasting)} aria-expanded={pasting}>
          Вставить ответ Claude
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={onFile}
          aria-label="Файл диалога (JSON)"
        />
      </div>
      {pasting && <PasteDialogue />}
    </div>
  )
}

function PasteDialogue() {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const d = await api<{ id: number }>('/dialogues/import/text', {
        method: 'POST',
        body: JSON.stringify({ text }),
      })
      navigate(`/dialogues/${d.id}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Скопируйте промпт, вставьте его в{' '}
        <a
          href="https://claude.ai/new"
          target="_blank"
          rel="noreferrer"
          className="text-blue-600 underline dark:text-blue-400"
        >
          новый чат claude.ai
        </a>{' '}
        и приложите диалог (текст, фото страницы или PDF). Ответ Claude вставьте сюда.
      </p>
      <PromptBox kind="dialogue" label="Промпт «Диалог»" />
      <label className="block font-medium" htmlFor="dialogue-json">
        JSON от Claude
      </label>
      <textarea
        id="dialogue-json"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        className="w-full rounded-xl border-2 border-slate-300 bg-white p-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
        placeholder='{"type": "dialogue", …}'
      />
      <ErrorText>{error}</ErrorText>
      <Button onClick={submit} disabled={busy || !text.trim()}>
        Создать диалог
      </Button>
    </div>
  )
}

function DialogueCard({
  dialogue: d,
  onChanged,
  onError,
}: {
  dialogue: Dialogue
  onChanged: () => void
  onError: (e: string) => void
}) {
  const replaceInput = useRef<HTMLInputElement>(null)

  const replace = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!confirm(`Заменить «${d.title}» содержимым файла?`)) return
    onError('')
    try {
      await uploadFile(file, d.id)
      onChanged()
    } catch (err) {
      onError((err as Error).message)
    }
  }

  const remove = async () => {
    if (!confirm(`Удалить диалог «${d.title}»?`)) return
    try {
      await api(`/dialogues/${d.id}`, { method: 'DELETE' })
      onChanged()
    } catch (err) {
      onError((err as Error).message)
    }
  }

  return (
    <li className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-medium break-words">{d.title}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            <span lang="el">{d.speakers.join(' · ')}</span> · {d.line_count}{' '}
            {pluralLines(d.line_count)}
          </p>
        </div>
        <Link
          to={`/dialogues/${d.id}`}
          className="shrink-0 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Учить
        </Link>
      </div>
      {d.can_edit && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <button
            type="button"
            className="text-slate-600 underline dark:text-slate-300"
            onClick={() => replaceInput.current?.click()}
          >
            Заменить из JSON
          </button>
          <a
            href={`/api/dialogues/${d.id}/export`}
            className="text-slate-600 underline dark:text-slate-300"
          >
            Скачать JSON
          </a>
          <button type="button" className="text-red-600 underline" onClick={remove}>
            Удалить
          </button>
          <input
            ref={replaceInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={replace}
            aria-label={`Заменить «${d.title}» из JSON`}
          />
        </div>
      )}
    </li>
  )
}
