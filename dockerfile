FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json yarn.lock ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY package/auth/package.json ./package/auth/package.json
COPY package/file-models/package.json ./package/file-models/package.json
COPY package/shared-types/package.json ./package/shared-types/package.json

RUN yarn install --frozen-lockfile --non-interactive

COPY backend ./backend
COPY frontend ./frontend
COPY package ./package

RUN yarn build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    API_PORT=7000 \
    DB_FILE_NAME=file:./data/fast-drive.sqlite \
    STORAGE_ROOT=./data/storage \
    UPLOAD_TEMP_ROOT=/tmp/fast-drive-uploads \
    WEB_DIST_ROOT=/app/frontend/dist/frontend/browser \
    DRIZZLE_MIGRATIONS_FOLDER=./drizzle

WORKDIR /app/backend

COPY --from=build --chown=node:node /app/node_modules /app/node_modules
COPY --from=build --chown=node:node /app/backend/dist /app/backend/dist
COPY --from=build --chown=node:node /app/backend/drizzle /app/backend/drizzle
COPY --from=build --chown=node:node /app/package/auth/package.json /app/package/auth/package.json
COPY --from=build --chown=node:node /app/package/auth/dist /app/package/auth/dist
COPY --from=build --chown=node:node /app/package/file-models/package.json /app/package/file-models/package.json
COPY --from=build --chown=node:node /app/package/file-models/dist /app/package/file-models/dist
COPY --from=build --chown=node:node /app/package/shared-types/package.json /app/package/shared-types/package.json
COPY --from=build --chown=node:node /app/package/shared-types/dist /app/package/shared-types/dist
COPY --from=build --chown=node:node /app/frontend/dist/frontend/browser /app/frontend/dist/frontend/browser

RUN mkdir -p /app/backend/data /tmp/fast-drive-uploads \
    && chown -R node:node /app/backend/data /tmp/fast-drive-uploads

USER node

EXPOSE 7000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:7000/api/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
