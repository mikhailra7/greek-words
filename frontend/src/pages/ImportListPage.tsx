import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../api/client.ts'
import { IMPORT_STATUS_LABELS, type ImportJob } from '../api/types.ts'
import { Button, Card, ErrorText, Spinner } from '../components/ui.tsx'

const fmtDate = (iso: string) =>
  new Date(iso.endsWith('Z') ? iso : `${iso}Z`).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

export default function ImportListPage() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState<ImportJob[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const bookInput = useRef<HTMLInputElement>(null)
  const zipInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => setJobs(await api<ImportJob[]>('/imports')), [])

  useEffect(() => {
    load().catch((e: Error) => setError(e.message))
  }, [load])

  const send = async (path: string, form: FormData) => {
    setBusy(true)
    setError('')
    try {
      const job = await api<ImportJob>(path, { method: 'POST', body: form })
      navigate(`/import/${job.id}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const onBook = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    const form = new FormData()
    files.forEach((f) => form.append('files', f))
    send('/imports', form)
  }

  const onZip = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    send('/imports/package', form)
  }

  const remove = async (job: ImportJob) => {
    if (!confirm('Удалить этот импорт? Опубликованный словарь останется.')) return
    try {
      await api(`/imports/${job.id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <section className="space-y-4">
      <Link to="/dictionaries" className="text-sm text-blue-600 dark:text-blue-400">
        ← Словари
      </Link>
      <h1 className="text-2xl font-semibold">Импорт из учебника</h1>

      <Card className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Загрузите PDF со страницами учебника или фото страниц. Дальше: выбрать страницы → отдать
          их Claude → проверить черновик → опубликовать словарь.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => bookInput.current?.click()}>
            {busy ? 'Загружаю…' : 'Загрузить PDF или фото'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => zipInput.current?.click()}>
            Загрузить архив (zip)
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          Архив — из Claude Code (большие загрузки) или «Скачать архив» у готового словаря.
        </p>
        <input
          ref={bookInput}
          type="file"
          multiple
          accept="application/pdf,.pdf,image/*,.doc,.docx"
          className="hidden"
          onChange={onBook}
        />
        <input
          ref={zipInput}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={onZip}
        />
        <ErrorText>{error}</ErrorText>
      </Card>

      <h2 className="text-lg font-medium">Недавние импорты</h2>
      {!jobs ? (
        <Spinner />
      ) : jobs.length === 0 ? (
        <p className="text-sm text-slate-500">Пока ничего не загружали.</p>
      ) : (
        <ul className="space-y-2">
          {jobs.map((j) => (
            <li key={j.id}>
              <Card className="flex items-center justify-between gap-3 p-0">
                <Link to={`/import/${j.id}`} className="min-w-0 flex-1 px-4 py-3">
                  <span className="block truncate font-medium">
                    {j.title || j.source_filename || `Импорт ${j.id}`}
                  </span>
                  <span className="block text-sm text-slate-500">
                    {IMPORT_STATUS_LABELS[j.status]} · {fmtDate(j.created_at)}
                    {j.word_count > 0 && ` · ${j.word_count} сл.`}
                  </span>
                </Link>
                <button
                  onClick={() => remove(j)}
                  className="px-4 py-3 text-slate-400 hover:text-red-600"
                  aria-label="Удалить импорт"
                >
                  ×
                </button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
