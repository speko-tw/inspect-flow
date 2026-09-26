.PHONY: setup setup-backend setup-frontend check \
	check-env check-backend check-frontend

# Installs backend and frontend dependencies.
setup: setup-backend setup-frontend

setup-backend:
	cd backend && uv sync --locked

setup-frontend:
	cd frontend && npm ci

# Single entry point for local and CI checks. Runs format, lint,
# type-check, test and build for backend and frontend, in order.
# Any failing step stops the run with a non-zero exit code.
# check-env/check-backend/check-frontend are invoked as separate
# $(MAKE) recipe lines (not prerequisites), so `make -j` cannot run
# them in parallel and a failure in one stops the later ones.
check:
	$(MAKE) --no-print-directory check-env
	$(MAKE) --no-print-directory check-backend
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

# Fails fast if frontend deps are missing. Not auto-installed here:
# CI runs its own `npm ci`, so installing on demand would hide
# lockfile problems that should fail the check instead.
check-frontend:
	@test -d frontend/node_modules || \
		(echo "frontend/node_modules not found. Run" \
			"'make setup' or 'make setup-frontend' first." && \
		exit 1)
	cd frontend && npm run format:check
	cd frontend && npm run lint
	cd frontend && npm run typecheck
	cd frontend && npm run test
	cd frontend && npm run build
	cd frontend && npm run check:split
