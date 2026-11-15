# MaintAR — руководство разработчика

Документ для тех, кто будет поддерживать и развивать проект: как всё устроено, как запустить, где что менять и на какие грабли не наступать.

Пользовательское описание возможностей — в [README.md](../README.md) и [details.md](details.md).

---

## 1. Архитектура

Три независимых процесса, которые общаются по HTTP:

```
┌──────────────────────┐   REST + JWT    ┌───────────────────────────┐  multipart  ┌──────────────────────┐
│  Приложение          │ ──────────────► │  Сервер                   │ ──────────► │  Сервис ИИ           │
│  frontend/           │ ◄────────────── │  backend/MaintARBackend   │ ◄────────── │  ai/service/         │
│  React Native + Expo │   JSON, фото    │  ASP.NET Core 11, EF Core │  находки    │  FastAPI + YOLOv8    │
│  порт 8081           │                 │  порт 5176                │             │  порт 8000           │
└──────────────────────┘                 └─────────────┬─────────────┘             └──────────────────────┘
                                                       │ EF Core
                                                       ▼
                                         SQLite (локально) / SQL Server
                                         + файлы фото в wwwroot/
```

- **Приложение** знает только про сервер. С сервисом ИИ напрямую не общается.
- **Сервер** — единственный источник данных: учётные записи, оборудование, осмотры, журнал работ, фото. Для анализа фото он сам вызывает сервис ИИ и сохраняет результат.
- **Сервис ИИ** не хранит состояние: получил фото и список узлов — вернул находки.

### Сценарий осмотра целиком

1. Приложение: `POST /api/Inspections` (multipart: `photo`, `value` — код или серийный номер, `identificationMethod`).
2. Сервер находит оборудование, создаёт `Inspection` со статусом `Pending`, сохраняет фото в `wwwroot/uploads/inspections/{id}.jpg`.
3. Сервер вызывает `POST {AiService:BaseUrl}/analyze`: фото + `context` (узлы оборудования и типы дефектов его типа).
4. Сервис ИИ прогоняет фото через модели и возвращает `findings` с `componentId`, категорией, уверенностью, рамкой.
5. Сервер отбрасывает находки по чужим узлам, сохраняет остальные как `InspectionFinding`, ставит статус `Completed` (или `Failed`, если ИИ недоступен) и возвращает осмотр приложению.

---

## 2. Окружение

| Что | Версия | Зачем |
|---|---|---|
| .NET SDK | 11 | сервер |
| Python | 3.10+ (проверено на 3.12/3.13) | сервис ИИ |
| Node.js | 20+ | приложение |
| Expo Go на телефоне | под Expo SDK 58 | запуск приложения на устройстве |

Телефон и компьютер должны быть в одной сети Wi-Fi.

---

## 3. Первый запуск

```bash
git clone https://github.com/kayeros/MaintAR
cd MaintAR\frontend
npm install
cd ..
start-all.bat
```

`start-all.bat` открывает три окна: ИИ (8000), сервер (5176), Expo (8081).

**Ключи не обязательны.** В режиме Development сервер стартует без `appsettings.Local.json`:
- JWT подписывается встроенным тестовым ключом;
- письма не уходят, код подтверждения почты пишется в консоль сервера;
- демо-вход `demo` / `demo12345` работает сразу (почта у него уже подтверждена).

Вне Development без ключей сервер намеренно не стартует (см. `Program.cs`).

Чтобы телефон видел сервер, в `frontend/.env` укажите IP компьютера (образец — `frontend/.env.example`):

```
EXPO_PUBLIC_API_URL=http://<IP компьютера>:5176
```

Адрес можно поменять и в самом приложении: «Профиль» → «Адрес сервера».

### Запуск по отдельности

```bash
ai\service\run.bat
```

```bash
cd backend\MaintARBackend
dotnet run --launch-profile http --urls http://0.0.0.0:5176
```

```bash
cd frontend
npx expo start --lan --clear
```

Swagger сервера в Development: `http://localhost:5176/swagger`.

---

## 4. Конфигурация

### Сервер

Настройки читаются по порядку, следующий файл перекрывает предыдущий:
`appsettings.json` → `appsettings.Development.json` → `appsettings.Local.json` → переменные окружения.

`appsettings.Local.json` — **секреты, в git не попадает** (есть в `.gitignore`). Образец: `appsettings.Local.example.json`.

| Ключ | Что | По умолчанию |
|---|---|---|
| `Jwt:Key` | ключ подписи токенов, от 32 символов | в Development — встроенный тестовый |
| `Jwt:ExpireMinutes` | срок жизни токена | 60 |
| `Resend:ApiToken` | токен почтового сервиса Resend | в Development — заглушка, код в консоли |
| `AiService:BaseUrl` | адрес сервиса ИИ | `http://localhost:8000/` |
| `Database:Provider` | `Sqlite` или пусто (= SQL Server) | SQL Server |
| `ConnectionStrings:Sqlite` | файл SQLite | `Data Source=maintar.db` |
| `ConnectionStrings:Default` | строка SQL Server | LocalDB |

> Тестовый ключ Resend отправляет письма только на почту владельца аккаунта Resend. Для реальных пользователей нужен подтверждённый домен.

### Сервис ИИ (переменные окружения)

| Переменная | Что | По умолчанию |
|---|---|---|
| `BASIC_WEIGHTS` | путь к базовой модели | `ai/service/weights/basic.pt` |
| `EXPANDED_WEIGHTS` | путь к расширенной модели | `ai/service/weights/expanded.pt` |
| `BASIC_CONF` | порог уверенности базовой модели | 0.35 |
| `EXPANDED_CONF` | порог уверенности расширенной модели | 0.30 |

### Приложение

| Переменная | Что |
|---|---|
| `EXPO_PUBLIC_API_URL` | адрес сервера, файл `frontend/.env` |

---

## 5. Сервер (`backend/MaintARBackend`)

### Структура

| Папка | Содержимое |
|---|---|
| `Controllers/` | HTTP-эндпоинты |
| `Models/` | сущности EF Core и DTO запросов/ответов |
| `Context/AppDbContext.cs` | контекст EF Core |
| `Context/DevDataSeeder.cs` | демо-данные для Development |
| `Services/Auth/` | пароли, JWT, подтверждение почты, сброс пароля |
| `Services/Email/` | отправка писем через Resend и HTML-шаблоны |
| `Services/Ai/AiAnalysisClient.cs` | клиент сервиса ИИ и DTO контракта |
| `Middleware/ExceptionHandlingMiddleware.cs` | единая обработка исключений |
| `Migrations/` | миграции EF Core (под SQL Server) |
| `wwwroot/seed/` | фото демо-оборудования (в git) |
| `wwwroot/uploads/` | фото, загруженные пользователями (не в git) |

### Модель данных

```
EquipmentType ─┬─< Equipment ─┬─< Component ─┬─< MaintenanceRecord >── User
               │              │              └─< InspectionFinding
               │              └─< Inspection ───< InspectionFinding
               │                     └── User
               └─< DefectType ──────────────────< InspectionFinding (необязательно)
```

| Сущность | Ключевые поля |
|---|---|
| `EquipmentType` | `Name`; список `DefectTypes` — какие дефекты бывают у этого типа |
| `Equipment` | `Code` (код в QR), `SerialNumber`, `Model`, `Name`, `Location`, `InstalledAt`, `PhotoPath` |
| `Component` (узел) | `Name`, `ServiceLifeMonths`, `InstalledAt`, `LastReplacedAt` — по ним считается остаточный ресурс |
| `DefectType` | `Code` (например `PUMP_SEAL_LEAK`), `Name`, `Description` |
| `Inspection` | `Status` (`Pending`/`Completed`/`Failed`), `IdentificationMethod`, `PhotoPath`, `RawAiResponse` (сырой ответ ИИ) |
| `InspectionFinding` | `ComponentId`, `DefectTypeId?`, `Category`, `Confidence`, `Explanation`, `Recommendation`, рамка `BoxX/BoxY/BoxWidth/BoxHeight` (доли кадра 0–1) |
| `MaintenanceRecord` | `Type` (`Checked`/`Serviced`/`Replaced`/`Note`), `Date`, `Comment` |
| `User` | `Email`, `UserName`, `PasswordHash`, `IsEmailVerified` |

Перечисления — в `Models/Enums.cs`. В JSON они передаются строками (`JsonStringEnumConverter`).

### Авторизация

- JWT в заголовке `Authorization: Bearer <token>`.
- В токене есть claim `email_verified`. Политика `EmailVerified` требует `true`.
- `Equipment`, `Inspections`, `Maintenance` закрыты политикой `EmailVerified`. `Profile` и часть `Auth` требуют только вход.
- После подтверждения почты или смены имени сервер выдаёт **новый токен** — приложение его сохраняет.

### API

| Метод | Путь | Доступ | Назначение |
|---|---|---|---|
| POST | `/api/Auth/register` | все | регистрация |
| POST | `/api/Auth/login` | все | вход, возвращает токен |
| POST | `/api/Auth/send-verification-code` | вход | отправить код на почту |
| POST | `/api/Auth/verify-email` | вход | подтвердить почту кодом |
| POST | `/api/Auth/forgot-password` | все | код для сброса пароля |
| POST | `/api/Auth/reset-password` | все | новый пароль по коду |
| GET | `/api/Equipment` | почта | список (поиск, для ручного выбора) |
| GET | `/api/Equipment/{id}` | почта | карточка: узлы, ресурс, последний осмотр |
| GET | `/api/Equipment/identify?value=` | почта | поиск по коду или серийному номеру |
| POST | `/api/Equipment/{id}/photo` | почта | загрузить фото оборудования |
| POST | `/api/Inspections` | почта | осмотр по фото с анализом ИИ |
| GET | `/api/Inspections/my` | почта | свои осмотры |
| GET | `/api/Inspections/{id}` | почта | свой осмотр |
| GET | `/api/Inspections/equipment/{equipmentId}` | почта | все осмотры оборудования |
| GET | `/api/Inspections/equipment/{equipmentId}/{id}` | почта | осмотр оборудования (любого инженера) |
| POST | `/api/Maintenance` | почта | записать работу |
| GET | `/api/Maintenance/equipment/{id}` | почта | журнал по оборудованию |
| GET | `/api/Maintenance/component/{id}` | почта | журнал по узлу |
| GET | `/api/Maintenance/my` | почта | свои записи |
| DELETE | `/api/Maintenance/{id}` | почта | удалить свою запись |
| GET | `/api/Profile` | вход | имя, почта, аватар |
| PUT | `/api/Profile/name` | вход | сменить имя (вернёт новый токен) |
| POST | `/api/Profile/avatar` | вход | загрузить аватар (до 5 МБ) |
| DELETE | `/api/Profile/avatar` | вход | удалить аватар |

Ручные запросы для проверки — `MaintARBackend.http` (открывается в Visual Studio / Rider / VS Code с REST Client).

### База данных и миграции

- **Локально — SQLite**, схема создаётся `EnsureCreated` по текущей модели (`Program.cs`). Миграции при этом **не применяются**.
- **Миграции в `Migrations/` написаны под SQL Server.**

Из этого следует важное правило:

> Если вы добавили поле в сущность, а у вас уже есть файл `maintar.db`, новой колонки в нём не появится — `EnsureCreated` не меняет существующую базу. Удалите `maintar.db` (демо-данные пересоздадутся при запуске) или добавьте колонку вручную.

Для SQL Server после изменения модели создайте миграцию:

```bash
cd backend\MaintARBackend
dotnet ef migrations add <ИмяМиграции>
dotnet ef database update
```

### Демо-данные (`Context/DevDataSeeder.cs`)

Выполняется при каждом старте в Development и **идемпотентен** — можно запускать на существующей базе:
- создаёт пользователя `demo@maintar.local` / `demo12345` с подтверждённой почтой;
- создаёт типы оборудования, их дефекты и три агрегата: `MOTOR-001` (есть дефекты), `VALVE-001` (норма), `PUMP-001` (не проверялся);
- проставляет фото из `wwwroot/seed/` оборудованию и демо-осмотрам, если их нет.

Новые демо-данные добавляйте так же: «создать, если нет», а не «очистить и залить заново» — у разработчиков уже есть свои базы.

### Фото

- Отдаются как статика: `GET /seed/...`, `GET /uploads/...`. В API возвращается относительный путь, приложение склеивает его с адресом сервера (`photoUrl()` в `api.js`).
- Фото осмотров: `wwwroot/uploads/inspections/{inspectionId}.jpg`, до 10 МБ.
- Аватары: `wwwroot/uploads/avatars/{userId}.jpg`, URL с `?v=<ticks>` против кэша.
- `wwwroot/uploads/` в git не попадает. На сервере эту папку нужно сохранять при обновлениях.

---

## 6. Сервис ИИ (`ai/service`)

### Контракт

```
POST /analyze   multipart/form-data
  photo    — файл изображения
  context  — JSON:
    { "equipmentId": 1, "equipmentType": "...", "model": "...",
      "components":  [{ "id": 3, "name": "Кабельный ввод" }],
      "defectTypes": [{ "code": "MOTOR_CABLE_INSULATION", "name": "..." }] }

→ { "findings": [{
      "componentId": 3,
      "defectCode": "MOTOR_CABLE_INSULATION" | null,
      "category": "PossibleDefect" | "CheckRecommended" | "NoVisibleProblems",
      "confidence": 0.87,
      "explanation": "…", "recommendation": "…",
      "box": { "x": 0.12, "y": 0.30, "width": 0.25, "height": 0.20 } | null
  }] }

GET /health → какие веса загружены и на каком устройстве (CPU/GPU)
```

- `box` — доли кадра: левый верхний угол и размер.
- `componentId` обязан быть из присланного `components`, иначе сервер находку отбросит.
- Если ничего не найдено — по одной записи `NoVisibleProblems` на каждый узел.

На стороне сервера тот же контракт описан классами в `Services/Ai/AiAnalysisClient.cs`. **Меняете контракт — меняйте оба места.**

### Как выбирается находка

- Две модели YOLOv8 (`PLAN` в `app.py`):
  - `basic.pt` — берём классы `surface_corrosion`, `pipe_crack`;
  - `expanded.pt` — берём `pipe_leak`, `cable_insulation_damage`, `fastener_issue`.
- Уверенность ≥ 0.6 → `PossibleDefect`, ниже → `CheckRecommended`.
- Узел подбирается по ключевым словам в названии (`COMP_KEYS`), код дефекта — по ключевым словам в коде (`CODE_KEYS`). Не нашлось — берётся первый узел, код `null`.
- Тексты пояснений и рекомендаций — словари `TEXT` и `NAME`.
- В ответе не больше 10 находок, по убыванию уверенности.

### Обновление весов

Веса обучаются в отдельном репозитории [maintar-model-training](https://github.com/ilsurkhal319-cell/maintar-model-training). Порядок:

1. Возьмите `best.pt` нужного запуска.
2. Проверьте, что классы и их порядок те же: `surface_corrosion, pipe_crack, pipe_leak, cable_insulation_damage, fastener_issue`. Если нет — поправьте `PLAN`, `TEXT`, `NAME`, `CODE_KEYS`, `COMP_KEYS`.
3. Замените файл в `ai/service/weights/`, обновите таблицу в `ai/service/weights/README.md` (источник, эпохи, mAP).
4. Перезапустите сервис и прогоните пару фото из папки `Кейс/` через `/analyze`.

Обучающие скрипты (сборка датасета, обучение, подбор порогов) — `ai/vision/train/`.

---

## 7. Приложение (`frontend`)

| Файл | Что |
|---|---|
| `App.js` | все экраны, навигация (стек экранов + нижние вкладки) и общие компоненты |
| `src/api.js` | клиент сервера: токен, сессия, ошибки на русском, загрузка фото, нормализация QR |
| `src/theme.js` | цвета |
| `tailwind.config.js`, `global.css` | NativeWind (Tailwind-классы в `className`) |

Ранний прототип, приложение его **не использует**: `src/engine.js`, `src/data/`, `src/AuthScreen.js`, `src/auth.js`, `ai/server/`, большая часть `ai/vision/`. Не правьте их, думая, что меняете приложение.

### Правила

- Все запросы — только через `request()` в `api.js`: он подставляет токен, ставит таймаут, переводит ошибки на русский и на 401 разлогинивает.
- Новый эндпоинт → функция в `api.js` → вызов из экрана.
- Загрузка файлов отличается для веба и телефона: в вебе — `Blob`, на телефоне — `uploadNative`. Смотрите `createInspection` и `uploadAvatar` как образец.
- Логин без «@» превращается в `<логин>@maintar.local` (`toEmail`).
- Код из QR чистится функцией `cleanCode`: понимает `http://VALVE-001`, `...?code=VALVE-001` и т. п.

### Проверка без телефона

`npx expo start --web` или `http://localhost:8081` в браузере. Камеры там нет, фото выбирается из галереи.

---

## 8. Типовые задачи

### Добавить тип оборудования с дефектами

1. В `DevDataSeeder.cs` — по образцу насоса `PUMP-001` в `EnsureCatalogAsync`: тип, его `DefectType` с кодами вида `<ТИП>_<ДЕФЕКТ>`, агрегат с узлами, всё через проверку «если ещё нет».
2. Чтобы ИИ привязывал находки к этим узлам и кодам — проверьте `COMP_KEYS` и `CODE_KEYS` в `ai/service/app.py`.
3. Сгенерируйте QR с кодом агрегата и положите в `docs/qr/`.

### Добавить поле в сущность

1. Поле в классе в `Models/`, при необходимости — в DTO ответа.
2. SQL Server: `dotnet ef migrations add …`.
3. SQLite: удалите локальный `maintar.db` (см. раздел 5).
4. Отобразите поле в `App.js`.

### Добавить эндпоинт

1. Метод в контроллере. Рабочий функционал — под `[Authorize(Policy = "EmailVerified")]`.
2. Проверьте в Swagger.
3. Функция в `frontend/src/api.js`, вызов из экрана.
4. Строка в таблицу API выше.

### Добавить класс дефекта в ИИ

1. Обучите модель с новым классом (репозиторий обучения).
2. В `app.py`: класс в нужный набор `PLAN`, тексты в `TEXT` и `NAME`, ключевые слова в `CODE_KEYS` и `COMP_KEYS`.
3. В сидере — `DefectType` с подходящим кодом у нужных типов оборудования.

---

## 9. Известные проблемы

| Симптом | Причина | Что делать |
|---|---|---|
| `FileLoadException ... 0x800711C7` при запуске сервера | Windows Smart App Control блокирует Debug-сборку | удалить `bin/` и `obj/`; если не помогло — `dotnet run -c Release ...` |
| `python` открывает Microsoft Store | алиас Store вместо Python | использовать `py`, либо отключить алиас в «Параметрах → Приложения → Псевдонимы» |
| Новое поле модели не сохраняется, ошибка `no such column` | SQLite создан `EnsureCreated` до изменения модели | удалить `maintar.db` |
| Письмо с кодом не приходит | тестовый токен Resend шлёт только владельцу аккаунта | в Development взять код из консоли сервера |
| Телефон не видит сервер | брандмауэр или неверный IP в `.env` | `netsh advfirewall firewall add rule name="MaintAR" dir=in action=allow protocol=TCP localport=8081,5176,8000 profile=private,public` |
| Осмотр со статусом «Анализ не выполнен» | сервис ИИ не запущен, упал или ответ превысил 60 с | проверить окно ИИ и `GET http://localhost:8000/health`; ошибка — в логе сервера |
| Первый анализ очень долгий | загрузка моделей и работа на CPU | нормально; на GPU в разы быстрее |

---

## 10. Правила работы с репозиторием

- **Не коммитьте секреты**: `appsettings.Local.json`, `.env` с реальными адресами, токены. Перед коммитом смотрите `git status`.
- **Не коммитьте** `maintar.db`, `wwwroot/uploads/`, `bin/`, `obj/`, `node_modules/`, `.venv/`, `__pycache__/`.
- Веса моделей (`*.pt`) лежат в git намеренно — проект должен запускаться сразу после клонирования. Не добавляйте промежуточные чекпоинты, только итоговые `basic.pt` и `expanded.pt`.
- Ветка `main` должна запускаться через `start-all.bat` на чистом клоне. Перед пушем проверьте:
  1. сервер собирается: `dotnet build`;
  2. демо-вход `demo` / `demo12345` работает;
  3. `MOTOR-001` открывается, осмотр по фото проходит со статусом «Готово».
