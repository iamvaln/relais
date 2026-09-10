#!/usr/bin/env bash
# Démarre un PostgreSQL 16 et un Redis locaux, jetables, pour le dev et les
# tests. Ne touche à aucune instance système. Idempotent.
#
#   scripts/dev-services.sh start   → PG sur $PG_PORT (défaut 55432), Redis sur $REDIS_PORT (55379)
#   scripts/dev-services.sh stop
#   scripts/dev-services.sh reset   → base recréée, migrations + seed rejoués
#
# Variables exportées à reprendre dans .env / l'environnement de test :
#   DATABASE_URL=postgresql://relais@localhost:$PG_PORT/relais_dev
#   REDIS_URL=redis://localhost:$REDIS_PORT

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_PORT="${PG_PORT:-55432}"
REDIS_PORT="${REDIS_PORT:-55379}"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
STATE_DIR="${RELAIS_DEV_STATE:-/var/lib/postgresql/relais-dev}"
PGDATA="$STATE_DIR/pgdata"
DB_NAME="${DB_NAME:-relais_dev}"
PSQL="psql -h localhost -p $PG_PORT -U relais"

# initdb refuse root : on passe par l'utilisateur postgres si nécessaire.
as_pg() {
  if [ "$(id -u)" = "0" ]; then su postgres -c "$*"; else bash -c "$*"; fi
}

start_pg() {
  if $PSQL -d postgres -c 'select 1' >/dev/null 2>&1; then
    echo "postgres : déjà démarré (port $PG_PORT)"; return
  fi
  mkdir -p "$STATE_DIR"
  if [ "$(id -u)" = "0" ]; then chown -R postgres:postgres "$STATE_DIR"; fi
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    as_pg "$PG_BIN/initdb -D '$PGDATA' -U relais --auth=trust" >/dev/null
  fi
  as_pg "$PG_BIN/pg_ctl -D '$PGDATA' -o '-p $PG_PORT -c listen_addresses=localhost' -l '$STATE_DIR/pg.log' start" >/dev/null
  for _ in $(seq 1 30); do
    $PSQL -d postgres -c 'select 1' >/dev/null 2>&1 && break
    sleep 0.5
  done
  echo "postgres : démarré (port $PG_PORT)"
}

start_redis() {
  if redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
    echo "redis : déjà démarré (port $REDIS_PORT)"; return
  fi
  mkdir -p "$STATE_DIR"
  redis-server --port "$REDIS_PORT" --daemonize yes --save '' --appendonly no \
    --logfile "$STATE_DIR/redis.log" --dir "$STATE_DIR" >/dev/null
  for _ in $(seq 1 30); do
    redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1 && break
    sleep 0.2
  done
  echo "redis : démarré (port $REDIS_PORT)"
}

reset_db() {
  $PSQL -d postgres -q -c "DROP DATABASE IF EXISTS $DB_NAME;" -c "CREATE DATABASE $DB_NAME;"
  for m in "$ROOT"/prisma/migrations/*/migration.sql; do
    $PSQL -d "$DB_NAME" -q -f "$m" >/dev/null
  done
  $PSQL -d "$DB_NAME" -q -f "$ROOT/prisma/seeds/001_checkin_questions.sql" >/dev/null
  redis-cli -p "$REDIS_PORT" flushall >/dev/null
  echo "base $DB_NAME : migrations + seed appliqués, redis vidé"
}

case "${1:-start}" in
  start)
    start_pg; start_redis
    $PSQL -d postgres -tAc "select 1 from pg_database where datname='$DB_NAME'" | grep -q 1 || reset_db
    echo "DATABASE_URL=postgresql://relais@localhost:$PG_PORT/$DB_NAME"
    echo "REDIS_URL=redis://localhost:$REDIS_PORT"
    ;;
  reset)
    start_pg; start_redis; reset_db
    ;;
  stop)
    as_pg "$PG_BIN/pg_ctl -D '$PGDATA' stop -m fast" >/dev/null 2>&1 || true
    redis-cli -p "$REDIS_PORT" shutdown nosave >/dev/null 2>&1 || true
    echo "services arrêtés"
    ;;
  *)
    echo "usage : $0 start|reset|stop" >&2; exit 1
    ;;
esac
