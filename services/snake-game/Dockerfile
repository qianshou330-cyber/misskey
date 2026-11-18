FROM node:26.4.0-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
COPY scripts ./scripts
RUN npm run build && node --test dist/test/*.test.js

FROM node:26.4.0-trixie-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3021
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist/src ./dist/src
COPY LICENSE UPSTREAM.json ./
USER 991:991
EXPOSE 3021
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--max-old-space-size=384", "dist/src/index.js"]
