# TeamPulse API — этап 1

NestJS + Prisma/PostgreSQL. API пока предоставляет только проверку состояния; OAuth, бизнес-эндпоинты и очередь описаны в `docs/backend-plan.md`.

## Запуск из корня репозитория (PowerShell)

Нужны Node.js 24, pnpm и запущенный Docker Desktop с Linux containers.

```powershell
pnpm install --frozen-lockfile
Copy-Item apps/api/.env.example apps/api/.env
docker compose up -d --wait
pnpm --filter @teampulse/api db:generate
pnpm --filter @teampulse/api db:deploy
pnpm dev:api
```

`Copy-Item` выполняется только при первом запуске; существующий `.env` сохраняй. `pnpm dev` по-прежнему запускает фронтенд отдельно. API по умолчанию слушает `127.0.0.1:3000`, фронтенд — `http://localhost:5173`.

```powershell
Invoke-RestMethod http://localhost:3000/api/health/live
Invoke-RestMethod http://localhost:3000/api/health/ready
```

`live` проверяет HTTP-процесс. `ready` выполняет `SELECT 1` и возвращает 503 при отказе PostgreSQL, не раскрывая строку подключения. На старте API требует доступную PostgreSQL. Redis станет частью readiness после подключения очереди.

Переменные окружения загружаются из `apps/api/.env` командой запуска и Prisma CLI. Пароли Compose предназначены для локальной разработки; порты опубликованы только на loopback. `docker compose down` сохраняет данные в томах.

## Проверки

```powershell
pnpm --filter @teampulse/api db:generate
pnpm --filter @teampulse/api build
pnpm --filter @teampulse/api test
pnpm --filter @teampulse/api db:validate
pnpm --filter @teampulse/api test:smoke
```

Для `db:validate` нужен `.env` с DATABASE_URL, работающая БД не обязательна. HTTP-тесты используют подмену Prisma: проверяют реальные маршруты Nest, но не заменяют проверку миграций на PostgreSQL.

`test:smoke` требует сборку API, доступную PostgreSQL и применённые миграции. Он запускает настоящий модуль приложения на свободном локальном порту, проверяет liveness, readiness с запросом к БД и CORS, затем закрывает приложение.

После изменения схемы: `pnpm --filter @teampulse/api db:migrate --name <название>`, затем `db:generate`; SQL-миграции хранятся в Git. В рабочей среде применять только `db:deploy`.

Проверка 18.11.2026 на Node.js 24.22.3 и pnpm 10.17.1: схема валидна, сборка и 14 тестов API проходят. Миграция применена к локальной PostgreSQL 17; `migrate status` подтверждает актуальность, `migrate diff` не находит расхождений. Smoke-проверка с настоящей БД проходит. PostgreSQL и Redis в Compose здоровы, Redis отвечает PONG.

## Ограничения начальной модели

У руководителя доступ к проекту задаётся `ProjectManager`, у участника — `TeamMembership`; сами проверки доступа появятся на этапе 2. Ограничение одного репозитория на команду и ключи дедупликации заданы на уровне БД. `weights`, `thresholds`, `Event.payload` требуют схем валидации на границе будущего API/нормализатора. Принадлежность автора события тому же репозиторию проверяется будущим сервисом сбора. Таблицы метрик и сводок пока не добавлены.
