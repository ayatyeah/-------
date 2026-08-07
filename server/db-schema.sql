-- ============================================================================
--  Схема базы данных СХМ Агро.
--
--  Выполняется приложением при каждом старте (все команды идемпотентны:
--  IF NOT EXISTS). Отдельного шага «накатить миграции» нет и не нужно —
--  запустили контейнер, схема на месте.
--
--  ─── ПОЧЕМУ ТАБЛИЦЫ ВЫГЛЯДЯТ ИМЕННО ТАК ──────────────────────────────────
--  В каждой таблице есть колонка data типа jsonb — это полная запись ровно
--  в том виде, в каком она лежит в store.json и в памяти сервера. Она —
--  источник истины. Отдельные колонки рядом (cat, status, sort, phone…) —
--  производные от неё, их заполняет сервер при записи. Нужны они для двух
--  вещей: индексы и SQL-запросы человеком из psql.
--
--  Так сделано сознательно. Разложить запись по колонкам полностью — значит
--  переписать все 20 методов store.js и получить расхождение формы данных
--  между JSON-файлом и базой. Тогда откат на JSON (а он должен работать
--  всегда, см. server/db.js) перестал бы быть безопасным. Здесь же формат
--  один, и любую из двух копий можно взять как есть.
--
--  Расхождение data и производных колонок неопасно: читаем всегда data,
--  колонки участвуют только в WHERE и ORDER BY.
--  ─────────────────────────────────────────────────────────────────────────
-- ============================================================================

-- ------------------------------- служебное ---------------------------------

-- Отметки состояния: когда была последняя сверка, откуда поднимались,
-- какая версия схемы. Смотреть: select * from store_meta;
CREATE TABLE IF NOT EXISTS store_meta (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Мелкие документы, которые в JSON лежат не списком записей, а одним
-- значением: список регионов (массив строк) и хэш пароля админки.
-- Заводить под них по таблице не за чем — читать и писать их всё равно
-- целиком.
CREATE TABLE IF NOT EXISTS kv (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------- справочники --------------------------------

CREATE TABLE IF NOT EXISTS categories (
  id         text PRIMARY KEY,
  name       text,
  sort       integer,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS categories_sort_idx ON categories (sort);

CREATE TABLE IF NOT EXISTS services (
  id         text PRIMARY KEY,
  title      text,
  sort       integer,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS services_sort_idx ON services (sort);

CREATE TABLE IF NOT EXISTS stats (
  id         text PRIMARY KEY,
  sort       integer,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stats_sort_idx ON stats (sort);

CREATE TABLE IF NOT EXISTS certs (
  id         text PRIMARY KEY,
  title      text,
  sort       integer,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS certs_sort_idx ON certs (sort);

CREATE TABLE IF NOT EXISTS service_centers (
  id         text PRIMARY KEY,
  name       text,
  sort       integer,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_centers_sort_idx ON service_centers (sort);

-- ------------------------------- каталог ------------------------------------

CREATE TABLE IF NOT EXISTS models (
  id         text PRIMARY KEY,
  cat        text,
  name       text,
  sort       integer,
  published  boolean,
  subsidized boolean,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS models_cat_idx       ON models (cat);
CREATE INDEX IF NOT EXISTS models_published_idx ON models (published, sort);
-- Под будущий текстовый поиск по каталогу (задача 9 из перечня доработок).
-- Индекс по jsonb целиком: сразу закрывает и поиск по названию, и по
-- характеристикам, не требуя разбирать спеки по колонкам.
CREATE INDEX IF NOT EXISTS models_data_gin_idx  ON models USING gin (data jsonb_path_ops);

CREATE TABLE IF NOT EXISTS news (
  id         text PRIMARY KEY,
  date       text,
  title      text,
  published  boolean,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS news_date_idx ON news (date DESC);

-- ------------------------------- заявки -------------------------------------

-- Самая ценная таблица: здесь живут обращения клиентов. Индексы поставлены
-- под то, ради чего заявки читают, — свежие сверху, разрезы по статусу и
-- поиск дублей по телефону (задача 4 из перечня доработок).
CREATE TABLE IF NOT EXISTS requests (
  id         text PRIMARY KEY,
  date       text,
  created_at timestamptz,
  status     text,
  type       text,
  fio        text,
  phone      text,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS requests_created_idx ON requests (created_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS requests_status_idx  ON requests (status);
CREATE INDEX IF NOT EXISTS requests_phone_idx   ON requests (phone);
CREATE INDEX IF NOT EXISTS requests_date_idx    ON requests (date);

-- ------------------------------- прочее -------------------------------------

-- Опись загруженных через админку картинок. Ключ — имя файла на диске:
-- оно уникально и по нему же файл удаляют.
CREATE TABLE IF NOT EXISTS media (
  name       text PRIMARY KEY,
  path       text,
  size       bigint,
  at         text,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_at_idx ON media (at DESC);

-- Настройки сайта: телефон, адрес, тексты главной. Плоские строки, поэтому
-- отдельная таблица ключ-значение читается человеком лучше, чем один jsonb.
CREATE TABLE IF NOT EXISTS settings (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Счётчик визитов по дням. Никаких адресов и идентификаторов посетителей —
-- только число за день, как и было в JSON.
CREATE TABLE IF NOT EXISTS visits (
  day   text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0
);

-- Кэш ответов ИИ. Живёт в базе, чтобы не платить за один и тот же вопрос
-- после каждого деплоя.
CREATE TABLE IF NOT EXISTS ai_cache (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  saved_at   bigint,
  expires_at bigint
);
CREATE INDEX IF NOT EXISTS ai_cache_saved_idx ON ai_cache (saved_at);
