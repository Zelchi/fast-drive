SHELL := /usr/bin/env bash

.DEFAULT_GOAL := help

.PHONY: help install dev dev-packages backend frontend build build-packages build-backend build-frontend desktop-dev desktop-build desktop-check test test-backend test-frontend lint format format-check check db-generate db-migrate db-push docker-build docker-up docker-down docker-logs

help:
	@printf 'Uso: make <comando>\n\nComandos:\n'
	@awk -F: '/^[a-zA-Z][a-zA-Z0-9_.-]*:/ {printf "  %s\n", $$1}' $(MAKEFILE_LIST)

install:
	yarn install --frozen-lockfile --ignore-engines

dev:
	yarn dev

dev-packages:
	yarn dev:packages

backend:
	yarn --cwd backend start:dev

frontend:
	yarn --cwd frontend start

build:
	yarn build

build-packages:
	yarn build:packages

build-backend: build-packages
	yarn --cwd backend build

build-frontend: build-packages
	yarn --cwd frontend build

desktop-dev:
	yarn desktop:dev

desktop-build:
	yarn desktop:build

desktop-check:
	CCACHE_DISABLE=1 cargo check --release --locked --manifest-path software/tauri/Cargo.toml

test:
	yarn test

test-backend:
	yarn --cwd backend test

test-frontend:
	yarn --cwd frontend test --watch=false

lint:
	yarn lint

format:
	yarn format

format-check:
	yarn format:check

check:
	yarn biome:check

db-generate:
	yarn --cwd backend db:generate

db-migrate:
	yarn --cwd backend db:migrate

db-push:
	yarn --cwd backend db:push

docker-build:
	docker compose build

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f fast-drive
