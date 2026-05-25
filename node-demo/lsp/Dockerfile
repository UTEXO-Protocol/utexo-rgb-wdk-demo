# Local override of utexo-lsp's Dockerfile.
#
# Upstream's Dockerfile builds with CGO_ENABLED=0, but go-sqlite3
# requires cgo at runtime ("Binary was compiled with 'CGO_ENABLED=0',
# go-sqlite3 requires cgo to work. This is a stub"). We rebuild with
# cgo enabled so the SQLite driver actually runs. Same behaviour
# otherwise — just bigger binary.
#
# Upstream PR opportunity: flip their Dockerfile to either CGO_ENABLED=1
# with sqlite-dev installed, or default DATABASE_DRIVER=postgres.

FROM golang:1.26-alpine AS builder

WORKDIR /app
RUN apk add --no-cache ca-certificates gcc musl-dev sqlite-dev

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=1 go build -o application ./main.go

FROM alpine:3.22 AS runtime

WORKDIR /app
RUN apk add --no-cache ca-certificates sqlite-libs wget

COPY --from=builder /app/application /application

ENTRYPOINT ["/application"]
