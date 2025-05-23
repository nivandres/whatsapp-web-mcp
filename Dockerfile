ARG BUN_VERSION=latest
ARG PORT=3000
FROM oven/bun:${BUN_VERSION} AS base

RUN apt-get update -qq && \
    apt-get install -y gconf-service libgbm-dev libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS build

COPY . .
RUN rm -rf node_modules && \
    bun install --ci

FROM base

COPY --from=build /app /app

ENTRYPOINT ["bun", "run", "index.ts"]
