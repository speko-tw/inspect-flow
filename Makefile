.PHONY: help setup setup-backend setup-frontend check \
	check-env check-version check-backend check-postgres check-frontend \
	migrate init reset-admin-password run-backend run-frontend \
	dev-cert run-frontend-https version

# Installs backend and frontend dependencies.
setup: setup-backend setup-frontend

# Lists the supported local development commands.
help:
	@printf '%s\n' \
		'Local development commands:' \
		'  make setup                  Install backend and frontend dependencies' \
		'  make migrate                Apply database migrations' \
		'  make init                   Create admin and first-login code' \
		'  make reset-admin-password   Reset the built-in admin password' \
		'  make version                Show the release version and commit' \
		'  make run-backend            Start the backend development server' \
		'  make run-frontend           Start the frontend development server' \
		'  make dev-cert               Create the local HTTPS certificate' \
		'  make run-frontend-https     Start the frontend over HTTPS' \
		'  make check                  Run repository checks'

setup-backend:
	cd backend && uv sync --locked

setup-frontend:
	cd frontend && npm ci

# Local run (see README "Running locally"). migrate and
# run-backend read the database target from
# INSPECTFLOW_DATABASE_URL in the environment; unset means the
# default SQLite file backend/data/inspectflow.db (ignored by
# backend/.gitignore). Neither Make nor the backend
# loads .env, so export its variables in the shell first.
# run-backend and run-frontend each block; run them in separate
# terminals. Port 8000 matches the Vite /api proxy default
# (frontend/vite.config.ts).
migrate:
	cd backend && uv run --locked alembic upgrade head

# System initialization command (DOM-R53): creates the built-in
# admin, then prints a one-time setup code.
# Run after `make migrate`; when admin has no password, rerunning
# replaces the old code. A configured admin cannot be reinitialized.
# Invoked as a module (`python -m`), not a `uv run` script entry
# point: backend/pyproject.toml sets `[tool.uv] package = false`
# (backend/pyproject.toml), so uv does not install
# `[project.scripts]` entry points for it (verified: `uv sync`
# prints "Skipping installation of entry points" for such a
# project) -- see plan.md's T6 row for this deviation from its
# original "只加指令入口" file list.
init:
	cd backend && uv run --locked python -m app.cli.init_system

# Reset only the built-in admin password (AUT-R47). Passwords are
# read twice without echo, from the terminal or piped stdin. The
# command accepts no account or password arguments.
reset-admin-password:
	cd backend && uv run --locked python -m app.cli.reset_admin_password

run-backend:
	cd backend && uv run --locked uvicorn app.main:app --reload \
		--host 127.0.0.1 --port 8000

# Print the same release identity as the backend startup log and API.
version:
	cd backend && uv run --locked python -m app version

run-frontend:
	cd frontend && npm run dev

# Local HTTPS for Safari (#307), which does not send the `__Host-`
# session cookie over http://localhost. dev-cert writes a mkcert
# certificate for localhost into frontend/.cert/ (git-ignored) and
# skips when both files already exist. It never runs
# `mkcert -install`, which changes the system trust store; it only
# prints that hint. run-frontend-https passes the certificate paths
# to Vite through the INSPECTFLOW_DEV_HTTPS_* variables
# (frontend/vite.config.ts). FRONTEND_PORT overrides the port; the
# port is strict, so an occupied one fails instead of moving.
# LAN access and iPhone trust stay manual (README, #231).
CERT_DIR := $(CURDIR)/frontend/.cert
CERT_FILE := $(CERT_DIR)/dev.pem
KEY_FILE := $(CERT_DIR)/dev-key.pem
FRONTEND_PORT ?= 5173

dev-cert:
	@if [ -f "$(CERT_FILE)" ] && [ -f "$(KEY_FILE)" ]; then \
		echo "dev-cert: certificate exists, skipped ($(CERT_DIR))"; \
		exit 0; \
	fi; \
	if ! command -v mkcert >/dev/null 2>&1; then \
		echo "dev-cert: mkcert is not installed."; \
		echo "Install it (macOS: brew install mkcert), run" \
			"'mkcert -install' once, then rerun 'make dev-cert'."; \
		exit 1; \
	fi; \
	mkdir -p "$(CERT_DIR)" && \
	mkcert -cert-file "$(CERT_FILE)" -key-file "$(KEY_FILE)" \
		localhost 127.0.0.1 && \
	if [ ! -f "$$(mkcert -CAROOT)/rootCA.pem" ]; then \
		echo "dev-cert: run 'mkcert -install' once so browsers" \
			"trust this certificate."; \
	fi

run-frontend-https: dev-cert
	cd frontend && \
	INSPECTFLOW_DEV_HTTPS_CERT="$(CERT_FILE)" \
	INSPECTFLOW_DEV_HTTPS_KEY="$(KEY_FILE)" \
	npm run dev -- --port $(FRONTEND_PORT) --strictPort

# Single entry point for local and CI checks. Runs format, lint,
# type-check, test and build for backend and frontend, in order.
# check-postgres runs the PostgreSQL compatibility check (DBF-R10)
# between them: SKIPPED (exit 0) when INSPECTFLOW_TEST_POSTGRES_URL
# is unset, so this passes on a machine with no PostgreSQL
# available. Any failing step stops the run with a non-zero exit
# code. check-env/check-backend/check-postgres/check-frontend are
# invoked as separate $(MAKE) recipe lines (not prerequisites), so
# `make -j` cannot run them in parallel and a failure in one stops
# the later ones.
check:
	$(MAKE) --no-print-directory check-env
	$(MAKE) --no-print-directory check-version
	$(MAKE) --no-print-directory check-backend
	$(MAKE) --no-print-directory check-postgres
	$(MAKE) --no-print-directory check-frontend

# Fails if a .env file is tracked in git, or .env.example is missing.
check-env:
	@tracked_files=$$(git ls-files); \
	status=$$?; \
	if [ $$status -ne 0 ]; then \
		echo "git ls-files failed (exit $$status)"; \
		exit 1; \
	fi; \
	tracked_env=$$(echo "$$tracked_files" | grep -E '\.env$$'); \
	if [ -n "$$tracked_env" ]; then \
		echo "tracked .env file(s) found (must not be committed):"; \
		echo "$$tracked_env"; \
		exit 1; \
	fi
	@test -f .env.example || \
		(echo ".env.example is missing" && exit 1)

# VERSION is the source of truth; keep both package manifests aligned.
check-version:
	python3 scripts/check-version.py

check-backend:
	cd backend && uv run --locked ruff format --check .
	cd backend && uv run --locked ruff check .
	cd backend && uv run --locked pyright
	cd backend && uv run --locked pytest
	cd backend && uv run --locked python -m compileall -q app

# PostgreSQL compatibility check (DBF-R10, DBF-AC08). Uses
# INSPECTFLOW_TEST_POSTGRES_URL rather than INSPECTFLOW_DATABASE_URL
# because this check drops and recreates the target database's
# entire `public` schema -- a developer's configured
# INSPECTFLOW_DATABASE_URL may point at a database with real data,
# so it must never be assumed safe to wipe (see .env.example).
# SKIPPED (exit 0) rather than failed when the variable is unset.
# Not echoed anywhere below: the URL may carry a password.
check-postgres:
	@if [ -z "$$INSPECTFLOW_TEST_POSTGRES_URL" ]; then \
		echo "check-postgres: SKIPPED (INSPECTFLOW_TEST_POSTGRES_URL is not set)"; \
		exit 0; \
	fi; \
	cd backend && uv run --locked python -m tests.db.reset_postgres_schema && \
	INSPECTFLOW_DATABASE_URL="$$INSPECTFLOW_TEST_POSTGRES_URL" \
		uv run --locked alembic upgrade head && \
	uv run --locked pytest tests/db --db-backend=postgresql

# Fails fast if frontend deps are missing. Not auto-installed here:
# CI runs its own `npm ci`, so installing on demand would hide
# lockfile problems that should fail the check instead.
# Checks for .bin/prettier (the first tool format:check runs)
# instead of the node_modules dir itself, since a dir that exists
# but is empty (e.g. an interrupted `npm ci`) would otherwise pass.
check-frontend:
	@test -x frontend/node_modules/.bin/prettier || \
		(echo "frontend/node_modules is missing or incomplete. Run" \
			"'make setup' or 'make setup-frontend' first." && \
		exit 1)
	cd frontend && npm run format:check
	cd frontend && npm run lint
	cd frontend && npm run typecheck
	cd frontend && npm run test
	cd frontend && npm run build
	cd frontend && npm run check:split
