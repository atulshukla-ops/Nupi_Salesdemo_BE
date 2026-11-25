# NupiPay Sales Demo Room - backend image.
# One image, two containers (see docker-compose.yml):
#   api    -> node build/index.js   (REST API + live sync relay at /sync)
#   worker -> node build/worker.js  (video processing + nightly cleanup)
# Settings come from the server's .env at run time; nothing secret is baked into the image.

# ---------- 1. build: TypeScript -> JavaScript ----------
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --omit=optional: the npm-bundled ffmpeg (~400 MB) is not needed, the image has system ffmpeg
RUN npm ci --omit=optional --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- 2. runtime: only what is needed to run ----------
FROM node:24-bookworm-slim AS runtime

# ffmpeg converts uploaded videos; tini forwards stop signals so shutdowns are clean
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts && npm cache clean --force
COPY --from=build /app/build ./build

# logs/ and storage/ are mounted from the server (see docker-compose.yml)
RUN mkdir -p logs storage && chown -R node:node /app
USER node

EXPOSE 8130
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "build/index.js"]
