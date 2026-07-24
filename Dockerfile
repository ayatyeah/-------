# ============================================================================
#  ТОО «СХМ Агро» — образ для боевого запуска.
#
#  Собирается в два шага: сначала на полном наборе зависимостей собирается
#  клиент (Vite), затем в чистый образ кладётся только то, что нужно для
#  работы. Инструменты сборки в рабочий образ не попадают: меньше вес и
#  меньше поверхности для атаки.
#
#  Node 22: в package.json заявлено ">=22.9.0", потому что сервер использует
#  флаг --env-file-if-exists, появившийся в 22.9. Понижать версию нельзя —
#  запуск упадёт с "bad option".
# ============================================================================

# ------------------------------ шаг 1: сборка -------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Сначала только манифесты: пока они не изменились, Docker берёт слой с
# зависимостями из кэша и не качает их заново при каждой правке кода.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------------------------- шаг 2: рабочий образ --------------------------
FROM node:22-alpine

# NODE_ENV=production включает в сервере HSTS и режим прода у Express.
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    STORE_PATH=/data/store.json

WORKDIR /app

# Только рабочие зависимости: vite, react и прочее нужны были на сборке,
# в готовом образе им делать нечего.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY --from=build /app/dist ./dist

# Данные лежат на томе. Каталог создаём заранее и отдаём пользователю node,
# иначе процесс без прав root не сможет туда писать.
RUN mkdir -p /data && chown -R node:node /data /app

# Работаем не от root: если в приложении найдётся дыра, она не даст прав
# на весь контейнер. Образ node:alpine уже содержит пользователя node.
USER node

EXPOSE 3001

# Docker сам проверяет, отвечает ли сайт. curl и wget в образе нет и не нужны:
# в Node 22 есть встроенный fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Флаг --env-file-if-exists терпит отсутствие .env: в контейнере переменные
# приходят из docker compose, но при желании можно примонтировать и файл.
CMD ["node", "--env-file-if-exists=.env", "server/index.js"]
