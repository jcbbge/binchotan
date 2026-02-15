#!/usr/bin/env bash
set -e

source .env 2>/dev/null || true

# Run migrations (idempotent, safe to re-run)
for f in database/migrations/*.sql; do
  psql "$DATABASE_URL" -f "$f" 2>/dev/null
done

exec bun run src/index.ts
