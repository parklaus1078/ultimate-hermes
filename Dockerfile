FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HERMES_HOST=0.0.0.0 \
    PORT=8787
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json* ./
RUN npm prune --omit=dev
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/src/db/migrations ./src/db/migrations
COPY --chown=node:node --from=build /app/scripts/install_mcp_client.mjs ./scripts/install_mcp_client.mjs
COPY --chown=node:node --from=build /app/scripts/install_mcp_client.py ./scripts/install_mcp_client.py
COPY --chown=node:node certs/prod-ca-2021.crt ./certs/prod-ca-2021.crt
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/src/server/index.js"]
