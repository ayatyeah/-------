import { useT } from '../i18n'

/**
 * Тип файла сертификата по его имени — только чтобы решить, как показать
 * превью: картинку — сразу как картинку, PDF — во встроенном просмотрщике
 * (его умеет любой современный браузер, без сторонних библиотек), DOC/DOCX —
 * никак: браузер их не отображает, только скачивает.
 */
export function certFileKind(name) {
  const ext = (name || '').split('.').pop()?.toLowerCase()
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (['doc', 'docx'].includes(ext)) return 'doc'
  return null
}

/**
 * Лайтбокс сертификата: карточка с печатью по умолчанию, а если приложен
 * файл — открывает его прямо тут, без перехода на новую вкладку.
 *
 * Фото и PDF показываются на месте (у PDF — встроенный просмотрщик
 * браузера через iframe). DOC/DOCX браузер отобразить не умеет в принципе —
 * для них только кнопка «Скачать» с атрибутом download: файл сохраняется,
 * а страница никуда не уходит.
 */
export default function CertLightbox({ cert, onClose }) {
  const { t, td } = useT()
  const kind = cert.file ? certFileKind(cert.fileName || cert.file) : null
  const showsMedia = kind === 'image' || kind === 'pdf'

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="lightbox" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-sheet">
          {kind === 'image' && (
            <img src={cert.file} alt={td(cert.title)} className="cert-preview-media" />
          )}
          {kind === 'pdf' && (
            <iframe src={cert.file} title={td(cert.title)} className="cert-preview-media" />
          )}
          {!showsMedia && (
            <>
              <div className="cert-seal" style={{ width: 54, height: 54, fontSize: 16 }}>
                СХМ
              </div>
              <div className="cert-title" style={{ fontSize: 24 }}>
                {td(cert.title)}
              </div>
              <div className="cert-org">{td(cert.org)}</div>
            </>
          )}
          {kind === 'doc' && (
            <a href={cert.file} download={cert.fileName || true} className="btn btn-secondary btn-sm">
              {t('cert_download')}
            </a>
          )}
        </div>
        <div className="lightbox-cap">
          <span style={{ fontSize: 14, color: 'var(--text-2)' }}>{td(cert.title)}</span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('close_x')}
          </button>
        </div>
      </div>
    </div>
  )
}
