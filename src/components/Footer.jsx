import { Link } from 'react-router-dom'
import { useSite } from '../store'

export default function Footer() {
  const { settings, openCall } = useSite()
  const telHref = `tel:${settings.phone.replace(/[^\d+]/g, '')}`

  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <div className="footer-brand">
            <img src="/assets/logo.png" alt="" width="46" height="46" />
            ТОО СХМ Агро
          </div>
          <p>Производство и продажа сельхозтехники. {settings.address}.</p>
        </div>

        <div>
          <div className="footer-col-title">Разделы</div>
          <div className="footer-links">
            <Link to="/catalog">Каталог</Link>
            <Link to="/about">О компании</Link>
            <Link to="/news">Новости</Link>
            <Link to="/contacts">Контакты</Link>
          </div>
        </div>

        <div>
          <div className="footer-col-title">Контакты</div>
          <div className="footer-links">
            <a href={telHref}>{settings.phone}</a>
            <a href={`mailto:${settings.email}`}>{settings.email}</a>
            <a href={settings.leasing_url} target="_blank" rel="noopener noreferrer">
              КазАгроФинанс
            </a>
            <a href={settings.subsidy_url} target="_blank" rel="noopener noreferrer">
              ГосАгро (субсидии)
            </a>
          </div>
        </div>

        <div>
          <button type="button" className="btn btn-brass btn-block" onClick={openCall}>
            Заказать звонок
          </button>
          <div className="footer-social">
            <a href="#" aria-label="Instagram">IG</a>
            <a href="#" aria-label="Telegram">TG</a>
            <a href="#" aria-label="WhatsApp">WA</a>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <div className="footer-bottom-inner">© 2026 ТОО «СХМ Агро». Прототип интерфейса.</div>
      </div>
    </footer>
  )
}
