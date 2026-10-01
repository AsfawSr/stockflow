# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f apps/api/Dockerfile .

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --workspace=@stockflow/api --include-workspace-root
COPY apps/api apps/api
RUN npm run build --workspace=@stockflow/api

# One-shot stage with the Prisma CLI, schema, and migrations for `migrate deploy`.
FROM build AS migrate
CMD ["npm", "run", "db:migrate", "--workspace=@stockflow/api"]

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --workspace=@stockflow/api --include-workspace-root \
    && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
USER node
ENV HOST=0.0.0.0 PORT=3001
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
