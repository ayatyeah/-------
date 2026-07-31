import Reveal from './Reveal'
import Icon from './Icon'
import { useT } from '../i18n'

/* Три этапа — ровно те, что заявлены в тексте о компании: «льём узлы,
   собираем, красим и обкатываем на своём полигоне». Раньше здесь стояли
   пустые плашки под фото цеха; фотографий нет до сих пор, поэтому главную
   мысль — делаем сами — держит текст, а не картинка. */
/* t/p — ключи словаря (src/locales/*): stage_1t..stage_3p. */
const STAGES = [
  { icon: 'factory', t: 'stage_1t', p: 'stage_1p' },
  { icon: 'shield', t: 'stage_2t', p: 'stage_2p' },
  { icon: 'compass', t: 'stage_3t', p: 'stage_3p' },
]

/**
 * «Цех, а не перепродажа» — тёмная глава посреди светлой ленты.
 *
 * Блок стоит и на главной, и в «О компании». Раньше он был скопирован в оба
 * файла вместе с данными и при любой правке разъезжался — теперь один
 * источник.
 *
 * @param {boolean} quote  Показывать ли цитату директора в конце. На главной
 *   она закрывает главу («не перекупщики» и «не продаём лишнего» — одна
 *   мысль, врозь звучали слабее). В «О компании» ниже своя линия
 *   повествования, и цитата там перебивала бы её.
 */
export default function Production({ quote = false }) {
  const { t } = useT()
  return (
    <section className="band band--dark" id="production">
      <div className="wrap">
        <Reveal as="span" className="kicker kicker--light">
          {t('prod_kicker')}
        </Reveal>
        <div className="section-head">
          <div>
            <Reveal as="h2" delay={60}>
              {t('prod_title')}
            </Reveal>
            <Reveal as="p" className="lead" delay={120} style={{ marginTop: 12 }}>
              {t('prod_lead')}
            </Reveal>
          </div>
        </div>

        <div className="prod-grid">
          {STAGES.map((s, i) => (
            <Reveal className="prod-stage" key={s.t} delay={i * 110}>
              <span className="prod-stage-icon">
                <Icon name={s.icon} size={24} />
              </span>
              <span className="prod-stage-num">{t('prod_stage')} {String(i + 1).padStart(2, '0')}</span>
              <h3>{t(s.t)}</h3>
              <p>{t(s.p)}</p>
            </Reveal>
          ))}
        </div>

        {quote && (
          <Reveal className="pullquote pullquote--bare" delay={160}>
            <p>{t('prod_quote')}</p>
            <div className="pullquote-by">{t('prod_quote_by')}</div>
          </Reveal>
        )}
      </div>
    </section>
  )
}
