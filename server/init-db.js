/**
 * Пересоздаёт базу данных и заполняет её начальными данными.
 * Запуск: npm run init-db
 */
import { db, SCHEMA, DB_PATH } from './db.js'
import * as seed from './seed.js'

console.log('→ База данных:', DB_PATH)

// Чистый старт: init-db всегда даёт предсказуемое состояние.
for (const t of [
  'requests',
  'stats',
  'certs',
  'services',
  'news',
  'models',
  'categories',
  'settings',
]) {
  db.exec(`DROP TABLE IF EXISTS ${t}`)
}
db.exec(SCHEMA)
console.log('→ Схема создана')

const insCat = db.prepare('INSERT INTO categories (id, name, sort) VALUES (?, ?, ?)')
for (const c of seed.categories) insCat.run(c.id, c.name, c.sort)

const insModel = db.prepare(
  `INSERT INTO models (id, name, cat, photo, short, descr, specs, subsidized, published, sort)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
)
for (const m of seed.models) {
  insModel.run(
    m.id, m.name, m.cat, m.photo, m.short, m.descr,
    JSON.stringify(m.specs), m.subsidized, m.sort
  )
}

const insNews = db.prepare(
  `INSERT INTO news (id, date, title, excerpt, body, cover, published)
   VALUES (?, ?, ?, ?, ?, ?, 1)`
)
for (const n of seed.news) {
  insNews.run(n.id, n.date, n.title, n.excerpt, JSON.stringify(n.body), n.cover)
}

const insCert = db.prepare('INSERT INTO certs (title, org, sort) VALUES (?, ?, ?)')
for (const c of seed.certs) insCert.run(c.title, c.org, c.sort)

const insSrv = db.prepare(
  'INSERT INTO services (id, icon, title, text, note, sort) VALUES (?, ?, ?, ?, ?, ?)'
)
for (const s of seed.services) insSrv.run(s.id, s.icon, s.title, s.text, s.note, s.sort)

const insStat = db.prepare('INSERT INTO stats (v, k, sort) VALUES (?, ?, ?)')
for (const s of seed.stats) insStat.run(s.v, s.k, s.sort)

const insReq = db.prepare(
  'INSERT INTO requests (id, date, type, fio, phone, meta, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
)
for (const r of seed.requests) {
  insReq.run(r.id, r.date, r.type, r.fio, r.phone, r.meta, r.status)
}

const insSet = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
for (const [k, v] of Object.entries(seed.settings)) {
  // Пароль админки берём из .env, если он там задан.
  insSet.run(k, k === 'admin_password' ? process.env.ADMIN_PASSWORD || v : v)
}

const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n

console.log('→ Данные загружены:')
console.log(`   категорий  ${count('categories')}`)
console.log(`   моделей    ${count('models')}`)
console.log(`   новостей   ${count('news')}`)
console.log(`   услуг      ${count('services')}`)
console.log(`   сертификат ${count('certs')}`)
console.log(`   показателей ${count('stats')}`)
console.log(`   заявок     ${count('requests')}`)
console.log(`   настроек   ${count('settings')}`)
console.log('\n✓ Готово. Запустите: npm run dev:server  и  npm run dev:client')

const pw = process.env.ADMIN_PASSWORD || seed.settings.admin_password
console.log(`  Вход в админку — пароль: ${pw}`)
if (pw === 'admin') {
  console.log('  ⚠ Пароль стандартный. Перед публикацией смените ADMIN_PASSWORD в .env')
}

db.close()
