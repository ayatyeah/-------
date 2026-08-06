/**
 * Уведомление о новой заявке в Telegram.
 *
 * Зачем: заявка попадает в store.json, но пока никто не откроет админку,
 * о ней никто не знает. Для сайта, который собирает лиды, это главная
 * операционная дыра — клиент ждёт звонка, а заявку никто не видел.
 *
 * Telegram выбран намеренно: обычный HTTPS-запрос через fetch, без SMTP,
 * без библиотек, без аккаунтов у почтовых сервисов. Настройка — две
 * переменные в .env (как их получить, написано в .env.example).
 *
 * Важно про закон: сами персональные данные остаются в базе на сервере в
 * РК. В Telegram уходит только сигнал «пришла заявка» с минимумом для
 * связи — этого достаточно, чтобы менеджер открыл админку и перезвонил.
 */

const token = () => process.env.TELEGRAM_BOT_TOKEN || ''
const chatId = () => process.env.TELEGRAM_CHAT_ID || ''

export const notifyEnabled = () => !!token() && !!chatId()

/**
 * Шлёт сообщение о заявке. Никогда не бросает исключение: сбой Telegram не
 * должен мешать приёму заявки — она уже сохранена. Ошибку только логируем.
 */
export async function notifyNewRequest(r) {
  if (!notifyEnabled()) return

  const lines = [
    '🔔 Новая заявка на сайте',
    '',
    `Тип: ${r.type}`,
    `Имя: ${r.fio}`,
    `Телефон: ${r.phone}`,
    r.meta && r.meta !== '—' ? `Детали: ${r.meta}` : '',
    r.comment ? `Комментарий: ${r.comment}` : '',
    '',
    'Открыть админку и перезвонить.',
  ].filter(Boolean)

  await notifyText(lines.join('\n'))
}

/**
 * Произвольное техническое сообщение тем же каналом.
 *
 * Появилось ради состояния базы данных: сайт продолжает работать и без
 * неё, поэтому посетитель проблемы не увидит — и владелец не увидит тоже,
 * пока не понадобится выгрузка. Один сигнал в тот же чат закрывает разрыв.
 *
 * Как и уведомление о заявке, ничего не бросает: сбой Telegram — не повод
 * ронять то, ради чего мы его звали.
 *
 * Одинаковые сообщения подряд не шлём. База, которая моргает раз в минуту,
 * иначе превратила бы чат заявок в поток одинаковых строк, и настоящие
 * заявки в нём бы потерялись.
 */
let последнее = ''
let последнееВремя = 0
const ПОВТОР_МС = 10 * 60 * 1000

export async function notifyText(text, { dedupe = true } = {}) {
  if (!notifyEnabled()) return
  const msg = String(text || '').slice(0, 3500)
  if (!msg) return

  if (dedupe && msg === последнее && Date.now() - последнееВремя < ПОВТОР_МС) return
  последнее = msg
  последнееВремя = Date.now()

  try {
    const res = await fetch(`https://api.telegram.org/bot${token()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId(),
        text: msg,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.warn('Telegram не принял уведомление:', res.status, (await res.text()).slice(0, 120))
    }
  } catch (e) {
    console.warn('Не удалось отправить уведомление в Telegram:', e.message?.slice(0, 100))
  }
}
