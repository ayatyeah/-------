import Reveal from './Reveal'
import { useT } from '../i18n'

/**
 * «Как мы работаем» — путь от заявки до сервиса.
 * Номера шагов рисует CSS-счётчик, в разметке их нет.
 * Тексты — в словарях (src/locales), ключи step_Nt / step_Np.
 */
const STEPS = [1, 2, 3, 4]

export default function Steps() {
  const { t } = useT()
  return (
    <section className="section">
      <div className="wrap">
        <Reveal as="span" className="kicker">
          {t('steps_kicker')}
        </Reveal>
        <div className="section-head">
          <div>
            <Reveal as="h2" delay={60}>
              {t('steps_title')}
            </Reveal>
            <Reveal as="p" className="lead" delay={120} style={{ marginTop: 12 }}>
              {t('steps_lead')}
            </Reveal>
          </div>
        </div>

        <div className="steps">
          {STEPS.map((n, i) => (
            <Reveal className="step" key={n} delay={i * 100}>
              <h3>{t(`step_${n}t`)}</h3>
              <p>{t(`step_${n}p`)}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
