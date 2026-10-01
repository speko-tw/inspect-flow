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
3. **Initialize the system**: `make init`. Copy the one-time
   first-login code printed by the command. If `admin` has no
   password yet, running the command again invalidates the old code
   and prints a new one. Initialization creates only the built-in
   `admin`; an administrator adds roles later in the system.
4. **Start the backend and frontend**, each in its own terminal:
   - `make run-backend` — API at `http://127.0.0.1:8000`.
   - `make run-frontend` — Vite at `http://localhost:5173`; it
     forwards `/api` to the backend.
5. **Set the admin password**: until the first-setup page from #264 is
   available, use the API from a terminal. The code expires after 24
   hours; if it expires or is locked, run `make init` again to issue a
   replacement. Read both values without echoing them or adding them to
   shell history, then send the JSON through standard input:

   ```bash
   printf 'First-login code: '
   IFS= read -r -s SETUP_CODE
   printf '\nAdmin password: '
   IFS= read -r -s ADMIN_PASSWORD
   printf '\n'
   export SETUP_CODE ADMIN_PASSWORD
   uv run --project backend python -c \
     'import json, os; print(json.dumps({"code": os.environ["SETUP_CODE"], "password": os.environ["ADMIN_PASSWORD"]}))' |
     curl --fail-with-body --silent --show-error \
       -X POST http://127.0.0.1:8000/api/v1/setup/admin-password \
       -H 'Content-Type: application/json' --data-binary @- \
       -o /dev/null -w 'HTTP %{http_code}\n'
   unset SETUP_CODE ADMIN_PASSWORD
   ```

   This request returns a login Cookie, which this command does not
   save; sign in through the existing login page with username `admin`
   and the password you just set. After #264 is complete, use its
   first-setup page instead.
6. **Reset the admin password when needed**: run
   `make reset-admin-password` on the server. Enter the new password
   twice; the terminal does not echo it. The command accepts piped
   standard input for automation and takes no password arguments.

Safari limitation: the session cookie uses the `__Host-` prefix,
which requires `Secure`. Safari does not send it over
`http://localhost`, so sign-in fails there. Chrome and Firefox work;
for Safari, see the next section.

## Testing with Safari or iPhone

Use the HTTPS dev server. Generate a local certificate with
[mkcert](https://github.com/FiloSottile/mkcert) into
`frontend/.cert/`, which is git-ignored; never commit it.

1. **Install mkcert** (once): `brew install mkcert`, then run
   `mkcert -install` so this machine trusts its root CA.
2. **Create a certificate**:

   ```bash
   mkdir -p frontend/.cert
   mkcert -cert-file frontend/.cert/dev.pem \
     -key-file frontend/.cert/dev-key.pem localhost 127.0.0.1
   ```

   For an iPhone, also append this machine's LAN IP.
3. **Start**: run `make run-backend` as above; start the frontend
   with:

   ```bash
   export INSPECTFLOW_DEV_HTTPS_CERT="$PWD/frontend/.cert/dev.pem"
   export INSPECTFLOW_DEV_HTTPS_KEY="$PWD/frontend/.cert/dev-key.pem"
   make run-frontend
   ```

   Open `https://localhost:5173` in Safari. With neither variable
   set, the dev server stays on plain HTTP.
4. **iPhone or iPad** (same LAN):
   - Also `export INSPECTFLOW_DEV_HOST=0.0.0.0` before starting the
     frontend so it listens on the LAN; the variable only works in
     HTTPS mode. The backend still binds 127.0.0.1 only; the
     frontend forwards `/api` to it.
   - Copy `rootCA.pem` from the `mkcert -CAROOT` directory to the
     iPhone, install it, then enable it under Settings > General >
     About > Certificate Trust Settings.
   - Open `https://<LAN IP>:5173`.

## Documentation

- [Design Intents](docs/intents/README.md) (Traditional Chinese): why InspectFlow is designed the way it is — overview and architecture diagrams, design principles, key decisions and tech stack, glossary, and open questions.
