import { Link } from 'react-router-dom'
import { useSite } from '../store'
import Icon from './Icon'
import { useT } from '../i18n'

const SOCIAL = [
  { key: 'instagram_url', name: 'Instagram' },
  { key: 'telegram_url', name: 'Telegram' },
  { key: 'whatsapp_url', name: 'WhatsApp' },
]

export default function Footer() {
  const { settings, openCall } = useSite()
  const { t } = useT()
  const telHref = `tel:${settings.phone.replace(/[^\d+]/g, '')}`

  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <div className="footer-brand">
            <img src="/assets/logo.png" alt="" width="46" height="46" />
            {t('brand')}
          </div>
          <p>{t('footer_tagline')} {settings.address}.</p>
          {/* Реквизиты появляются, только когда заполнены в админке. */}
          {(settings.legal_name || settings.bin) && (
            <p className="footer-legal">
              {settings.legal_name}
              {settings.legal_name && settings.bin ? ', ' : ''}
              {settings.bin ? `${t('r_bin')} ${settings.bin}` : ''}
            </p>
          )}
        </div>

        <div>
          <div className="footer-col-title">{t('footer_sections')}</div>
          <div className="footer-links">
            <Link to="/catalog">{t('nav_catalog')}</Link>
            <Link to="/about">{t('nav_about')}</Link>
            <Link to="/news">{t('nav_news')}</Link>
            <Link to="/contacts">{t('nav_contacts')}</Link>
          </div>
        </div>

        <div>
          <div className="footer-col-title">{t('footer_contacts')}</div>
          <div className="footer-links">
            <a href={telHref}>{settings.phone}</a>
            <a href={`mailto:${settings.email}`}>{settings.email}</a>
            <a href={settings.leasing_url} target="_blank" rel="noopener noreferrer">
              {t('footer_leasing')}
            </a>
            <a href={settings.subsidy_url} target="_blank" rel="noopener noreferrer">
              {t('footer_subsidy')}
            </a>
          </div>
        </div>

        <div>
          <button type="button" className="btn btn-brass btn-block" onClick={openCall}>
            {t('call_order')}
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
          <span>© {new Date().getFullYear()} {settings.legal_name || 'ТОО «СХМ Агро»'}. {t('footer_rights')}</span>
          <div className="footer-bottom-links">
            <Link to="/privacy">{t('footer_privacy')}</Link>
            <Link to="/terms">{t('footer_terms')}</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
