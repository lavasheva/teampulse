# Этап 3: GitHub App и конвейер событий

Проверено 18.11.2026 на Node.js 24.22.3: lint и build всего проекта, 31 тест API, 2 теста клиента, 17 интеграционных тестов с PostgreSQL/Redis и HTTP smoke с настоящей БД. Миграция применена к БД разработки и тестовой БД; Prisma diff без расхождений. Настоящий TeamPulse Insights установлен на lavasheva/teampulse; read-only права и проверка admin-доступа lavasheva подтверждены через GitHub API. Репозиторий связан с локальным тестовым проектом; PostgreSQL и Redis готовы.

Ветка: `backend/stage-3-github-events`, база — `develop` после PR №15.

## Что реализовано

- `GET /api/github/app` (сессия): ссылка установки из `GITHUB_APP_SLUG`.
- `POST /api/teams/:teamId/repository` (сессия + Origin + CSRF): `{ installationId: "123", fullName: "owner/repository" }`.
- `POST /api/webhooks/github`: публичный приём подписанных событий, без пользовательских cookie.
- BullMQ worker и dispatcher, восстанавливающий очередь из PostgreSQL.

Подключить репозиторий может руководитель/владелец с доступом к команде либо её участник. Наблюдатель не может. Через GitHub App проверяются действующая установка, read-only права App и права администратора репозитория у пользователя с тем же **числовым GitHub ID**, что при OAuth. Логин не используется как доказательство личности. Список администраторов читается с пагинацией. Один репозиторий на команду; уже подключённый к другой команде репозиторий — 409.

## Настройка GitHub App

OAuth App для входа уже существует; для чтения репозитория и вебхуков нужен отдельный GitHub App.

В Settings → Developer settings → GitHub Apps зарегистрируй приложение:

1. Homepage URL — URL фронтенда.
2. Webhook URL — публичный HTTPS-адрес API с путём `/api/webhooks/github`. `localhost` GitHub не доступен; для ручного теста нужен выбранный пользователем HTTPS-туннель или сервер.
3. Случайный Webhook secret не короче 32 символов.
4. Repository permissions: Contents, Issues, Pull requests — **Read-only**, Metadata — Read-only (автоматически). Остальные права не нужны; сервер отклоняет установки с write-правами.
5. Subscribe: Push, Pull request, Pull request review, Issues. Обрабатываются также Installation и Installation repositories.
6. Сгенерируй private key, сохрани локально вне репозитория. `.pem` и `.key` исключены из Git.
7. Установи App только на нужный репозиторий.

Заполни в `apps/api/.env`:

```dotenv
GITHUB_APP_ID=<числовой App ID>
GITHUB_APP_SLUG=<slug приложения>
GITHUB_APP_PRIVATE_KEY_PATH=C:/path/outside/repo/app.private-key.pem
GITHUB_WEBHOOK_SECRET=<случайный секрет>
GITHUB_EVENTS_ENABLED=true
GITHUB_QUEUE_NAME=github-deliveries
REDIS_URL=redis://localhost:6379
```

Не присылай private key/secret в чат и не добавляй их в Git. Installation ID можно взять со страницы установленного App. Вызов подключения репозитория сверит доступ через GitHub, а не поверит переданному ID.

## Подпись и хранение

Сначала Express читает исходные байты тела (JSON, до 2 MiB), затем проверяется `X-Hub-Signature-256` с HMAC SHA-256 и constant-time сравнением. JSON разбирается только после верной подписи. Неверная подпись — 401, неверный JSON/структура — 400, слишком большое тело — 413, отсутствие настройки секрета — 503.

Сохраняется хеш исходного тела и имени события. Повторный delivery ID с тем же хешем — 202 с `duplicate: true`; тот же ID с другим телом/типом — 409. Неподдерживаемые действия, ping, неизвестные/отключённые репозитории и чужая installation — 202 с `ignored: true`.

В `WebhookDelivery.payload` хранится **нормализованный allowlist метаданных**, не исходное тело. Код/diff/patch не сохраняются. В Redis передаётся только delivery ID. На push сохраняются SHA, авторские email/login (если есть), время, сообщение и пути файлов. На PR/review/issues — стабильный внешний ID, действие, автор, время, заголовок и URL. Число изменённых строк требует последующего обогащения через GitHub API, webhook этих данных не содержит.

Автоматически связывается только числовой GitHub ID действительного участника команды. Username и непроверенный email из push не дают права на чужой вклад; неизвестные авторы сохраняются отдельно. Полное сопоставление авторов — этап 4.

## Надёжность

Приём отвечает 202 после записи pending-строки в PostgreSQL и не обращается к Redis. Эта строка одновременно inbox/outbox. Dispatcher раз в 3 секунды подбирает до 100 pending-строк; Redis job ID равен delivery ID. После восстановления Redis задания снова добавляются. Повторная обработка безопасна: блокировка строки доставки и уникальные ключи событий в БД.

Worker одной транзакцией сохраняет авторов/события и завершает доставку. При сбое транзакция откатывается. Пять неудачных обработок с экспоненциальной паузой от 1 секунды; после этого статус failed, общий код `PROCESSING_FAILED`. Секреты и тексты исключений в lastError не сохраняются. failed-строки не подбираются автоматически; UI ручного повтора пока нет. Удаление/приостановка установки и удаление репозитория из установки помечают соответствующие источники disconnected.

Без `GITHUB_EVENTS_ENABLED=true` API может принимать и сохранять вебхуки, но worker не запускается. Это удобно для настройки: накопленные pending-строки будут обработаны после включения. При включённой очереди readiness проверяет PostgreSQL и Redis; таймаут Redis — 1,5 секунды.

## Проверки и границы этапа

`pnpm --filter @teampulse/api test` — нормализация и прежние модульные/HTTP-тесты.

`TEST_DATABASE_URL` должен указывать на отдельную БД с суффиксом `_test`. Затем `pnpm --filter @teampulse/api test:integration`. Для теста BullMQ нужен доступный Redis, по умолчанию `redis://127.0.0.1:6379/15`; можно задать `TEST_REDIS_URL`. Используется отдельное случайное имя очереди. Нельзя указывать рабочий Redis без согласования с владельцем.

Интеграционные тесты проверяют подпись по байтам, лимит тела, дубли и конфликт ID, rollback/повторы, отключение источника, доступ к подключению и обработку в настоящем BullMQ. Недоступность транспорта Redis моделируется сбоем dispatcher, затем обработка восстанавливается настоящим Redis. GitHub App API в тестах подменён.

Для ручной проверки настроен настоящий GitHub App с временным HTTPS-туннелем Pinggy, который открывает только POST /api/webhooks/github. Установка и read-only права проверены; контрольный push используется для проверки всего конвейера. История/пагинация коммитов, обогащение diff-статистики, суточная сверка и полное сопоставление авторов относятся к этапу 4. Фронтенд остаётся на демоданных.

Источники: [подписи GitHub](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [события и payload](https://docs.github.com/en/webhooks/webhook-events-and-payloads), [повторы BullMQ](https://docs.bullmq.io/guide/retrying-failing-jobs), [проверка администраторов репозитория](https://docs.github.com/en/rest/collaborators/collaborators#list-repository-collaborators).
