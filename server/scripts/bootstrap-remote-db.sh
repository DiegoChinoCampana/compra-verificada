#!/usr/bin/env bash
# Crea la base de datos Compra Verificada en un Postgres remoto (si no existe) y aplica db/schema.sql.
#
# Requisitos: cliente psql (paquete postgresql-client / libpq).
#
# Opción A — variables en el entorno (recomendado para servidor remoto con SSL):
#   export PGHOST=db.tudominio.com
#   export PGPORT=5432
#   export PGUSER=postgres
#   export PGPASSWORD='...'
#   export PGSSLMODE=require
#   export DB_NAME=compra_verificada
#   bash server/scripts/bootstrap-remote-db.sh
#
# Opción B — mismo criterio que la API: definí server/.env (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME).
#   bash server/scripts/bootstrap-remote-db.sh
#
# El usuario PGUSER debe poder CREATE DATABASE (rol superuser o createdb).
# POSTGRES_ADMIN_DB: base a la que conectar para el CREATE (default: postgres).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${DB_NAME:=compra_verificada}"
ADMIN_DB="${POSTGRES_ADMIN_DB:-postgres}"

if [[ ! "$DB_NAME" =~ ^[a-zA-Z0-9_]+$ ]]; then
  echo "DB_NAME inválido: usá solo letras, números y guión bajo." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "No está instalado psql. Instalá postgresql-client (Debian/Ubuntu) o libpq." >&2
  exit 1
fi

export PGHOST="${PGHOST:-${DB_HOST:-}}"
export PGPORT="${PGPORT:-${DB_PORT:-5432}}"
export PGUSER="${PGUSER:-${DB_USER:-}}"
export PGPASSWORD="${PGPASSWORD:-${DB_PASSWORD:-}}"

if [[ -z "$PGHOST" || -z "$PGUSER" ]]; then
  echo "Definí PGHOST y PGUSER (o DB_HOST y DB_USER en server/.env)." >&2
  exit 1
fi

export PGSSLMODE="${PGSSLMODE:-prefer}"

echo "==> Creando base \"${DB_NAME}\" si no existe (conectado a \"${ADMIN_DB}\")..."
psql -v ON_ERROR_STOP=1 -v "dbname=${DB_NAME}" -d "${ADMIN_DB}" <<'SQL'
SELECT format('CREATE DATABASE %I', :'dbname')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'dbname')\gexec
SQL

echo "==> Aplicando esquema (${ROOT}/db/schema.sql)..."
psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "${ROOT}/db/schema.sql"

echo "==> Listo."
echo "    DATABASE_URL=postgresql://${PGUSER}:***@${PGHOST}:${PGPORT}/${DB_NAME}"
echo "    (en Vercel usá la URL completa con contraseña URL-encoded y ?sslmode=require si aplica.)"
