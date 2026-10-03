import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client.ts'
import type { Word } from '../api/types.ts'
import { ErrorText } from '../components/ui.tsx'
import { unlockAudio } from '../lib/speaker.ts'
import {
  clampCount,
  CountSlider,
  HideKnownToggle,
  playableCount,
  trainingTotal,
  ResultScreen,
  SessionShell,
  Toggle,
  TrainerSetup,
  useActiveCount,
  sessionKey,
  useTrainerSettings,
  type Mistake,
} from '../trainers/common.tsx'
import ChoiceTask, { type Direction, type Option } from '../trainers/ChoiceTask.tsx'

type Settings = {
  count: number
  direction: Direction
  showAnswer: boolean
  hideKnown: boolean
  repeatKnown: boolean
  hard: boolean
  speakAnswer: boolean
}
type Question = { word: Word; options: Option[] }

export default function TranslatePage() {
  const active = useActiveCount()
  const [settings, update] = useTrainerSettings<Settings>('translate', {
    hideKnown: true,
    repeatKnown: false,
    count: 20,
    direction: 'ru_gr',
    showAnswer: true,
    hard: false,
    speakAnswer: false,
  })
  const [questions, setQuestions] = useState<Question[] | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  const total = trainingTotal(active, settings?.repeatKnown)
  const playable = playableCount(active, settings?.hideKnown, settings?.repeatKnown)
  const count = settings && playable ? clampCount(settings.count, playable) : 1

  const start = async () => {
    if (!settings) return
    unlockAudio()
    setStarting(true)
    setError('')
    try {
      setQuestions(
        await api<Question[]>(
          `/training/translate?count=${count}&direction=${settings.direction}` +
            `&hide_known=${settings.hideKnown}&known_only=${settings.repeatKnown}&hard=${settings.hard}`,
        ),
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  if (questions && settings) {
    return (
      <TranslateSession
        key={sessionKey(questions)}
        questions={questions}
        direction={settings.direction}
        showAnswer={settings.showAnswer}
        speakAnswer={settings.speakAnswer}
        onExit={() => setQuestions(null)}
        onRestart={start}
      />
    )
  }

  return (
    <>
      <TrainerSetup
        title="Переведи слово"
        total={total}
        repeatKnown={settings?.repeatKnown ?? false}
        knownAll={active?.known_all ?? 0}
        onRepeatKnown={(repeatKnown) => update({ repeatKnown })}
        playable={playable}
        ready={settings !== null}
        starting={starting}
        onStart={start}
      >
        {settings && total ? (
          <>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Направление">
              {(
                [
                  ['ru_gr', 'С русского', 'на греческий'],
                  ['gr_ru', 'С греческого', 'на русский'],
                ] as const
              ).map(([value, a, b]) => (
                <button
                  key={value}
                  role="radio"
                  aria-checked={settings.direction === value}
                  onClick={() => update({ direction: value })}
                  className={`rounded-xl border-2 px-3 py-2.5 text-sm ${
                    settings.direction === value
                      ? 'border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {a}
                  <br />
                  {b}
                </button>
              ))}
            </div>
            {settings.direction === 'ru_gr' && (
              <div>
                <Toggle
                  label="Hard-режим"
                  checked={settings.hard}
                  onChange={(hard) => update({ hard })}
                />
                <p className="mt-1 pl-9 text-sm text-slate-500">
                  Варианты — почти как правильный: другая буква, другое ударение, другой артикль.
                </p>
              </div>
            )}
            <Toggle
              label="Показывать правильный ответ сразу"
              checked={settings.showAnswer}
              onChange={(showAnswer) => update({ showAnswer })}
            />
            {/* Plays when the right answer is shown — without «показывать сразу» it never is. */}
            {settings.showAnswer && (
              <Toggle
                label="Воспроизвести ответ"
                checked={settings.speakAnswer}
                onChange={(speakAnswer) => update({ speakAnswer })}
              />
            )}
            {!settings.repeatKnown && (
              <HideKnownToggle
                checked={settings.hideKnown}
                known={active?.known ?? 0}
                onChange={(hideKnown) => update({ hideKnown })}
              />
            )}
            {playable > 0 && (
              <CountSlider value={count} max={playable} onChange={(n) => update({ count: n })} />
            )}
          </>
        ) : null}
      </TrainerSetup>
      <ErrorText>{error}</ErrorText>
    </>
  )
}

function TranslateSession({
  questions,
  direction,
  showAnswer,
  speakAnswer,
  onExit,
  onRestart,
}: {
  questions: Question[]
  direction: Direction
  showAnswer: boolean
  speakAnswer: boolean
  onExit: () => void
  onRestart: () => void
}) {
  const [index, setIndex] = useState(0)
  const [mistakes, setMistakes] = useState<Mistake[]>([])
  const done = index >= questions.length
  const q = questions[index]

  const next = useCallback(() => setIndex((i) => i + 1), [])
  const answered = useCallback((m: Mistake | null) => m && setMistakes((all) => [...all, m]), [])

  const exit = useCallback(() => {
    if (done || confirm('Закончить тренировку?')) onExit()
  }, [done, onExit])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && exit()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exit])

  if (done) {
    return (
      <SessionShell onExit={onExit}>
        <ResultScreen
          total={questions.length}
          mistakes={mistakes}
          onRestart={onRestart}
          onExit={onExit}
          greekAnswers={direction === 'ru_gr'}
        />
      </SessionShell>
    )
  }

  return (
    <SessionShell progress={`${index + 1} / ${questions.length}`} onExit={exit}>
      <div className="flex flex-1 flex-col justify-center gap-4">
        <ChoiceTask
          key={index}
          word={q.word}
          options={q.options}
          direction={direction}
          showAnswer={showAnswer}
          speakAnswer={speakAnswer}
          onAnswered={answered}
          onNext={next}
        />
      </div>
    </SessionShell>
  )
}
