# inspect-flow

**English** | [繁體中文](README.zh-TW.md)

Engineering Inspection Management System

## Running checks

Requirements: [uv](https://docs.astral.sh/uv/), Node.js (version from
`frontend/.nvmrc`), and `make`.

- `make setup` installs backend and frontend dependencies.
- `make version` prints the release version and the short commit SHA
  when Git information is available.
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

Run `make version` to check the release version and source commit.

1. **Environment variables** (optional). The backend reads them
   from the shell environment; `.env` is not loaded automatically.
   With `INSPECTFLOW_DATABASE_URL` unset, the database is the SQLite
   file `backend/data/inspectflow.db` (git-ignored). To change it or
   other settings, copy `.env.example` to `.env`, edit it, then load
   it into the current shell:

   `INSPECTFLOW_VERSION` and `INSPECTFLOW_COMMIT` can override the
   release version and short commit displayed by the backend and
   frontend. When unset, the version comes from `VERSION` and the
   commit is read from Git when available.

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
5. **Set the admin password**: open the first-setup page at
   `http://localhost:5173/setup` (opening `/` or `/login` redirects
   there until setup is done). Enter the first-login code printed by
   `make init` and the new password twice (8 to 128 characters). The
   code expires after 24 hours; if it expires or is locked, run
   `make init` again to issue a replacement. After the password is
   set you are signed in as `admin`; the page then offers to add the
   first user (it shows a temporary password once) or to skip to the
   admin pages.
6. **Reset the admin password when needed**: run
   `make reset-admin-password` on the server. Enter the new password
   twice; the terminal does not echo it. The command accepts piped
   standard input for automation and takes no password arguments.

Safari limitation: the session cookie uses the `__Host-` prefix,
which requires `Secure`. Safari does not send it over
`http://localhost`, so sign-in fails there. Chrome and Firefox work;
for Safari, see the next section.

## Testing with Safari or iPhone

Use the HTTPS dev server. It needs
[mkcert](https://github.com/FiloSottile/mkcert) (once:
`brew install mkcert`, then `mkcert -install` so this machine trusts
its root CA). Then, with `make run-backend` already running, two
commands are enough:

```bash
make dev-cert            # creates frontend/.cert/, skips if present
make run-frontend-https  # starts the frontend over HTTPS
```

Open `https://localhost:5173` in Safari. `frontend/.cert/` is
git-ignored; never commit it. `make dev-cert` stops with an install
hint if mkcert is missing. To use another port, run
`make run-frontend-https FRONTEND_PORT=<port>`. `make run-frontend`
stays on plain HTTP.

**iPhone or iPad** (same LAN) setup and device acceptance (#231):

- Regenerate the certificate with this machine's LAN IP appended:

  ```bash
  mkdir -p frontend/.cert
  mkcert -cert-file frontend/.cert/dev.pem \
    -key-file frontend/.cert/dev-key.pem \
    localhost 127.0.0.1 <LAN IP>
  ```

  Replace `<LAN IP>` with the development machine's IPv4 address. This
  overwrites the files `make dev-cert` created.
- Find the iPhone's IPv4 address and subnet mask in its Wi-Fi network
  details. For example, use `192.168.1.0/24` when both devices are on
  that subnet. Start the frontend with:

  ```bash
  make run-frontend-https \
    INSPECTFLOW_DEV_HOST=192.168.1.20 \
    INSPECTFLOW_DEV_ALLOWED_CIDR=192.168.1.0/24
  ```

  Replace the example host with the LAN IP used in the certificate, and
  replace the CIDR with the actual allowed subnet. The server binds only
  to that interface, and the LAN guard accepts only that Host value;
  requests from outside the CIDR receive HTTP 403. `INSPECTFLOW_DEV_HOST` and
  `INSPECTFLOW_DEV_ALLOWED_CIDR` are accepted only with HTTPS and must be
  set together. Without them, Vite stays on loopback. The backend still
  binds `127.0.0.1`; the frontend forwards `/api` to it.
- On the development machine, run `mkcert -CAROOT` and transfer only
  `rootCA.pem` from that directory to the iPhone (for example, with
  AirDrop). This is the public root certificate. **Never transfer
  `rootCA-key.pem` or any CA private key.** Open the certificate on the
  iPhone and install the downloaded certificate profile in Settings.
  Then go to Settings > General > About > Certificate Trust Settings and
  enable full trust for the installed root certificate.
- In Safari, open `https://<LAN IP>:5173/field/`, sign in, reload the
  page and confirm the session remains signed in, then sign out. To add
  Field to the Home Screen, use Share > Add to Home Screen; open it once
  from the new icon to confirm standalone display.

  **Device acceptance: NOT_RUN (requires the owner's iPhone).** Verify
  that an allowed subnet can connect and an outside source gets HTTP 403,
  then complete the Safari sign-in, reload, sign-out, and Home Screen
  steps above.

## Documentation

- [Design Intents](docs/intents/README.md) (Traditional Chinese): why InspectFlow is designed the way it is — overview and architecture diagrams, design principles, key decisions and tech stack, glossary, and open questions.
