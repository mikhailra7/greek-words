import { useState, type FormEvent } from 'react'
import { categoryLabel } from '../lib/categories.ts'
import {
  ARTICLES,
  PARTS_OF_SPEECH,
  type PartOfSpeech,
  type Category,
  type Word,
  type WordInput,
} from '../api/types.ts'
import { Button, ErrorText, Field, Input } from './ui.tsx'

const selectClass =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base dark:border-slate-700 dark:bg-slate-900'

// Works for dictionary words and import draft words alike.
type EditableWord = Pick<
  Word,
  | 'article'
  | 'greek'
  | 'full_greek'
  | 'transcription'
  | 'translations_ru'
  | 'part_of_speech'
  | 'example_gr'
  | 'example_ru'
  | 'image_emoji'
  | 'image_query'
> & { category_id?: number | null }

export default function WordForm({
  word,
  onSubmit,
  onDelete,
  submitLabel,
  categories,
}: {
  word?: EditableWord
  submitLabel?: string
  /** When given, the form shows a category picker (dictionary words; not import drafts). */
  categories?: Category[] | null
  onSubmit: (data: WordInput) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const [article, setArticle] = useState(word?.article ?? '')
  const [greek, setGreek] = useState(word?.greek ?? '')
  const [transcription, setTranscription] = useState(word?.transcription ?? '')
  const [translations, setTranslations] = useState<string[]>(() => {
    const t = word?.translations_ru ?? []
    return [t[0] ?? '', t[1] ?? '', t[2] ?? '']
  })
  const [pos, setPos] = useState<string>(word?.part_of_speech ?? '')
  const [emoji, setEmoji] = useState(word?.image_emoji ?? '')
  const [imageQuery, setImageQuery] = useState(word?.image_query ?? '')
  const [categoryId, setCategoryId] = useState<string>(
    word?.category_id ? String(word.category_id) : '',
  )
  const [exampleGr, setExampleGr] = useState(word?.example_gr ?? '')
  const [exampleRu, setExampleRu] = useState(word?.example_ru ?? '')
  const [showExample, setShowExample] = useState(Boolean(word?.example_gr || word?.example_ru))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSubmit({
        article: article || null,
        greek,
        transcription,
        translations_ru: translations.filter((t) => t.trim()),
        part_of_speech: (pos || null) as PartOfSpeech | null,
        example_gr: exampleGr || null,
        example_ru: exampleRu || null,
        image_emoji: emoji || null,
        image_query: imageQuery || null,
        ...(categories ? { category_id: categoryId ? Number(categoryId) : null } : {}),
      })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!onDelete || !confirm(`Удалить слово «${word?.full_greek}»?`)) return
    setBusy(true)
    try {
      await onDelete()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-[5.5rem_1fr] gap-3">
        <Field label="Артикль">
          <select
            value={article}
            onChange={(e) => setArticle(e.target.value)}
            className={selectClass}
          >
            <option value="">—</option>
            {ARTICLES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Греческое слово">
          <Input
            lang="el"
            value={greek}
            onChange={(e) => setGreek(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
          />
        </Field>
      </div>
      <Field label="Транскрипция (латиницей, с артиклем)">
        <Input
          value={transcription}
          onChange={(e) => setTranscription(e.target.value)}
          placeholder="to neró"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </Field>
      <Field label="Перевод" hint="От 1 до 3 вариантов.">
        <div className="space-y-2">
          {translations.map((t, i) => (
            <Input
              key={i}
              value={t}
              onChange={(e) =>
                setTranslations((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
              }
              placeholder={i === 0 ? 'основной перевод' : 'ещё вариант (необязательно)'}
              required={i === 0}
            />
          ))}
        </div>
      </Field>
      {categories && (
        <Field label="Категория">
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={selectClass}
          >
            <option value="">— без категории —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="grid grid-cols-[1fr_5.5rem] gap-3">
        <Field label="Часть речи">
          <select value={pos} onChange={(e) => setPos(e.target.value)} className={selectClass}>
            <option value="">—</option>
            {Object.entries(PARTS_OF_SPEECH).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Эмодзи">
          <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} className="text-center" />
        </Field>
      </div>
      <Field label="Слово для поиска картинки (англ.)" hint="Необязательно. Например: lemon.">
        <Input
          value={imageQuery}
          onChange={(e) => setImageQuery(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          maxLength={80}
        />
      </Field>
      {showExample ? (
        <>
          <Field label="Пример на греческом">
            <Input lang="el" value={exampleGr} onChange={(e) => setExampleGr(e.target.value)} />
          </Field>
          <Field label="Перевод примера">
            <Input value={exampleRu} onChange={(e) => setExampleRu(e.target.value)} />
          </Field>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setShowExample(true)}
          className="text-sm text-blue-600 dark:text-blue-400"
        >
          + пример употребления
        </button>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2 pt-1">
        <Button type="submit" disabled={busy} className="flex-1">
          {submitLabel ?? (word ? 'Сохранить' : 'Добавить')}
        </Button>
        {onDelete && (
          <Button type="button" variant="dangerGhost" disabled={busy} onClick={remove}>
            Удалить
          </Button>
        )}
      </div>
    </form>
  )
}
