const KEY = 'shm_attribution'

/**
 * Метки перехода — откуда посетитель пришёл на сайт.
 *
 * Зовём один раз при полной загрузке страницы (см. App.jsx). Если в адресе
 * есть utm-метки — значит, это переход по рекламе или рассылке, и метки
 * запоминаем на вкладку (последний такой переход побеждает предыдущий).
 * Если меток нет, но это первая страница за вкладку и есть referrer —
 * запоминаем хотя бы его, ничего не перезаписывая при дальнейшей навигации
 * по самому сайту.
 */
export function captureAttribution() {
  const p = new URLSearchParams(window.location.search)
  const utmSource = p.get('utm_source') || ''
  const utmMedium = p.get('utm_medium') || ''
  const utmCampaign = p.get('utm_campaign') || ''

  if (utmSource || utmMedium || utmCampaign) {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ utmSource, utmMedium, utmCampaign, referrer: document.referrer || '' })
    )
  } else if (!sessionStorage.getItem(KEY) && document.referrer) {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ utmSource: '', utmMedium: '', utmCampaign: '', referrer: document.referrer })
    )
  }
}

/** Метки для заявки, отправляемой прямо сейчас: сохранённые utm/referrer
    плюс страница, с которой ушла форма. */
export function getAttribution() {
  let stored = {}
  try {
    stored = JSON.parse(sessionStorage.getItem(KEY) || '{}')
  } catch {
    stored = {}
  }
  return {
    utmSource: stored.utmSource || '',
    utmMedium: stored.utmMedium || '',
    utmCampaign: stored.utmCampaign || '',
    referrer: stored.referrer || '',
    page: window.location.pathname,
  }
}
