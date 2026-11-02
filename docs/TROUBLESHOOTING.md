# Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Requests take ~2 s each on Windows | `localhost` resolves to IPv6 first while containers listen on IPv4. Use `127.0.0.1` in backend URLs (as in `.env.example`) |
| `System role 'owner' missing` | Run `uv run python -m app.cli sync-rbac` after migrations |
| Timezone rejected as unknown on Windows | Install backend deps (`uv sync`) — the `tzdata` package provides the IANA database |
| Port already in use | Change the `*_HOST_PORT` values in `.env` (defaults: 55432, 56379, 59000/59001, 51025/58025, 8100, 5180) |
| `permission denied` from the API on a new table | New tables get grants via default privileges; ensure the migration ran as `wflow_owner` |
| Postgres init script did not run | It only runs on an empty volume: `docker compose down -v` (destroys local data) then `up -d` |
| 429 "Too many requests" on sign-in in dev | Auth endpoints allow `AUTH_RATE_LIMIT` per minute per IP; wait a minute or raise it in `.env` |
| Emails not arriving | Development email is captured by Mailpit: http://localhost:58025 |
