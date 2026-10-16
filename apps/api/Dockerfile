FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev
# schema.sql is read at runtime from dist/db/
RUN cp src/db/schema.sql dist/db/schema.sql

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Runs as the image's "node" user (uid/gid 1000), the same uid as the proxy and epg images, so the
# shared data volume has one owner everywhere. A new named volume is seeded from this directory
# (ownership included) on first mount, so /data must be owned by node before VOLUME.
# Installs made before this change have a root-owned volume: see docs/TROUBLESHOOTING.md.
RUN mkdir -p /data/epg /data/raw /data/logos \
 && chown -R node:node /data
VOLUME ["/data"]
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
