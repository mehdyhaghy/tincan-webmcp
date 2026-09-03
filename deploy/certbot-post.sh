#!/usr/bin/env bash
# Runs after a certificate renewal attempt: close port 80 again and load the new certificate.
set -euo pipefail
ufw delete allow 80/tcp >/dev/null || true
if systemctl is-active --quiet nginx; then
  systemctl reload nginx
fi
