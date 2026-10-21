#!/bin/sh
# One-shot WordPress bootstrap for Docker Compose (runs in the wordpress:cli image).
# Installs WordPress, activates Terra Fleet and seeds three Dispatch issues.
set -eu

SITE_URL="${WP_SITE_URL:-http://localhost:8080}"

echo "Waiting for the database…"
# --skip-ssl: the alpine MariaDB client rejects MySQL 8.4's self-signed cert (PHP/mysqli is unaffected)
until wp db check --skip-ssl --quiet >/dev/null 2>&1; do sleep 3; done

if ! wp core is-installed >/dev/null 2>&1; then
  wp core install \
    --url="$SITE_URL" \
    --title="Terra Dispatch" \
    --admin_user="${WP_ADMIN_USER:-terra}" \
    --admin_password="${WP_ADMIN_PASSWORD:-change-me-locally}" \
    --admin_email="${WP_ADMIN_EMAIL:-admin@example.com}" \
    --skip-email
fi

wp rewrite structure '/%postname%/' --hard
wp post delete 1 --force >/dev/null 2>&1 || true   # the default "Hello world!" post
wp plugin activate terra-fleet
wp option update terra_fleet_api_url "${TERRA_API_INTERNAL_URL:-http://api:8080}"
wp option update terra_fleet_app_url "${TERRA_APP_URL:-http://localhost:8081}"

seed() {
  issue="$1"; title="$2"; body="$3"
  if [ -z "$(wp post list --post_type=post --meta_key=terra_issue --meta_value="$issue" --format=ids)" ]; then
    id=$(wp post create --post_type=post --post_status=publish --post_title="$title" --post_content="$body" --porcelain)
    wp post meta update "$id" terra_issue "$issue"
  fi
}

seed 1 "The Brisbane CBD is open for traffic" "<p>Real streets from OpenStreetMap, ready for your self-driving utes to learn.</p>[terra_play label=\"Build some roads\" path=\"/city\"]"
seed 2 "Storm cells added to the Coral Sea" "<p>Freighters to Nadi and Honiara now have to fly around drifting cyclones.</p>[terra_network]"
seed 3 "Ships learn the North-West Channel" "<p>Container ships leave Moreton Bay without kissing Bribie Island. Mostly.</p>[terra_leaderboard take=\"5\"]"

if [ -z "$(wp post list --post_type=page --name=leaderboard --format=ids)" ]; then
  wp post create --post_type=page --post_status=publish --post_title="Leaderboard" --post_name=leaderboard --post_content="[terra_network][terra_leaderboard take=\"20\"]"
fi

echo "WordPress ready at $SITE_URL (Dispatch posts seeded)."
