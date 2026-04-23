-- Crear la base vacía si no existe (misma lógica que npm run db:ensure).
-- Conectate a la base administrativa, p. ej. postgres:
--
--   psql "host=db.tudominio.com port=5432 user=postgres dbname=postgres sslmode=require" \
--     -v ON_ERROR_STOP=1 -v dbname=compra_verificada -f server/db/create_database.sql
--
-- Luego aplicá el esquema:
--   psql "host=... dbname=compra_verificada ..." -v ON_ERROR_STOP=1 -f server/db/schema.sql

SELECT format('CREATE DATABASE %I', :'dbname')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'dbname')\gexec
