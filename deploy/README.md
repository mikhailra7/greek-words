# Сервер: установка, перенос данных, бэкапы, обновление

Схема: на VPS работает Docker Compose из двух контейнеров.

- **web** — Caddy: HTTPS (сертификат Let's Encrypt получает сам), собранный фронтенд,
  проксирует `/api` и `/media` на бэкенд. Наружу открыты только 80 и 443.
- **backend** — FastAPI, **один процесс** (счётчик неудачных входов и очереди озвучки живут в
  памяти). Миграции применяются при каждом старте. Снаружи недоступен.

Данные лежат на диске сервера рядом с кодом и в образы не попадают:
`data/` (SQLite, черновики импорта), `media/` (картинки и звук), `backups/` (архивы).
Код приходит из GitHub, данные — архивом с ноутбука (`deploy/pack-data.sh`).

**Сейчас (с 2026-10-03):** `https://31-31-192-134.sslip.io` — VPS 31.31.192.134 (Ubuntu 24.04,
1 vCPU, 1 ГБ RAM + swap 2 ГБ, 20 ГБ), пользователь `ubuntu`, проект в `/home/ubuntu/greek`. Вход
только по SSH-ключу. Прежний сервер 194.226.112.127 остановлен (данные на нём остались, cron снят).

Требования к VPS: Ubuntu 24.04 или Debian 12, минимум 1 vCPU / 1 ГБ RAM (+ swap, скрипт
создаёт 2 ГБ) / 15 ГБ диска, лучше 2 vCPU / 2 ГБ / 25+ ГБ. Домен с A-записью на IP сервера.

## Первая установка

### 1. Сервер (один раз, от root)

```bash
scp deploy/server-setup.sh root@<IP>:
ssh root@<IP> 'bash server-setup.sh ubuntu'
```

Обновляет систему, ставит Docker, git, firewall (22, 80, 443), автообновления безопасности,
fail2ban, swap 2 ГБ; добавляет пользователя в группу docker и копирует ему SSH-ключи root.

**Пользователь должен иметь uid 1000** — под этим uid работает бэкенд в контейнере и ему
принадлежат `data/` и `media/`. В образах Ubuntu это уже существующий `ubuntu`; всё дальнейшее
(`update.sh`, бэкапы, cron) — под ним, **без sudo**, иначе файлы достанутся root.

Проверить вход по ключу: `ssh ubuntu@<IP>`. Только после этого отключить вход по паролю
(файл `00-…` читается раньше `50-cloud-init.conf`, который пароль разрешает):

```bash
sudo tee /etc/ssh/sshd_config.d/00-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sudo sshd -t && sudo systemctl reload ssh
```

Если сервер просит перезагрузку после обновлений (`/var/run/reboot-required`) — перезагрузить
до запуска сайта.

### 2. Код и настройки (под пользователем ubuntu)

```bash
git clone https://github.com/mikhailra7/greek-words.git greek
cd greek
cp .env.example .env
nano .env        # DOMAIN=<домен>; TTS_*, PIXABAY_API_KEY — по желанию
mkdir -p data media backups
```

`ENV=dev` в `.env` оставить как есть: `docker-compose.yml` всё равно включает `ENV=prod`
(cookie только по HTTPS, нет `/api/docs`).

Домена пока нет — можно взять `DOMAIN=<IP-через-дефисы>.sslip.io` (например,
`203-0-113-7.sslip.io`): это имя само указывает на IP, и Caddy получит для него сертификат.

### 3. Данные с ноутбука — **до** первого запуска

Если запустить сайт с пустой базой, первый зарегистрировавшийся станет администратором.

На ноутбуке:

```bash
make pack-data                                   # -> backups/greek-data-<дата>.tar.gz
scp backups/greek-data-<дата>.tar.gz ubuntu@<IP>:greek/backups/
```

На сервере:

```bash
cd ~/greek
deploy/restore-data.sh backups/greek-data-<дата>.tar.gz
```

### 4. Запуск

```bash
docker compose up -d --build     # первая сборка — несколько минут
docker compose ps                # backend: healthy, web: running
docker compose logs -f web       # получение сертификата
```

Открыть `https://<домен>`, войти своим пользователем, проверить словари, картинки и звук.

Проверить, что с сервера работает озвучка (сервис Microsoft бывает недоступен с части
хостингов): в «Изучении» включить «Озвучивать слова» и выбрать голос сайта в профиле. Если
звук не создаётся — `docker compose logs backend`; сайт в этом случае сам переходит на голос
устройства.

### 5. Ежедневный бэкап

```bash
sudo tee /etc/cron.d/greek-backup >/dev/null <<'EOF'
30 3 * * * ubuntu /home/ubuntu/greek/deploy/backup.sh >> /home/ubuntu/greek/backups/backup.log 2>&1
EOF
```

Каждую ночь в `backups/` появляется `greek-data-<дата>.tar.gz` (база целостной копией через
SQLite backup API, `media/`, `data/imports/`), хранятся последние 14 (`KEEP=…`). Время —
по часовому поясу сервера (сейчас Москва).

Копии на том же диске не спасут, если пропадёт сервер, — регулярно забирайте их на ноутбук:

```bash
deploy/pull-backups.sh ubuntu@<IP>
```

Мониторинг доступности (по желанию): бесплатный UptimeRobot или аналог на
`https://<домен>/api/health`.

## Обновление

После push в `main` (и зелёного CI):

```bash
ssh ubuntu@<IP>
cd greek && deploy/update.sh     # без sudo; бэкап → git pull → пересборка → перезапуск
```

## Переезд на другой сервер

Так переехали 2026-10-03 (простой — несколько минут):

1. Новый сервер: «Первая установка», шаги 1–2 (`.env` можно взять со старого, поменяв `DOMAIN`),
   заранее `docker compose build` и проверка озвучки — пока старый сайт работает.
2. Старый: `docker compose stop backend`, финальная копия разовым контейнером —
   `docker compose run --rm --no-deps -T backend python -m app.cli backup /app/data/<папка>/data/greek.db`,
   и `tar` из неё + `media` + `data/imports` (тот же формат, что у `backup.sh`).
3. Архив — через ноутбук (там остаётся копия) → `deploy/restore-data.sh` → `docker compose up -d`.
4. Сверить число строк в таблицах, `pragma integrity_check`, HTTPS; cron бэкапа на новом;
   на старом — `docker compose stop` и убрать `/etc/cron.d/greek-backup`.
5. При смене адреса (sslip.io) все входят заново — сессии привязаны к адресу; установленное на
   телефоне приложение ставится заново.

## Восстановление из бэкапа

```bash
deploy/restore-data.sh backups/greek-data-<дата>.tar.gz --force   # текущие данные сохранятся в backups/before-restore-*
docker compose up -d
```

## Полезное

| Что | Команда |
|---|---|
| Состояние | `docker compose ps` |
| Логи | `docker compose logs -f backend` (или `web`) |
| Перезапуск | `docker compose restart backend` |
| Выдать админа | `docker compose exec backend python -m app.cli make-admin <имя>` |
| Промпт импорта | `docker compose exec backend python -m app.cli import-prompt` |
| Место на диске | `du -sh data media backups; docker system df` |

Логи контейнеров ограничены: 3 файла по 10 МБ на контейнер.

## Что сознательно не сделано

- DOC/DOCX на сервере не конвертируются (нет LibreOffice в образе): сайт просит PDF.
- Образы собираются на самом сервере (нужен swap на 1 ГБ RAM). Если сборка станет тяжёлой —
  собирать в GitHub Actions и публиковать в GHCR.
