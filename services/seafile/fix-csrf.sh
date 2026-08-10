#!/bin/bash

DOMAIN="${SEAFILE_SERVER_HOSTNAME}"

if [ -n "$DOMAIN" ]; then
  cat >> /shared/seafile/conf/seahub_settings.py <<EOF

# --- Auto-configured by entrypoint ---
SERVICE_URL = 'https://${DOMAIN}'
FILE_SERVER_ROOT = 'https://${DOMAIN}/seafhttp'
CSRF_TRUSTED_ORIGINS = ["https://${DOMAIN}"]
EOF
fi
