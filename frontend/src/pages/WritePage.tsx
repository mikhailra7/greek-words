import { useCallback, useEffect, useState } from 'react'
import type { Word } from '../api/types.ts'
import { ErrorText } from '../components/ui.tsx'
import { unlockAudio } from '../lib/speaker.ts'
import {
  clampCount,
  CountSlider,
  fetchTrainingWords,
  HideKnownToggle,
  playableCount,
  ResultScreen,
  SessionShell,
  Toggle,
  TrainerSetup,
  useActiveCount,
  sessionKey,
  useTrainerSettings,
  type Mistake,
} from '../trainers/common.tsx'
import WriteTask from '../trainers/WriteTask.tsx'

type Settings = { count: number; hideKnown: boolean; speakAnswer: boolean; screenKeyboard: boolean }
export default function WritePage() {
  const active = useActiveCount()
  const [settings, update] = useTrainerSettings<Settings>('write', {
    count: 20,
    hideKnown: true,
    speakAnswer: false,
    screenKeyboard: false,
  })
  const [words, setWords] = useState<Word[] | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  const total = active?.words ?? null
  const playable = playableCount(active, settings?.hideKnown)
  const count = settings && playable ? clampCount(settings.count, playable) : 1

  const start = async () => {
    unlockAudio()
    setStarting(true)
    setError('')
    try {
      setWords(await fetchTrainingWords(count, settings?.hideKnown ?? true))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
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
            <Toggle
              label="Воспроизвести ответ"
              checked={settings.speakAnswer}
              onChange={(speakAnswer) => update({ speakAnswer })}
            />
            <HideKnownToggle
              checked={settings.hideKnown}
              known={active?.known ?? 0}
              onChange={(hideKnown) => update({ hideKnown })}
            />
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
          onNext={next}
        />
      </div>
    </SessionShell>
  )
}
