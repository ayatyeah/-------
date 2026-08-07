/**
 * PDF-листовка с характеристиками модели (п.15 дорожной карты).
 *
 * Печатный лист, который менеджер отправляет клиенту или распечатывает —
 * название, характеристики, короткое описание, контакты завода. Строится
 * из тех же данных, что показывает страница модели, без отдельного шаблона
 * данных: что видно на сайте, то и печатается.
 *
 * pdfkit выбран вместо headless-браузера (Puppeteer): у документа нет
 * сложной вёрстки, а Chromium на маленьком VPS — это лишние сотни
 * мегабайт памяти ради одной страницы текста.
 */
import PDFDocument from 'pdfkit'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const LOGO_PATH = join(HERE, '..', 'dist', 'assets', 'logo.png')

/* pdfkit-у встроен только латинский набор из 14 стандартных PDF-шрифтов —
   Helvetica кириллицу не рисует вовсе (буквы превращаются в мусор). PT Sans
   тот же, что и на сайте (см. public/fonts/) — здесь TTF, а не woff2:
   встроенный в pdfkit fontkit падает на некоторых woff2-подвыборках при
   субсеттинге (проверено), TTF работает надёжно. Файлы — SIL Open Font
   License, см. server/fonts/OFL.txt. */
const FONT_REGULAR = join(HERE, 'fonts', 'PTSans-Regular.ttf')
const FONT_BOLD = join(HERE, 'fonts', 'PTSans-Bold.ttf')
const FONT_ITALIC = join(HERE, 'fonts', 'PTSans-Italic.ttf')

const GREEN = '#14301a'
const BRASS = '#a9761c'
const TEXT = '#2a2f28'
const MUTED = '#6b7566'
const RULE = '#dcded7'

/**
 * Пишет PDF-листовку модели прямо в поток ответа.
 * @param {import('node:http').ServerResponse} res
 * @param {object} model  — то, что отдаёт store.models.get()
 * @param {object} settings — store.settings.publicAll()
 */
export function streamModelSheet(res, model, settings) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, autoFirstPage: true, info: { Title: `${model.name} — характеристики` } })
  doc.pipe(res)
  doc.registerFont('body', FONT_REGULAR)
  doc.registerFont('bold', FONT_BOLD)
  doc.registerFont('italic', FONT_ITALIC)

  /* ------------------------------- шапка --------------------------------- */
  const logoSize = 40
  if (existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, 50, 46, { width: logoSize, height: logoSize })
    } catch {
      /* повреждённый файл логотипа — печатаем без него, не роняем весь PDF */
    }
  }
  doc
    .fillColor(GREEN)
    .font('bold')
    .fontSize(14)
    .text(settings.legal_name || 'ТОО «СХМ Агро»', 50 + logoSize + 12, 50, { width: 400 })
    .fillColor(MUTED)
    .font('body')
    .fontSize(9)
    .text('Производство и продажа сельхозтехники', 50 + logoSize + 12, 68)

  doc.moveTo(50, 100).lineTo(545, 100).strokeColor(RULE).lineWidth(1).stroke()

  /* ------------------------------ заголовок ------------------------------- */
  let y = 118
  doc.fillColor(MUTED).font('body').fontSize(9).text(model.catName || '', 50, y)
  y += 14

  doc.fillColor(GREEN).font('bold').fontSize(22).text(model.name, 50, y, { width: 495 })
  y = doc.y + 6

  const badges = []
  if (model.subsidized) badges.push('Субсидируется')
  if (model.flagship) badges.push('Флагман модельного ряда')
  if (badges.length) {
    doc.fillColor(BRASS).font('bold').fontSize(10).text(badges.join('   ·   '), 50, y)
    y = doc.y + 4
  }

  if (model.short) {
    doc.fillColor(TEXT).font('body').fontSize(11).text(model.short, 50, y + 6, { width: 495 })
    y = doc.y
  }

  y += 18

  /* --------------------------- таблица характеристик ----------------------- */
  const specs = (model.specs || []).filter((s) => s.k || s.v)
  if (specs.length) {
    doc.fillColor(GREEN).font('bold').fontSize(13).text('Технические характеристики', 50, y)
    y = doc.y + 8

    const colK = 50
    const colV = 260
    const rowPad = 8

    for (const s of specs) {
      // Новая страница, если строка не влезает до нижнего поля.
      if (y > 740) {
        doc.addPage()
        y = 50
      }
      doc.fillColor(MUTED).font('body').fontSize(10.5).text(s.k || '', colK, y, { width: 200 })
      doc.fillColor(TEXT).font('bold').fontSize(10.5).text(s.v || '', colV, y, { width: 285 })
      let rowY = Math.max(doc.y, y + 14)
      if (s.benefit) {
        doc
          .fillColor(BRASS)
          .font('italic')
          .fontSize(9)
          .text(s.benefit, colV, rowY, { width: 285 })
        rowY = doc.y
      }
      y = rowY + rowPad
      doc.strokeColor(RULE).lineWidth(0.5).moveTo(50, y - rowPad / 2).lineTo(545, y - rowPad / 2).stroke()
    }
    y += 10
  }

  /* ------------------------------- отзыв ---------------------------------- */
  if (model.testimonial?.quote) {
    if (y > 700) {
      doc.addPage()
      y = 50
    }
    doc
      .fillColor(TEXT)
      .font('italic')
      .fontSize(11)
      .text(`«${model.testimonial.quote}»`, 50, y, { width: 495 })
    y = doc.y + 4
    if (model.testimonial.author) {
      doc.fillColor(MUTED).font('body').fontSize(9.5).text(`— ${model.testimonial.author}`, 50, y)
      y = doc.y
    }
    y += 14
  }

  /* ------------------------------- подвал ---------------------------------- */
  // 760, не 791 (нижнее поле страницы): вплотную к краю pdfkit сам решает,
  // что строка не влезает, и уводит подвал на пустую вторую страницу.
  // Если контента много (длинный список характеристик) и место уже занято —
  // подвал печатается на новой странице, а не поверх последней строки.
  if (y > 700) doc.addPage()
  const footerY = 760
  doc.strokeColor(RULE).lineWidth(1).moveTo(50, footerY).lineTo(545, footerY).stroke()
  const contactLine = [settings.phone, settings.email, settings.address].filter(Boolean).join('   ·   ')
  doc.fillColor(MUTED).font('body').fontSize(8.5).text(contactLine, 50, footerY + 8, { width: 495, align: 'center' })

  doc.end()
}
