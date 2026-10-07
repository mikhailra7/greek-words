import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type { DialogueDetail, DialogueLine } from '../api/types.ts'
import { Button } from '../components/ui.tsx'
import { compareLoose, tokenize, type LooseCheck } from '../lib/greekText.ts'
import { Toggle } from '../trainers/common.tsx'
import GreekKeyboard from '../trainers/GreekKeyboard.tsx'
import ScopedPractice from './ScopedPractice.tsx'
import type { Voice } from './voice.ts'

// Д4.5 «Ввод по памяти»: the translation, type the Greek line. Lenient: case, punctuation,
// accents and ς/σ don't count — this mode learns the text, «Напиши» learns the spelling.
// The right line is then shown with its accents; differing words are marked.

export default function TypeMode({
  dialogue,
  voiceOf,
  screenKeyboard,
  setScreenKeyboard,
}: {
  dialogue: DialogueDetail
  voiceOf: Voice
  screenKeyboard: boolean
  setScreenKeyboard: (on: boolean) => void
}) {
  return (
    <ScopedPractice
      dialogue={dialogue}
      voiceOf={voiceOf}
      resultLabel="Верно"
      setupExtra={
        <div>
          <Toggle
            label="Экранная клавиатура"
            checked={screenKeyboard}
            onChange={setScreenKeyboard}
          />
          <p className="mt-1 pl-9 text-sm text-slate-500">
            Греческая клавиатура сайта вместо клавиатуры телефона — та не открывается.
          </p>
        </div>
      }
      intro="По переводу наберите реплику по-гречески. Ударения, заглавные буквы и знаки препинания не важны — важны слова и их порядок."
      task={({ line, onMistake, onRight, play, onNext }) => (
        <TypeTask
          line={line}
          screenKeyboard={screenKeyboard}
          onMistake={onMistake}
          onRight={onRight}
          play={play}
          onNext={onNext}
        />
      )}
    />
  )
}

function TypeTask({
  line,
  screenKeyboard,
  onMistake,
  onRight,
  play,
  onNext,
}: {
  line: DialogueLine
  screenKeyboard: boolean
  onMistake: () => void
  onRight: () => void
  play: () => void
  onNext: () => void
}) {
  const [answer, setAnswer] = useState('')
  const [result, setResult] = useState<LooseCheck | null>(null)
  const [gaveUp, setGaveUp] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    field.current?.focus()
  }, [])

  const check = (given: string, giveUp = false) => {
    const r = compareLoose(given, line.greek)
    setResult(r)
    setGaveUp(giveUp)
    if (giveUp || !r.correct) onMistake()
    play() // inside the tap / Enter: plays on iOS too
  }
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!result && answer.trim()) check(answer)
  }

  // The site keyboard: insert at the caret (or over the selection) and keep the caret after it.
  const caret = useRef<number | null>(null)
  const edit = (text: string, backspace = false) => {
    const el = field.current
    if (!el || result) return
    let start = el.selectionStart ?? answer.length
    const end = el.selectionEnd ?? start
    if (backspace && start === end) start = Math.max(0, start - 1)
    caret.current = start + text.length
    setAnswer(answer.slice(0, start) + text + answer.slice(end))
  }
  useLayoutEffect(() => {
    if (caret.current === null) return
    field.current?.setSelectionRange(caret.current, caret.current)
    caret.current = null
  }, [answer])

  return (
    <div className="mt-2 space-y-3">
      <form onSubmit={submit} className="space-y-2">
        <textarea
          ref={field}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          // Enter checks (and after the check — «Далее» has the focus); no line breaks.
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) submit(e)
          }}
          readOnly={!!result}
          rows={2}
          inputMode={screenKeyboard ? 'none' : undefined}
          lang="el"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          placeholder="по-гречески…"
          aria-label="Реплика по-гречески"
          className="w-full resize-none rounded-xl border-2 border-slate-300 bg-white px-3 py-2 text-lg outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
        />
        {!result && (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!answer.trim()}>
              Проверить
            </Button>
            <Button
              type="button"
              variant="secondary"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => check('', true)}
            >
              Не знаю
            </Button>
          </div>
        )}
      </form>

      {result ? (
        <div className="space-y-2" role="status">
          <p
            className={`font-medium ${
              (result.correct || accepted) && !gaveUp
                ? 'text-green-700 dark:text-green-400'
                : 'text-red-700 dark:text-red-400'
            }`}
          >
            {gaveUp
              ? 'Правильно так:'
              : result.correct
                ? 'Верно!'
                : accepted
                  ? 'Засчитано как верно ✓'
                  : 'Есть отличия'}
          </p>
          {!gaveUp && !result.correct && (
            <p lang="el" className="text-lg" aria-label="Ваш ответ">
              {result.given.map((w, i) => (
                <span key={i}>
                  {i > 0 && ' '}
                  <span
                    className={
                      w.ok
                        ? ''
                        : 'rounded bg-red-100 px-0.5 text-red-900 dark:bg-red-900/60 dark:text-red-100'
                    }
                  >
                    {w.text}
                  </span>
                </span>
              ))}
            </p>
          )}
          <p lang="el" className="text-lg font-medium" aria-label="Правильно">
            {result.correct || gaveUp ? (
              line.greek
            ) : (
              <MarkedLine line={line.greek} check={result} />
            )}
          </p>
          {line.transcription && (
            <p className="text-slate-500 italic dark:text-slate-400">{line.transcription}</p>
          )}
          {result.latin && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Похоже, введены латинские буквы — переключите клавиатуру на греческую.
            </p>
          )}
          {!result.correct && !gaveUp && !accepted && (
            <Button
              variant="secondary"
              onClick={() => {
                setAccepted(true)
                onRight()
              }}
              className="mr-2"
            >
              Я ответил правильно
            </Button>
          )}
          {/* Focused, so Enter after the check goes on. */}
          <Button autoFocus onClick={onNext}>
            Далее
          </Button>
        </div>
      ) : (
        <GreekKeyboard
          onInput={(text) => edit(text)}
          onBackspace={() => edit('', true)}
          disabled={false}
          always={screenKeyboard}
        />
      )}
    </div>
  )
}

/** The right line with its punctuation; the words the answer missed in green. */
function MarkedLine({ line, check }: { line: string; check: LooseCheck }) {
  let w = -1
  return (
    <>
      {tokenize(line).map((t, i) => {
        if (!t.word) return <span key={i}>{t.text}</span>
        w++
        return check.expected[w]?.ok ? (
          <span key={i}>{t.text}</span>
        ) : (
          <span
            key={i}
            className="rounded bg-green-100 px-0.5 text-green-900 dark:bg-green-900/60 dark:text-green-100"
          >
            {t.text}
          </span>
        )
      })}
    </>
  )
}
