# The whatsapp-web.js to run: a version, or a commit on GitHub such as pedroslopez's main.
ARG WWEBJS=github:pedroslopez/whatsapp-web.js#38eb45b2759450cc6fccb6a7a3f2cbc3bdb87db2

FROM oven/bun:1.4 AS deps
ARG WWEBJS
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=1
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production \
    && bun add --production --no-save "whatsapp-web.js@${WWEBJS}"

FROM oven/bun:1.4-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY package.json ./
COPY src src
RUN mkdir -p /data && chown bun:bun /data
ENV NODE_ENV=production \
    DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=3000 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROMIUM_ARGS=--no-sandbox
USER bun
VOLUME /data
EXPOSE 3000
ENTRYPOINT ["bun", "src/index.ts"]
CMD ["http"]
