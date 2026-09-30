import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../api/client.ts'
import { useAuth } from '../auth/AuthContext.tsx'
import AuthShell from '../components/AuthShell.tsx'
import { Button, ErrorText, Field, Input, Spinner } from '../components/ui.tsx'

type AuthStatus = { has_users: boolean; registration_open: boolean }

export default function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<AuthStatus>('/auth/status')
      .then(setStatus)
      .catch((e: Error) => setError(e.message))
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== password2) {
      setError('Пароли не совпадают')
      return
    }
    setBusy(true)
    setError('')
    try {
      await register(username, password, status?.has_users ? code : undefined)
      navigate('/', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!status && !error) return <Spinner />

  if (status && !status.registration_open) {
    return (
      <AuthShell title="Регистрация закрыта">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          В группе уже максимальное количество участников. Обратитесь к администратору.
        </p>
        <BackToLogin />
      </AuthShell>
    )
  }

  const firstUser = status && !status.has_users

  return (
    <AuthShell title="Регистрация">
      {firstUser && (
        <p className="mb-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-950 dark:text-blue-200">
          Это первый аккаунт — он станет администратором. Код приглашения не нужен.
        </p>
      )}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Имя" hint="Буквы, цифры, точка, дефис, подчёркивание. 2–32 символа.">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="off"
            minLength={2}
            maxLength={32}
            required
          />
        </Field>
        <Field label="Пароль" hint="Минимум 6 символов.">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
          />
        </Field>
        <Field label="Повторите пароль">
          <Input
            type="password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
          />
        </Field>
        {!firstUser && (
          <Field label="Код приглашения" hint="Код выдаёт администратор группы.">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="ABCD-EFGH"
              required
            />
          </Field>
        )}
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy} className="w-full">
          Зарегистрироваться
        </Button>
      </form>
      <BackToLogin />
    </AuthShell>
  )
}

function BackToLogin() {
  return (
    <p className="mt-6 text-center text-sm text-slate-500">
      Уже есть аккаунт?{' '}
      <Link to="/login" className="text-blue-600 dark:text-blue-400">
        Войти
      </Link>
    </p>
  )
}
