// Shared pieces of the three trainers: remembered settings, word count slider, setup screen,
// full-screen session shell.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { api } from '../api/client.ts'
import { pluralWords, type ActiveSummary, type Word } from '../api/types.ts'
import { Button, Card, Spinner } from '../components/ui.tsx'

// Keys of per-user settings on the server (trainers + «voice» from the profile).
export type TrainerKey = 'study' | 'translate' | 'write' | 'listen' | 'mix' | 'voice' | 'dialogue'

let settingsCache: Promise<Record<string, Record<string, unknown>>> | null = null

// Called on login/logout so the next person on this device doesn't get stale settings.
export function resetTrainerSettingsCache(): void {
  settingsCache = null
}

// Last used options per trainer, stored on the server (same on phone and laptop).
export function useTrainerSettings<T extends Record<string, unknown>>(
  key: TrainerKey,
  defaults: T,
): [T | null, (patch: Partial<T>) => void] {
  const [value, setValue] = useState<T | null>(null)
  const saveTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    settingsCache ??= api<Record<string, Record<string, unknown>>>('/me/settings').catch(() => ({}))
    settingsCache.then((all) => setValue({ ...defaults, ...(all[key] as Partial<T>) }))
    // defaults are a fresh literal each render; loading once per key is intended
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const update = useCallback(
    (patch: Partial<T>) =>
      setValue((prev) => {
        const next = { ...(prev ?? defaults), ...patch }
        window.clearTimeout(saveTimer.current)
        saveTimer.current = window.setTimeout(() => {
          settingsCache = settingsCache?.then((all) => ({ ...all, [key]: next })) ?? null
          api(`/me/settings/${key}`, {
            method: 'PUT',
            body: JSON.stringify({ value: next }),
          }).catch(() => {})
        }, 400)
        return next
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )

  return [value, update]
}

export function useActiveCount(): ActiveSummary | null {
  const [summary, setSummary] = useState<ActiveSummary | null>(null)
  useEffect(() => {
    api<ActiveSummary>('/words/active/count')
      .then(setSummary)
      .catch(() => setSummary({ dictionaries: 0, categories: 0, words: 0, known: 0 }))
  }, [])
  return summary
}

// Every «Начать» / «Ещё раз» must mount a fresh session (card 1, empty answers), even if the
// random draw happens to repeat the previous order — hence the counter, not just the ids.
let sessionCounter = 0
const sessionKeys = new WeakMap<object, string>()
export function sessionKey(batch: object): string {
  let key = sessionKeys.get(batch)
  if (!key) {
    key = `s${++sessionCounter}`
    sessionKeys.set(batch, key)
  }
  return key
}

export async function fetchTrainingWords(count: number, hideKnown: boolean): Promise<Word[]> {
  return api<Word[]>(`/training/words?count=${count}&hide_known=${hideKnown}`)
}

/** How many words an exercise can use right now (known ones excluded when hidden). */
export const playableCount = (a: ActiveSummary | null, hideKnown: boolean | undefined) =>
  a ? a.words - (hideKnown ? a.known : 0) : 0

// «Скрыть выученные слова» — the same toggle in all four exercises.
export function HideKnownToggle({
  checked,
  known,
  onChange,
}: {
  checked: boolean
  known: number
  onChange: (v: boolean) => void
}) {
  return (
    <div>
      <Toggle label="Скрыть выученные слова" checked={checked} onChange={onChange} />
      {known > 0 && (
        <p className="mt-1 ml-9 text-sm text-slate-500">
          Выучено: {known} {pluralWords(known)}
          {checked ? ' — они не попадут в упражнение' : ' — могут попасться'}
        </p>
      )}
    </div>
  )
}

export const DEFAULT_COUNT = 20

// Saved count may exceed today's total (a dictionary was switched off) — clamp it.
export const clampCount = (saved: number | undefined, total: number) =>
  Math.max(1, Math.min(saved ?? DEFAULT_COUNT, total))

export function CountSlider({
  value,
  max,
  onChange,
}: {
  value: number
  max: number
  onChange: (n: number) => void
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-baseline justify-between">
        <span className="font-medium">Количество слов</span>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
      </span>
      <input
        type="range"
        min={1}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-600"
        disabled={max <= 1}
      />
      <span className="mt-1 flex justify-between text-xs text-slate-500">
        <span>1</span>
        <span>
          {max} {pluralWords(max)}
        </span>
      </span>
    </label>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <input
        type="checkbox"
        className="size-6 accent-blue-600"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

// Title + options card + big «Начать»; handles loading and "no active words".
export function TrainerSetup({
  title,
  total,
  playable,
  ready,
  starting,
  onStart,
  children,
}: {
  title: string
  total: number | null // words in the active dictionaries/categories
  playable: number // of them, usable with the current settings (known ones may be hidden)
  ready: boolean
  starting?: boolean
  onStart: () => void
  children: ReactNode
}) {
  if (total === null || !ready) return <Spinner />
  return (
    <section className="mx-auto max-w-md space-y-5">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {total === 0 ? (
        <Card className="space-y-3 text-center">
          <p>В тренировке пока нет слов.</p>
          <p className="text-sm text-slate-500">Отметьте словари галочками в разделе «Словари».</p>
          <Link
            to="/dictionaries"
            className="inline-block rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white"
          >
            Выбрать словари
          </Link>
        </Card>
      ) : (
        <>
          <Card className="space-y-6 p-5">
            {children}
            {playable === 0 && (
              <p className="rounded-xl bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
                Все слова отмечены как выученные. Снимите «Скрыть выученные слова» или сбросьте
                отметки в словаре или категории.
              </p>
            )}
          </Card>
          <div className="flex justify-center">
            <Button
              onClick={onStart}
              disabled={starting || playable === 0}
              className="min-w-48 py-3.5 text-lg"
            >
              {starting ? 'Загружаю…' : 'Начать'}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

export function IconClose({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={className}
    >
      <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
    </svg>
  )
}

// Full-screen layer over the app (hides the tab bar) with progress and ✕ in the corner.
export function SessionShell({
  progress,
  onExit,
  children,
}: {
  progress?: string
  onExit: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-50 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] dark:bg-slate-950">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-3">
        <span className="text-sm text-slate-500 tabular-nums">{progress}</span>
        <button
          onClick={onExit}
          className="-mr-2 rounded-full p-2 text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          aria-label="Выйти"
        >
          <IconClose className="size-7" />
        </button>
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col overflow-y-auto px-4 pb-4">
        {children}
      </main>
    </div>
  )
}

export function WordPicture({ word, className = '' }: { word: Word; className?: string }) {
  return (
    <div
      className={`flex items-center justify-center overflow-hidden rounded-2xl bg-white ${className}`}
    >
      {word.image_url ? (
        <img src={word.image_url} alt="" className="size-full object-contain" draggable={false} />
      ) : (
        <span className="text-8xl">{word.image_emoji ?? '📘'}</span>
      )}
    </div>
  )
}

// greek: the answers are Greek text; task: which kind of question it was (shown in «Микс»).
export type Mistake = {
  word: Word
  prompt: string
  correct: string
  given: string
  greek?: boolean
  task?: string
}

// End of «Переведи» / «Напиши» / «Микс»: score + what went wrong.
export function ResultScreen({
  total,
  mistakes,
  onRestart,
  onExit,
  greekAnswers,
}: {
  total: number
  mistakes: Mistake[]
  onRestart: () => void
  onExit: () => void
  greekAnswers?: boolean
}) {
  const right = total - mistakes.length
  const ratio = total ? right / total : 0
  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto pt-6">
      <div className="text-center">
        <p className="text-5xl">{ratio === 1 ? '🏆' : ratio >= 0.7 ? '🎉' : '💪'}</p>
        <p className="mt-3 text-2xl font-semibold">
          Правильно {right} из {total}
        </p>
      </div>
      <div className="flex justify-center gap-3">
        <Button onClick={onRestart}>Ещё раз</Button>
        <Button variant="secondary" onClick={onExit}>
          В меню
        </Button>
      </div>
      {mistakes.length > 0 && (
        <div>
          <h2 className="mb-2 font-medium">Ошибки</h2>
          <ul className="divide-y divide-slate-200 rounded-2xl bg-white dark:divide-slate-800 dark:bg-slate-900">
            {mistakes.map((m, i) => (
              <li key={i} className="px-4 py-3 text-sm">
                {m.task && <p className="text-xs text-slate-500">{m.task}</p>}
                <p className="font-medium">{m.prompt}</p>
                <p className="text-green-700 dark:text-green-400">
                  ✓ <span lang={(m.greek ?? greekAnswers) ? 'el' : undefined}>{m.correct}</span>
                </p>
                <p className="text-red-600 line-through decoration-1 dark:text-red-400">
                  ✗{' '}
                  {m.given ? (
                    <span lang={(m.greek ?? greekAnswers) ? 'el' : undefined}>{m.given}</span>
                  ) : (
                    'не знаю'
                  )}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
