# PandaPlan Draw — static build served by nginx. No server process, no runtime deps.
FROM alpine:3.20 AS drawio
ARG DRAWIO_VERSION=32.6.10
RUN apk add --no-cache curl unzip \
 && curl -fsSL -o /tmp/draw.war "https://github.com/jgraph/drawio/releases/download/v${DRAWIO_VERSION}/draw.war" \
 && mkdir -p /drawio && unzip -q /tmp/draw.war -d /drawio \
 && rm -f /tmp/draw.war && rm -rf /drawio/META-INF /drawio/WEB-INF

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS serve
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=drawio /drawio /usr/share/nginx/html/drawio
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
