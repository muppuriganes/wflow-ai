FROM node:20-bookworm-slim AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim
# System Chromium for whatsapp-web.js (puppeteer's own download is skipped).
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-noto-color-emoji ca-certificates dumb-init \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    GATEWAY_HOST=0.0.0.0 \
    SESSION_ROOT=/data/sessions \
    CHROME_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_ARGS=--no-sandbox,--disable-dev-shm-usage
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN useradd --create-home --uid 10001 wflow && mkdir -p /data/sessions && chown -R wflow /data /app
USER wflow
VOLUME ["/data/sessions"]
EXPOSE 8200
# dumb-init forwards SIGTERM so sessions shut down gracefully and resume after restart.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
