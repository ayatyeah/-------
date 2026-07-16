/**
 * Готовит данные сайта: создаёт data/store.json из начальных данных
 * (server/seed.js) и перезаписывает его, если он уже есть.
 *
 * Запуск: npm run init-db
 *
 * Базы данных у проекта сейчас нет — всё хранится в файлах внутри проекта,
 * поэтому команда просто сбрасывает контент к исходному состоянию.
 * Сервер и без неё поднимется: при первом старте store.json создастся сам.
 */
import * as store from './store.js'
import * as seed from './seed.js'

console.log('→ Файл данных:', store.STORE_PATH)

const c = store.reset()

console.log('→ Данные загружены:')
console.log(`   категорий   ${c.categories}`)
console.log(`   моделей     ${c.models}`)
console.log(`   новостей    ${c.news}`)
console.log(`   услуг       ${c.services}`)
console.log(`   сертификатов ${c.certs}`)
console.log(`   показателей ${c.stats}`)
console.log(`   заявок      ${c.requests}`)
console.log(`   настроек    ${c.settings}`)

console.log('\n✓ Готово. Запустите: npm run dev:server  и  npm run dev:client')
// Сервер держит данные в памяти, поэтому на уже запущенный он не посмотрит.
console.log('  Если сервер сейчас запущен — перезапустите его, иначе увидите старые данные.')

const pw = process.env.ADMIN_PASSWORD || seed.settings.admin_password
console.log(`  Вход в админку — пароль: ${pw}`)
if (pw === 'admin') {
  console.log('  ⚠ Пароль стандартный. Перед публикацией смените ADMIN_PASSWORD в .env')
}

if (process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY) {
  const engine = process.env.GEMINI_API_KEY ? 'Gemini' : 'OpenAI'
  console.log(`\n  ИИ подключён (${engine}): чат на главной и анализатор лидов в админке.`)
} else {
  console.log('\n  ИИ не подключён — чат и анализатор лидов работают на правилах.')
  console.log('  Чтобы включить: добавьте GEMINI_API_KEY или OPENAI_API_KEY в .env')
}
