# Carys — static production image (no GPU, no backend, no secrets).
# Stage 1 builds TypeScript; stage 2 serves static files via nginx.
# Samples are NOT baked in (343MB+): mount at /usr/share/nginx/html/samples.
#
#   docker build -t carys:latest .
#   docker run --rm -p 8080:80 \
#     -v /path/to/samples:/usr/share/nginx/html/samples:ro \
#     carys:latest
#   open http://localhost:8080/  (lands on the React app)

ARG NODE_TAG=20.20.2-alpine3.22
ARG NGINX_TAG=1.27.4-alpine3.21

FROM node:${NODE_TAG} AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY packages/volume-core/package.json packages/volume-core/
COPY packages/io/package.json packages/io/
COPY packages/measure/package.json packages/measure/
COPY packages/render-cpu/package.json packages/render-cpu/
COPY packages/editor-seg/package.json packages/editor-seg/
COPY packages/study/package.json packages/study/
COPY packages/dicomweb/package.json packages/dicomweb/
COPY packages/app/package.json packages/app/
COPY packages/ui/package.json packages/ui/
RUN npm ci --no-audit --no-fund
COPY packages/ ./packages/
COPY index.html ./
# Sample-free gate: full `npm test` needs samples/ (mounted at run time, not
# baked in), so the image runs the hermetic unit subset. CI/dev run `npm run verify`.
RUN npx tsc -b && npm run test:unit && npm run typecheck:app && npm run build:app

FROM nginx:${NGINX_TAG} AS serve
COPY --from=build /app/packages/volume-core/dist /usr/share/nginx/html/packages/volume-core/dist
COPY --from=build /app/packages/io/dist /usr/share/nginx/html/packages/io/dist
COPY --from=build /app/packages/measure/dist /usr/share/nginx/html/packages/measure/dist
COPY --from=build /app/packages/render-cpu/dist /usr/share/nginx/html/packages/render-cpu/dist
COPY --from=build /app/packages/editor-seg/dist /usr/share/nginx/html/packages/editor-seg/dist
COPY --from=build /app/packages/study/dist /usr/share/nginx/html/packages/study/dist
COPY --from=build /app/packages/dicomweb/dist /usr/share/nginx/html/packages/dicomweb/dist
COPY --from=build /app/packages/app/dist /usr/share/nginx/html/packages/app/dist
COPY --from=build /app/packages/ui /usr/share/nginx/html/packages/ui
COPY --from=build /app/index.html /usr/share/nginx/html/index.html
COPY README.md /usr/share/nginx/html/
RUN mkdir -p /usr/share/nginx/html/samples && chown -R nginx:nginx /usr/share/nginx/html
USER nginx
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://localhost/ || exit 1
