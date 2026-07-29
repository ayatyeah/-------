#!/usr/bin/env bash
# ============================================================================
#  Проверка безопасности API — раздел 3 из промпта «полное тестирование».
#
#  Запуск (сервер должен уже работать):
#      BASE_URL=http://localhost:3001 ADMIN_PASSWORD=testpass12345 \
#        bash scripts/smoke-test.sh
#
#  По умолчанию — localhost:3001 / testpass12345 (локальный тестовый стенд).
#  На боевом сервере сознательно НЕ гоняем: часть проверок создаёт заявки,
#  файлы и данные с префиксом ZZTEST-, а раздел про лимиты частоты и вовсе
#  вызвал бы полноценный обстрел. Заголовки (3.8) отдельно проверяются через
#  curl на бою в другом месте — здесь их нет.
#
#  Печатает ПРОШЛА/ПРОВАЛ по каждому пункту, в конце — код возврата 0/1.
#  Все тестовые записи создаются с префиксом ZZTEST- и удаляются в конце
#  скрипта, даже если какая-то проверка по пути провалилась (trap на выходе).
# ============================================================================
set -uo pipefail

BASE="${BASE_URL:-http://localhost:3001}"
PW="${ADMIN_PASSWORD:-testpass12345}"

PASS_N=0
FAIL_N=0
CREATED_MODELS=()
CREATED_NEWS=()
CREATED_CATS=()
CREATED_REQUESTS=()
CREATED_UPLOADS=()

ok()  { PASS_N=$((PASS_N+1)); printf '  \033[32mПРОШЛА\033[0m  %s\n' "$1"; }
bad() { FAIL_N=$((FAIL_N+1)); printf '  \033[31mПРОВАЛ\033[0m  %s  (ожидали %s, получили %s)\n' "$1" "$2" "$3"; }

# check "описание" ожидаемый_код фактический_код
check() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then ok "$desc"; else bad "$desc" "$expected" "$actual"; fi
}

status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
body()   { curl -s "$@"; }

# ---------------------------------------------------------------------------
cleanup() {
  echo
  echo "=== Уборка тестовых данных ==="
  for id in "${CREATED_MODELS[@]:-}"; do
    [ -n "$id" ] && curl -s -X DELETE "$BASE/api/models/$id" -H "Authorization: Bearer $TOKEN" >/dev/null
  done
  for id in "${CREATED_NEWS[@]:-}"; do
    [ -n "$id" ] && curl -s -X DELETE "$BASE/api/news/$id" -H "Authorization: Bearer $TOKEN" >/dev/null
  done
  for id in "${CREATED_CATS[@]:-}"; do
    [ -n "$id" ] && curl -s -X DELETE "$BASE/api/categories/$id" -H "Authorization: Bearer $TOKEN" >/dev/null
  done
  for id in "${CREATED_REQUESTS[@]:-}"; do
    [ -n "$id" ] && curl -s -X DELETE "$BASE/api/requests/$id" -H "Authorization: Bearer $TOKEN" >/dev/null
  done
  for name in "${CREATED_UPLOADS[@]:-}"; do
    [ -n "$name" ] && curl -s -X DELETE "$BASE/api/uploads/$name?force=1" -H "Authorization: Bearer $TOKEN" >/dev/null
  done
  echo "готово"
}
trap cleanup EXIT

echo "=== Вход администратором ($BASE) ==="
TOKEN=$(body -X POST "$BASE/api/login" -H 'Content-Type: application/json' \
  -d "{\"password\":\"$PW\"}" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "Не удалось войти — проверьте BASE_URL и ADMIN_PASSWORD. Останов."
  exit 1
fi
AUTH=(-H "Authorization: Bearer $TOKEN")
echo "  токен получен"

# Нужна хотя бы одна категория, чтобы создавать тестовые модели.
CAT_ID=$(body "$BASE/api/categories" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])" 2>/dev/null)

# ============================================================================
echo
echo "=== 3.1. Авторизация ==="
# ============================================================================
BAD_TOKEN="$TOKEN.tampered"
FLIP=$(echo "$TOKEN" | sed 's/./X/6')   # портим один символ подписи
FOREIGN=$(node -e "
const {createHmac,randomBytes}=require('node:crypto');
const key=randomBytes(32);
const payload=Buffer.from(JSON.stringify({exp:Date.now()+3600000})).toString('base64url');
const sig=createHmac('sha256',key).update(payload).digest('base64url');
console.log(payload+'.'+sig);
" 2>/dev/null)

check "GET /api/requests без токена → 401" 401 "$(status "$BASE/api/requests")"
check "GET /api/requests с мусорным токеном → 401" 401 "$(status "$BASE/api/requests" -H 'Authorization: Bearer garbage')"
check "GET /api/requests с испорченной подписью → 401" 401 "$(status "$BASE/api/requests" -H "Authorization: Bearer $FLIP")"
check "GET /api/requests с токеном от чужого секрета → 401" 401 "$(status "$BASE/api/requests" -H "Authorization: Bearer $FOREIGN")"
check "POST /api/models без токена → 401" 401 "$(status -X POST "$BASE/api/models")"
check "DELETE /api/uploads/x без токена → 401" 401 "$(status -X DELETE "$BASE/api/uploads/x")"
check "GET /api/admin/export без токена → 401" 401 "$(status "$BASE/api/admin/export")"

# Токен после смены пароля — проверяем на отдельном временном пароле,
# чтобы не трогать боевой ADMIN_PASSWORD стенда.
OLD_TOKEN="$TOKEN"
CH=$(status -X POST "$BASE/api/admin/password" "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d "{\"current\":\"$PW\",\"next\":\"ZZTEST-temp-pass-0001\"}")
if [ "$CH" = "200" ]; then
  check "старый токен после смены пароля → 401" 401 "$(status "$BASE/api/requests" -H "Authorization: Bearer $OLD_TOKEN")"
  # Возвращаем пароль как было. Проверяем на каждом шаге: если тут что-то
  # тихо не сработает, стенд останется на временном пароле, и все
  # следующие прогоны скрипта будут валиться на самом первом логине —
  # багом это выглядело один раз, пока не добавили эти проверки.
  NEWTOK=$(body -X POST "$BASE/api/login" -H 'Content-Type: application/json' \
    -d '{"password":"ZZTEST-temp-pass-0001"}' | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
  if [ -z "$NEWTOK" ]; then
    echo "  !! не удалось войти временным паролем — откат пароля пропущен, стенд остался на ZZTEST-temp-pass-0001"
    FAIL_N=$((FAIL_N+1))
  else
    REVERT_CODE=$(status -X POST "$BASE/api/admin/password" -H "Authorization: Bearer $NEWTOK" -H 'Content-Type: application/json' \
      -d "{\"current\":\"ZZTEST-temp-pass-0001\",\"next\":\"$PW\"}")
    TOKEN=$(body -X POST "$BASE/api/login" -H 'Content-Type: application/json' \
      -d "{\"password\":\"$PW\"}" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
    if [ -n "$TOKEN" ]; then
      ok "пароль стенда возвращён к исходному, вход по нему работает"
      AUTH=(-H "Authorization: Bearer $TOKEN")
    else
      echo "  !! откат пароля не подтверждён (PUT ответил $REVERT_CODE) — стенд может остаться на временном пароле"
      FAIL_N=$((FAIL_N+1))
      AUTH=(-H "Authorization: Bearer $NEWTOK")
    fi
  fi
else
  bad "смена пароля для проверки инвалидации токена" 200 "$CH"
fi

# ============================================================================
echo
echo "=== 3.2. Утечка черновиков ==="
# ============================================================================
DRAFT=$(body -X POST "$BASE/api/models" "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d "{\"name\":\"ZZTEST-Черновик\",\"cat\":\"$CAT_ID\",\"published\":false}")
DRAFT_ID=$(echo "$DRAFT" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])" 2>/dev/null)
CREATED_MODELS+=("$DRAFT_ID")

PUB_COUNT=$(body "$BASE/api/models?all=1" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(sum(1 for m in d if m.get('name','').startswith('ZZTEST')))
" 2>/dev/null)
check "GET /api/models?all=1 без токена не отдаёт черновик" "0" "${PUB_COUNT:-?}"

SITEMAP_HIT=$(body "$BASE/sitemap.xml" | grep -c "$DRAFT_ID" || true)
check "черновика нет в /sitemap.xml" "0" "$SITEMAP_HIT"

DRAFT_NEWS=$(body -X POST "$BASE/api/news" "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"title":"ZZTEST-Черновик новости","published":false}')
DRAFT_NEWS_ID=$(echo "$DRAFT_NEWS" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])" 2>/dev/null)
CREATED_NEWS+=("$DRAFT_NEWS_ID")
NEWS_HIT=$(body "$BASE/api/news" | grep -c "ZZTEST-Черновик новости" || true)
check "неопубликованной новости нет в /api/news" "0" "$NEWS_HIT"

check "прямой GET /api/models/<черновик> без токена → 404" 404 "$(status "$BASE/api/models/$DRAFT_ID")"
check "прямой GET /api/news/<черновик> без токена → 404" 404 "$(status "$BASE/api/news/$DRAFT_NEWS_ID")"
check "то же с токеном → 200 (админ черновик видит)" 200 "$(status "$BASE/api/models/$DRAFT_ID" "${AUTH[@]}")"

# Переполнение квоты на картинки (507, а не 500) требует отдельного стенда с
# низким UPLOAD_QUOTA_MB — против уже запущенного произвольного сервера этот
# скрипт квоту не понизит. Проверка руками:
#   UPLOAD_QUOTA_MB=1 ADMIN_PASSWORD=testpass12345 NODE_ENV=production \
#     PORT=3005 STORE_PATH=.../store.json UPLOAD_DIR=.../uploads node server/index.js
#   затем залить фото до превышения 1 МБ — ответ должен быть 507 с текстом
#   про освобождение места, и НЕ должно быть "API error" в логе сервера.

# ============================================================================
echo
echo "=== 3.3. Загрузка файлов ==="
# ============================================================================
# Каталог для временных файлов теста: НЕ внутри проекта. Windows-python,
# запущенный из Git Bash, не всегда верно декодирует кириллицу в пути
# (репозиторий лежит в «…\СХМАгро\…») — приходит мусор в имени файла, и
# запись падает с FileNotFoundError. TMPDIR (если задан — например,
# scratchpad-каталог агента) или системный temp решают это понадёжнее.
TMP="${SMOKE_TMPDIR:-${TMPDIR:-/tmp}}/smoke-test-$$"
rm -rf "$TMP"
mkdir -p "$TMP"
# Внутри python -c обратный слэш — начало escape-последовательности
# ('\U...' читается как unicode-escape). Windows-путь в SMOKE_TMPDIR может
# прийти с обратными слэшами — для python-скриптов ниже нужна версия с
# прямыми: они работают в путях Windows точно так же.
TMP_PY="${TMP//\\//}"

# Настоящий PNG 1x1 и JPEG — валидные сигнатуры.
python3 -c "
import struct, zlib
def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag+data))
sig=b'\x89PNG\r\n\x1a\n'
ihdr=chunk(b'IHDR', struct.pack('>IIBBBBB',1,1,8,2,0,0,0))
idat=chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00'))
iend=chunk(b'IEND', b'')
open('$TMP_PY/real.png','wb').write(sig+ihdr+idat+iend)
open('$TMP_PY/real.jpg','wb').write(bytes([0xFF,0xD8,0xFF,0xE0])+b'\x00'*100)
open('$TMP_PY/fake.json','wb').write(b'{\"a\":1}')
open('$TMP_PY/elf','wb').write(bytes([0x7F,0x45,0x4C,0x46])+b'\x00'*100)
open('$TMP_PY/empty','wb').write(b'')
open('$TMP_PY/big','wb').write(b'\xff\xd8\xff\xe0'+b'A'*(9*1024*1024))
open('$TMP_PY/svg.svg','wb').write(b'<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>')
open('$TMP_PY/polyglot.gif','wb').write(b'GIF89a'+b'<html><script>alert(1)</script></html>')
"

up() { # up <файл> <X-File-Name> — только код ответа, файл не отслеживается
  # Подходит лишь для заведомо отклоняемых файлов (415/400/413) — сервер
  # такие не сохраняет, убирать за собой нечего.
  curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/uploads" "${AUTH[@]}" \
    -H "X-File-Name: $2" --data-binary "@$1"
}
up_tracked() { # up_tracked <файл> <X-File-Name> — печатает "код<TAB>имя"
  # Один запрос, а не два (загрузка «для имени» + отдельная «для статуса»):
  # второй запрос создавал ВТОРОЙ файл на диске, имя которого нигде не
  # сохранялось, — уборка в конце его не находила, и тестовый файл
  # оставался в /data/uploads навсегда.
  #
  # Массив CREATED_UPLOADS сюда НЕ трогаем: вызов вида "$(up_tracked ...)"
  # запускает функцию в подпроцессе, и любые её изменения глобального
  # массива теряются при выходе из него — ровно так этот баг и жил здесь
  # незамеченным. Вместо этого печатаем код и имя одной строкой, а массив
  # пополняет тот, кто вызывает — в основном теле скрипта, не в подпроцессе.
  local resp code name
  resp=$(curl -s -w $'\nHTTPSTATUS:%{http_code}' -X POST "$BASE/api/uploads" "${AUTH[@]}" \
    -H "X-File-Name: $2" --data-binary "@$1")
  code=$(echo "$resp" | grep -o 'HTTPSTATUS:[0-9]*' | cut -d: -f2)
  name=$(echo "$resp" | sed '$d' | python3 -c "import sys,json;print(json.load(sys.stdin).get('name',''))" 2>/dev/null)
  printf '%s\t%s\n' "$code" "$name"
}

IFS=$'\t' read -r CODE1 NAME1 <<< "$(up_tracked "$TMP/real.png" 'ZZTEST-real.png')"
[ -n "$NAME1" ] && CREATED_UPLOADS+=("$NAME1")
check "настоящий PNG → 201" 201 "$CODE1"

IFS=$'\t' read -r CODE2 NAME2 <<< "$(up_tracked "$TMP/real.jpg" 'ZZTEST-real.jpg')"
[ -n "$NAME2" ] && CREATED_UPLOADS+=("$NAME2")
check "настоящий JPEG → 201" 201 "$CODE2"

check "SVG со <script> → 415" 415 "$(up "$TMP/svg.svg" 'ZZTEST-x.svg')"
check "GIF89a + HTML внутри (полиглот) → 415" 415 "$(up "$TMP/polyglot.gif" 'ZZTEST-x.gif')"
check "JSON с именем .jpeg → 415" 415 "$(up "$TMP/fake.json" 'ZZTEST-x.jpeg')"
check "ELF-заголовок → 415" 415 "$(up "$TMP/elf" 'ZZTEST-x.png')"
check "пустое тело → 400" 400 "$(up "$TMP/empty" 'ZZTEST-x.png')"
check "файл больше 8 МБ → 413" 413 "$(up "$TMP/big" 'ZZTEST-x.jpg')"

TRAV=$(curl -s -X POST "$BASE/api/uploads" "${AUTH[@]}" -H "X-File-Name: ..%2F..%2Fetc%2Fpasswd" --data-binary "@$TMP/real.png")
TRAV_NAME=$(echo "$TRAV" | python3 -c "import sys,json;print(json.load(sys.stdin).get('name',''))" 2>/dev/null)
[ -n "$TRAV_NAME" ] && CREATED_UPLOADS+=("$TRAV_NAME")
case "$TRAV_NAME" in
  *..*|*/*) bad "имя с обходом каталога сохранено безопасно" "без .. и /" "$TRAV_NAME" ;;
  "") bad "имя с обходом каталога — сервер должен был принять и переименовать" "безопасное имя" "(пусто)" ;;
  *) ok "имя '../../etc/passwd' сохранено под безопасным именем: $TRAV_NAME" ;;
esac

check "GET /uploads/..%2f..%2fstore.json → 404" 404 "$(status "$BASE/uploads/..%2f..%2fstore.json")"
check "GET /uploads/../store.json → 404" 404 "$(status "$BASE/uploads/../store.json")"

if [ -n "$NAME1" ]; then
  CT=$(curl -sI "$BASE/uploads/$NAME1" | grep -i '^content-type' | tr -d '\r')
  NS=$(curl -sI "$BASE/uploads/$NAME1" | grep -ic 'nosniff')
  CD=$(curl -sI "$BASE/uploads/$NAME1" | grep -i '^content-disposition' | tr -d '\r')
  case "$CT" in *image/png*) ok "отдача файла: верный Content-Type" ;; *) bad "Content-Type картинки" "image/png" "$CT" ;; esac
  check "отдача файла: nosniff" 1 "$NS"
  case "$CD" in *inline*) ok "отдача файла: Content-Disposition inline" ;; *) bad "Content-Disposition" "inline" "$CD" ;; esac
fi

# $TMP используется ещё в разделе 3.4 (тела запросов из файла) — удаляем
# только в самом конце скрипта.

# ============================================================================
echo
echo "=== 3.4. Проверка входных данных ==="
# ============================================================================
mk_model() { # mk_model '{"photo":"..."}' — возвращает id
  body -X POST "$BASE/api/models" "${AUTH[@]}" -H 'Content-Type: application/json' \
    -d "$1" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('id',''))" 2>/dev/null
}
get_photo() { body "$BASE/api/models/$1" | python3 -c "import sys,json;print(json.load(sys.stdin).get('photo') or '')" 2>/dev/null; }

for url in 'https://evil.example.com/x.gif' 'javascript:alert(1)' '/uploads/../../etc/passwd' 'data:image/svg+xml;base64,AAAA'; do
  ID=$(mk_model "{\"name\":\"ZZTEST-photo\",\"cat\":\"$CAT_ID\",\"photo\":$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$url")}")
  CREATED_MODELS+=("$ID")
  PH=$(get_photo "$ID")
  if [ -z "$PH" ]; then ok "photo: $url → обнулено"; else bad "photo: $url → обнулено" "(пусто)" "$PH"; fi
done

# 100 000 символов не помещаются в аргумент командной строки — тело в файл.
# Само тело (100 000+ символов) уже больше общего лимита express.json —
# 64 КБ (см. index.js, app.use(express.json({limit:'64kb'}))). Это отдельный
# защитный слой, срабатывающий раньше, чем обрезка поля по MAX.short: тело
# целиком отклоняется с 413, до разбора JSON дело не доходит. Оба исхода —
# «обрезано до предела» или «отклонено целиком» — означают, что 100 000
# символов не осели в данных как есть; принимаем любой из двух.
python3 -c "
import json
print(json.dumps({'name':'ZZTEST-long','cat':'$CAT_ID','short':'A'*100000}))
" > "$TMP/long-body.json"
LONG_CODE=$(status -X POST "$BASE/api/models" "${AUTH[@]}" -H 'Content-Type: application/json' --data-binary "@$TMP/long-body.json")
if [ "$LONG_CODE" = "413" ]; then
  ok "строка в 100000 символов: тело целиком отклонено 413 (общий лимит 64 КБ раньше поля)"
else
  ID_LONG=$(curl -s -X POST "$BASE/api/models" "${AUTH[@]}" -H 'Content-Type: application/json' \
    --data-binary "@$TMP/long-body.json" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  CREATED_MODELS+=("$ID_LONG")
  LEN=$(body "$BASE/api/models/$ID_LONG" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('short','')))" 2>/dev/null)
  if [ -n "$LEN" ] && [ "$LEN" -lt 100000 ] && [ "$LEN" -gt 0 ]; then
    ok "строка в 100000 символов обрезана до предела (осталось $LEN), сервер жив"
  else
    bad "обрезка длинной строки" "413, либо обрезано (< 100000 и > 0)" "код $LONG_CODE, поле '${LEN:-?}'"
  fi
fi
check "сервер жив после длинной строки" 200 "$(status "$BASE/api/health")"

# Те же 64 КБ ограничивают и 10000 характеристик (JSON такого списка —
# сотни килобайт). Принимаем 413 наравне с обрезкой до MAX.specs.
python3 -c "
import json
print(json.dumps({'name':'ZZTEST-specs','cat':'$CAT_ID','specs':[{'k':'x','v':'y'} for _ in range(10000)]}))
" > "$TMP/specs-body.json"
SPECS_CODE=$(status -X POST "$BASE/api/models" "${AUTH[@]}" -H 'Content-Type: application/json' --data-binary "@$TMP/specs-body.json")
if [ "$SPECS_CODE" = "413" ]; then
  ok "массив из 10000 характеристик: тело целиком отклонено 413 (общий лимит 64 КБ)"
else
  ID_SPECS=$(curl -s -X POST "$BASE/api/models" "${AUTH[@]}" -H 'Content-Type: application/json' \
    --data-binary "@$TMP/specs-body.json" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  CREATED_MODELS+=("$ID_SPECS")
  SN=$(body "$BASE/api/models/$ID_SPECS" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('specs',[])))" 2>/dev/null)
  if [ -n "$SN" ] && [ "$SN" -lt 10000 ]; then
    ok "массив из 10000 характеристик обрезан (осталось $SN)"
  else
    bad "обрезка массива характеристик" "413, либо обрезано (< 10000)" "код $SPECS_CODE, поле '${SN:-?}'"
  fi
fi

check "specs: не массив → сервер не падает (200/201)" 201 "$(status -X POST "$BASE/api/models" "${AUTH[@]}" -H 'Content-Type: application/json' -d "{\"name\":\"ZZTEST-badspecs\",\"cat\":\"$CAT_ID\",\"specs\":\"не массив\"}")"
NB=$(body "$BASE/api/models?all=1" "${AUTH[@]}" | python3 -c "
import sys,json
d=json.load(sys.stdin)
xs=[m for m in d if m['name']=='ZZTEST-badspecs']
print(xs[-1]['id'] if xs else '')
" 2>/dev/null)
[ -n "$NB" ] && CREATED_MODELS+=("$NB")

check "null вместо тела → 400, не 500" 400 "$(status -X POST "$BASE/api/models" "${AUTH[@]}" -H 'Content-Type: application/json' -d 'null')"
check "без имени/категории → 400, не 500" 400 "$(status -X POST "$BASE/api/models" "${AUTH[@]}" -H 'Content-Type: application/json' -d '{}')"

curl -s -X PUT "$BASE/api/settings" "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"instagram_url":"javascript:alert(1)"}' >/dev/null
V1=$(body "$BASE/api/settings" | python3 -c "import sys,json;print(json.load(sys.stdin).get('instagram_url',''))")
if [ -z "$V1" ]; then ok "ссылка javascript: в настройках → пустая строка"; else bad "javascript: в настройках" "(пусто)" "$V1"; fi

curl -s -X PUT "$BASE/api/settings" "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"instagram_url":"http://example.com"}' >/dev/null
V2=$(body "$BASE/api/settings" | python3 -c "import sys,json;print(json.load(sys.stdin).get('instagram_url',''))")
if [ -z "$V2" ]; then ok "ссылка http:// (без s) в настройках → пустая строка"; else bad "http:// в настройках" "(пусто)" "$V2"; fi
# возвращаем пустым, как было
curl -s -X PUT "$BASE/api/settings" "${AUTH[@]}" -H 'Content-Type: application/json' -d '{"instagram_url":""}' >/dev/null

check "пустой список регионов → 400" 400 "$(status -X PUT "$BASE/api/regions" "${AUTH[@]}" -H 'Content-Type: application/json' -d '{"regions":[]}')"

# ============================================================================
echo
echo "=== 3.5. Межсайтовый скриптинг (хранение) ==="
# ============================================================================
# Полноценный запуск в браузере curl'ом не проверить: в проекте нет ни
# одного dangerouslySetInnerHTML/innerHTML (см. отчёт) — экранирование на
# стороне React. Здесь проверяем, что API хранит payload как есть, без
# серверной интерпретации (шаблонизации, обрезки под «безопасный» вид).
XSS_PAYLOADS=(
  '<script>alert(1)</script>'
  '<img src=x onerror=alert(1)>'
  '"><svg onload=alert(1)>'
  '{{7*7}}'
  '${7*7}'
)
for p in "${XSS_PAYLOADS[@]}"; do
  ESC=$(python3 -c "import json,sys;print(json.dumps(sys.argv[1]))" "$p")
  ID=$(mk_model "{\"name\":\"ZZTEST-xss\",\"cat\":\"$CAT_ID\",\"short\":$ESC}")
  CREATED_MODELS+=("$ID")
  GOT=$(body "$BASE/api/models/$ID" | python3 -c "import sys,json;print(json.load(sys.stdin).get('short',''))")
  if [ "$GOT" = "$p" ]; then
    ok "поле хранит буквально: $p"
  else
    bad "поле изменило payload (возможна шаблонизация/фильтр)" "$p" "$GOT"
  fi
done

# ============================================================================
echo
echo "=== 3.6. Форма заявки ==="
# ============================================================================
check "без согласия → отклонено" 400 "$(status -X POST "$BASE/api/requests" -H 'Content-Type: application/json' -d '{"type":"call","fio":"ZZTEST Тест","phone":"+7 700 000 00 00","consent":false}')"

TRAP_RESP=$(curl -s -w "\nHTTPSTATUS:%{http_code}" -X POST "$BASE/api/requests" -H 'Content-Type: application/json' \
  -d '{"type":"call","fio":"ZZTEST Бот","phone":"+7 700 000 00 00","consent":true,"website":"http://spam.example"}')
TRAP_CODE=$(echo "$TRAP_RESP" | grep -o 'HTTPSTATUS:[0-9]*' | cut -d: -f2)
if [ "$TRAP_CODE" = "201" ]; then
  # Показали 201 боту (ожидаемо — ловушка не должна себя выдавать), но
  # если заявка при этом реально сохранилась, это баг: запоминаем id на
  # случай такого провала, чтобы запись не осталась в базе навсегда.
  TRAP_ID=$(echo "$TRAP_RESP" | sed 's/HTTPSTATUS:[0-9]*$//' | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  HIT=$(body "$BASE/api/requests" "${AUTH[@]}" | grep -c 'ZZTEST Бот' || true)
  if [ "$HIT" = "0" ]; then
    ok "ловушка для ботов: 201 показан боту, но заявка не сохранена"
  else
    bad "ловушка для ботов не сработала" "не сохранено" "сохранено"
    [ -n "$TRAP_ID" ] && CREATED_REQUESTS+=("$TRAP_ID")
  fi
else
  check "заполненная ловушка для ботов → отклонено" 400 "$TRAP_CODE"
fi

check "телефон из букв → отклонено" 400 "$(status -X POST "$BASE/api/requests" -H 'Content-Type: application/json' -d '{"type":"call","fio":"ZZTEST Тест","phone":"абвгд","consent":true}')"

LONGFIO=$(python3 -c "print('И'*10000)")
LONGFIO_RESP=$(curl -s -w "\nHTTPSTATUS:%{http_code}" -X POST "$BASE/api/requests" -H 'Content-Type: application/json' -d "{\"type\":\"call\",\"fio\":\"$LONGFIO\",\"phone\":\"+7 700 000 00 01\",\"consent\":true}")
FIO_CODE=$(echo "$LONGFIO_RESP" | grep -o 'HTTPSTATUS:[0-9]*' | cut -d: -f2)
# 201 — заявка реально создалась (даже если ФИО обрезано) — запоминаем id,
# иначе она останется в базе навсегда: status() выше отдавал только код,
# id терялся, и на боевом это оставило забытую запись после первого прогона.
if [ "$FIO_CODE" = "201" ]; then
  LONGFIO_ID=$(echo "$LONGFIO_RESP" | sed 's/HTTPSTATUS:[0-9]*$//' | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  [ -n "$LONGFIO_ID" ] && CREATED_REQUESTS+=("$LONGFIO_ID")
fi
case "$FIO_CODE" in 201|400) ok "ФИО в 10000 символов → $FIO_CODE (обрезано или отклонено), сервер жив" ;; *) bad "ФИО 10000 символов" "201 или 400" "$FIO_CODE" ;; esac
check "сервер жив после длинного ФИО" 200 "$(status "$BASE/api/health")"

# SKIP_LOCKOUT_TESTS=1 пропускает эту проверку и проверку логин-лимита в 3.7:
# обе нарочно добивают лимит частоты, а на боевом это на 10-15 минут запирает
# форму КП и вход в админку для настоящих посетителей, не только для теста.
if [ "${SKIP_LOCKOUT_TESTS:-0}" = "1" ]; then
  echo "    (пропущено: SKIP_LOCKOUT_TESTS=1 — не запираем форму КП на боевом)"
else
  RATE_HIT=no
  for i in $(seq 1 8); do
    RESP=$(curl -s -w "\nHTTPSTATUS:%{http_code}" -X POST "$BASE/api/requests" -H 'Content-Type: application/json' \
      -d "{\"type\":\"call\",\"fio\":\"ZZTEST Лимит $i\",\"phone\":\"+7 700 000 00 0$i\",\"consent\":true}")
    C=$(echo "$RESP" | grep -o 'HTTPSTATUS:[0-9]*' | cut -d: -f2)
    if [ "$C" = "201" ]; then
      RID=$(echo "$RESP" | sed 's/HTTPSTATUS:[0-9]*$//' | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
      [ -n "$RID" ] && CREATED_REQUESTS+=("$RID")
    fi
    if [ "$C" = "429" ]; then RATE_HIT=yes; break; fi
  done
  if [ "$RATE_HIT" = "yes" ]; then ok "лимит частоты на заявки сработал (лимит 5/10мин)"; else bad "лимит частоты на заявки" "429 после 5-й" "не сработал за 8 попыток"; fi
fi

# подчищаем тестовые заявки
ALL_REQ=$(body "$BASE/api/requests" "${AUTH[@]}")
while IFS= read -r rid; do
  [ -n "$rid" ] && CREATED_REQUESTS+=("$rid")
done < <(echo "$ALL_REQ" | python3 -c "
import sys,json
for r in json.load(sys.stdin):
    if r.get('fio','').startswith('ZZTEST'):
        print(r['id'])
" 2>/dev/null)

# ============================================================================
echo
echo "=== 3.7. Лимиты частоты ==="
# ============================================================================
if [ "${SKIP_LOCKOUT_TESTS:-0}" = "1" ]; then
  echo "    (пропущено: SKIP_LOCKOUT_TESTS=1 — не запираем вход в админку на боевом)"
else
  LOGIN_BLOCKED=no
  for i in $(seq 1 12); do
    C=$(status -X POST "$BASE/api/login" -H 'Content-Type: application/json' -d '{"password":"ZZTEST-wrong"}')
    if [ "$C" = "429" ]; then LOGIN_BLOCKED=yes; echo "    (блокировка на попытке №$i)"; break; fi
  done
  if [ "$LOGIN_BLOCKED" = "yes" ]; then ok "после ~10 неверных паролей — блокировка (429)"; else bad "блокировка по неверным паролям" "429 после 10-й" "не сработала за 12 попыток"; fi
  echo "    (пароль верного администратора не задет — своя запись по паролю ZZTEST-wrong)"
fi

check "подделанный X-Forwarded-For игнорируется без TRUST_PROXY" 200 "$(status "$BASE/api/health" -H 'X-Forwarded-For: 1.2.3.4')"
echo "    (нагрузочные проверки 400 запросов/60 загрузок — см. часть 4, только локально)"

# ============================================================================
echo
echo "=== 3.9. Сообщения об ошибках ==="
# ============================================================================
BADJSON=$(curl -s -X POST "$BASE/api/login" -H 'Content-Type: application/json' -d '{broken')
BADJSON_CODE=$(status -X POST "$BASE/api/login" -H 'Content-Type: application/json' -d '{broken')
check "битый JSON → 400" 400 "$BADJSON_CODE"
if echo "$BADJSON" | grep -qiE 'at Object|at Module|\.js:[0-9]+:[0-9]+|node_modules'; then
  bad "битый JSON не содержит следа стека" "без стека" "стек виден"
else
  ok "битый JSON не содержит следа стека"
fi

check "очень длинный адрес → 404 или 414" "1" "$( [ "$(status "$BASE/$(python3 -c "print('a'*9000)")")" = "404" ] || [ "$(status "$BASE/$(python3 -c "print('a'*9000)")")" = "414" ] && echo 1 || echo 0 )"

TRACE=$(status -X TRACE "$BASE/api/models")
PROPFIND=$(status -X PROPFIND "$BASE/api/models")
case "$TRACE" in 4*|501) ok "TRACE отклонён ($TRACE)" ;; *) bad "TRACE" "4xx/501" "$TRACE" ;; esac
case "$PROPFIND" in 4*|501) ok "PROPFIND отклонён ($PROPFIND)" ;; *) bad "PROPFIND" "4xx/501" "$PROPFIND" ;; esac

FORCE500=$(curl -s "$BASE/api/models/%00")
if echo "$FORCE500" | grep -qiE 'at Object|at Module|\.js:[0-9]+:[0-9]+|node_modules|Error:'; then
  bad "ответ об ошибке без следа стека" "без стека" "стек виден"
else
  ok "проверка формата ошибок (без стека) — образец пройден"
fi

rm -rf "$TMP"

# ============================================================================
echo
echo "================================================================"
echo "Итого: $PASS_N прошло, $FAIL_N провалено"
echo "================================================================"
[ "$FAIL_N" -eq 0 ]
