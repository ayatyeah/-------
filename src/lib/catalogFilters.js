/**
 * Текстовый поиск и параметрические фильтры каталога (задача 9).
 *
 * Характеристики моделей — свободный текст («220 л.с.», «16 / 8, синхро»),
 * без единого формата и единиц измерения. Числовой диапазон предлагаем
 * только там, где у большинства значений действительно читается число в
 * начале строки; остальное — список конкретных значений (как в интернет-
 * магазинах: «Тип привода: 4×4 / 4×2»), а не выдуманная нормализация.
 */

/** «220 л.с.» → 220, «6,7 л» → 6.7, «16 / 8, синхро» → null (не число). */
export function leadingNumber(v) {
  const m = String(v ?? '')
    .trim()
    .match(/^-?\d+(?:[.,]\d+)?/)
  if (!m) return null
  return Number(m[0].replace(',', '.'))
}

const MAX_FACETS = 6

/**
 * Разрезы по характеристикам для текущего набора моделей (уже
 * отфильтрованного по категории — вне категории характеристики разных
 * типов техники всё равно не сравнить). Берёт до MAX_FACETS ключей,
 * встречающихся чаще всего, и только те, где значения вообще различаются.
 */
export function buildFacets(models) {
  const byKey = new Map() // key -> Map(value -> count)
  for (const m of models) {
    for (const s of m.specs || []) {
      if (!s.k || !s.v) continue
      if (!byKey.has(s.k)) byKey.set(s.k, new Map())
      const values = byKey.get(s.k)
      values.set(s.v, (values.get(s.v) || 0) + 1)
    }
  }

  const facets = []
  for (const [key, values] of byKey.entries()) {
    if (values.size < 2) continue // не варьируется — фильтровать нечего
    const distinct = [...values.keys()]
    const numbers = distinct.map(leadingNumber)
    const numericEnough = numbers.filter((n) => n != null).length / distinct.length >= 0.8

    if (numericEnough) {
      const nums = numbers.filter((n) => n != null)
      facets.push({ key, kind: 'range', min: Math.min(...nums), max: Math.max(...nums) })
    } else {
      facets.push({ key, kind: 'set', values: distinct.sort((a, b) => a.localeCompare(b, 'ru')) })
    }
  }

  // Чаще встречающийся параметр — выше и полезнее как фильтр.
  facets.sort((a, b) => {
    const countA = models.filter((m) => (m.specs || []).some((s) => s.k === a.key)).length
    const countB = models.filter((m) => (m.specs || []).some((s) => s.k === b.key)).length
    return countB - countA
  })

  return facets.slice(0, MAX_FACETS)
}

/** Значение характеристики key у модели m, если есть. */
const specValue = (m, key) => (m.specs || []).find((s) => s.k === key)?.v

/** Проходит ли модель через все активные фильтры по характеристикам.
    active: { [key]: { kind: 'range', min?, max? } | { kind: 'set', selected: Set } } */
export function matchesFacets(m, active) {
  for (const [key, state] of Object.entries(active)) {
    const v = specValue(m, key)
    if (state.kind === 'range') {
      const n = leadingNumber(v)
      if (n == null) return false
      if (state.min != null && n < state.min) return false
      if (state.max != null && n > state.max) return false
    } else if (state.kind === 'set' && state.selected.size > 0) {
      if (!v || !state.selected.has(v)) return false
    }
  }
  return true
}

/** Текстовый поиск по названию, описанию и характеристикам. */
export function matchesQuery(m, query) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (m.name?.toLowerCase().includes(q)) return true
  if (m.short?.toLowerCase().includes(q)) return true
  if (m.descr?.toLowerCase().includes(q)) return true
  return (m.specs || []).some((s) => s.k?.toLowerCase().includes(q) || s.v?.toLowerCase().includes(q))
}
