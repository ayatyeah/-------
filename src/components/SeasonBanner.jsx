import { useSite } from '../store'

/**
 * Сезонная строка над каталогом/карточкой модели (задача 10) — включается
 * и выключается вручную в админке на время посевной/уборочной. Пока не
 * включена явно или текст не задан, ничего не рендерим — ни пустой
 * плашки, ни заготовки.
 */
export default function SeasonBanner() {
  const { settings } = useSite()
  if (settings.season_banner_enabled !== '1' || !settings.season_banner_text) return null

  return (
    <div className="season-banner">
      <div className="wrap">{settings.season_banner_text}</div>
    </div>
  )
}
