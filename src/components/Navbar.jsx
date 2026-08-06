import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useSite } from '../store'
import { useScrolled } from '../hooks/useMotion'
import Icon from './Icon'
import LangSwitcher from './LangSwitcher'
import { useT } from '../i18n'

/* Ссылки на админку в этом меню нет и быть не должно.
   Раньше «Админка» стояла рядом с «Контактами» — то есть каждому
   посетителю показывали, где вход в панель управления. Это не защита
   (адрес /admin легко угадать), но приглашение: подобрать пароль пробует
   тот, кто видит форму входа, а не тот, кто о ней не думал.
   Владелец заходит по прямому адресу /admin и держит его в закладке. */

// label — ключ словаря: подписи переводятся вместе с языком сайта.
const LINKS = [
  { to: '/catalog', label: 'nav_catalog' },
  { to: '/about', label: 'nav_about' },
  { to: '/news', label: 'nav_news' },
  { to: '/contacts', label: 'nav_contacts' },
]

export default function Navbar() {
  const { settings, openKP } = useSite()
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const scrolled = useScrolled()
  const telHref = `tel:${settings.phone.replace(/[^\d+]/g, '')}`

  // Закрываем мобильное меню при переходе.
  const close = () => setOpen(false)

  return (
    <nav className={`nav${scrolled ? ' is-scrolled' : ''}`}>
      <div className="nav-inner">
        <Link to="/" className="brand" onClick={close} aria-label={t('nav_home_aria')}>
          <img src="/assets/logo.png" alt="" width="46" height="46" />
          {t('brand')}
        </Link>

        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} className="navlink hide-sm">
            {t(l.label)}
          </NavLink>
        ))}

        <span className="hide-sm">
          <LangSwitcher />
        </span>

        <a className="nav-phone hide-sm" href={telHref}>
          {settings.phone}
        </a>

        <button type="button" className="btn btn-primary btn-sm hide-sm" onClick={() => openKP()}>
          {t('get_kp')}
        </button>

        {/* Когда меню сворачивается в бургер, звонок должен остаться под рукой. */}
        <a className="nav-phone-sm" href={telHref} aria-label={`${t('nav_call_aria')} ${settings.phone}`}>
          <Icon name="phone" size={18} />
        </a>

        <button
          type="button"
          className="nav-burger"
          aria-label={t('nav_menu')}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      <div className={`nav-mobile${open ? ' open' : ''}`} key={location.pathname}>
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} className="navlink" onClick={close}>
            {t(l.label)}
          </NavLink>
        ))}
        <a className="navlink" href={telHref}>
          {settings.phone}
        </a>
        <button
          type="button"
          className="btn btn-primary btn-block"
          style={{ marginTop: 10 }}
          onClick={() => {
            close()
            openKP()
          }}
        >
          {t('get_kp')}
        </button>
        <LangSwitcher block />
      </div>
    </nav>
  )
}
