FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api ./apps/api
COPY apps/web ./apps/web
RUN --mount=type=secret,id=validation_ca,required=false \
    if [ -f /run/secrets/validation_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/validation_ca; fi; \
    npm ci --no-audit --no-fund --fetch-retries=1 --fetch-timeout=30000 && npm run build
FROM nginx:1.27-alpine
COPY --from=build /usr/local /usr/local
COPY --from=build /usr/lib/libstdc++.so* /usr/lib/
COPY --from=build /usr/lib/libgcc_s.so* /usr/lib/
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY infra/db/init ./infra/db/init
COPY deployment/render-staging ./deployment/render-staging
ENV NODE_ENV=production API_PORT=4000 PORT=10000 COOKIE_SECURE=true
EXPOSE 10000
ENTRYPOINT ["node", "deployment/render-staging/start.mjs"]
