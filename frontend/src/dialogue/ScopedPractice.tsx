import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DialogueDetail, DialogueLine } from '../api/types.ts'
import { Button } from '../components/ui.tsx'
import { playUntilEnd, speak, stopPlayback, unlockAudio } from '../lib/speaker.ts'
import { Bubble } from './common.tsx'
import { ScopeSetup, type Scope } from './Scope.tsx'
import { sleep, type Voice } from './voice.ts'

// The run shared by «Сборка фразы» and «Ввод по памяти»: pick the lines (all / one role), go
// through the dialogue — context lines are shown and played, each practised line gets the
// mode's task — and a result with the lines that went wrong.

export type TaskProps = {
  line: DialogueLine
  /** The line went wrong (counted once per line). */
  onMistake: () => void
  /** Play the line in its role's voice (call it inside a tap when you can — iOS). */
  play: () => void
  onNext: () => void
}

export default function ScopedPractice({
  dialogue,
  voiceOf,
  intro,
  setupExtra,
  resultLabel,
  task,
}: {
  dialogue: DialogueDetail
  voiceOf: Voice
  intro: ReactNode
  setupExtra?: ReactNode
  resultLabel: string
  task: (props: TaskProps) => ReactNode
}) {
  const { lines, speakers } = dialogue
  const [scope, setScope] = useState<Scope>(null)
  const [started, setStarted] = useState(false)
  const [index, setIndex] = useState(0)
  const [missed, setMissed] = useState<Set<number>>(new Set())
  const items = useRef<(HTMLLIElement | null)[]>([])

  const isMine = (line: DialogueLine) => scope === null || line.speaker === scope
  const mine = lines.filter(isMine)

  const start = () => {
    unlockAudio() // inside the tap: context lines may play on their own
    setMissed(new Set())
    setIndex(0)
    setStarted(true)
  }
  const stop = () => {
    stopPlayback()
    setStarted(false)
  }

  // A context line (the other roles): shown, played, and on to the next one.
  useEffect(() => {
    if (!started || index >= lines.length) return
    items.current[index]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const line = lines[index]
    if (scope === null || line.speaker === scope) return
    let cancelled = false
    playUntilEnd(line.audio_url, line.greek, 'el-GR', voiceOf(line.speaker)).then(async () => {
      await sleep(400)
      if (!cancelled) setIndex((i) => i + 1)
    })
    return () => {
      cancelled = true
    }
  }, [started, index, lines, scope, voiceOf])

  if (!started)
    return (
      <ScopeSetup speakers={speakers} scope={scope} onScope={setScope} onStart={start}>
        {setupExtra}
        <p className="text-sm text-slate-600 dark:text-slate-400">{intro}</p>
      </ScopeSetup>
    )

  if (index >= lines.length) {
    const good = mine.filter((l) => !missed.has(l.id)).length
    return (
      <div className="space-y-4">
        <p className="text-xl font-semibold">
          {resultLabel}: {good} из {mine.length}
        </p>
        {missed.size > 0 && (
          <ul className="space-y-2">
            {mine
              .filter((l) => missed.has(l.id))
              .map((l) => (
                <li key={l.id} className="rounded-xl bg-white p-3 dark:bg-slate-900">
                  <span lang="el" className="block">
                    {l.greek}
                  </span>
                  <span className="block text-sm text-slate-500">{l.translation_ru}</span>
                </li>
              ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={start}>Ещё раз</Button>
          <Button variant="secondary" onClick={stop}>
            Другие реплики
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>{scope === null ? 'Все реплики' : <span lang="el">{speakers[scope]}</span>}</span>
        <button type="button" onClick={stop} className="underline">
          Закончить
        </button>
      </div>
      <ul className="space-y-3">
        {lines.slice(0, index + 1).map((line, i) => {
          const ref = (el: HTMLLIElement | null) => {
            items.current[i] = el
          }
          const play = () => speak(line.audio_url, line.greek, voiceOf(line.speaker))
          if (i < index || !isMine(line))
            return (
              <Bubble
                key={line.id}
                line={line}
                speakers={speakers}
                show={{ greek: true, transcription: false, translation: true }}
                active={i === index}
                onTap={play}
                bubbleRef={ref}
              />
            )
          return (
            <Bubble
              key={line.id}
              line={line}
              speakers={speakers}
              show={{ greek: false, transcription: false, translation: true }}
              active
              bubbleRef={ref}
            >
              {task({
                line,
                play,
                onMistake: () => setMissed((s) => new Set(s).add(line.id)),
                onNext: () => setIndex((n) => n + 1),
              })}
            </Bubble>
          )
        })}
      </ul>
    </div>
  )
}
