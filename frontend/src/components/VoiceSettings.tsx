import { useEffect, useState, type ReactNode } from 'react'
import {
  DEFAULT_VOICE,
  hasDeviceVoice,
  setVoicePrefs,
  speak,
  SPEEDS,
  unlockAudio,
  type VoicePrefs,
} from '../lib/speaker.ts'
import { useTrainerSettings } from '../trainers/common.tsx'
import { Button, Card } from './ui.tsx'

const SAMPLE = 'Καλημέρα! Το νερό, η γυναίκα, το αγγούρι.'
const speedLabel = (n: number) => (n === 0 ? 'обычная' : `${n > 0 ? '+' : '−'}${Math.abs(n)} %`)

// Profile → «Озвучка»: whose voice, male/female, speed of Greek speech. Saved per user
// (same on all their devices) and applied at once to every section.
export default function VoiceSettings() {
  const [prefs, update] = useTrainerSettings<VoicePrefs>('voice', DEFAULT_VOICE)
  // Chrome fills the voice list a moment after load.
  const [deviceHasGreek, setDeviceHasGreek] = useState(() => hasDeviceVoice('el-GR'))
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const check = () => setDeviceHasGreek(hasDeviceVoice('el-GR'))
    speechSynthesis.addEventListener('voiceschanged', check)
    return () => speechSynthesis.removeEventListener('voiceschanged', check)
  }, [])

  if (!prefs) return null

  const change = (patch: Partial<VoicePrefs>) => {
    const next = { ...prefs, ...patch }
    update(patch)
    setVoicePrefs(next) // at once, not after the save
  }

  const listen = () => {
    unlockAudio()
    speak('/api/tts/sample?lang=el', SAMPLE)
  }

  return (
    <Card className="space-y-4">
      <h2 className="font-medium">Озвучка</h2>

      <Choice
        label="Голос"
        value={prefs.device ? 'device' : 'site'}
        onChange={(v) => change({ device: v === 'device' })}
        options={[
          ['site', 'Голос сайта', 'одинаковый на всех устройствах'],
          ['device', 'Голос устройства', 'этого телефона или компьютера'],
        ]}
      />
      {prefs.device && !deviceHasGreek && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          На этом устройстве нет греческого голоса — здесь будет звучать голос сайта.
        </p>
      )}

      {prefs.device ? (
        <p className="text-sm text-slate-500">
          Мужской или женский — зависит от голосов, установленных в настройках телефона или
          компьютера.
        </p>
      ) : (
        <Choice
          label="Голос сайта"
          value={prefs.male ? 'male' : 'female'}
          onChange={(v) => change({ male: v === 'male' })}
          options={[
            ['female', 'Женский', null],
            ['male', 'Мужской', null],
          ]}
        />
      )}

      <div>
        <p className="mb-2 text-sm font-medium">Скорость греческой речи</p>
        <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Скорость">
          {SPEEDS.map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={prefs.speed === n}
              onClick={() => change({ speed: n })}
              className={`rounded-xl border-2 px-1 py-2 text-sm ${
                prefs.speed === n
                  ? 'border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              {speedLabel(n)}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          −10 % — чуть медленнее обычного (как было раньше), «обычная» — без замедления. Русский в
          «Аудио повторении» всегда звучит с обычной скоростью.
        </p>
      </div>

      <Button variant="secondary" onClick={listen}>
        ▶ Прослушать
      </Button>
    </Card>
  )
}

function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: [string, string, ReactNode][]
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{label}</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={label}>
        {options.map(([v, title, hint]) => (
          <button
            key={v}
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={`rounded-xl border-2 px-3 py-2.5 text-left text-sm ${
              value === v
                ? 'border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100'
                : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            <span className="block font-medium">{title}</span>
            {hint && <span className="block text-xs opacity-70">{hint}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
