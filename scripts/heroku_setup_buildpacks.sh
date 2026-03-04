#!/usr/bin/env bash
set -euo pipefail

# One-shot setup for this project on an existing Heroku app:
# - Ensures buildpack order is Node.js then Python
# - Ensures Heroku Postgres exists
# - Sets ENV=prod
#
# Usage:
#   HEROKU_APP="your-app-name" ./scripts/heroku_setup_buildpacks.sh
#
# Notes:
# - Buildpacks are stored on the Heroku app; you only need to run this once per app.
# - You still create the app separately (e.g. `heroku create ... --team identity-software`).

if [[ -z "${HEROKU_APP:-}" ]]; then
  HEROKU_APP=crownpack-production
fi

echo "Setting buildpacks on ${HEROKU_APP}…"
heroku buildpacks:clear -a "$HEROKU_APP"
heroku buildpacks:add heroku/nodejs -a "$HEROKU_APP"
heroku buildpacks:add heroku/python -a "$HEROKU_APP"

echo "Ensuring Postgres addon exists…"
if ! heroku addons -a "$HEROKU_APP" | rg -q "heroku-postgresql"; then
  heroku addons:create heroku-postgresql:essential-0 -a "$HEROKU_APP"
fi

echo "Setting config vars…"
heroku config:set ENV=prod -a "$HEROKU_APP"

echo "Done."


