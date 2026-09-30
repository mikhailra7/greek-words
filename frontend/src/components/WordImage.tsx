import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { api } from '../api/client.ts'
import type { Word } from '../api/types.ts'
import SpeakButton from './SpeakButton.tsx'
import { Button, ErrorText, Input, Spinner } from './ui.tsx'

type StockHit = { id: string; thumb_url: string; credit: string }
type StockResults = { provider: string; results: StockHit[] }

// Picture + sound block in the word sheet (admin): upload / stock / remove, listen / regenerate.
export default function WordImage({
  word,
  onChanged,
  note,
}: {
  word: Word
  onChanged: (w: Word) => void
  note?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [searching, setSearching] = useState(false)

  const run = async (action: () => Promise<Word>) => {
    setBusy(true)
    setError('')
    try {
      onChanged(await action())
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const upload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    run(() => api<Word>(`/words/${word.id}/image`, { method: 'PUT', body: form }))
  }

  const remove = () => {
    if (!confirm('Убрать картинку у этого слова?')) return
    run(() => api<Word>(`/words/${word.id}/image`, { method: 'DELETE' }))
  }

  const choose = async (hit: StockHit) => {
    const ok = await run(() =>
      api<Word>(`/words/${word.id}/image/stock`, {
        method: 'PUT',
        body: JSON.stringify({ id: hit.id }),
      }),
    )
    if (ok) setSearching(false)
  }

  const regenerate = () =>
    run(() => api<Word>(`/words/${word.id}/audio/regenerate`, { method: 'POST' }))

  return (
    <div className="mb-5 space-y-3">
      {note && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
          Слово добавлено. Можно добавить картинку или закрыть.
        </p>
      )}
      <div className="flex items-center gap-3">
        <span className="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white text-5xl ring-1 ring-slate-200 dark:ring-slate-700">
          {word.image_url ? (
            <img src={word.image_url} alt="" className="size-full object-contain" />
          ) : (
            (word.image_emoji ?? <span className="text-base text-slate-400">нет</span>)
          )}
        </span>
        <div className="flex flex-col items-start gap-1">
          <Button variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
            {word.image_url ? 'Заменить картинку' : 'Загрузить картинку'}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setSearching((s) => !s)}>
            Найти на стоке
          </Button>
          {word.image_url && (
            <Button variant="dangerGhost" disabled={busy} onClick={remove}>
              Убрать картинку
            </Button>
          )}
        </div>
      </div>
      {word.image_credit && <p className="text-xs text-slate-500">Фото: {word.image_credit}</p>}
      {!word.image_url && word.image_emoji && (
        <p className="text-xs text-slate-500">Пока картинки нет, показывается эмодзи.</p>
      )}
      {searching && (
        <StockPicker
          initial={word.image_query || word.translations_ru[0] || ''}
          onChoose={choose}
          disabled={busy}
        />
      )}
      <div className="flex items-center gap-2 text-sm">
        <SpeakButton url={word.audio_url} text={word.full_greek} />
        <span className="text-slate-500">Произношение</span>
        <Button variant="ghost" disabled={busy} onClick={regenerate} className="ml-auto">
          Перегенерировать звук
        </Button>
      </div>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={upload} />
      <ErrorText>{error}</ErrorText>
    </div>
  )
}

function StockPicker({
  initial,
  onChoose,
  disabled,
}: {
  initial: string
  onChoose: (hit: StockHit) => void
  disabled: boolean
}) {
  const [query, setQuery] = useState(initial)
  const [data, setData] = useState<StockResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const search = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setError('')
    try {
      setData(await api<StockResults>(`/stock/search?q=${encodeURIComponent(query)}`))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2 rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
      <form onSubmit={search} className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="по-английски ищет лучше: lemon"
          autoCapitalize="off"
        />
        <Button type="submit" disabled={loading}>
          Найти
        </Button>
      </form>
      <ErrorText>{error}</ErrorText>
      {loading && <Spinner />}
      {data && !loading && (
        <>
          {data.results.length === 0 ? (
            <p className="text-sm text-slate-500">Ничего не нашлось — попробуйте другое слово.</p>
          ) : (
            <ul className="grid grid-cols-3 gap-2">
              {data.results.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChoose(hit)}
                    className="block aspect-square w-full overflow-hidden rounded-lg bg-white ring-blue-600 hover:ring-2 disabled:opacity-50"
                    title={hit.credit}
                  >
                    <img
                      src={hit.thumb_url}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="size-full object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-500">
            Источник: {data.provider === 'pixabay' ? 'Pixabay' : 'Openverse (свободные лицензии)'}
          </p>
        </>
      )}
    </div>
  )
}
