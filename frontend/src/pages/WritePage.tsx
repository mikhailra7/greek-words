import { useCallback, useEffect, useState } from 'react'
import { pluralWords, type Word } from '../api/types.ts'
import { Button, ErrorText } from '../components/ui.tsx'
import { unlockAudio } from '../lib/speaker.ts'
import {
  clampCount,
  CountSlider,
  fetchTrainingWords,
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
  withoutLast,
  type Mistake,
} from '../trainers/common.tsx'
import WriteTask from '../trainers/WriteTask.tsx'

type Settings = {
  count: number
  hideKnown: boolean
  repeatKnown: boolean
  speakAnswer: boolean
  screenKeyboard: boolean
  /** «Добивать до правильного ответа»: rounds until every word is written right. */
  untilRight: boolean
}
export default function WritePage() {
  const active = useActiveCount()
  const [settings, update] = useTrainerSettings<Settings>('write', {
    count: 20,
    hideKnown: true,
    repeatKnown: false,
    speakAnswer: false,
    screenKeyboard: false,
    untilRight: false,
  })
  const [words, setWords] = useState<Word[] | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  const total = trainingTotal(active, settings?.repeatKnown)
  const playable = playableCount(active, settings?.hideKnown, settings?.repeatKnown)
  const count = settings && playable ? clampCount(settings.count, playable) : 1

  const start = async () => {
    unlockAudio()
    setStarting(true)
    setError('')
    try {
      setWords(
        await fetchTrainingWords(
          count,
          settings?.hideKnown ?? true,
          settings?.repeatKnown ?? false,
        ),
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  if (words && settings?.untilRight) {
    return (
      <UntilRightSession
        key={sessionKey(words)}
        words={words}
        speakAnswer={settings.speakAnswer}
        screenKeyboard={settings.screenKeyboard}
        onExit={() => setWords(null)}
        onRestart={start}
      />
    )
  }

  if (words) {
    return (
      <WriteSession
        key={sessionKey(words)}
        words={words}
        speakAnswer={settings?.speakAnswer ?? false}
        screenKeyboard={settings?.screenKeyboard ?? false}
        onExit={() => setWords(null)}
        onRestart={start}
      />
    )
  }

  return (
    <>
      <TrainerSetup
        title="Напиши"
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
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Пишите по-гречески с ударением. У существительных — с артиклем: «το νερό».
            </p>
            <div>
              <Toggle
                label="Экранная клавиатура"
                checked={settings.screenKeyboard}
                onChange={(screenKeyboard) => update({ screenKeyboard })}
              />
              <p className="mt-1 pl-9 text-sm text-slate-500">
                Греческая клавиатура сайта вместо клавиатуры телефона — та не открывается.
              </p>
            </div>
            <div>
              <Toggle
                label="Добивать до правильного ответа"
                checked={settings.untilRight}
                onChange={(untilRight) => update({ untilRight })}
              />
              <p className="mt-1 pl-9 text-sm text-slate-500">
                Круг за кругом: слова с ошибками (и с «Не знаю») идут ещё раз, пока все не будут
                написаны верно.
              </p>
            </div>
            <Toggle
              label="Воспроизвести ответ"
              checked={settings.speakAnswer}
              onChange={(speakAnswer) => update({ speakAnswer })}
            />
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

function WriteSession({
  words,
  speakAnswer,
  screenKeyboard,
  onExit,
  onRestart,
}: {
  words: Word[]
  speakAnswer: boolean
  screenKeyboard: boolean
  onExit: () => void
  onRestart: () => void
}) {
  const [index, setIndex] = useState(0)
  const [mistakes, setMistakes] = useState<Mistake[]>([])
  const done = index >= words.length

  const next = useCallback(() => setIndex((i) => i + 1), [])
  const answered = useCallback((m: Mistake | null) => m && setMistakes((all) => [...all, m]), [])
  const accepted = useCallback(
    (w: Word) => setMistakes((all) => withoutLast(all, (m) => m.word.id === w.id)),
    [],
  )

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
          total={words.length}
          mistakes={mistakes}
          onRestart={onRestart}
          onExit={onExit}
          greekAnswers
        />
      </SessionShell>
    )
  }

  return (
    <SessionShell progress={`${index + 1} / ${words.length}`} onExit={exit}>
      <div className="flex flex-1 flex-col gap-4 pt-2">
        <WriteTask
          word={words[index]}
          speakAnswer={speakAnswer}
          screenKeyboard={screenKeyboard}
          onAnswered={answered}
          onAccepted={accepted}
          onNext={next}
        />
      </div>
    </SessionShell>
  )
}

const shuffle = <T,>(items: T[]): T[] => {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// «Добивать до правильного ответа»: the words once; then, round after round, the ones with a
// mistake (shuffled) — until a round has none. The verdict is the usual one, with the right
// answer (hiding it was tried on 2026-10-04 and dropped the next day).
function UntilRightSession({
  words,
  speakAnswer,
  screenKeyboard,
  onExit,
  onRestart,
}: {
  words: Word[]
  speakAnswer: boolean
  screenKeyboard: boolean
  onExit: () => void
  onRestart: () => void
}) {
  const [round, setRound] = useState(1)
  const [queue, setQueue] = useState(words)
  const [index, setIndex] = useState(0)
  const [wrong, setWrong] = useState<Word[]>([]) // this round
  const [errors, setErrors] = useState<Record<number, number>>({}) // word id → mistakes
  const [done, setDone] = useState(false)

  const answered = useCallback((m: Mistake | null) => {
    if (!m) return
    setWrong((w) => [...w, m.word])
    setErrors((e) => ({ ...e, [m.word.id]: (e[m.word.id] ?? 0) + 1 }))
  }, [])
  // «Я ответил правильно»: not a mistake after all — off the next round.
  const accepted = useCallback((w: Word) => {
    setWrong((ws) => withoutLast(ws, (x) => x.id === w.id))
    setErrors((e) => ({ ...e, [w.id]: Math.max(0, (e[w.id] ?? 1) - 1) }))
  }, [])

  const next = () => {
    if (index + 1 < queue.length) return setIndex((i) => i + 1)
    if (wrong.length === 0) return setDone(true)
    setQueue(shuffle(wrong))
    setWrong([])
    setIndex(0)
    setRound((r) => r + 1)
  }

  const exit = useCallback(() => {
    if (done || confirm('Закончить тренировку?')) onExit()
  }, [done, onExit])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && exit()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exit])

  if (done) {
    const hard = words.filter((w) => errors[w.id]).sort((a, b) => errors[b.id] - errors[a.id])
    return (
      <SessionShell onExit={onExit}>
        <div className="flex flex-1 flex-col gap-5 py-4">
          <div className="text-center">
            <p className="text-5xl">🎉</p>
            <p className="mt-3 text-xl font-semibold">
              Все {words.length} {pluralWords(words.length)} написаны верно
            </p>
            <p className="text-slate-500">Кругов: {round}</p>
          </div>
          {hard.length > 0 && (
            <div>
              <p className="mb-2 font-medium">Больше всего попыток</p>
              <ul className="divide-y divide-slate-200 rounded-2xl bg-white dark:divide-slate-800 dark:bg-slate-900">
                {hard.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0">
                      <span lang="el" className="block font-medium">
                        {w.full_greek}
                      </span>
                      <span className="block text-sm text-slate-500">
                        {w.translations_ru.join(', ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm text-red-700 dark:text-red-400">
                      ошибок: {errors[w.id]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-center gap-3">
            <Button onClick={onRestart}>Ещё раз</Button>
            <Button variant="secondary" onClick={onExit}>
              В меню
            </Button>
          </div>
        </div>
      </SessionShell>
    )
  }

  return (
    <SessionShell
      progress={`${round > 1 ? `Круг ${round} · ` : ''}${index + 1} / ${queue.length}`}
      onExit={exit}
    >
      <div className="flex flex-1 flex-col gap-4 pt-2">
        {round > 1 && index === 0 && (
          <p className="text-center text-sm text-slate-500" role="status">
            Круг {round}: слова, где были ошибки
          </p>
        )}
        <WriteTask
          word={queue[index]}
          taskKey={`${round}:${index}`}
          speakAnswer={speakAnswer}
          screenKeyboard={screenKeyboard}
          onAnswered={answered}
          onAccepted={accepted}
          onNext={next}
        />
      </div>
    </SessionShell>
  )
}
