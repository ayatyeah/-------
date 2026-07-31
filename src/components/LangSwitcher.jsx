import { LANGS, useT } from '../i18n'

/**
 * Переключатель языка: Рус / Қаз / Eng.
 * Обычные кнопки, а не ссылки: у сайта один набор адресов, язык — состояние
 * интерфейса (см. src/i18n.jsx). aria-pressed говорит читалке, какой выбран.
 */
export default function LangSwitcher({ block = false }) {
  const { lang, setLang } = useT()
  return (
    <div className={`lang-switch${block ? ' lang-switch--block' : ''}`} role="group" aria-label="Язык / Тіл / Language">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          lang={l.code}
          className={`lang-btn${lang === l.code ? ' active' : ''}`}
          aria-pressed={lang === l.code}
          onClick={() => setLang(l.code)}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}
