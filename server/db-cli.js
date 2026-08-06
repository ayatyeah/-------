/**
 * Ручные операции с базой данных. Нужны редко — в основном при первом
 * переезде на сервер и при разборе аварий.
 *
 *   npm run db:status   — что в базе: доступна ли, сколько чего лежит
 *   npm run db:import   — залить data/store.json в базу (файл → база)
 *   npm run db:export   — выгрузить базу в data/store.json (база → файл)
 *
 * Почему отдельный скрипт, а не кнопки в админке: он рассчитан на
 * ОСТАНОВЛЕННЫЙ сайт. Живой сайт держит данные в памяти и перезапишет
 * store.json своей копией, если тронуть файл у него под руками. Для
 * операций на работающем сайте есть безопасная кнопка «перелить заново»
 * в админке — она приводит базу к тому, что сайт показывает сейчас.
 *
 * На сервере:
 *     docker compose stop web
 *     docker compose run --rm --entrypoint "" web node server/db-cli.js export
 *     docker compose start web
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import * as db from './db.js'
import * as store from './store.js'

const ПУТЬ = store.STORE_PATH

const печатьСчётчиков = (c) => {
  for (const [k, v] of Object.entries(c)) console.log(`  ${String(k).padEnd(12)} ${v}`)
}

async function статус() {
  const c = await db.countsForCli()
  console.log('База данных доступна. Строк в таблицах:')
  печатьСчётчиков(c)

  console.log(`\nФайл ${ПУТЬ}: ${existsSync(ПУТЬ) ? 'на месте' : 'ОТСУТСТВУЕТ'}`)
  if (existsSync(ПУТЬ)) {
    try {
      const d = JSON.parse(readFileSync(ПУТЬ, 'utf8'))
      console.log(
        `  моделей ${d.models?.length ?? 0}, новостей ${d.news?.length ?? 0}, заявок ${d.requests?.length ?? 0}`
      )
    } catch (e) {
      console.log(`  ⚠ не читается: ${e.message}`)
    }
  }
  return 0
}

async function импорт() {
  if (!existsSync(ПУТЬ)) {
    console.error(`Файл ${ПУТЬ} не найден — переносить нечего.`)
    return 1
  }
  const { seeded } = store.load()
  if (seeded) {
    console.error('Файл не читается — в базу уехали бы демо-данные. Отказываюсь.')
    return 1
  }

  console.log(`Переношу ${ПУТЬ} → PostgreSQL…`)
  // DB_SOURCE=json заставляет слой считать файл главным независимо от того,
  // что уже лежит в базе. Это и означает «залить из файла».
  process.env.DB_SOURCE = 'json'
  await db.start({ seeded: false })
  await db.flushNow()

  const s = db.status()
  if (s.state !== 'up') {
    console.error(`База недоступна: ${s.lastError || 'причина неизвестна'}`)
    return 1
  }
  console.log('Готово. В базе:')
  печатьСчётчиков(await db.countsForCli())
  return 0
}

async function экспорт() {
  const данные = await db.readAllForCli()
  const моделей = данные.models?.length ?? 0
  const заявок = данные.requests?.length ?? 0
  const настроек = Object.keys(данные.settings || {}).length

  if (!моделей && !заявок && !настроек) {
    console.error('В базе пусто — выгружать нечего. Файл не трогаю.')
    return 1
  }

  /* Прежний файл не перезаписываем молча: если выгрузка окажется не той,
     вернуть будет уже нечего. */
  if (existsSync(ПУТЬ)) {
    const копия = `${ПУТЬ}.before-export-${Date.now()}`
    copyFileSync(ПУТЬ, копия)
    console.log(`Прежний файл сохранён как ${копия}`)
  }

  /* Пишем как есть. Недостающие поля (снимок мог быть снят прежней версией
     сайта) достроит migrate() при ближайшей загрузке — тот же путь, что и
     для любого старого store.json. */
  writeFileSync(ПУТЬ, JSON.stringify(данные, null, 2), 'utf8')
  console.log(`Готово: ${ПУТЬ} — моделей ${моделей}, заявок ${заявок}, настроек ${настроек}`)
  return 0
}

async function main() {
  const команда = (process.argv[2] || 'status').toLowerCase()

  if (!db.configured()) {
    console.error('DATABASE_URL не задан — работать не с чем.')
    console.error('Задайте его в .env, например:')
    console.error('  DATABASE_URL=postgres://shmagro:пароль@postgres:5432/shmagro')
    return 1
  }

  if (команда === 'status') return статус()
  if (команда === 'import') return импорт()
  if (команда === 'export') return экспорт()

  console.error(`Неизвестная команда: ${команда}`)
  console.error('Доступно: status | import | export')
  return 1
}

let код = 1
try {
  код = await main()
} catch (e) {
  console.error('Ошибка:', e.message)
  код = 1
}
await db.close().catch(() => {})
process.exit(код)
