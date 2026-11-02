#!/bin/bash
# Runs once, on first start of an empty data volume.
# Creates the runtime role (no BYPASSRLS, not the table owner) and the test database.
set -euo pipefail

for db in "$POSTGRES_DB" "${POSTGRES_DB}_test"; do
  if [ "$db" != "$POSTGRES_DB" ]; then
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
      -c "CREATE DATABASE \"$db\" OWNER \"$POSTGRES_USER\";"
  fi
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE EXTENSION IF NOT EXISTS vector;
EOSQL
done

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
  CREATE ROLE wflow_app LOGIN PASSWORD '${APP_DB_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO wflow_app;
  GRANT CONNECT ON DATABASE "${POSTGRES_DB}_test" TO wflow_app;
EOSQL
