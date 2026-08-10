#!/bin/bash

/sbin/my_init &
INIT_PID=$!

SETTINGS="/shared/seafile/conf/seahub_settings.py"
DOMAIN="${SEAFILE_SERVER_HOSTNAME}"

while [ ! -f "$SETTINGS" ]; do
  sleep 1
done

if ! grep -q "CSRF_TRUSTED_ORIGINS" "$SETTINGS" 2>/dev/null; then
  cat >> "$SETTINGS" <<EOF

SERVICE_URL = 'https://${DOMAIN}'
FILE_SERVER_ROOT = 'https://${DOMAIN}/seafhttp'
CSRF_TRUSTED_ORIGINS = ["https://${DOMAIN}"]
EOF
fi

wait $INIT_PID
