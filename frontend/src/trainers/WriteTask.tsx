import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../api/client.ts'
import type { Word } from '../api/types.ts'
import SpeakButton from '../components/SpeakButton.tsx'
import { Button, ErrorText } from '../components/ui.tsx'
import { speak } from '../lib/speaker.ts'
import { WordPicture, type Mistake } from './common.tsx'
import GreekKeyboard from './GreekKeyboard.tsx'

type Segment = { text: string; ok: boolean }
type CheckResult = {
  answer_id: number
  correct: boolean
  expected: string
  hint: string | null
  given_segments: Segment[]
  expected_segments: Segment[]
}

// One «Напиши» question: picture + Russian, type the Greek, ✓, verdict. Used by «Напиши» and
// «Микс заданий». Not keyed per word on purpose: the same <input> stays focused between
// consecutive write questions, so a phone keyboard doesn't close and reopen.
export default function WriteTask({
  word,
  speakAnswer = false,
  screenKeyboard = false,
  taskKey,
  onAnswered,
  onAccepted,
  onNext,
}: {
  word: Word
  /** «Экранная клавиатура»: only the site's Greek keyboard, the device's one never opens
   * (inputmode=none) — e.g. Samsung Keyboard in Chrome drops the field when the language is
   * picked by holding the space bar. */
  screenKeyboard?: boolean
  /** «Воспроизвести ответ»: say the Greek word when the verdict shows the right answer. */
  speakAnswer?: boolean
  /** Changes for every new task (default: the word) — the same word can come again. */
  taskKey?: string
  onAnswered: (mistake: Mistake | null) => void
  /** «Я ответил правильно»: the learner overruled the check — the session drops the mistake. */
  onAccepted?: (word: Word) => void
  onNext: () => void
}) {
  const [answer, setAnswer] = useState('')
  const [result, setResult] = useState<CheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  // New task: clear the previous answer and keep the keyboard up.
  const key = taskKey ?? String(word.id)
  const [shownKey, setShownKey] = useState(key)
  if (shownKey !== key) {
    setShownKey(key)
    setAnswer('')
    setResult(null)
    setError('')
    setAccepted(false)
  }
  useEffect(() => {
    input.current?.focus()
  }, [word.id])

  // On-screen keyboard: replace the selection (or insert at the caret) and keep the caret after it.
  const edit = (text: string, backspace = false) => {
    const el = input.current
    if (!el || result) return
    let start = el.selectionStart ?? answer.length
    const end = el.selectionEnd ?? start
    if (backspace && start === end) start = Math.max(0, start - 1)
    const value = answer.slice(0, start) + text + answer.slice(end)
    caret.current = start + text.length
    setAnswer(value)
  }
  // Right after React writes the new value (which moves the caret to the end).
  const caret = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (caret.current === null) return
    input.current?.setSelectionRange(caret.current, caret.current)
    caret.current = null
  }, [answer])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (result) return onNext() // Enter after the check = «Далее»
    if (answer.trim()) check(answer)
  }

  // «Не знаю» = an empty answer: logged as wrong, the verdict shows the right one.
  const dontKnow = () => {
    setAnswer('')
    check('')
  }

  // «Я ответил правильно»: counts as right in the word's statistics and in this exercise.
  // The exercise knows at once (a quick «Далее» mustn't beat the request); the statistics
  // follow — if the server refuses, the error is shown.
  const accept = async () => {
    if (!result) return
    setAccepted(true)
    onAccepted?.(word)
    try {
      await api(`/training/answers/${result.answer_id}/accept`, { method: 'POST' })
    } catch (err) {
      setError(`Не удалось засчитать в статистике: ${(err as Error).message}`)
    }
  }

  const check = async (given: string) => {
    if (checking || result) return
    setChecking(true)
    setError('')
    try {
      const r = await api<CheckResult>('/training/write/check', {
        method: 'POST',
        body: JSON.stringify({ word_id: word.id, answer: given }),
      })
      setResult(r)
      // After the server's answer, outside the tap: fine, «Начать» has unlocked the sound.
      if (speakAnswer) speak(word.audio_url, word.full_greek)
      onAnswered(
        r.correct
          ? null
          : {
              word,
              prompt: word.translations_ru.join(', '),
              correct: r.expected,
              given: given.trim(),
              greek: true,
            },
      )
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <article className="rounded-3xl bg-white p-4 text-center shadow-lg dark:bg-slate-900">
        <WordPicture
          word={word}
          className="mx-auto aspect-square max-h-[30dvh] w-full [@media(max-height:700px)]:max-h-[22dvh]"
        />
        <p className="pt-3 text-2xl font-semibold">{word.translations_ru.join(', ')}</p>
      </article>

      <form onSubmit={submit} className="flex gap-2">
        <input
          ref={input}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          readOnly={!!result}
          inputMode={screenKeyboard ? 'none' : undefined}
          lang="el"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint={result ? 'next' : 'done'}
          placeholder="по-гречески…"
          aria-label="Ответ по-гречески"
          className={`min-w-0 flex-1 rounded-2xl border-2 bg-white px-4 py-3 text-xl outline-none dark:bg-slate-900 ${
            !result
              ? 'border-slate-300 focus:border-blue-500 dark:border-slate-700'
              : result.correct
                ? 'border-green-600'
                : 'border-red-600'
          }`}
        />
        <button
          type="submit"
          disabled={checking || (!result && !answer.trim())}
          className="flex w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
          aria-label={result ? 'Далее' : 'Проверить'}
        >
          {result ? (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              className="size-7"
            >
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              className="size-7"
            >
              <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </form>
      {!result && (
        <div className="-mt-2 flex justify-end">
          {/* mousedown cancelled: the answer field (and the phone keyboard) keep focus. */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={dontKnow}
            disabled={checking}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            Не знаю
          </button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>

      {result ? (
        <Verdict
          result={result}
          word={word}
          accepted={accepted}
          onAccept={onAccepted ? accept : undefined}
          onNext={onNext}
        />
      ) : (
        <GreekKeyboard
          onInput={(text) => edit(text)}
          onBackspace={() => edit('', true)}
          disabled={checking}
          always={screenKeyboard}
        />
      )}
    </>
  )
}

function Verdict({
  result,
  word,
  accepted,
  onAccept,
  onNext,
}: {
  result: CheckResult
  word: Word
  accepted: boolean
  onAccept?: () => void
  onNext: () => void
}) {
  // «Не знаю» (nothing typed) can't be counted as right.
  const canAccept = !result.correct && !accepted && result.given_segments.length > 0
  return (
    <div className="space-y-3 rounded-2xl bg-white p-4 dark:bg-slate-900">
      {result.correct ? (
        <p className="text-lg font-semibold text-green-700 dark:text-green-400">Верно!</p>
      ) : (
        <>
          {accepted && (
            <p className="text-lg font-semibold text-green-700 dark:text-green-400" role="status">
              Засчитано как верно ✓
            </p>
          )}
          <Row label="Ваш ответ">
            {result.given_segments.length === 0 && (
              <span lang="ru" className="text-base text-slate-500 italic">
                не знаю
              </span>
            )}
            {result.given_segments.map((s, i) => (
              <span
                key={i}
                className={
                  s.ok ? '' : 'rounded bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                }
              >
                {s.text}
              </span>
            ))}
          </Row>
          <Row label="Правильно">
            {result.expected_segments.map((s, i) => (
              <span
                key={i}
                className={
                  s.ok
                    ? ''
                    : 'rounded bg-green-100 font-semibold text-green-800 dark:bg-green-950 dark:text-green-300'
                }
              >
                {s.text}
              </span>
            ))}
          </Row>
          {result.hint && (
            <p className="text-sm text-amber-700 dark:text-amber-400">{result.hint}</p>
          )}
          {canAccept && onAccept && (
            <Button variant="secondary" onClick={onAccept} className="w-full">
              Я ответил правильно
            </Button>
          )}
        </>
      )}
      <div className="flex items-center gap-2">
        <SpeakButton url={word.audio_url} text={word.full_greek} />
        <span lang="el" className="text-slate-500">
          {word.full_greek}
          {word.transcription && ` · ${word.transcription}`}
        </span>
        <Button onClick={onNext} className="ml-auto">
          Далее
        </Button>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p lang="el" className="text-xl whitespace-pre-wrap">
        {children}
      </p>
    </div>
  )
}
