#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/opt/mysql@8.0/bin:$PATH"
DATADIR="${HOME}/.smm-portal/mysql-data"
mkdir -p "$(dirname "$DATADIR")"
if [ ! -d "$DATADIR/mysql" ]; then
  mkdir -p "$DATADIR"
  mysqld --initialize-insecure --datadir="$DATADIR"
fi
if ! mysqladmin --socket="$DATADIR/mysql.sock" -u root ping &>/dev/null; then
  mysqld --datadir="$DATADIR" --port=3307 --socket="$DATADIR/mysql.sock" \
    --pid-file="$DATADIR/mysqld.pid" --bind-address=127.0.0.1 --mysqlx=0 \
    >"$DATADIR/mysqld.out" 2>"$DATADIR/mysqld.err" &
  sleep 3
fi
mysql --protocol=TCP -h 127.0.0.1 -P 3307 -u root -e \
  "CREATE DATABASE IF NOT EXISTS smm_portal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
echo "Local MySQL ready on 127.0.0.1:3307 (persistent: $DATADIR)"
