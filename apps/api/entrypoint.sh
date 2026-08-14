#!/bin/sh
set -e
echo "entrypoint: running migrations..."
alembic upgrade head
echo "entrypoint: migrations complete, starting: $*"
exec "$@"
