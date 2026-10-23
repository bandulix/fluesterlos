#!/usr/bin/env bash
set -euo pipefail

PG_VER=$(ls /etc/postgresql | sort -V | tail -1)
if ! pg_isready -q; then
  sudo pg_ctlcluster "$PG_VER" main start
fi

tries=0
until pg_isready -q; do
  tries=$((tries + 1))
  if [ "$tries" -ge 30 ]; then
    echo "Postgres did not become ready" >&2
    exit 1
  fi
  sleep 1
done

sudo -u postgres psql -v ON_ERROR_STOP=1 -f .cursor/ensure-role.sql

for db in fluesterlos fluesterlos_test; do
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1; then
    sudo -u postgres createdb -O fluesterlos "$db"
  fi
done

sudo mkdir -p /var/lib/fluesterlos
sudo chown "$(id -u):$(id -g)" /var/lib/fluesterlos

if ! tmux has-session -t fluesterlos-api 2>/dev/null; then
  tmux new-session -d -s fluesterlos-api -c /workspace \
    "env DATABASE_URL=postgres://fluesterlos:fluesterlos@127.0.0.1:5432/fluesterlos BOOTSTRAP_TOKEN=change-me-once PORT=3000 PUBLIC_URL=http://127.0.0.1:5173 CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173 DATA_DIR=/var/lib/fluesterlos DEFAULT_PHONE_COUNTRY=TH DEFAULT_EVENT_TIMEZONE=Asia/Bangkok npm run dev -w api 2>&1 | tee /tmp/fluesterlos-api.log"
fi

tries=0
until curl -sf http://127.0.0.1:3000/api/health >/dev/null; do
  tries=$((tries + 1))
  if [ "$tries" -ge 60 ]; then
    echo "API did not become ready" >&2
    tail -n 80 /tmp/fluesterlos-api.log >&2 || true
    exit 1
  fi
  sleep 1
done

if ! tmux has-session -t fluesterlos-web 2>/dev/null; then
  tmux new-session -d -s fluesterlos-web -c /workspace \
    "npm run dev -w web -- --host 0.0.0.0 --port 5173 2>&1 | tee /tmp/fluesterlos-web.log"
fi

tries=0
until curl -sf -o /dev/null http://127.0.0.1:5173/; do
  tries=$((tries + 1))
  if [ "$tries" -ge 60 ]; then
    echo "Web dev server did not become ready" >&2
    tail -n 80 /tmp/fluesterlos-web.log >&2 || true
    exit 1
  fi
  sleep 1
done
