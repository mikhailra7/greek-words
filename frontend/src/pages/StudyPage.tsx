import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { pluralWords, type Word } from '../api/types.ts'
import { IconSpeaker } from '../components/SpeakButton.tsx'
import { Button, ErrorText } from '../components/ui.tsx'
import { setKnown } from '../components/KnownCheckbox.tsx'
import { preload, speak, unlockAudio } from '../lib/speaker.ts'
import {
  clampCount,
  CountSlider,
  fetchTrainingWords,
  HideKnownToggle,
  playableCount,
  SessionShell,
  Toggle,
  TrainerSetup,
  useActiveCount,
  sessionKey,
  useTrainerSettings,
  WordPicture,
} from '../trainers/common.tsx'

type StudySettings = { count: number; speak: boolean; wordOnly: boolean; hideKnown: boolean }

export default function StudyPage() {
  const active = useActiveCount()
  const [settings, update] = useTrainerSettings<StudySettings>('study', {
    hideKnown: true,
    count: 20,
    speak: true,
    wordOnly: false,
  })
  const [words, setWords] = useState<Word[] | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  const total = active?.words ?? null
  const playable = playableCount(active, settings?.hideKnown)
  const count = settings && playable ? clampCount(settings.count, playable) : 1

  const start = async () => {
    unlockAudio() // inside the tap: lets later auto-play work on iOS
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

  if (words && settings) {
    return (
      <StudySession
        key={sessionKey(words)}
        words={words}
        autoSpeak={settings.speak}
        wordOnly={settings.wordOnly}
        onExit={() => setWords(null)}
        onRestart={start}
      />
    )
  }

  return (
    <>
      <TrainerSetup
        title="Изучение слов"
        total={total}
        playable={playable}
        ready={settings !== null}
        starting={starting}
        onStart={start}
      >
        {settings && total ? (
          <>
            <Toggle
              label="Озвучивать слова"
              checked={settings.speak}
              onChange={(speak) => update({ speak })}
            />
            <Toggle
              label="Показывать только слово"
              checked={settings.wordOnly}
              onChange={(wordOnly) => update({ wordOnly })}
            />
            {settings.wordOnly && (
              <p className="-mt-3 text-sm text-slate-500">
                Сначала только греческое слово. Нажмите на карточку — она перевернётся, покажет
                перевод и произнесёт слово.
              </p>
            )}
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

const SWIPE_DISTANCE = 80
const TAP_DISTANCE = 8 // less movement than this counts as a tap (flip), not a swipe

function StudySession({
  words,
  autoSpeak,
  wordOnly,
  onExit,
  onRestart,
}: {
  words: Word[]
  autoSpeak: boolean
  wordOnly: boolean
  onExit: () => void
  onRestart: () => void
}) {
  const [index, setIndex] = useState(0)
  const [dx, setDx] = useState(0)
  const [leaving, setLeaving] = useState<-1 | 1 | null>(null)
  // «Показывать только слово»: each card starts face down (Greek only) until tapped.
  const [revealed, setRevealed] = useState(!wordOnly)
  // «Я знаю это слово»: marked words stay in this session and drop out from the next ones.
  const [known, setKnownMap] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(words.map((w) => [w.id, w.known])),
  )
  const toggleKnown = async (w: Word) => {
    const next = !known[w.id]
    setKnownMap((m) => ({ ...m, [w.id]: next }))
    try {
      await setKnown(w.id, next)
    } catch {
      setKnownMap((m) => ({ ...m, [w.id]: !next }))
    }
  }
  const drag = useRef<{ x: number; id: number } | null>(null)
  const done = index >= words.length
  const word = words[index]

  // 1 — next word (the card flies off to the left, like turning a page), -1 — back to the
  // previous one (flies right). The first card has nothing before it: it just springs back.
  const move = useCallback(
    (step: 1 | -1) => {
      if (leaving || done) return
      if (step === -1 && index === 0) return setDx(0)
      setLeaving(step === 1 ? -1 : 1)
      window.setTimeout(() => {
        setIndex((i) => i + step)
        setRevealed(!wordOnly)
        setLeaving(null)
        setDx(0)
      }, 180)
    },
    [leaving, done, wordOnly, index],
  )

  // Flip to the full card and say the word (inside the tap, so iOS allows the sound).
  const reveal = useCallback(() => {
    if (revealed || done) return
    setRevealed(true)
    speak(word.audio_url, word.full_greek)
  }, [revealed, done, word])

  const exit = useCallback(() => {
    if (done || confirm('Закончить изучение?')) onExit()
  }, [done, onExit])

  // Auto-play 0.5 s after a card opens (not in «только слово»: there the flip plays it);
  // warm up the next card's picture and sound.
  useEffect(() => {
    if (!word) return
    const t =
      autoSpeak && !wordOnly
        ? window.setTimeout(() => speak(word.audio_url, word.full_greek), 500)
        : 0
    const after = words[index + 1]
    if (after) {
      preload(after.audio_url)
      if (after.image_url) new Image().src = after.image_url
    }
    return () => window.clearTimeout(t)
  }, [word, index, words, autoSpeak, wordOnly])

  // Laptop keys: → / Enter — next, ← — previous, space — repeat sound, Esc — exit.
  // Face-down card: space / Enter flip it first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exit()
      else if (done) return
      else if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        reveal()
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') move(1)
      else if (e.key === 'ArrowLeft') move(-1)
      else if (e.key === ' ') {
        e.preventDefault()
        speak(word.audio_url, word.full_greek)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, exit, done, word, revealed, reveal])

  const onPointerDown = (e: PointerEvent) => {
    if ((e.target as Element).closest('button')) return
    drag.current = { x: e.clientX, id: e.pointerId }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    if (drag.current?.id === e.pointerId) setDx(e.clientX - drag.current.x)
  }
  const onPointerUp = () => {
    if (!drag.current) return
    drag.current = null
    if (Math.abs(dx) > SWIPE_DISTANCE)
      move(dx < 0 ? 1 : -1) // left — next, right — back
    else {
      if (Math.abs(dx) < TAP_DISTANCE) reveal()
      setDx(0)
    }
  }

  if (done) {
    return (
      <SessionShell onExit={onExit}>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <p className="text-5xl">🎉</p>
          <p className="text-xl font-semibold">
            Готово: {words.length} {pluralWords(words.length)}
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

  const offset = leaving ? leaving * window.innerWidth : dx
  return (
    <SessionShell progress={`${index + 1} / ${words.length}`} onExit={exit}>
      <label className="mx-auto mb-3 flex cursor-pointer items-center gap-3 rounded-xl bg-white px-4 py-2.5 shadow-sm select-none dark:bg-slate-900">
        <input
          type="checkbox"
          className="size-6 accent-green-600"
          checked={!!known[word.id]}
          onChange={() => toggleKnown(word)}
        />
        <span>Я знаю это слово</span>
      </label>
      <div className="flex flex-1 items-center">
        <article
          key={word.id}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative max-h-full w-full cursor-grab touch-pan-y rounded-3xl shadow-lg select-none active:cursor-grabbing"
          style={{
            transform: `translateX(${offset}px) rotate(${offset / 30}deg)`,
            transition: drag.current ? 'none' : 'transform 180ms ease-out',
          }}
        >
          {/* Two faces in one grid cell (card height = the taller face), turned in 3D. */}
          <div className="[perspective:1400px]">
            <div
              className="grid transition-transform duration-500 [transform-style:preserve-3d]"
              style={{ transform: revealed ? 'rotateY(180deg)' : 'none' }}
            >
              <div
                className="flex flex-col items-center justify-center gap-4 rounded-3xl bg-white p-6 text-center [grid-area:1/1] [backface-visibility:hidden] dark:bg-slate-900"
                aria-hidden={revealed}
              >
                <p lang="el" className="text-4xl font-semibold break-words">
                  {word.full_greek}
                </p>
                <p className="text-sm text-slate-400">Нажмите, чтобы перевернуть</p>
              </div>

              <div
                className="relative flex flex-col rounded-3xl bg-white p-4 [grid-area:1/1] [backface-visibility:hidden] [transform:rotateY(180deg)] dark:bg-slate-900"
                aria-hidden={!revealed}
              >
                <button
                  onClick={() => speak(word.audio_url, word.full_greek)}
                  tabIndex={revealed ? 0 : -1}
                  className="absolute top-3 right-3 z-10 rounded-full bg-white/90 p-2.5 text-blue-600 shadow hover:bg-blue-50 dark:bg-slate-800/90 dark:text-blue-400"
                  aria-label="Произнести ещё раз"
                >
                  <IconSpeaker className="size-[42px]" />
                </button>

                <WordPicture
                  word={word}
                  className="aspect-square max-h-[42dvh] w-full [@media(max-height:700px)]:max-h-[34dvh]"
                />

                <div className="space-y-1 px-1 pt-4 pb-14 text-center">
                  <p lang="el" className="text-3xl font-semibold break-words">
                    {word.full_greek}
                  </p>
                  {word.transcription && (
                    <p className="text-lg text-slate-500 italic">{word.transcription}</p>
                  )}
                  <p className="text-xl">{word.translations_ru.join(', ')}</p>
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={() => move(-1)}
            disabled={index === 0}
            className="absolute bottom-3 left-3 z-10 rounded-full bg-slate-100 p-3 text-slate-600 shadow hover:bg-slate-200 disabled:opacity-30 disabled:shadow-none dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            aria-label="Предыдущее слово"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              className="size-6"
            >
              <path d="M19 12H5M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <button
            onClick={() => move(1)}
            className="absolute right-3 bottom-3 z-10 rounded-full bg-blue-600 p-3 text-white shadow hover:bg-blue-700"
            aria-label="Следующее слово"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              className="size-6"
            >
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </article>
      </div>
      <p className="pt-3 text-center text-xs text-slate-400">
        {revealed
          ? 'Свайп влево — следующее слово, вправо — предыдущее'
          : 'Нажмите на карточку, чтобы перевернуть'}
      </p>
    </SessionShell>
  )
}
