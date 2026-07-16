import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Путь к базе можно переопределить через DB_PATH в .env
// (например, чтобы вынести файл на отдельный диск на сервере).
export const DB_PATH = process.env.DB_PATH
  ? resolve(process.env.DB_PATH)
  : join(__dirname, '..', 'data', 'shmagro.db')

mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

/**
 * Схема. Списочные поля (характеристики, абзацы статьи) хранятся как JSON-текст:
 * они всегда читаются и пишутся целиком вместе с родительской записью.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  sort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS models (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  cat         TEXT NOT NULL REFERENCES categories(id),
  photo       TEXT,
  short       TEXT NOT NULL DEFAULT '',
  descr       TEXT NOT NULL DEFAULT '',
  specs       TEXT NOT NULL DEFAULT '[]',
  subsidized  INTEGER NOT NULL DEFAULT 0,
  published   INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS news (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  title       TEXT NOT NULL,
  excerpt     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '[]',
  cover       TEXT,
  published   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS certs (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  org   TEXT NOT NULL DEFAULT '',
  sort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS services (
  id     TEXT PRIMARY KEY,
  icon   TEXT NOT NULL DEFAULT 'gear',
  title  TEXT NOT NULL,
  text   TEXT NOT NULL DEFAULT '',
  note   TEXT NOT NULL DEFAULT '',
  sort   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stats (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  v     TEXT NOT NULL,
  k     TEXT NOT NULL,
  sort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS requests (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  type        TEXT NOT NULL,
  fio         TEXT NOT NULL,
  phone       TEXT NOT NULL,
  meta        TEXT NOT NULL DEFAULT '—',
  comment     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'Новая',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_models_cat     ON models(cat);
CREATE INDEX IF NOT EXISTS idx_news_date      ON news(date DESC);
CREATE INDEX IF NOT EXISTS idx_requests_date  ON requests(created_at DESC);
`
