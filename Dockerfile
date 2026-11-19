# CASE 404 — single-container deployment (API + built web client + SQLite on a volume).
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 DATABASE_PATH=/app/data/case404.db
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/release-manifest.json ./
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/content ./content
# The answer key ships in the image only because this repository is private.
# Prefer mounting it instead: -v /secure/answers.json:/run/secrets/answers.json -e CASE_ANSWERS_PATH=/run/secrets/answers.json
COPY --from=build /app/private/organizer/answers.json ./private/organizer/answers.json
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 8787
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/api/dist/server.js"]
