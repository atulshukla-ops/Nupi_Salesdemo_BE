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

# ffmpeg converts uploaded videos; LibreOffice converts PowerPoint decks to PDF; tini forwards stop
# signals so shutdowns are clean. Fonts, so slides look like they do in PowerPoint:
#   Carlito / Caladea = same-size replacements for Calibri / Cambria (PowerPoint's default fonts)
#   Liberation        = same-size replacements for Arial, Times New Roman, Courier New
#   Noto              = most scripts, including Devanagari for Hindi slides
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tini libreoffice-impress-nogui \
      fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation2 \
      fonts-dejavu-core fonts-noto-core fonts-noto-ui-core \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe

WORKDIR /app
COPY package.json package-lock.json ./
# The slide renderer's native part is an optional package (left out with the other optional,
# large ones above): add the one for this server's CPU (x64 or ARM, e.g. AWS Graviton), at the
# exact version in package-lock.json.
ARG TARGETARCH
RUN npm ci --omit=dev --omit=optional --ignore-scripts \
 && CANVAS_VERSION=$(node -p "require('./package-lock.json').packages['node_modules/@napi-rs/canvas'].version") \
 && case "$TARGETARCH" in \
      arm64) CANVAS_PKG=@napi-rs/canvas-linux-arm64-gnu ;; \
      *)     CANVAS_PKG=@napi-rs/canvas-linux-x64-gnu ;; \
    esac \
 && npm install --no-save --ignore-scripts "$CANVAS_PKG@$CANVAS_VERSION" \
 && node -e "require('@napi-rs/canvas')" \
 && npm cache clean --force
COPY --from=build /app/build ./build

# logs/ and storage/ are mounted from the server (see docker-compose.yml)
RUN mkdir -p logs storage && chown -R node:node /app
USER node

EXPOSE 8130
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "build/index.js"]
