import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../api/client.ts'
import { useAuth } from '../auth/AuthContext.tsx'
import { Button, Card, ErrorText, Field, Input } from '../components/ui.tsx'
import VoiceSettings from '../components/VoiceSettings.tsx'

export default function ProfilePage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const onLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Профиль</h1>

      <Card className="flex items-center justify-between gap-3">
        <div>
          <p className="text-lg font-medium">{user?.username}</p>
          <p className="text-sm text-slate-500">{user?.is_admin ? 'Администратор' : 'Участник'}</p>
        </div>
        <Button variant="secondary" onClick={onLogout}>
          Выйти
        </Button>
      </Card>

      {user?.is_admin && (
        <Link to="/admin" className="block">
          <Card className="flex items-center justify-between hover:border-blue-400">
            <span>
              <span className="block font-medium">Администрирование</span>
              <span className="block text-sm text-slate-500">пользователи и коды приглашения</span>
            </span>
            <span className="text-slate-400">→</span>
          </Card>
        </Link>
      )}

      <VoiceSettings />

      <ChangePassword />
    </section>
  )
}

function ChangePassword() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [next2, setNext2] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setDone(false)
    if (next !== next2) {
      setError('Новые пароли не совпадают')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: current, new_password: next }),
      })
      setCurrent('')
      setNext('')
      setNext2('')
      setDone(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <h2 className="mb-3 font-medium">Сменить пароль</h2>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Текущий пароль">
          <Input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <Field label="Новый пароль" hint="Минимум 6 символов. Другие устройства будут разлогинены.">
          <Input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
          />
        </Field>
        <Field label="Повторите новый пароль">
          <Input
            type="password"
            value={next2}
            onChange={(e) => setNext2(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        {done && <p className="text-sm text-green-600 dark:text-green-400">Пароль изменён</p>}
        <Button type="submit" disabled={busy}>
          Сохранить
        </Button>
      </form>
    </Card>
  )
}
