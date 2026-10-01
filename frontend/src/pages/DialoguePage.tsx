import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../api/client.ts'
import { type DialogueDetail, type DialogueLine } from '../api/types.ts'
import { Button, ErrorText, Spinner } from '../components/ui.tsx'
import {
  pausePlayback,
  playUntilEnd,
  resumePlayback,
  speak,
  stopPlayback,
  unlockAudio,
  type SpeakOptions,
} from '../lib/speaker.ts'
import { Toggle, useTrainerSettings } from '../trainers/common.tsx'

// One dialogue (SPEC «Диалоги», Д4): «Чтение» (chat, listen to all) and «По ролям».
// Д4.3–Д4.5 come later, each on its own request.

type Mode = 'read' | 'roles'
type Settings = {
  mode: Mode
  greek: boolean
  transcription: boolean
  translation: boolean
  oneVoice: boolean
}
const DEFAULTS: Settings = {
  mode: 'read',
  greek: true,
  transcription: true,
  translation: true,
  oneVoice: false,
}
const MODES: [Mode, string][] = [
  ['read', 'Чтение'],
  ['roles', 'По ролям'],
]

const PAUSE_MS = 800 // between lines in «Прослушать весь диалог»
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Voice = (speaker: number) => SpeakOptions

export default function DialoguePage() {
  const { id } = useParams()
  const [dialogue, setDialogue] = useState<DialogueDetail | null>(null)
  const [error, setError] = useState('')
  const [settings, update] = useTrainerSettings<Settings>('dialogue', DEFAULTS)

  useEffect(() => {
    api<DialogueDetail>(`/dialogues/${id}`)
      .then(setDialogue)
      .catch((e: Error) => setError(e.message))
  }, [id])
  useEffect(() => () => stopPlayback(), []) // leaving the page silences it

  // Site voice: each role its own (female, male, female) unless «Один голос»; the device
  // voice is one for everybody anyway.
  const oneVoice = settings?.oneVoice ?? false
  const voiceOf = useCallback<Voice>(
    (speaker) => (oneVoice ? {} : { male: speaker % 2 === 1 }),
    [oneVoice],
  )

  if (!dialogue || !settings) return error ? <ErrorText>{error}</ErrorText> : <Spinner />

  return (
    <section className="space-y-4">
      <div>
        <Link to="/dialogues" className="text-sm text-blue-600 dark:text-blue-400">
          ← Диалоги
        </Link>
        <h1 className="mt-1 text-2xl font-semibold break-words">{dialogue.title}</h1>
        <p lang="el" className="text-sm text-slate-500 dark:text-slate-400">
          {dialogue.speakers.join(' · ')}
        </p>
      </div>

      <div
        className="grid grid-cols-2 rounded-xl bg-slate-200 p-1 dark:bg-slate-800"
        role="tablist"
      >
        {MODES.map(([mode, label]) => (
          <button
            key={mode}
            role="tab"
            aria-selected={settings.mode === mode}
            onClick={() => {
              stopPlayback()
              update({ mode })
            }}
            className={`rounded-lg px-2 py-2 text-sm font-medium ${
              settings.mode === mode
                ? 'bg-white shadow-sm dark:bg-slate-900'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div>
        <Toggle
          label="Один голос для всех ролей"
          checked={settings.oneVoice}
          onChange={(v) => update({ oneVoice: v })}
        />
        <p className="mt-1 pl-9 text-sm text-slate-500">
          Для голоса сайта: иначе роли звучат разными голосами — женским и мужским.
        </p>
      </div>

      {settings.mode === 'read' ? (
        <ReadMode dialogue={dialogue} settings={settings} update={update} voiceOf={voiceOf} />
      ) : (
        <RolesMode key={dialogue.id} dialogue={dialogue} voiceOf={voiceOf} />
      )}
    </section>
  )
}

// --- the chat ---

const BUBBLE = [
  'bg-white dark:bg-slate-900',
  'bg-blue-50 dark:bg-blue-950/60',
  'bg-emerald-50 dark:bg-emerald-950/60',
]

function Bubble({
  line,
  speakers,
  show,
  active = false,
  onTap,
  children,
  bubbleRef,
}: {
  line: DialogueLine
  speakers: string[]
  show: { greek: boolean; transcription: boolean; translation: boolean }
  active?: boolean
  onTap?: () => void
  children?: React.ReactNode
  bubbleRef?: (el: HTMLLIElement | null) => void
}) {
  const left = line.speaker === 0
  const body = (
    <>
      <span className="block text-xs font-medium text-slate-500 dark:text-slate-400" lang="el">
        {speakers[line.speaker]}
      </span>
      {show.greek && (
        <span lang="el" className="block text-lg break-words">
          {line.greek}
        </span>
      )}
      {show.transcription && line.transcription && (
        <span className="block text-slate-500 italic break-words dark:text-slate-400">
          {line.transcription}
        </span>
      )}
      {show.translation && <span className="block break-words">{line.translation_ru}</span>}
      {show.translation && line.note && (
        <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">{line.note}</span>
      )}
    </>
  )
  const cls = `max-w-[85%] min-w-0 rounded-2xl px-4 py-2.5 text-left shadow-sm ${BUBBLE[line.speaker % 3]} ${
    left ? 'rounded-bl-md' : 'rounded-br-md'
  } ${active ? 'ring-2 ring-blue-500' : ''}`
  return (
    <li ref={bubbleRef} className={`flex ${left ? 'justify-start' : 'justify-end'}`}>
      <div className={cls}>
        {onTap ? (
          <button type="button" onClick={onTap} className="block w-full text-left">
            {body}
          </button>
        ) : (
          body
        )}
        {children}
      </div>
    </li>
  )
}

// --- Д4.1 Чтение / слушание ---

function ReadMode({
  dialogue,
  settings,
  update,
  voiceOf,
}: {
  dialogue: DialogueDetail
  settings: Settings
  update: (patch: Partial<Settings>) => void
  voiceOf: Voice
}) {
  const { lines, speakers } = dialogue
  const [current, setCurrent] = useState<number | null>(null)
  const [state, setState] = useState<'idle' | 'playing' | 'paused'>('idle')
  const run = useRef(0) // bumped by «Стоп»: the running loop sees it and quits
  const paused = useRef(false)
  const items = useRef<(HTMLLIElement | null)[]>([])

  useEffect(
    () => () => {
      run.current++
    },
    [],
  )

  const stop = () => {
    run.current++
    paused.current = false
    stopPlayback()
    setState('idle')
    setCurrent(null)
  }

  const playAll = async () => {
    unlockAudio() // inside the tap, so iOS lets the sequence play
    const me = ++run.current
    paused.current = false
    setState('playing')
    for (let i = 0; i < lines.length; i++) {
      if (run.current !== me) return
      setCurrent(i)
      items.current[i]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      const line = lines[i]
      await playUntilEnd(line.audio_url, line.greek, 'el-GR', voiceOf(line.speaker))
      const until = Date.now() + PAUSE_MS
      while (run.current === me && (paused.current || Date.now() < until)) await sleep(100)
    }
    if (run.current === me) {
      setState('idle')
      setCurrent(null)
    }
  }

  const tap = (line: DialogueLine) => {
    if (state !== 'idle') stop()
    speak(line.audio_url, line.greek, voiceOf(line.speaker))
  }

  const show = {
    greek: settings.greek,
    transcription: settings.transcription,
    translation: settings.translation,
  }
  const shownCount = Object.values(show).filter(Boolean).length
  const chips: [keyof typeof show, string][] = [
    ['greek', 'Греческий'],
    ['transcription', 'Транскрипция'],
    ['translation', 'Перевод'],
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Что показывать">
        {chips.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={show[key]}
            // At least one stays on: an empty chat makes no sense.
            disabled={show[key] && shownCount === 1}
            onClick={() => update({ [key]: !show[key] })}
            className={`rounded-full border-2 px-3 py-1.5 text-sm ${
              show[key]
                ? 'border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100'
                : 'border-slate-300 text-slate-500 dark:border-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="text-sm text-slate-500 dark:text-slate-400">
        Нажмите на реплику — она прозвучит.
      </p>

      {/* pb: the floating «Прослушать весь диалог» mustn't cover the last line */}
      <ul className="space-y-3 pb-16">
        {lines.map((line, i) => (
          <Bubble
            key={line.id}
            line={line}
            speakers={speakers}
            show={show}
            active={current === i}
            onTap={() => tap(line)}
            bubbleRef={(el) => {
              items.current[i] = el
            }}
          />
        ))}
      </ul>

      <div className="sticky bottom-3 flex justify-center gap-2">
        {state === 'idle' ? (
          <Button onClick={playAll} className="shadow-lg">
            ▶ Прослушать весь диалог
          </Button>
        ) : (
          <>
            {state === 'playing' ? (
              <Button
                onClick={() => {
                  paused.current = true
                  pausePlayback()
                  setState('paused')
                }}
                className="shadow-lg"
              >
                ⏸ Пауза
              </Button>
            ) : (
              <Button
                onClick={() => {
                  paused.current = false
                  resumePlayback()
                  setState('playing')
                }}
                className="shadow-lg"
              >
                ▶ Продолжить
              </Button>
            )}
            <Button variant="secondary" onClick={stop} className="shadow-lg">
              ⏹ Стоп
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

// --- Д4.2 По ролям ---

function RolesMode({ dialogue, voiceOf }: { dialogue: DialogueDetail; voiceOf: Voice }) {
  const { lines, speakers } = dialogue
  const [role, setRole] = useState(0)
  const [phase, setPhase] = useState<'setup' | 'session'>('setup')
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  // «Знал / Не знал» for this pass only (SPEC Д6: no stored progress yet).
  const [knew, setKnew] = useState<Record<number, boolean>>({})
  const items = useRef<(HTMLLIElement | null)[]>([])

  const start = () => {
    unlockAudio() // inside the tap: the partner's lines may play on their own
    setKnew({})
    setIndex(0)
    setRevealed(false)
    setPhase('session')
  }
  const toSetup = () => {
    stopPlayback()
    setPhase('setup')
  }

  // The partner's line: shown, played, and on to the next one.
  useEffect(() => {
    if (phase !== 'session' || index >= lines.length) return
    items.current[index]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const line = lines[index]
    if (line.speaker === role) return
    let cancelled = false
    playUntilEnd(line.audio_url, line.greek, 'el-GR', voiceOf(line.speaker)).then(async () => {
      await sleep(500)
      if (!cancelled) setIndex((i) => i + 1)
    })
    return () => {
      cancelled = true
    }
  }, [phase, index, lines, role, voiceOf])

  if (phase === 'setup') {
    return (
      <div className="space-y-4">
        <div>
          <p className="mb-2 font-medium">Ваша роль</p>
          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            role="radiogroup"
            aria-label="Ваша роль"
          >
            {speakers.map((name, i) => (
              <button
                key={i}
                role="radio"
                aria-checked={role === i}
                onClick={() => setRole(i)}
                lang="el"
                className={`rounded-xl border-2 px-3 py-2.5 text-sm ${
                  role === i
                    ? 'border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Реплики собеседника звучат сами. Ваши скрыты — по переводу вспомните реплику и скажите её
          вслух, потом «Показать» и честно отметьте: «Знал» или «Не знал».
        </p>
        <Button onClick={start} className="w-full py-3 text-base">
          Начать
        </Button>
      </div>
    )
  }

  const mine = lines.filter((l) => l.speaker === role)
  if (index >= lines.length) {
    // the pass is over
    const known = mine.filter((l) => knew[l.id]).length
    const missed = mine.filter((l) => !knew[l.id])
    return (
      <div className="space-y-4">
        <p className="text-xl font-semibold">
          Знал {known} из {mine.length}
        </p>
        {missed.length > 0 && (
          <ul className="space-y-2">
            {missed.map((l) => (
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
          <Button variant="secondary" onClick={toSetup}>
            Сменить роль
          </Button>
        </div>
      </div>
    )
  }

  const full = { greek: true, transcription: true, translation: true }
  const answer = (line: DialogueLine, value: boolean) => {
    setKnew((k) => ({ ...k, [line.id]: value }))
    setRevealed(false)
    setIndex((i) => i + 1)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>
          Вы — <span lang="el">{speakers[role]}</span>
        </span>
        <button type="button" onClick={toSetup} className="underline">
          Закончить
        </button>
      </div>
      <ul className="space-y-3">
        {lines.slice(0, index + 1).map((line, i) => {
          const ref = (el: HTMLLIElement | null) => {
            items.current[i] = el
          }
          const replay = () => speak(line.audio_url, line.greek, voiceOf(line.speaker))
          if (i < index || line.speaker !== role) {
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
          }
          // The user's line: only the translation until «Показать».
          return (
            <Bubble
              key={line.id}
              line={line}
              speakers={speakers}
              show={revealed ? full : { greek: false, transcription: false, translation: true }}
              active
              bubbleRef={ref}
            >
              <div className="mt-2 flex flex-wrap gap-2">
                {!revealed ? (
                  <Button
                    onClick={() => {
                      setRevealed(true)
                      replay() // hear how it should sound
                    }}
                  >
                    Показать
                  </Button>
                ) : (
                  <>
                    <Button onClick={() => answer(line, true)}>Знал</Button>
                    <Button variant="secondary" onClick={() => answer(line, false)}>
                      Не знал
                    </Button>
                  </>
                )}
              </div>
            </Bubble>
          )
        })}
      </ul>
    </div>
  )
}
