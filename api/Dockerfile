FROM node:22-alpine AS build
WORKDIR /app
# Install from the workspace lockfile for reproducible builds.
COPY package.json package-lock.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json
RUN npm ci -w api --include-workspace-root=false
COPY api/tsconfig.json ./api/tsconfig.json
COPY api/src ./api/src
RUN npm run build -w api
RUN npm prune --omit=dev -w api --include-workspace-root=false

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/api/package.json ./api/package.json
COPY --from=build /app/api/dist ./api/dist
WORKDIR /app/api
EXPOSE 3000
CMD ["node", "dist/index.js"]
