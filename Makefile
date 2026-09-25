.PHONY: setup setup-backend setup-frontend check \
	check-temp-fail check-env check-backend check-frontend

# Installs backend and frontend dependencies.
setup: setup-backend setup-frontend

setup-backend:
	cd backend && uv sync --locked

setup-frontend:
	cd frontend && npm ci

# Single entry point for local and CI checks. Runs format, lint,
# type-check, test and build for backend and frontend, in order.
# Any failing step stops the run with a non-zero exit code.
check: check-temp-fail check-env check-backend check-frontend

check-temp-fail:
	@false

# Fails if a .env file is tracked in git, or .env.example is missing.
check-env:
	@tracked_env=$$(git ls-files | grep -E '\.env$$' || true); \
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

check-frontend:
	cd frontend && npm run format:check
	cd frontend && npm run lint
	cd frontend && npm run typecheck
	cd frontend && npm run test
	cd frontend && npm run build
	cd frontend && npm run check:split
