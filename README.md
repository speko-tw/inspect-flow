# inspect-flow

**English** | [繁體中文](README.zh-TW.md)

Engineering Inspection Management System

## Running checks

Requirements: [uv](https://docs.astral.sh/uv/), Node.js (version from
`frontend/.nvmrc`), and `make`.

- `make setup` installs backend and frontend dependencies.
- `make check` runs, for backend and frontend, format checks, lint,
  type checks, tests, and build, plus the frontend bundle-split
  check.
- CI runs the same `make check` on every pull request and on every
  push to `main`.
- Copy `.env.example` to `.env` for local environment variables;
  `.env` must not be committed.

## Running locally

Run `make setup` first. Each step below runs from the repository
root.

1. **Environment variables** (optional). The backend reads them
   from the shell environment; `.env` is not loaded automatically.
   With `INSPECTFLOW_DATABASE_URL` unset, the database is the SQLite
   file `backend/data/inspectflow.db` (git-ignored). To change it or
   other settings, copy `.env.example` to `.env`, edit it, then load
   it into the current shell:

   ```bash
   set -a; . ./.env; set +a
   ```

2. **Apply migrations**: `make migrate`.
3. **Initialize the system**: `make init`. Prompts for the first
   company's code and name, and the required basic fields of the
   built-in `admin` account and the owner's personal account;
   running it again on an already-initialized database reports that
   and writes nothing. **Set a password**: provided by #154, to be
   added here once merged.
4. **Start the backend and frontend**, each in its own terminal:
   - `make run-backend` — API at `http://127.0.0.1:8000`.
   - `make run-frontend` — Vite at `http://localhost:5173`; it
     forwards `/api` to the backend.
5. **Sign in**: open `http://localhost:5173` in a browser.

Known limitation: the session cookie uses the `__Host-` prefix,
which requires `Secure`. Safari does not send it over
`http://localhost`, so sign-in fails there (see #169). Chrome and
Firefox work.

## Documentation

- [Design Intents](docs/intents/README.md) (Traditional Chinese): why InspectFlow is designed the way it is — overview and architecture diagrams, design principles, key decisions and tech stack, glossary, and open questions.
