#!/usr/bin/env bash
# Deploy the latest commit on an already provisioned host. Run as root.
set -euo pipefail

APP_DIR=/opt/tincan
APP_USER=tincan
BRANCH="${BRANCH:-main}"

sudo -u "$APP_USER" -H git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
sudo -u "$APP_USER" -H git -C "$APP_DIR" reset --quiet --hard "origin/$BRANCH"
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && bun install --frozen-lockfile && bun run build"
install -m 0644 "$APP_DIR/deploy/tincan-api.service" /etc/systemd/system/tincan-api.service
systemctl daemon-reload
systemctl restart tincan-api
systemctl is-active --quiet tincan-api
echo "Deployed $(sudo -u "$APP_USER" -H git -C "$APP_DIR" rev-parse --short HEAD)"
