# The Vite artifacts are architecture-independent, so build them once on the
# native Buildx platform. Only nginx is resolved for each target architecture.
FROM --platform=$BUILDPLATFORM node:26-alpine AS web-builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild rolldown
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
USER root
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-builder /app/dist /usr/share/nginx/html
RUN chmod a=r /etc/nginx/conf.d/default.conf \
    && chmod -R a=rX /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/_health || exit 1
USER 101
CMD ["nginx", "-g", "daemon off;"]
