FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS runner
WORKDIR /app

# hadolint ignore=DL3018
RUN apk add --no-cache su-exec openssl

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV PUID=1000
ENV PGID=1000
ENV GENERATE_SELFSIGNED_CERT=false

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server.ts next.config.ts tsconfig.json postcss.config.mjs ./
COPY app ./app

COPY data ./defaults/data
COPY docker-entrypoint.sh /docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "--import", "tsx", "server.ts"]
