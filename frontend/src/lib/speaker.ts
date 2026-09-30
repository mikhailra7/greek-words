// One shared <audio> for the whole app.
//
// iOS Safari only lets a page play sound after a user gesture has started playback once;
// `unlockAudio()` is called from such a gesture (e.g. the «Начать» button) and later
// `speak()` calls — including the delayed auto-play on a card — are then allowed.
// If the server audio fails (TTS down), fall back to the browser's own Greek voice.
//
// Each user picks their voice in the profile («Озвучка»): the site's voice (female or male,
// speed of Greek speech) or the voice of their own phone/computer. `setVoicePrefs` is fed
// from the saved settings; every speak/preload/playUntilEnd call follows it.

export type VoicePrefs = { device: boolean; male: boolean; speed: number }
// The device voice by default (2026-10-01): on phones and Macs it answers at once; without a
// Greek voice on the device the site's voice plays anyway.
export const DEFAULT_VOICE: VoicePrefs = { device: true, male: false, speed: -10 }
export const SPEEDS = [-30, -20, -10, 0, 10] as const

let prefs: VoicePrefs = DEFAULT_VOICE

export function setVoicePrefs(p: VoicePrefs): void {
  prefs = p
}

/** Server URL for the chosen voice. The default voice keeps the plain URL (same file). */
export function voiceUrl(url: string): string {
  const params = []
  if (prefs.male) params.push('voice=male')
  if (!url.includes('/audio/ru') && prefs.speed !== DEFAULT_VOICE.speed)
    params.push(`rate=${prefs.speed}`) // Russian is always read at normal speed
  if (!params.length) return url
  return url + (url.includes('?') ? '&' : '?') + params.join('&')
}

type Lang = 'el-GR' | 'ru-RU'

/** Does this device have a voice for `lang`? (Unknown yet — the list loads late in Chrome —
 * counts as yes.) Without one, «голос устройства» falls back to the site's voice. */
export function hasDeviceVoice(lang: Lang): boolean {
  if (!('speechSynthesis' in window)) return false
  const voices = speechSynthesis.getVoices()
  const code = lang.slice(0, 2)
  return voices.length === 0 || voices.some((v) => v.lang.toLowerCase().startsWith(code))
}
if ('speechSynthesis' in window) speechSynthesis.getVoices() // starts loading the list

const onDevice = (lang: Lang) => prefs.device && hasDeviceVoice(lang)
const deviceRate = (lang: Lang) => (lang === 'el-GR' ? 1 + prefs.speed / 100 : 1)

// --- the device voice (Web Speech) ---
//
// Safari (iOS) and Chrome (macOS) sometimes go silent for good: the synthesizer reports
// "speaking" but never starts the next phrase. Guards against the known causes:
// - the phrase being spoken is kept referenced: if it is garbage-collected, its `end` never
//   arrives and the engine stays "busy";
// - cancel() only when something is actually queued, and the next phrase goes a moment later
//   (Safari drops a phrase queued right after cancel());
// - the voice is picked explicitly instead of leaving it to `lang`;
// - a phrase that hasn't started within START_TIMEOUT_MS is dropped and the caller falls back
//   to the site's voice, so a stuck engine never means silence.

const START_TIMEOUT_MS = 1500
const AFTER_CANCEL_MS = 60

let speaking: SpeechSynthesisUtterance | null = null
// Settles the phrase in progress (stopPlayback, or a newer phrase took over).
let settleSpeech: (() => void) | null = null
let speechPrimed = false

function deviceVoice(lang: Lang): SpeechSynthesisVoice | undefined {
  const code = lang.slice(0, 2)
  const voices = speechSynthesis
    .getVoices()
    .filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith(code))
  return voices.find((v) => v.default) ?? voices.find((v) => v.localService) ?? voices[0]
}

function cancelSpeech(): boolean {
  settleSpeech?.()
  const busy = speechSynthesis.speaking || speechSynthesis.pending
  if (busy) speechSynthesis.cancel()
  return busy
}

/** Says `text` with the device voice. Resolves true once it is over (or was stopped), false if
 * the engine never started it — then the caller plays the site's voice instead. */
function deviceSpeak(text: string, lang: Lang): Promise<boolean> {
  if (!('speechSynthesis' in window)) return Promise.resolve(false)
  const hadToCancel = cancelSpeech()
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text)
    const voice = deviceVoice(lang)
    try {
      if (voice) u.voice = voice
    } catch {
      // not a real SpeechSynthesisVoice (some browsers, test doubles): `lang` is enough
    }
    u.lang = voice?.lang ?? lang
    u.rate = deviceRate(lang)
    let started = false
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      if (speaking === u) speaking = null
      if (settleSpeech === stop) settleSpeech = null
      resolve(ok)
    }
    const stop = () => finish(true)
    const timer = window.setTimeout(() => {
      if (started || done) return
      const mine = speaking === u
      finish(false) // first: cancel() answers with an "interrupted" error, which isn't a success
      if (mine) speechSynthesis.cancel()
    }, START_TIMEOUT_MS)
    u.onstart = () => (started = true)
    u.onend = () => finish(true)
    // interrupted/canceled: a newer phrase or stopPlayback took over — not a failure
    u.onerror = (e) => finish(started || e.error === 'interrupted' || e.error === 'canceled')
    speaking = u
    settleSpeech = stop
    if (hadToCancel)
      window.setTimeout(() => speaking === u && speechSynthesis.speak(u), AFTER_CANCEL_MS)
    else speechSynthesis.speak(u)
  })
}

const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='

let audio: HTMLAudioElement | null = null
let unlocked = false

function player(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio()
    audio.preload = 'auto'
  }
  return audio
}

export function unlockAudio(): void {
  // iOS: the speech engine wants its first phrase inside a tap — once is enough, and an
  // empty phrase on every tap only gives the engine more chances to get stuck.
  if (prefs.device && !speechPrimed && 'speechSynthesis' in window && !speechSynthesis.speaking) {
    speechPrimed = true
    speechSynthesis.speak(new SpeechSynthesisUtterance(''))
  }
  unlockElement()
}

function unlockElement(): void {
  if (unlocked) return
  const a = player()
  a.src = SILENT_WAV
  // Calling play() inside the tap is what unlocks the element, even if the next speak()
  // interrupts this clip before it resolves.
  unlocked = true
  a.play().catch((e: DOMException) => {
    if (e.name === 'NotAllowedError') unlocked = false
  })
}

async function playFile(url: string): Promise<'ok' | 'blocked' | 'failed'> {
  const a = player()
  a.src = voiceUrl(url)
  try {
    await a.play()
    unlocked = true
    return 'ok'
  } catch (e) {
    const name = (e as DOMException).name
    // NotAllowedError = no gesture yet; AbortError = a newer clip took over.
    return name === 'NotAllowedError' || name === 'AbortError' ? 'blocked' : 'failed'
  }
}

export async function speak(url: string, text: string): Promise<void> {
  player().pause()
  if (onDevice('el-GR')) {
    // Still inside the tap: unlock <audio> now, the fallback below comes too late for iOS.
    unlockElement()
    if (await deviceSpeak(text, 'el-GR')) return
    await playFile(url) // the device voice didn't start: the site's voice instead
    return
  }
  cancelSpeech()
  // The server file didn't load (TTS down): the browser's own Greek voice.
  if ((await playFile(url)) === 'failed') await deviceSpeak(text, 'el-GR')
}

// Warm the browser cache for the next card.
export function preload(url: string): void {
  if (prefs.device) return
  const link = document.createElement('link')
  link.rel = 'prefetch'
  link.href = voiceUrl(url)
  document.head.appendChild(link)
  setTimeout(() => link.remove(), 30_000)
}

// --- sequential playback for «Аудио повторение» ---

// Settles the clip that is playing right now (so a jump to another word doesn't hang).
let settleCurrent: (() => void) | null = null

/** Plays `url` and resolves when it has finished (or fell back to the other voice). */
export async function playUntilEnd(url: string, text: string, lang: Lang): Promise<void> {
  player().pause()
  if (onDevice(lang)) {
    if (await deviceSpeak(text, lang)) return
    return fileUntilEnd(url, text, lang, false) // the device voice didn't start
  }
  cancelSpeech()
  return fileUntilEnd(url, text, lang, true)
}

function fileUntilEnd(url: string, text: string, lang: Lang, orDevice: boolean): Promise<void> {
  const a = player()
  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      settleCurrent = null
      a.removeEventListener('ended', done)
      a.removeEventListener('error', failed)
      resolve()
    }
    const failed = () => {
      if (settled) return
      a.removeEventListener('ended', done)
      a.removeEventListener('error', failed)
      settled = true
      settleCurrent = null
      // The server file didn't load (TTS down): the browser's own voice, if not tried already.
      if (orDevice) deviceSpeak(text, lang).then(() => resolve())
      else resolve()
    }
    settleCurrent = done
    a.addEventListener('ended', done)
    a.addEventListener('error', failed)
    a.src = voiceUrl(url)
    a.play()
      .then(() => (unlocked = true))
      .catch((e: DOMException) => (e.name === 'AbortError' ? undefined : failed()))
  })
}

export function pausePlayback(): void {
  if (speaking) speechSynthesis.pause()
  else player().pause()
}

export function resumePlayback(): void {
  if (speaking) speechSynthesis.resume()
  else if (player().getAttribute('src') && !player().ended)
    player()
      .play()
      .catch(() => {})
}

/** Stops the current clip; a pending playUntilEnd() resolves right away. */
export function stopPlayback(): void {
  const a = player()
  a.pause()
  a.removeAttribute('src') // so a later resumePlayback() can't restart the old clip
  if ('speechSynthesis' in window) cancelSpeech()
  settleCurrent?.()
}
