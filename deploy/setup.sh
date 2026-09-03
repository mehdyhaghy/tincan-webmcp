#!/usr/bin/env bash
# Provision an Ubuntu 24.04 host to serve TinCan over HTTPS only.
#
# Usage, as root on the host:
#   DOMAIN=tincandemo.example.com bash setup.sh
#
# Optional environment: REPO_URL, BRANCH, CERTBOT_EMAIL.
# The script is idempotent. Rerunning it refreshes packages, the checkout, and
# the build without reissuing the certificate or duplicating firewall rules.
set -euo pipefail

DOMAIN="${DOMAIN:?Set DOMAIN to the public hostname, for example tincandemo.example.com}"
REPO_URL="${REPO_URL:-https://github.com/mehdyhaghy/tincan-webmcp.git}"
BRANCH="${BRANCH:-main}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
APP_DIR=/opt/tincan
APP_USER=tincan
APP_HOME=/var/lib/tincan
BUN_VERSION=1.3.13
DEPLOY_DIR="$APP_DIR/deploy"

if [[ $EUID -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

log() { printf '\n==> %s\n' "$*"; }

log "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q nginx certbot ufw git unzip curl

log "Creating service account"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$APP_HOME" --shell /usr/sbin/nologin "$APP_USER"
fi

log "Installing Bun $BUN_VERSION"
if ! /usr/local/bin/bun --version 2>/dev/null | grep -qx "$BUN_VERSION"; then
  curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s "bun-v$BUN_VERSION"
fi

log "Fetching source ($BRANCH)"
if [[ -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" -H git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  sudo -u "$APP_USER" -H git -C "$APP_DIR" reset --quiet --hard "origin/$BRANCH"
else
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
fi

log "Installing dependencies and building"
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && bun install --frozen-lockfile && bun run build"

log "Installing systemd unit"
install -m 0644 "$DEPLOY_DIR/tincan-api.service" /etc/systemd/system/tincan-api.service
systemctl daemon-reload
systemctl enable --quiet tincan-api

log "Configuring firewall (SSH and 443 only)"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

log "Configuring nginx"
rm -f /etc/nginx/sites-enabled/default
sed "s/__DOMAIN__/$DOMAIN/g" "$DEPLOY_DIR/nginx-site.conf" > "/etc/nginx/sites-available/$DOMAIN.conf"
ln -sf "/etc/nginx/sites-available/$DOMAIN.conf" "/etc/nginx/sites-enabled/$DOMAIN.conf"

log "Installing certificate renewal hooks"
install -d /etc/letsencrypt/renewal-hooks/pre /etc/letsencrypt/renewal-hooks/post
install -m 0755 "$DEPLOY_DIR/certbot-pre.sh" /etc/letsencrypt/renewal-hooks/pre/open-http.sh
install -m 0755 "$DEPLOY_DIR/certbot-post.sh" /etc/letsencrypt/renewal-hooks/post/close-http.sh

if [[ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
  log "Obtaining Let's Encrypt certificate for $DOMAIN"
  email_args=(--register-unsafely-without-email)
  if [[ -n "$CERTBOT_EMAIL" ]]; then
    email_args=(-m "$CERTBOT_EMAIL")
  fi
  systemctl stop nginx
  ufw allow 80/tcp >/dev/null
  if ! certbot certonly --standalone --non-interactive --agree-tos "${email_args[@]}" -d "$DOMAIN"; then
    ufw delete allow 80/tcp >/dev/null || true
    echo "Certificate issuance failed. Check that $DOMAIN resolves to this host." >&2
    exit 1
  fi
  ufw delete allow 80/tcp >/dev/null || true
fi

log "Starting services"
nginx -t
systemctl enable --quiet nginx
systemctl restart tincan-api
systemctl restart nginx

log "Done"
echo "Site: https://$DOMAIN"
echo "API:  $(systemctl is-active tincan-api) on 127.0.0.1:8787"
