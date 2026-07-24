#!/bin/sh
# Восстановление данных сайта из резервной копии.
#
# Порядок важен — сайт держит данные в памяти и, если он работает, перезапишет
# восстановленный файл своими:
#
#     docker compose stop web
#     docker compose run --rm restore
#     docker compose start web
#
# Из конкретной копии (без имени берётся самая свежая):
#     docker compose run --rm restore sh /scripts/restore.sh store-2026-07-24_03-00.json.gz
set -eu

DEST="${BACKUP_DIR:-/backups}"
TARGET="${STORE_PATH:-/data/store.json}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

if [ $# -ge 1 ]; then
  SRC="$DEST/$1"
else
  # Самая свежая копия по имени: имена содержат дату в порядке год-месяц-день,
  # поэтому обычная сортировка ставит новейшую последней.
  SRC=$(find "$DEST" -name 'store-*.json.gz' -type f | sort | tail -n 1)
fi

if [ -z "${SRC:-}" ] || [ ! -f "$SRC" ]; then
  log "копия не найдена. Что есть в $DEST:"
  ls -1 "$DEST" 2>/dev/null || echo "  (папка пуста)"
  exit 1
fi

log "восстанавливаю из: $(basename "$SRC")"

if ! gzip -t "$SRC" 2>/dev/null; then
  log "ОШИБКА: архив повреждён, восстановление отменено"
  exit 1
fi

# Текущие данные не затираем молча, а откладываем в сторону: если
# восстановили не ту копию, будет куда вернуться.
if [ -f "$TARGET" ]; then
  # Имена переменных только латиницей: оболочка в Alpine (ash) кириллицу
  # в именах не принимает и падает с «not found».
  prev="$TARGET.before-restore-$(date '+%Y-%m-%d_%H-%M')"
  cp "$TARGET" "$prev"
  log "текущие данные сохранены как $(basename "$prev")"
fi

TMP="$TARGET.restoring"
gunzip -c "$SRC" > "$TMP"

# Проверяем, что внутри действительно наши данные, а не обрывок файла.
if ! grep -q '"models"' "$TMP" 2>/dev/null; then
  log "ОШИБКА: в архиве не похоже на данные сайта, восстановление отменено"
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$TARGET"
log "готово. Запустите сайт: docker compose start web"
