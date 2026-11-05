# Verdikt — one service: the API, the verifier's Chromium, and the built web app on the same origin.
# On Render the service's environment variables reach the build as args; the VITE_ ones are public
# (they end up in the browser anyway). Secrets are read at runtime only.

# ---- the web app
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_PAYPAL_CLIENT_ID
ARG VITE_PLATFORM_FEE_PERCENT=2
ARG VITE_DEMO
RUN npm run build

# ---- the API + verifier
FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-color-emoji ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    CHROME_PATH=/usr/bin/chromium \
    WEB_DIST=/app/public

WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=web /web/dist ./public

EXPOSE 4100
# secrets come from a Render secret file when one is mounted, otherwise from the service's env vars
CMD ["node", "--env-file-if-exists=/etc/secrets/.env", "src/index.js"]
