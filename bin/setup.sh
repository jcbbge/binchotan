#!/usr/bin/env bash
set -e

echo "Setting up Binchotan..."

bun install

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example — edit it with your DB credentials"
fi

source .env

# Test DB connection
echo "Testing database connection..."
psql "$DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1 || { echo "ERROR: Cannot connect to database at $DATABASE_URL"; exit 1; }

# Run migrations (idempotent)
echo "Running migrations..."
for f in database/migrations/*.sql; do
  echo "  → $f"
  psql "$DATABASE_URL" -f "$f"
done

echo "Setup complete."
