#!/usr/bin/env bash
# Runs before a certificate renewal attempt: open port 80 for the HTTP-01 challenge.
set -euo pipefail
ufw allow 80/tcp >/dev/null
