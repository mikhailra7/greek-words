import { useEffect, useRef, useState } from 'react'
import type { DialogueDetail, DialogueLine } from '../api/types.ts'
import { Button } from '../components/ui.tsx'
import { words } from '../lib/greekText.ts'
import { playUntilEnd, speak, stopPlayback, unlockAudio } from '../lib/speaker.ts'
import { Bubble } from './common.tsx'
import { ScopeSetup, type Scope } from './Scope.tsx'
import { sleep, type Voice } from './voice.ts'

// Д4.4 «Сборка фразы»: the translation, and below it the line's words shuffled as chips;
// tap them in order. Checked when every chip is placed; chips in a wrong place turn red.
// No typing — the mode for a phone.

type Chip = { id: number; text: string }

function shuffled(texts: string[]): Chip[] {
  const chips = texts.map((text, id) => ({ id, text }))
  for (let tries = 0; tries < 10; tries++) {
    for (let i = chips.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[chips[i], chips[j]] = [chips[j], chips[i]]
    }
    // Not already in order (when there is any other order).
    if (chips.some((c, i) => c.text !== texts[i])) break
  }
  return chips
}

export default function BuildMode({
  dialogue,
  voiceOf,
}: {
  dialogue: DialogueDetail
  voiceOf: Voice
}) {
  const { lines, speakers } = dialogue
  const [scope, setScope] = useState<Scope>(null)
  const [started, setStarted] = useState(false)
  const [index, setIndex] = useState(0)
  // Line ids built wrong at least once (or shown with «Показать ответ»).
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
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Под переводом — слова реплики вперемешку. Нажимайте их по порядку; нажатое слово в фразе
          возвращается обратно. Когда выложены все слова, фраза проверяется сама.
        </p>
      </ScopeSetup>
    )

  if (index >= lines.length) {
    const first = mine.filter((l) => !missed.has(l.id)).length
    return (
      <div className="space-y-4">
        <p className="text-xl font-semibold">
          С первого раза: {first} из {mine.length}
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
          <Button
            variant="secondary"
            onClick={() => {
              stopPlayback()
              setStarted(false)
            }}
          >
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
        <button
          type="button"
          onClick={() => {
            stopPlayback()
            setStarted(false)
          }}
          className="underline"
        >
          Закончить
        </button>
      </div>
      <ul className="space-y-3">
        {lines.slice(0, index + 1).map((line, i) => {
          const ref = (el: HTMLLIElement | null) => {
            items.current[i] = el
          }
          const replay = () => speak(line.audio_url, line.greek, voiceOf(line.speaker))
          if (i < index || !isMine(line))
            return (
              <Bubble
                key={line.id}
                line={line}
                speakers={speakers}
                show={{ greek: true, transcription: false, translation: true }}
                active={i === index}
                onTap={replay}
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
              <ChipBoard
                line={line}
                onMistake={() => setMissed((s) => new Set(s).add(line.id))}
                onSolved={replay}
                onNext={() => setIndex((n) => n + 1)}
              />
            </Bubble>
          )
        })}
      </ul>
    </div>
  )
}

function ChipBoard({
  line,
  onMistake,
  onSolved,
  onNext,
}: {
  line: DialogueLine
  onMistake: () => void
  onSolved: () => void
  onNext: () => void
}) {
  const [target] = useState(() => words(line.greek))
  const [pool, setPool] = useState<Chip[]>(() => shuffled(target))
  const [placed, setPlaced] = useState<Chip[]>([])
  const [solved, setSolved] = useState(false)

  const full = placed.length === target.length
  // Same words are interchangeable: only the text at each place matters.
  const wrongAt = (i: number) => full && !solved && placed[i].text !== target[i]

  const check = (next: Chip[]) => {
    if (next.length !== target.length) return
    if (next.every((c, i) => c.text === target[i])) {
      setSolved(true)
      onSolved() // inside the tap: plays on iOS too
    } else onMistake()
  }
  const place = (chip: Chip) => {
    if (solved) return
    const next = [...placed, chip]
    setPlaced(next)
    setPool((p) => p.filter((c) => c.id !== chip.id))
    check(next)
  }
  const unplace = (chip: Chip) => {
    if (solved) return
    setPlaced((p) => p.filter((c) => c.id !== chip.id))
    setPool((p) => [...p, chip])
  }
  const showAnswer = () => {
    onMistake()
    setPlaced(target.map((text, id) => ({ id, text })))
    setPool([])
    setSolved(true)
    onSolved()
  }

  const chipCls =
    'rounded-xl border-2 px-3 py-1.5 text-lg shadow-sm transition-colors disabled:opacity-100'
  return (
    <div className="mt-2 space-y-3">
      {solved ? (
        <p lang="el" className="text-lg font-medium text-green-700 dark:text-green-400">
          {line.greek}
        </p>
      ) : (
        <div
          className="flex min-h-12 flex-wrap gap-1.5 rounded-xl border-2 border-dashed border-slate-300 p-1.5 dark:border-slate-600"
          aria-label="Собранная фраза"
        >
          {placed.map((chip, i) => (
            <button
              key={chip.id}
              type="button"
              lang="el"
              onClick={() => unplace(chip)}
              className={`${chipCls} ${
                wrongAt(i)
                  ? 'border-red-500 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100'
                  : 'border-blue-300 bg-white dark:border-blue-700 dark:bg-slate-900'
              }`}
            >
              {chip.text}
            </button>
          ))}
        </div>
      )}
      {!solved && (
        <div className="flex flex-wrap gap-1.5" aria-label="Слова">
          {pool.map((chip) => (
            <button
              key={chip.id}
              type="button"
              lang="el"
              onClick={() => place(chip)}
              className={`${chipCls} border-slate-200 bg-white hover:border-blue-400 dark:border-slate-700 dark:bg-slate-900`}
            >
              {chip.text}
            </button>
          ))}
        </div>
      )}
      {full && !solved && (
        <p role="status" className="text-sm text-red-700 dark:text-red-400">
          Не тот порядок — уберите красные слова и поставьте заново.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {solved ? (
          <Button onClick={onNext}>Далее</Button>
        ) : (
          <Button variant="secondary" onClick={showAnswer}>
            Показать ответ
          </Button>
        )}
      </div>
    </div>
  )
}
