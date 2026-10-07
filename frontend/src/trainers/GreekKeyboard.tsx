import { useRef, useState } from 'react'

// On-screen Greek keyboard for «Напиши»: always on a laptop (under the field); on a phone only
// with the «Экранная клавиатура» setting — then pinned to the bottom of the screen, full width,
// and the phone's own keyboard stays closed. Holding a vowel types it with the accent. Standard Greek
// layout; ΄ (τόνος) and ¨ (διαλυτικά) are dead keys like on a real one: press, then the vowel.
const ROWS = [
  ['ς', 'ε', 'ρ', 'τ', 'υ', 'θ', 'ι', 'ο', 'π'],
  ['α', 'σ', 'δ', 'φ', 'γ', 'η', 'ξ', 'κ', 'λ', 'TONOS'],
  ['DIA', 'ζ', 'χ', 'ψ', 'ω', 'β', 'ν', 'μ', 'BACK'],
]

const LONG_PRESS_MS = 400 // holding a vowel this long types it with the accent

// The bottom row, around the space bar. «;» is the Greek question mark.
const PUNCTUATION: [string, string][] = [
  [',', 'Запятая'],
  ['.', 'Точка'],
  [';', 'Вопросительный знак (;)'],
  ['!', 'Восклицательный знак'],
  ["'", 'Апостроф'],
]

const TONOS: Record<string, string> = {
  α: 'ά',
  ε: 'έ',
  η: 'ή',
  ι: 'ί',
  ο: 'ό',
  υ: 'ύ',
  ω: 'ώ',
}
const DIA: Record<string, string> = { ι: 'ϊ', υ: 'ϋ' }
const BOTH: Record<string, string> = { ι: 'ΐ', υ: 'ΰ' }

function withMarks(letter: string, tonos: boolean, dia: boolean): string {
  if (tonos && dia) return BOTH[letter] ?? TONOS[letter] ?? letter
  if (tonos) return TONOS[letter] ?? letter
  if (dia) return DIA[letter] ?? letter
  return letter
}

const keyBase =
  'flex h-11 items-center justify-center rounded-lg border shadow-sm transition-colors disabled:opacity-40'
const keyIdle =
  'border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
const keyOn = 'border-blue-600 bg-blue-600 text-white'

export default function GreekKeyboard({
  onInput,
  onBackspace,
  disabled,
  always = false,
}: {
  onInput: (text: string) => void
  onBackspace: () => void
  disabled: boolean
  /** Shown on phones too, not only from 768 px. */
  always?: boolean
}) {
  const [tonos, setTonos] = useState(false)
  const [dia, setDia] = useState(false)
  // ⇧ like on a phone: once — the next letter is a capital; twice — all capitals (⇪); again — off.
  const [shift, setShift] = useState<'off' | 'once' | 'lock'>('off')
  const cased = (text: string) => (shift === 'off' ? text : text.toUpperCase())

  const letter = (ch: string) => {
    onInput(cased(withMarks(ch, tonos, dia)))
    setTonos(false)
    setDia(false)
    if (shift === 'once') setShift('off')
  }
  // Holding a vowel types it with the accent (ά), like on a phone keyboard; a plain tap — as is.
  const hold = useRef<{ timer: number; fired: boolean } | null>(null)
  const startHold = (key: string) => {
    // Every new touch starts clean: some phones send no click after a long press, and a
    // leftover «already typed» mark would swallow the next tap.
    hold.current = null
    if (!TONOS[key] || disabled) return
    const h = {
      fired: false,
      timer: window.setTimeout(() => {
        h.fired = true
        onInput(cased(withMarks(key, true, dia)))
        setTonos(false)
        setDia(false)
        if (shift === 'once') setShift('off')
        navigator.vibrate?.(15)
      }, LONG_PRESS_MS),
    }
    hold.current = h
  }
  const endHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer)
  }
  const tapLetter = (key: string) => {
    if (hold.current?.fired) {
      hold.current = null // the hold already typed the accented letter
      return
    }
    hold.current = null
    letter(key)
  }

  const nextShift = () => setShift(shift === 'off' ? 'once' : shift === 'once' ? 'lock' : 'off')

  // Punctuation: as is (no marks, no capitals); a pending ΄ / ¨ is dropped.
  const punctuationKey = ([text, label]: [string, string]) => (
    <button
      key={text}
      type="button"
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={() => {
        onInput(text)
        setTonos(false)
        setDia(false)
      }}
      className={`${keyBase} ${keyIdle} text-xl font-semibold`}
    >
      {text}
    </button>
  )

  const renderKey = (key: string) => {
    if (key === 'TONOS' || key === 'DIA') {
      const on = key === 'TONOS' ? tonos : dia
      return (
        <button
          key={key}
          type="button"
          disabled={disabled}
          aria-pressed={on}
          aria-label={key === 'TONOS' ? 'Ударение' : 'Диэресис'}
          title={key === 'TONOS' ? 'Ударение: нажмите, затем гласную' : 'Диэресис: ϊ, ϋ'}
          onClick={() => (key === 'TONOS' ? setTonos(!tonos) : setDia(!dia))}
          className={`${keyBase} ${on ? keyOn : keyIdle} text-2xl font-semibold`}
        >
          {key === 'TONOS' ? '΄' : '¨'}
        </button>
      )
    }
    if (key === 'BACK') {
      return (
        <button
          key={key}
          type="button"
          disabled={disabled}
          aria-label="Стереть"
          onClick={onBackspace}
          className={`${keyBase} ${keyIdle} col-span-2 text-lg`}
        >
          ⌫
        </button>
      )
    }
    const shown = cased(withMarks(key, tonos, dia))
    return (
      <button
        key={key}
        type="button"
        lang="el"
        disabled={disabled}
        onPointerDown={() => startHold(key)}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onPointerCancel={endHold}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => tapLetter(key)}
        title={TONOS[key] ? `Удерживайте — ${cased(TONOS[key])}` : undefined}
        className={`${keyBase} ${keyIdle} text-lg [-webkit-touch-callout:none]`}
      >
        {shown}
      </button>
    )
  }

  return (
    <>
      {/* Phone: the keyboard is pinned to the bottom of the screen, full width; this keeps
          the same room free under the content so nothing ends up behind it. */}
      {always && <div aria-hidden="true" className="h-56 shrink-0 md:hidden" />}
      {/* mousedown is cancelled so the answer field keeps focus (and the caret) while clicking. */}
      <div
        role="group"
        aria-label="Греческая клавиатура"
        onMouseDown={(e) => e.preventDefault()}
        className={`${always ? 'block' : 'hidden md:block'} space-y-1 bg-slate-100 select-none max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-50 max-md:border-t max-md:border-slate-200 max-md:px-1 max-md:pt-1 max-md:pb-[max(0.25rem,env(safe-area-inset-bottom))] max-md:shadow-[0_-4px_12px_rgba(0,0,0,0.08)] md:space-y-1.5 md:rounded-2xl md:p-2 dark:border-slate-700 dark:bg-slate-800`}
      >
        {ROWS.map((row, i) => (
          <div key={i} className="grid grid-cols-10 gap-1 sm:gap-1.5">
            {i === 0 && <span aria-hidden="true" />}
            {row.map(renderKey)}
          </div>
        ))}
        <div className="grid grid-cols-10 gap-1 sm:gap-1.5">
          <button
            type="button"
            disabled={disabled}
            aria-label="Заглавные"
            aria-pressed={shift !== 'off'}
            title="Заглавные: нажать — одна заглавная буква, ещё раз — все заглавные, ещё раз — выключить"
            onClick={nextShift}
            className={`${keyBase} ${shift === 'off' ? keyIdle : keyOn} col-span-2 text-xl`}
          >
            {shift === 'lock' ? '⇪' : '⇧'}
          </button>
          {PUNCTUATION.slice(0, 2).map((p) => punctuationKey(p))}
          <button
            type="button"
            disabled={disabled}
            aria-label="Пробел"
            onClick={() => onInput(' ')}
            className={`${keyBase} ${keyIdle} col-span-3`}
          >
            <span className="text-sm text-slate-400">пробел</span>
          </button>
          {PUNCTUATION.slice(2).map((p) => punctuationKey(p))}
        </div>
      </div>
    </>
  )
}
