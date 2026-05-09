#!/bin/sh
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

echo "Setting up user infoscreen (${PUID}:${PGID})..."

# Find or create the group for the given GID
TARGET_GROUP=$(getent group "$PGID" 2>/dev/null | cut -d: -f1 || true)
if [ -z "$TARGET_GROUP" ]; then
    addgroup -g "$PGID" infoscreen
    TARGET_GROUP="infoscreen"
fi

# Find or create the user for the given UID
TARGET_USER=$(getent passwd "$PUID" 2>/dev/null | cut -d: -f1 || true)
if [ -z "$TARGET_USER" ]; then
    adduser -u "$PUID" -G "$TARGET_GROUP" -D -h /app -s /sbin/nologin infoscreen
    TARGET_USER="infoscreen"
fi

# Seed default data if the data directory is empty or missing
if [ -z "$(ls -A /app/data 2>/dev/null)" ]; then
    echo "Data directory is empty — seeding default content..."
    cp -a /app/defaults/data/. /app/data/
fi

# Generate random passwords if users.json still has default credentials
if [ -f /app/data/users.json ]; then
    if grep -q '"password": "admin"' /app/data/users.json || grep -q '"password": "user"' /app/data/users.json; then
        ADMIN_PASS=$(head -c 16 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 12)
        USER_PASS=$(head -c 16 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 12)

        sed -i "s/\"password\": \"admin\"/\"password\": \"${ADMIN_PASS}\"/" /app/data/users.json
        sed -i "s/\"password\": \"user\"/\"password\": \"${USER_PASS}\"/" /app/data/users.json

        echo "========================================"
        echo "  Generated login credentials"
        echo "========================================"
        echo "  Admin:    admin / ${ADMIN_PASS}"
        echo "  Streamer: user  / ${USER_PASS}"
        echo "========================================"
        echo "  Change these in the admin UI or by"
        echo "  editing data/users.json"
        echo "========================================"
    fi
fi

# Generate self-signed certificate if requested and none exists
if [ "${GENERATE_SELFSIGNED_CERT}" = "true" ]; then
    if [ ! -f /app/data/cert.pem ] || [ ! -f /app/data/key.pem ]; then
        echo "Generating self-signed TLS certificate..."
        openssl req -x509 -newkey rsa:2048 \
            -keyout /app/data/key.pem \
            -out /app/data/cert.pem \
            -days 365 -nodes \
            -subj "/CN=infoscreen"
    fi
fi

# Point SSL_KEY/SSL_CERT to the data directory if certs exist there
if [ -f /app/data/key.pem ] && [ -f /app/data/cert.pem ]; then
    export SSL_KEY=/app/data/key.pem
    export SSL_CERT=/app/data/cert.pem
fi

chown -R "$PUID:$PGID" /app/data

exec su-exec "$PUID:$PGID" "$@"
