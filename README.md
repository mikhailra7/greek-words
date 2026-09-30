# Λέξεις — тренажёр греческих слов

Сайт для учебной группы: словари из страниц учебника, карточки, «Переведи слово», «Напиши».
Полное ТЗ и журнал решений — [SPEC.md](SPEC.md).

## Стек

- **backend/** — Python 3.11+, FastAPI, SQLAlchemy 2, Alembic, SQLite (`data/greek.db`)
- **frontend/** — Vite, React 19, TypeScript, Tailwind CSS 4, React Router
- Node.js лежит локально в `.tools/node` (в git не попадает); Makefile подхватывает его сам

## Первый запуск

```bash
make setup      # venv + pip install, npm install, .env из .env.example
make dev        # backend :8000 + frontend :5173, Ctrl+C останавливает оба
```

Открыть http://localhost:5173.

С телефона в той же Wi-Fi сети: `http://<IP ноутбука>:5173`
(IP: `ipconfig getifaddr en0`).

Для `make e2e` один раз скачать Chromium в `.tools`:

```bash
cd frontend && PLAYWRIGHT_BROWSERS_PATH=../.tools/ms-playwright npx playwright install chromium
```

Если Node ещё не распакован:

```bash
mkdir -p .tools && tar -xzf node-v24.*-darwin-arm64.tar.gz -C .tools && mv .tools/node-v24.* .tools/node
```

## Команды

| Команда | Что делает |
|---|---|
| `make dev` | оба сервера с автоперезагрузкой |
| `make backend` / `make frontend` | по отдельности |
| `make migrate` | применить миграции БД |
| `make test` | тесты бэкенда (pytest) |
| `make e2e` | тесты в браузере (Playwright): свой бэкенд на :8001 и чистая БД в `data/e2e` |
| `make lint` / `make fmt` | ruff + oxlint / автоформат (ruff, prettier) |

Выдать права администратора из консоли (если в админке некому):

```bash
cd backend && .venv/bin/python -m app.cli make-admin <имя>
```

Демо-словари для разработки (2 словаря, 32 слова; повторный запуск ничего не дублирует):

```bash
cd backend && .venv/bin/python -m app.cli seed-demo
```

Базовые категории и разметка слов без категории (повторный запуск ничего не дублирует):

```bash
cd backend && .venv/bin/python -m app.cli seed-categories
```

Новая миграция после изменения моделей:

```bash
cd backend && .venv/bin/alembic revision --autogenerate -m "описание"
```

## Импорт слов из учебника

**Через сайт (claude.ai):** Словари → «Импорт из учебника» → загрузить PDF или фото →
выбрать страницы → скачать PDF для Claude и скопировать промпт → в claude.ai приложить PDF,
вставить промпт → ответ вставить на сайт → проверить черновик → «Опубликовать».

**Через Claude Code (много страниц):** положить PDF в `import_inbox/` и написать в Claude Code
«разбери учебник <файл>» (скилл `import-textbook`). Готовый архив появится в `import_outbox/`,
его загружают на сайте: «Импорт из учебника» → «Загрузить архив».

## Папки

| Папка | Назначение | В git |
|---|---|---|
| `data/` | SQLite | нет |
| `media/` | озвучка и картинки слов | нет |
| `data/imports/` | загруженные PDF и черновики импорта (закрытые) | нет |
| `import_inbox/`, `import_outbox/` | импорт через Claude Code | нет |
| `docs/prompts/` | промпт и JSON-схема импорта | да |
| `docs/samples/` | сканы учебника для проверки импорта | нет |

API-документация в dev-режиме: http://localhost:5173/api/docs
