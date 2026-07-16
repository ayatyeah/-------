import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useSite } from '../store'
import { useScrolled } from '../hooks/useMotion'
import Icon from './Icon'

const LINKS = [
  { to: '/catalog', label: 'Каталог' },
  { to: '/about', label: 'О компании' },
  { to: '/news', label: 'Новости' },
  { to: '/contacts', label: 'Контакты' },
]

export default function Navbar() {
  const { settings, openKP } = useSite()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const scrolled = useScrolled()
  const telHref = `tel:${settings.phone.replace(/[^\d+]/g, '')}`

  // Закрываем мобильное меню при переходе.
  const close = () => setOpen(false)

  return (
    <nav className={`nav${scrolled ? ' is-scrolled' : ''}`}>
      <div className="nav-inner">
        <Link to="/" className="brand" onClick={close} aria-label="ТОО СХМ Агро — на главную">
          <img src="/assets/logo.png" alt="" width="46" height="46" />
          ТОО СХМ Агро
        </Link>

        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} className="navlink hide-sm">
            {l.label}
          </NavLink>
        ))}

        <a className="nav-phone hide-sm" href={telHref}>
          {settings.phone}
        </a>

        <button type="button" className="btn btn-primary btn-sm hide-sm" onClick={() => openKP()}>
          Получить КП
        </button>

        <NavLink to="/admin" className="navlink nav-admin hide-sm">
          Админка
        </NavLink>

        {/* Когда меню сворачивается в бургер, звонок должен остаться под рукой. */}
        <a className="nav-phone-sm" href={telHref} aria-label={`Позвонить ${settings.phone}`}>
          <Icon name="phone" size={18} />
        </a>

        <button
          type="button"
          className="nav-burger"
          aria-label="Меню"
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
            {l.label}
          </NavLink>
        ))}
        <NavLink to="/admin" className="navlink" onClick={close}>
          Админка
        </NavLink>
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
          Получить КП
        </button>
      </div>
    </nav>
  )
}
