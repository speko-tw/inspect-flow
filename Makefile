.PHONY: setup setup-backend setup-frontend check \
	check-env check-backend check-postgres check-frontend

# Installs backend and frontend dependencies.
setup: setup-backend setup-frontend

setup-backend:
	cd backend && uv sync --locked

setup-frontend:
	cd frontend && npm ci

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
