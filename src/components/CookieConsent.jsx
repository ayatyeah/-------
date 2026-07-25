import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

/*
 * Баннер согласия на использование данных в браузере.
 *
 * Честно о главном: сейчас сайт НЕ ставит ни трекинговых, ни рекламных cookie
 * и не следит за посетителями. Единственное, что попадает в браузер, —
 * техническое: ключ входа сотрудника в админку и вот эта самая отметка о
 * выборе. Для такого хранилища закон требует уведомления, а не разрешения,
 * поэтому баннер именно уведомляет и предлагает подтвердить.
 *
 * Но сделан он с заделом: как только появится аналитика (Google Analytics,
 * пиксель и т.п.), её скрипты нужно оборачивать в hasAnalyticsConsent() и
 * подключать ТОЛЬКО когда он вернул true. Тогда «Только необходимые» станет
 * настоящим отказом от слежки, а не формальностью.
 */

const KEY = 'shm_cookie_consent'
const VERSION = 1 // поднимите, если изменится состав cookie — баннер покажется снова

/** Дал ли посетитель согласие на аналитику. Пока аналитики нет — задел на будущее. */
export function hasAnalyticsConsent() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    return v?.version === VERSION && v?.analytics === true
  } catch {
    return false
  }
}

function save(analytics) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ version: VERSION, analytics, at: new Date().toISOString() })
    )
  } catch {
    /* приватный режим без localStorage — не показываем баннер повторно в рамках сессии */
  }
}

export default function CookieConsent() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // Показываем, только если человек ещё не отвечал в текущей версии.
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null')
      if (v?.version !== VERSION) setOpen(true)
    } catch {
      setOpen(true)
    }
  }, [])

  if (!open) return null

  const decide = (analytics) => {
    save(analytics)
    setOpen(false)
  }

  return (
    <div className="cookie" role="dialog" aria-label="Использование данных" aria-live="polite">
      <div className="cookie-inner">
        <div className="cookie-text">
          <b>Данные в браузере.</b> Сайт использует только необходимое для работы
          хранилище и не ведёт рекламной или аналитической слежки.{' '}
          <Link to="/privacy" target="_blank" rel="noopener noreferrer">
            Политика конфиденциальности
          </Link>
          .
        </div>
        <div className="cookie-actions">
          {/* Обе кнопки сейчас делают одно и то же (слежки нет). «Только
              необходимые» останется рабочим отказом, когда добавят аналитику. */}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => decide(false)}>
            Только необходимые
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => decide(true)}>
            Принять
          </button>
        </div>
      </div>
    </div>
  )
}
