import { useState } from 'react'

// On-screen Greek keyboard for «Напиши»: always on a laptop; on a phone only with the
// «Экранная клавиатура» setting (then the phone's own keyboard stays closed). Standard Greek
// layout; ΄ (τόνος) and ¨ (διαλυτικά) are dead keys like on a real one: press, then the vowel.
const ROWS = [
  ['ς', 'ε', 'ρ', 'τ', 'υ', 'θ', 'ι', 'ο', 'π'],
  ['α', 'σ', 'δ', 'φ', 'γ', 'η', 'ξ', 'κ', 'λ', 'TONOS'],
  ['DIA', 'ζ', 'χ', 'ψ', 'ω', 'β', 'ν', 'μ', 'BACK'],
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

  const letter = (ch: string) => {
    onInput(withMarks(ch, tonos, dia))
    setTonos(false)
    setDia(false)
  }

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
    const shown = withMarks(key, tonos, dia)
    return (
      <button
        key={key}
        type="button"
        lang="el"
        disabled={disabled}
        onClick={() => letter(key)}
        className={`${keyBase} ${keyIdle} text-lg`}
      >
        {shown}
      </button>
    )
  }

  return (
    // mousedown is cancelled so the answer field keeps focus (and the caret) while clicking.
    <div
      role="group"
      aria-label="Греческая клавиатура"
      onMouseDown={(e) => e.preventDefault()}
      className={`${always ? 'block' : 'hidden md:block'} space-y-1.5 rounded-2xl bg-slate-100 p-1.5 sm:p-2 dark:bg-slate-800/60`}
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
          aria-label="Пробел"
          onClick={() => onInput(' ')}
          className={`${keyBase} ${keyIdle} col-span-6 col-start-3`}
        >
          <span className="text-sm text-slate-400">пробел</span>
        </button>
      </div>
    </div>
  )
}
