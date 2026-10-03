import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api } from '../api/client.ts'
import {
  byAuthor,
  pluralWords,
  type Category,
  type DictionaryDetail,
  type Word,
  type WordInput,
} from '../api/types.ts'
import AnswerStats from '../components/AnswerStats.tsx'
import CategorizeSheet from '../components/CategorizeSheet.tsx'
import { KnownCheckbox, ResetKnownButton } from '../components/KnownCheckbox.tsx'
import Sheet from '../components/Sheet.tsx'
import { categoryLabel, useCategories } from '../lib/categories.ts'
import SpeakButton from '../components/SpeakButton.tsx'
import WordImage from '../components/WordImage.tsx'
import WordForm from '../components/WordForm.tsx'
import WordOrder from '../components/WordOrder.tsx'
import { Button, Card, ErrorText, Spinner } from '../components/ui.tsx'
import { DictionaryForm } from './DictionariesPage.tsx'

type Editing =
  { kind: 'new' } | { kind: 'word'; word: Word; justAdded?: boolean } | { kind: 'meta' } | null

export default function DictionaryPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [dict, setDict] = useState<DictionaryDetail | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Editing>(null)
  const [categories, reloadCategories] = useCategories()
  const [categorizing, setCategorizing] = useState(false)
  const [reordering, setReordering] = useState(false)
  // Bumped when a failed save brings back the server's order: WordOrder starts over from it.
  const [orderVersion, setOrderVersion] = useState(0)

  const load = useCallback(
    async () => setDict(await api<DictionaryDetail>(`/dictionaries/${id}`)),
    [id],
  )

  useEffect(() => {
    load().catch((e: Error) => setError(e.message))
  }, [load])

  if (!dict) return error ? <NotFound message={error} /> : <Spinner />

  const uncategorized = dict.words.filter((w) => !w.category_id).length

  const saveOrder = async (words: Word[]) => {
    setDict((d) => d && { ...d, words })
    setError('')
    try {
      await api(`/dictionaries/${dict.id}/order`, {
        method: 'PUT',
        body: JSON.stringify({ word_ids: words.map((w) => w.id) }),
      })
    } catch (e) {
      setError((e as Error).message)
      await load()
      setOrderVersion((v) => v + 1)
    }
  }

  const toggleActive = async () => {
    const active = !dict.is_active
    setDict({ ...dict, is_active: active })
    try {
      await api(`/dictionaries/${dict.id}/active`, {
        method: 'PUT',
        body: JSON.stringify({ active }),
      })
    } catch (e) {
      setError((e as Error).message)
      await load()
    }
  }

  const saveWord = async (data: WordInput) => {
    if (editing?.kind === 'word') {
      await api(`/words/${editing.word.id}`, { method: 'PUT', body: JSON.stringify(data) })
      await load()
      setEditing(null)
    } else {
      const word = await api<Word>(`/dictionaries/${dict.id}/words`, {
        method: 'POST',
        body: JSON.stringify(data),
      })
      await load()
      // Stay in the sheet so a picture can be added right away.
      setEditing({ kind: 'word', word, justAdded: true })
    }
  }

  const imageChanged = async (word: Word) => {
    await load()
    setEditing((e) => (e?.kind === 'word' ? { ...e, word } : e))
  }

  const deleteWord = async (word: Word) => {
    await api(`/words/${word.id}`, { method: 'DELETE' })
    await load()
    setEditing(null)
  }

  const deleteDictionary = async () => {
    if (!confirm(`Удалить словарь «${dict.title}» со всеми словами? Это нельзя отменить.`)) return
    try {
      await api(`/dictionaries/${dict.id}`, { method: 'DELETE' })
      navigate('/dictionaries', { replace: true })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <section className="space-y-4">
      <Link to="/dictionaries" className="text-sm text-blue-600 dark:text-blue-400">
        ← Словари
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">{dict.title}</h1>
        {dict.description && (
          <p className="mt-1 text-slate-600 dark:text-slate-400">{dict.description}</p>
        )}
        <p className="mt-1 text-sm text-slate-500">
          {dict.word_count} {pluralWords(dict.word_count)}
          {byAuthor(dict.author)}
        </p>
      </div>

      <label className="flex cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          className="size-6 accent-blue-600"
          checked={dict.is_active}
          onChange={toggleActive}
        />
        <span>Использовать в тренировках</span>
      </label>

      <ResetKnownButton
        count={dict.words.filter((w) => w.known).length}
        url={`/dictionaries/${dict.id}/known/reset`}
        onDone={load}
      />

      {dict.can_edit && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditing({ kind: 'new' })}>+ Слово</Button>
          {dict.words.length > 1 && (
            <Button
              variant="secondary"
              onClick={() => setReordering(!reordering)}
              aria-pressed={reordering}
            >
              {reordering ? 'Готово' : '↕ Порядок слов'}
            </Button>
          )}
          {uncategorized > 0 && (
            <Button variant="secondary" onClick={() => setCategorizing(true)}>
              Без категории: {uncategorized}
            </Button>
          )}
          <Button variant="secondary" onClick={() => setEditing({ kind: 'meta' })}>
            Переименовать
          </Button>
          <a
            href={`/api/dictionaries/${dict.id}/export?format=zip`}
            download
            className="inline-flex items-center rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Скачать архив
          </a>
          <Button variant="dangerGhost" onClick={deleteDictionary}>
            Удалить словарь
          </Button>
        </div>
      )}

      <ErrorText>{error}</ErrorText>

      {reordering ? (
        <>
          <p className="text-sm text-slate-500">
            Держите ⋮⋮ и перетаскивайте слово или двигайте стрелками. Порядок сохраняется сразу — по
            нему идёт «Порядок по словарю» в тренировках.
          </p>
          <WordOrder key={orderVersion} words={dict.words} onChange={saveOrder} />
        </>
      ) : dict.words.length === 0 ? (
        <Card className="text-center text-slate-500">В словаре пока нет слов.</Card>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {dict.words.map((w) => (
            <li key={w.id}>
              <WordRow
                word={w}
                category={categories?.find((c) => c.id === w.category_id)}
                onKnownChange={(known) =>
                  setDict(
                    (d) =>
                      d && {
                        ...d,
                        words: d.words.map((x) => (x.id === w.id ? { ...x, known } : x)),
                      },
                  )
                }
                onClick={dict.can_edit ? () => setEditing({ kind: 'word', word: w }) : undefined}
              />
            </li>
          ))}
        </ul>
      )}

      {(editing?.kind === 'new' || editing?.kind === 'word') && (
        <Sheet
          title={editing.kind === 'new' ? 'Новое слово' : 'Слово'}
          onClose={() => setEditing(null)}
        >
          {editing.kind === 'word' && (
            <WordImage word={editing.word} onChanged={imageChanged} note={editing.justAdded} />
          )}
          <WordForm
            categories={categories ?? []}
            key={editing.kind === 'word' ? editing.word.id : 'new'}
            word={editing.kind === 'word' ? editing.word : undefined}
            onSubmit={saveWord}
            onDelete={editing.kind === 'word' ? () => deleteWord(editing.word) : undefined}
          />
        </Sheet>
      )}

      {categorizing && (
        <CategorizeSheet
          words={dict.words}
          categories={categories ?? []}
          onCategoryCreated={reloadCategories}
          onClose={(changed) => {
            setCategorizing(false)
            if (changed) load()
          }}
        />
      )}

      {editing?.kind === 'meta' && (
        <Sheet title="Словарь" onClose={() => setEditing(null)}>
          <DictionaryForm
            initial={dict}
            onSubmit={async (title, description) => {
              await api(`/dictionaries/${dict.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ title, description }),
              })
              await load()
              setEditing(null)
            }}
          />
        </Sheet>
      )}
    </section>
  )
}

function WordRow({
  word,
  category,
  onClick,
  onKnownChange,
}: {
  word: Word
  category?: Category
  onClick?: () => void
  onKnownChange: (known: boolean) => void
}) {
  const content = (
    <>
      <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white text-2xl ring-1 ring-slate-200 dark:ring-slate-700">
        {word.image_url ? (
          <img src={word.image_url} alt="" className="size-full object-contain" loading="lazy" />
        ) : (
          (word.image_emoji ?? <span className="text-base text-slate-400">—</span>)
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span lang="el" className="block truncate text-lg font-medium">
          {word.full_greek}
        </span>
        <span className="block truncate text-sm text-slate-500">
          {word.transcription && <span className="italic">{word.transcription}</span>}
          {word.transcription && ' · '}
          {word.translations_ru.join(', ')}
        </span>
        {category && (
          <span className="block truncate text-xs text-slate-400">{categoryLabel(category)}</span>
        )}
      </span>
    </>
  )
  const className = 'flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-1 text-left'
  return (
    <div className="flex items-center pr-1">
      <KnownCheckbox
        wordId={word.id}
        greek={word.full_greek}
        known={word.known}
        onChange={onKnownChange}
      />
      {onClick ? (
        <button
          onClick={onClick}
          className={`${className} hover:bg-slate-50 dark:hover:bg-slate-800/50`}
        >
          {content}
        </button>
      ) : (
        <div className={className}>{content}</div>
      )}
      <AnswerStats answers={word.answers} />
      <SpeakButton url={word.audio_url} text={word.full_greek} />
    </div>
  )
}

function NotFound({ message }: { message: string }) {
  return (
    <section className="space-y-3">
      <Link to="/dictionaries" className="text-sm text-blue-600 dark:text-blue-400">
        ← Словари
      </Link>
      <ErrorText>{message}</ErrorText>
    </section>
  )
}
