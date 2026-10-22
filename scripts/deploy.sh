#!/usr/bin/env bash
#
# Deploys the checkout this script lives in: the upgrade path of docs/09-deployment.md, as one
# command. Run on the server, after `git pull` — by hand, or by .github/workflows/deploy.yml over
# SSH. Every step must succeed, and `up --wait` returns only once every service is healthy, so a
# broken build or a migration that fails fails the deploy instead of passing it.
#
# A failed BUILD leaves the running containers as they were: `up` is never reached.
set -euo pipefail

cd "$(dirname "$0")/.."
echo "Deploying $(git log --oneline -1)"

# The latest Postgres 18 minor release; the major version is the image tag, changed deliberately.
docker compose pull db
# api and web on FRESH base images, so Bun and Caddy security patches arrive too.
docker compose build --pull
docker compose up --detach --wait --remove-orphans
# The images this build replaced. Named volumes — the database, the uploads — are never touched.
docker image prune --force

docker compose ps --format 'table {{.Service}}\t{{.Status}}'
