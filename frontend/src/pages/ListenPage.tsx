import { useCallback, useEffect, useRef, useState } from 'react'
import { pluralWords, type Word } from '../api/types.ts'
import { Button, ErrorText } from '../components/ui.tsx'
import {
  pausePlayback,
  playUntilEnd,
  preload,
  resumePlayback,
  stopPlayback,
  unlockAudio,
} from '../lib/speaker.ts'
import {
  clampCount,
  CountSlider,
  fetchTrainingWords,
  HideKnownToggle,
  playableCount,
  SessionShell,
  TrainerSetup,
  useActiveCount,
  sessionKey,
  useTrainerSettings,
} from '../trainers/common.tsx'

type Settings = { count: number; pauseSec: number; hideKnown: boolean }

const DEFAULT_PAUSE_SEC = 3
const MIN_PAUSE_SEC = 1
const MAX_PAUSE_SEC = 10

const clampPause = (v: number | undefined) =>
  Math.min(MAX_PAUSE_SEC, Math.max(MIN_PAUSE_SEC, Math.round(v ?? DEFAULT_PAUSE_SEC)))

export default function ListenPage() {
  const active = useActiveCount()
  const [settings, update] = useTrainerSettings<Settings>('listen', {
    hideKnown: true,
    count: 20,
    pauseSec: DEFAULT_PAUSE_SEC,
  })
  const [words, setWords] = useState<Word[] | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  const total = active?.words ?? null
  const playable = playableCount(active, settings?.hideKnown)
  const count = settings && playable ? clampCount(settings.count, playable) : 1

  const start = async () => {
    unlockAudio() // inside the tap, so iOS lets the sequence play
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
      <ListenSession
        key={sessionKey(words)}
        words={words}
        pauseMs={clampPause(settings?.pauseSec) * 1000}
        onExit={() => setWords(null)}
        onRestart={start}
      />
    )
  }

  return (
    <>
      <TrainerSetup
        title="Аудио повторение"
        total={total}
        playable={playable}
        ready={settings !== null}
        starting={starting}
        onStart={start}
      >
        {settings && total ? (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Слово по-гречески → пауза → по-русски → пауза → следующее. Пока идёт прослушивание,
              экран телефона не гаснет.
            </p>
            <HideKnownToggle
              checked={settings.hideKnown}
              known={active?.known ?? 0}
              onChange={(hideKnown) => update({ hideKnown })}
            />
            {playable > 0 && (
              <CountSlider value={count} max={playable} onChange={(n) => update({ count: n })} />
            )}
            <PauseSlider
              value={clampPause(settings.pauseSec)}
              onChange={(pauseSec) => update({ pauseSec })}
            />
          </>
        ) : null}
      </TrainerSetup>
      <ErrorText>{error}</ErrorText>
    </>
  )
}

type Phase = 'greek' | 'gap1' | 'russian' | 'gap2'

const PHASE_LABEL: Record<Phase, string> = {
  greek: 'по-гречески',
  gap1: 'пауза',
  russian: 'по-русски',
  gap2: 'пауза',
}

function PauseSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-2 flex items-baseline justify-between">
        <span className="font-medium">Пауза после каждого слова</span>
        <span className="text-2xl font-semibold tabular-nums">{value} с</span>
      </span>
      <input
        type="range"
        min={MIN_PAUSE_SEC}
        max={MAX_PAUSE_SEC}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-600"
        aria-label="Пауза, секунд"
      />
      <span className="mt-1 flex justify-between text-xs text-slate-500">
        <span>{MIN_PAUSE_SEC} с</span>
        <span>{MAX_PAUSE_SEC} с</span>
      </span>
    </label>
  )
}

function ListenSession({
  words,
  pauseMs,
  onExit,
  onRestart,
}: {
  words: Word[]
  pauseMs: number
  onExit: () => void
  onRestart: () => void
}) {
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('greek')
  const [paused, setPaused] = useState(false)
  const [done, setDone] = useState(false)
  // `jump`: word index requested by ⏮/⏭ — the current step stops and the loop goes there.
  const control = useRef({ paused: false, cancelled: false, jump: null as number | null })
  const interrupted = () => control.current.cancelled || control.current.jump !== null

  // A pause between clips that freezes while the session is paused.
  const wait = async (ms: number) => {
    let left = ms
    while (left > 0 && !interrupted()) {
      await new Promise((r) => setTimeout(r, 100))
      if (!control.current.paused) left -= 100
    }
  }

  // Waits until «Play» is pressed again (used between steps).
  const whilePaused = async () => {
    while (control.current.paused && !interrupted()) {
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  useEffect(() => {
    const ctl = { paused: false, cancelled: false, jump: null as number | null }
    control.current = ctl
    // Keep the phone screen on while listening (where supported).
    let lock: WakeLockSentinel | null = null
    navigator.wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => {})

    const run = async () => {
      let i = 0
      while (i < words.length) {
        const w = words[i]
        const next = words[i + 1]
        if (next) {
          preload(next.audio_url)
          preload(next.audio_ru_url)
        }
        setIndex(i)
        setPhase('greek')
        const steps: [Phase, () => Promise<void>][] = [
          ['greek', () => playUntilEnd(w.audio_url, w.full_greek, 'el-GR')],
          ['gap1', () => wait(pauseMs)],
          ['russian', () => playUntilEnd(w.audio_ru_url, w.translations_ru.join(', '), 'ru-RU')],
          ['gap2', () => wait(pauseMs)],
        ]
        for (const [p, step] of steps) {
          await whilePaused()
          if (interrupted()) break
          setPhase(p)
          await step()
          if (interrupted()) break
        }
        if (ctl.cancelled) return
        if (ctl.jump !== null) {
          i = ctl.jump
          ctl.jump = null
        } else {
          i++
        }
      }
      setDone(true)
    }
    run()

    return () => {
      ctl.cancelled = true
      stopPlayback()
      lock?.release().catch(() => {})
    }
    // One run per mounted session (the parent remounts it for «Ещё раз»).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ⏮ / ⏭: go to a word and play it from the Greek; keeps the paused state.
  const jumpTo = useCallback(
    (target: number) => {
      const ctl = control.current
      ctl.jump = Math.max(0, Math.min(target, words.length)) // words.length = finish
      stopPlayback()
    },
    [words.length],
  )
  const prev = useCallback(() => jumpTo(index - 1), [jumpTo, index])
  const next = useCallback(() => jumpTo(index + 1), [jumpTo, index])

  const togglePause = useCallback(() => {
    const next = !control.current.paused
    control.current.paused = next
    setPaused(next)
    if (next) pausePlayback()
    else resumePlayback()
  }, [])

  const exit = useCallback(() => {
    if (done || confirm('Остановить прослушивание?')) {
      control.current.cancelled = true
      stopPlayback()
      onExit()
    }
  }, [done, onExit])

  // Laptop: space — pause/play, Esc — exit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exit()
      else if (done) return
      else if (e.key === ' ') {
        e.preventDefault()
        togglePause()
      } else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exit, togglePause, prev, next, done])

  if (done) {
    return (
      <SessionShell onExit={onExit}>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <p className="text-5xl">🎧</p>
          <p className="text-xl font-semibold">
            Прослушано: {words.length} {pluralWords(words.length)}
          </p>
          <div className="flex gap-3">
            <Button onClick={onRestart}>Ещё раз</Button>
            <Button variant="secondary" onClick={onExit}>
              В меню
            </Button>
          </div>
        </div>
      </SessionShell>
    )
  }

  const word = words[index]
  const showRussian = phase === 'russian' || phase === 'gap2'
  return (
    <SessionShell progress={`${index + 1} / ${words.length}`} onExit={exit}>
      <div className="flex flex-1 flex-col items-center justify-center gap-10 text-center">
        <div className="w-full space-y-3 rounded-3xl bg-white px-4 py-10 shadow-lg dark:bg-slate-900">
          <p lang="el" className="text-4xl font-semibold break-words">
            {word.full_greek}
          </p>
          {word.transcription && (
            <p className="text-lg text-slate-500 italic">{word.transcription}</p>
          )}
          <p
            className={`text-2xl transition-opacity duration-300 ${showRussian ? 'opacity-100' : 'opacity-0'}`}
            aria-hidden={!showRussian}
          >
            {word.translations_ru.join(', ')}
          </p>
        </div>

        <p className="h-5 text-sm text-slate-500" aria-live="polite">
          {paused ? 'на паузе' : PHASE_LABEL[phase]}
        </p>

        <div className="flex items-center gap-6">
          <SkipButton direction="back" onClick={prev} label="Предыдущее слово" />
          <button
            onClick={togglePause}
            className="flex size-20 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 active:scale-95"
            aria-label={paused ? 'Продолжить' : 'Пауза'}
          >
            {paused ? (
              <svg
                viewBox="0 0 24 24"
                className="ml-1 size-10"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="size-10" fill="currentColor" aria-hidden="true">
                <rect x="6" y="4" width="4.5" height="16" rx="1.2" />
                <rect x="13.5" y="4" width="4.5" height="16" rx="1.2" />
              </svg>
            )}
          </button>
          <SkipButton direction="forward" onClick={next} label="Следующее слово" />
        </div>
      </div>
    </SessionShell>
  )
}

function SkipButton({
  direction,
  onClick,
  label,
}: {
  direction: 'back' | 'forward'
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex size-14 items-center justify-center rounded-full bg-white text-slate-700 shadow hover:bg-slate-100 active:scale-95 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        className={`size-7 ${direction === 'back' ? 'rotate-180' : ''}`}
      >
        <path d="M5 5.5v13a1 1 0 0 0 1.55.83L15 13.2V18a1 1 0 0 0 2 0V6a1 1 0 0 0-2 0v4.8L6.55 4.67A1 1 0 0 0 5 5.5z" />
      </svg>
    </button>
  )
}
