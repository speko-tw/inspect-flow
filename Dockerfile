FROM node:24-alpine AS frontend-build

WORKDIR /src/frontend
COPY VERSION /src/VERSION
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY backend/app/permission_codes.json /src/backend/app/permission_codes.json
RUN npm run build

FROM ghcr.io/astral-sh/uv:0.11.23 AS uv

FROM python:3.12-slim AS backend-build
COPY --from=uv /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /src/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY backend/ ./

FROM python:3.12-slim AS runtime
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    INSPECTFLOW_DATABASE_URL=sqlite:////data/inspectflow.db \
    INSPECTFLOW_STATIC_DIR=/app/static
WORKDIR /app
RUN groupadd --system inspectflow \
    && useradd --system --gid inspectflow --home-dir /app inspectflow \
    && mkdir -p /data /uploads /app/static \
    && chown -R inspectflow:inspectflow /data /uploads /app
COPY --from=backend-build --chown=inspectflow:inspectflow /opt/venv /opt/venv
COPY --from=backend-build --chown=inspectflow:inspectflow /src/backend /app
COPY VERSION /VERSION
COPY --from=frontend-build --chown=inspectflow:inspectflow \
    /src/frontend/dist /app/static
USER inspectflow
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
