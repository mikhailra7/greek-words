export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// Fired when the server says the session is gone (expired, password reset, user deleted);
// AuthProvider listens and sends the user to the login screen.
export const SESSION_EXPIRED_EVENT = 'greek:session-expired'

const STATUS_MESSAGES: Record<number, string> = {
  413: 'Файл слишком большой',
  429: 'Слишком много попыток, подождите',
  500: 'Ошибка на сервере. Попробуйте ещё раз',
  502: 'Сервер недоступен. Попробуйте позже',
  503: 'Сервис временно недоступен',
  504: 'Сервер не ответил вовремя',
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData (file uploads) must set its own multipart boundary.
  const isForm = init?.body instanceof FormData
  let resp: Response
  try {
    resp = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...init?.headers },
    })
  } catch {
    throw new ApiError(0, 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз')
  }
  if (!resp.ok) {
    let message = STATUS_MESSAGES[resp.status] ?? `Ошибка ${resp.status}`
    try {
      const body = await resp.json()
      if (typeof body.detail === 'string') message = body.detail
    } catch {
      // non-JSON error body (proxy page etc.): keep the generic message
    }
    if (resp.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    }
    throw new ApiError(resp.status, message)
  }
  return resp.status === 204 ? (undefined as T) : resp.json()
}
