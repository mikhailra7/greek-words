import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client.ts'
import type { Word } from '../api/types.ts'
import { ErrorText } from '../components/ui.tsx'
import { unlockAudio } from '../lib/speaker.ts'
import ChoiceTask, { type Option } from '../trainers/ChoiceTask.tsx'
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
  withoutLast,
  type Mistake,
} from '../trainers/common.tsx'
import WriteTask from '../trainers/WriteTask.tsx'

type Settings = {
  count: number
  showAnswer: boolean
  hideKnown: boolean
  repeatKnown: boolean
  speakAnswer: boolean
  screenKeyboard: boolean
}
type TaskType = 'ru_gr' | 'gr_ru' | 'write'
type Task = { type: TaskType; word: Word; options: Option[] }

// What to do, shown above the card; the short form tags mistakes on the result screen.
const TASK_LABEL: Record<TaskType, { hint: string; tag: string }> = {
  ru_gr: { hint: 'Выберите перевод на греческий', tag: 'Переведи: с русского на греческий' },
  gr_ru: { hint: 'Выберите перевод на русский', tag: 'Переведи: с греческого на русский' },
  write: { hint: 'Напишите по-гречески', tag: 'Напиши' },
}

export default function MixPage() {
  const active = useActiveCount()
  const [settings, update] = useTrainerSettings<Settings>('mix', {
    count: 20,
    showAnswer: true,
    hideKnown: true,
    repeatKnown: false,
    speakAnswer: false,
    screenKeyboard: false,
  })
  const [tasks, setTasks] = useState<Task[] | null>(null)
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
      setTasks(
        await api<Task[]>(
          `/training/mix?count=${count}&hide_known=${settings.hideKnown}&known_only=${settings.repeatKnown}`,
        ),
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  if (tasks && settings) {
    return (
      <MixSession
        key={sessionKey(tasks)}
        tasks={tasks}
        showAnswer={settings.showAnswer}
        speakAnswer={settings.speakAnswer}
        screenKeyboard={settings.screenKeyboard}
        onExit={() => setTasks(null)}
        onRestart={start}
      />
    )
  }

  return (
    <>
      <TrainerSetup
        title="Микс заданий"
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
              Вперемешку: «Переведи» с русского и с греческого и «Напиши».
            </p>
            <Toggle
              label="Показывать правильный ответ сразу"
              checked={settings.showAnswer}
              onChange={(showAnswer) => update({ showAnswer })}
            />
            <div>
              <Toggle
                label="Экранная клавиатура"
                checked={settings.screenKeyboard}
                onChange={(screenKeyboard) => update({ screenKeyboard })}
              />
              <p className="mt-1 pl-9 text-sm text-slate-500">
                В заданиях «Напиши» — греческая клавиатура сайта вместо клавиатуры телефона.
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

function MixSession({
  tasks,
  showAnswer,
  speakAnswer,
  screenKeyboard,
  onExit,
  onRestart,
}: {
  tasks: Task[]
  showAnswer: boolean
  speakAnswer: boolean
  screenKeyboard: boolean
  onExit: () => void
  onRestart: () => void
}) {
  const [index, setIndex] = useState(0)
  const [mistakes, setMistakes] = useState<Mistake[]>([])
  const done = index >= tasks.length
  const task = tasks[index]

  const next = useCallback(() => setIndex((i) => i + 1), [])
  const type = task?.type
  const answered = useCallback(
    (m: Mistake | null) =>
      m && type && setMistakes((all) => [...all, { ...m, task: TASK_LABEL[type].tag }]),
    [type],
  )
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
          total={tasks.length}
          mistakes={mistakes}
          onRestart={onRestart}
          onExit={onExit}
        />
      </SessionShell>
    )
  }

  const choice = task.type !== 'write'
  return (
    <SessionShell progress={`${index + 1} / ${tasks.length}`} onExit={exit}>
      <div className={`flex flex-1 flex-col gap-4 ${choice ? 'justify-center' : 'pt-2'}`}>
        <p className="text-center text-sm font-medium text-slate-500 dark:text-slate-400">
          {TASK_LABEL[task.type].hint}
        </p>
        {/* WriteTask keeps its slot between consecutive «Напиши» tasks: the phone keyboard
            stays open. */}
        {task.type === 'write' ? (
          <WriteTask
            word={task.word}
            speakAnswer={speakAnswer}
            screenKeyboard={screenKeyboard}
            onAnswered={answered}
            onAccepted={accepted}
            onNext={next}
          />
        ) : (
          <ChoiceTask
            key={index}
            word={task.word}
            options={task.options}
            direction={task.type}
            showAnswer={showAnswer}
            speakAnswer={speakAnswer}
            onAnswered={answered}
            onNext={next}
          />
        )}
      </div>
    </SessionShell>
  )
}
