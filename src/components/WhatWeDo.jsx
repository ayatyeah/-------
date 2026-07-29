import { Link } from 'react-router-dom'
import Icon from './Icon'
import Reveal from './Reveal'

/**
 * «Что мы делаем» — первый содержательный экран после героя.
 * Задача: за пять секунд объяснить, чем занимается компания,
 * без длинных текстов. Слева — цикл работы, справа — что выпускаем,
 * с живым числом моделей из каталога.
 */

const CYCLE = [
  { icon: 'factory', t: 'Производим', p: 'Льём узлы, собираем и красим на своём заводе' },
  { icon: 'compass', t: 'Подбираем', p: 'Считаем технику под ваши гектары и культуры' },
  { icon: 'truck', t: 'Поставляем', p: 'Привозим в хозяйство, запускаем, обучаем' },
  { icon: 'wrench', t: 'Обслуживаем', p: 'Сервис в поле и запчасти со склада' },
]

/**
 * Значок категории.
 *
 * Раньше здесь был жёсткий список идентификаторов из seed.js, и любая
 * созданная заказчиком категория оставалась без картинки — блок молча
 * рисовал пустое место. Теперь значок хранится в самой категории и
 * выбирается в админке; список ниже нужен лишь для данных, созданных до
 * этой правки.
 */
const CAT_ICON = {
  traktory: 'tractor',
  kombayny: 'combine',
  posev: 'seeder',
  pochva: 'harrow',
}
const иконкаКатегории = (c) => c.icon || CAT_ICON[c.id] || 'gear'

export default function WhatWeDo({ models = [], categories = [] }) {
  // Считаем модели по категориям — цифры всегда честные, из каталога.
  const cats = categories
    .map((c) => ({ ...c, count: models.filter((m) => m.cat === c.id).length }))
    .filter((c) => c.count > 0)

  return (
    <section className="section wwd">
      <div className="wrap">
        <Reveal as="span" className="kicker">
          Чем мы занимаемся
        </Reveal>
        <Reveal as="h2" className="wwd-title" delay={60}>
          Делаем сельхозтехнику и ведём её весь срок службы
        </Reveal>

        <div className="wwd-grid">
          {/* Цикл: четыре шага, по одной строке на каждый */}
          <Reveal className="wwd-cycle" variant="left" delay={120}>
            {CYCLE.map((s) => (
              <div className="wwd-step" key={s.t}>
                <div className="wwd-step-ico">
                  <Icon name={s.icon} size={20} />
                </div>
                <div>
                  <h3>{s.t}</h3>
                  <p>{s.p}</p>
                </div>
              </div>
            ))}
          </Reveal>

          {/* Что выпускаем: категории с числом моделей */}
          <Reveal className="wwd-make" variant="right" delay={180}>
            <div className="wwd-make-head">Что выпускаем</div>
            <div className="wwd-cats">
              {cats.map((c) => (
                <Link className="wwd-cat" to={`/catalog?cat=${c.id}`} key={c.id}>
                  <Icon name={иконкаКатегории(c)} size={26} />
                  <span className="wwd-cat-name">{c.name}</span>
                  <span className="wwd-cat-count">
                    {c.count} {c.count === 1 ? 'модель' : c.count < 5 ? 'модели' : 'моделей'}
                  </span>
                </Link>
              ))}
            </div>
            <Link to="/catalog" className="btn btn-primary btn-block wwd-cta">
              Весь каталог
            </Link>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
