import { Link } from 'react-router-dom'
import { useSite } from '../store'
import Icon from './Icon'

const SOCIAL = [
  { key: 'instagram_url', name: 'Instagram' },
  { key: 'telegram_url', name: 'Telegram' },
  { key: 'whatsapp_url', name: 'WhatsApp' },
]

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
          {/* Значок появляется только когда адрес задан в админке.
              Ссылка, которая никуда не ведёт, хуже её отсутствия: человек
              жмёт и решает, что сайт сломан. */}
          <div className="footer-social">
            {SOCIAL.map(({ key, name }) =>
              settings[key] ? (
                <a
                  key={key}
                  href={settings[key]}
                  aria-label={name}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name={name.toLowerCase()} size={19} />
                </a>
              ) : null
            )}
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        {/* Год берём текущий, чтобы подвал не устарел первого января. */}
        <div className="footer-bottom-inner">
          <span>© {new Date().getFullYear()} ТОО «СХМ Агро». Все права защищены.</span>
          <Link to="/privacy">Политика конфиденциальности</Link>
        </div>
      </div>
    </footer>
  )
}
