# How to self-host FocusFlow with Docker Compose

This recipe gets a working FocusFlow instance running on your own machine
or server using the bundled Docker Compose stack (Postgres, the FastAPI
backend, the Next.js frontend, and an Nginx front door).

## Prerequisites

- Docker and the Docker Compose plugin installed.
- `openssl` available on your `PATH` (used to generate secrets).

## Steps

1. **Clone the repository** and change into it:

   ```sh
   git clone <this-repo-url>
   cd focusflow-app
   ```

2. **Copy the environment template:**

   ```sh
   cp .env.example .env
   ```

3. **Generate secrets.** Every secret in `.env` ships empty on purpose —
   the app refuses to start rather than run with an absent or guessable
   secret. Generate all three and paste each value into `.env`:

   ```sh
   openssl rand -hex 32   # -> INTERNAL_API_SECRET
   openssl rand -hex 32   # -> AUTH_SECRET
   openssl rand -hex 32   # -> POSTGRES_PASSWORD
   ```

   Leave `POMODORO_TEST_SHORT_INTERVALS` empty — it's a QA-only override
   that shortens Pomodoro intervals for testing and should not be set in
   a real deployment.

4. **Start the stack:**

   ```sh
   docker compose up -d --build
   ```

5. **Open the app:** visit `http://localhost` in your browser. You should
   land on the sign-up screen. Create an account and start tracking focus
   time against your tasks.

## ⚠ TLS warning

The bundled Nginx terminates **plaintext HTTP on port 80 only** — there is
no TLS/HTTPS support built in. This is fine for `localhost` use, but if you
expose this stack beyond your own machine (a LAN, a public server), you
**must** put a TLS-terminating reverse proxy (e.g. Caddy, another Nginx
instance, or a managed load balancer) in front of it first. Serving
sign-in credentials and session cookies over plaintext HTTP to a network
beyond your own machine is a real credential-exposure risk.

## Rate limiting behind another proxy

The bundled Nginx rate-limits login-adjacent endpoints by the connecting
client IP. If you place another reverse proxy (per the TLS note above) in
front of this stack, every request will appear to Nginx as coming from
that proxy's IP — making the rate limit effectively global across all your
visitors instead of per-visitor. If you add a proxy, configure
`real_ip_header` / `set_real_ip_from` in `apps/nginx/nginx.conf` for your
proxy's address so the original client IP is preserved.

## Stopping the stack

```sh
docker compose down
```

Add `-v` to also remove the Postgres data volume (this deletes all data).
