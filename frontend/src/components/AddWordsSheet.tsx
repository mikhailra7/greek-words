import { useRef, useState, type ChangeEvent } from 'react'
import { api } from '../api/client.ts'
import { pluralWords } from '../api/types.ts'
import { PromptBox } from '../pages/HowToAddTab.tsx'
import Sheet from './Sheet.tsx'
import { Button, ErrorText } from './ui.tsx'

type WordsImportResult = { added: number; skipped: string[] }

/** «+ Слова из JSON»: words into this dictionary from a JSON file or a Claude answer. Words the
 * dictionary already has are skipped (the server says which). */
export default function AddWordsSheet({
  dictionaryId,
  onClose,
  onDone,
}: {
  dictionaryId: number
  onClose: () => void
  /** Called with what happened («Добавлено: 3 слова. Уже были…»). */
  onDone: (message: string) => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const send = async (json: string) => {
    setBusy(true)
    setError('')
    try {
      const result = await api<WordsImportResult>(`/dictionaries/${dictionaryId}/words/import`, {
        method: 'POST',
        body: JSON.stringify({ text: json }),
      })
      onDone(resultText(result))
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) await send(await f.text())
  }

  return (
    <Sheet title="Слова из JSON" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Слова добавятся в конец словаря. Подойдёт JSON словаря (файл) или ответ Claude на промпт
          «Список слов» — вставьте его как есть. Слова, которые в словаре уже есть, пропускаются.
        </p>
        <PromptBox kind="wordlist" label="Промпт «Список слов»" />
        <Button variant="secondary" onClick={() => file.current?.click()} disabled={busy}>
          Выбрать файл .json
        </Button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={onFile}
          aria-label="Файл со словами (JSON)"
        />
        <label className="block font-medium" htmlFor="words-json">
          …или вставьте JSON / ответ Claude
        </label>
        <textarea
          id="words-json"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          className="w-full rounded-xl border-2 border-slate-300 bg-white p-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
          placeholder='{"words": [{"article": "το", "greek": "νερό", "translations_ru": ["вода"]}]}'
        />
        <ErrorText>{error}</ErrorText>
        <Button onClick={() => send(text)} disabled={busy || !text.trim()} className="w-full">
          {busy ? 'Добавляю…' : 'Добавить слова'}
        </Button>
      </div>
    </Sheet>
  )
}

function resultText({ added, skipped }: WordsImportResult): string {
  const parts = [`Добавлено: ${added} ${pluralWords(added)}.`]
  if (skipped.length)
    parts.push(`Уже были в словаре — пропущены (${skipped.length}): ${skipped.join(', ')}.`)
  return parts.join(' ')
}
