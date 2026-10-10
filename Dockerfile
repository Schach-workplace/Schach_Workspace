FROM node:24-alpine AS web
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
COPY shared/ /src/shared/
RUN npm run build

FROM golang:1.27-alpine AS api
RUN apk add --no-cache gcc musl-dev
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/workspace ./cmd/server && CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate

FROM alpine:3
RUN apk add --no-cache ca-certificates tzdata && addgroup -S workspace && adduser -S -G workspace workspace
RUN mkdir -p /app/media && chown -R workspace:workspace /app && chmod 700 /app/media
WORKDIR /app
COPY --from=api /out/workspace /app/workspace
COPY --from=api /out/migrate /app/migrate
COPY --from=web /src/frontend/dist /app/web
USER workspace
EXPOSE 8080
ENTRYPOINT ["/app/workspace"]
CMD ["--addr", ":8080", "--frontend", "/app/web"]
