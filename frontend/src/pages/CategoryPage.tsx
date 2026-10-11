import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api } from '../api/client.ts'
import { byAuthor, pluralWords, type CategoryDetail } from '../api/types.ts'
import AnswerStats from '../components/AnswerStats.tsx'
import {
  ActiveCheckbox,
  afterActiveToggle,
  AlsoIn,
  StudyCheckbox,
} from '../components/StudyCheckbox.tsx'
import { KnownCheckbox, ResetKnownButton } from '../components/KnownCheckbox.tsx'
import Sheet from '../components/Sheet.tsx'
import SpeakButton from '../components/SpeakButton.tsx'
import WordOrder from '../components/WordOrder.tsx'
import { Button, Card, ErrorText, Spinner } from '../components/ui.tsx'
import { categoryLabel } from '../lib/categories.ts'
import { CategoryForm } from './CategoriesTab.tsx'

// One category: its words from every dictionary (with the dictionary shown next to each).
export default function CategoryPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [cat, setCat] = useState<CategoryDetail | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [reordering, setReordering] = useState(false)
  // Bumped when a failed save brings back the server's order: WordOrder starts over from it.
  const [orderVersion, setOrderVersion] = useState(0)

  const load = useCallback(async () => setCat(await api<CategoryDetail>(`/categories/${id}`)), [id])

  useEffect(() => {
    load().catch((e: Error) => setError(e.message))
  }, [load])

  if (!cat) return error ? <ErrorText>{error}</ErrorText> : <Spinner />

  // «Использовать в тренировках» = «учить» on every word here (or off on all of them).
  const toggleActive = async () => {
    const active = !cat.is_active
    setCat({
      ...afterActiveToggle(cat, cat.words.length),
      words: cat.words.map((w) => ({ ...w, study: active })),
    })
    try {
      await api(`/categories/${cat.id}/active`, {
        method: 'PUT',
        body: JSON.stringify({ active }),
      })
    } catch (e) {
      setError((e as Error).message)
      await load()
    }
  }

  const saveOrder = async (words: CategoryDetail['words']) => {
    setCat((c) => c && { ...c, words })
    setError('')
    try {
      await api(`/categories/${cat.id}/order`, {
        method: 'PUT',
        body: JSON.stringify({ word_ids: words.map((w) => w.id) }),
      })
    } catch (e) {
      setError((e as Error).message)
      await load()
      setOrderVersion((v) => v + 1)
    }
  }

  // «учить» on one word: the category's tick follows (all ticked — on, otherwise «–»).
  const setStudy = (wordId: number, study: boolean) =>
    setCat((c) => {
      if (!c) return c
      const words = c.words.map((x) => (x.id === wordId ? { ...x, study } : x))
      const count = words.filter((x) => x.study).length
      return { ...c, words, study_count: count, is_active: count === words.length }
    })

  const remove = async () => {
    if (!confirm(`Удалить категорию «${cat.name}»? Слова останутся в своих словарях.`)) return
    try {
      await api(`/categories/${cat.id}`, { method: 'DELETE' })
      navigate('/dictionaries?tab=categories', { replace: true })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <section className="space-y-4">
      <Link to="/dictionaries?tab=categories" className="text-sm text-blue-600 dark:text-blue-400">
        ← Категории
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">{categoryLabel(cat)}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {cat.word_count} {pluralWords(cat.word_count)} из всех словарей
          {byAuthor(cat.author)}
        </p>
      </div>

      <label className="flex cursor-pointer items-center gap-3">
        <ActiveCheckbox
          active={cat.is_active}
          partial={cat.study_count > 0}
          onChange={toggleActive}
          label="Использовать в тренировках"
        />
        <span>
          Использовать в тренировках
          {!cat.is_active && cat.study_count > 0 && (
            <span className="text-sm text-slate-500">
              {' '}
              · отмечено {cat.study_count} из {cat.words.length}
            </span>
          )}
        </span>
      </label>

      <ResetKnownButton
        count={cat.words.filter((w) => w.known).length}
        url={`/categories/${cat.id}/known/reset`}
        onDone={load}
      />

      {cat.can_edit && (
        <div className="flex flex-wrap gap-2">
          {cat.words.length > 1 && (
            <Button
              variant="secondary"
              onClick={() => setReordering(!reordering)}
              aria-pressed={reordering}
            >
              {reordering ? 'Готово' : '↕ Порядок слов'}
            </Button>
          )}
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Переименовать
          </Button>
          <Button variant="dangerGhost" onClick={remove}>
            Удалить категорию
          </Button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>

      {reordering ? (
        <>
          <p className="text-sm text-slate-500">
            Держите ⋮⋮ и перетаскивайте слово или двигайте стрелками. Порядок сохраняется сразу — по
            нему идёт «Сортировка по категориям» в тренировках.
          </p>
          <WordOrder key={orderVersion} words={cat.words} onChange={saveOrder} />
        </>
      ) : cat.words.length === 0 ? (
        <Card className="text-center text-slate-500">
          Слов пока нет. Категорию слову можно выбрать в его карточке в словаре.
        </Card>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {cat.words.map((w) => (
            <li key={w.id} className="flex items-center pr-1">
              <StudyCheckbox
                wordId={w.id}
                greek={w.full_greek}
                study={w.study ?? false}
                via="category"
                onChange={(study) => setStudy(w.id, study)}
              />
              <KnownCheckbox
                wordId={w.id}
                greek={w.full_greek}
                known={w.known}
                onChange={(known) =>
                  setCat(
                    (c) =>
                      c && {
                        ...c,
                        words: c.words.map((x) => (x.id === w.id ? { ...x, known } : x)),
                      },
                  )
                }
              />
              <Link
                to={`/dictionaries/${w.dictionary_id}`}
                className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-1"
              >
                <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white text-2xl ring-1 ring-slate-200 dark:ring-slate-700">
                  {w.image_url ? (
                    <img
                      src={w.image_url}
                      alt=""
                      className="size-full object-contain"
                      loading="lazy"
                    />
                  ) : (
                    (w.image_emoji ?? <span className="text-base text-slate-400">—</span>)
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span lang="el" className="block truncate text-lg font-medium">
                    {w.full_greek}
                  </span>
                  <span className="block truncate text-sm text-slate-500">
                    {w.translations_ru.join(', ')}
                  </span>
                  <span className="block truncate text-xs text-slate-400">
                    {w.dictionary_title}
                  </span>
                  <AlsoIn dictionaries={w.also_in ?? []} />
                </span>
              </Link>
              <AnswerStats answers={w.answers} />
              <SpeakButton url={w.audio_url} text={w.full_greek} />
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <Sheet title="Категория" onClose={() => setEditing(false)}>
          <CategoryForm
            initial={cat}
            onSubmit={async (name, emoji) => {
              await api(`/categories/${cat.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ name, emoji }),
              })
              await load()
              setEditing(false)
            }}
          />
        </Sheet>
      )}
    </section>
  )
}
