# Infoscreen4

<a href="https://discord.gg/Ru59wMVDyd"><img alt="Discord" src="https://img.shields.io/discord/1173060772956479488?label=Discord&logo=discord&logoColor=fff"></a>

## 1. Introduction

Infoscreen4 for LAN parties. It combines a fast admin experience with real-time display updates, so you can create and publish content to multiple screens from one place.
The project is built with Next.js, React, Socket.IO, and Fabric.js, with a lightweight JSON-based data layer in the local `data/` directory.

## 2. Features

- Real-time display synchronization over WebSockets.
- Multi-display control with per-display assignments.
- Slide bundle management with ordered playback.
- Visual slide editor powered by Fabric.js.
- Rich slide content support: text, images, videos, shapes, colors and more.
- Integrated media management for files under `data/`.
- Live WebRTC streaming from `/send` to display clients.
- Optional HTTPS support for secure media capture workflows.
- No external database required for local/self-hosted usage.

## 3. Setup Guide For Production (Docker)

Infoscreen4 can be run in a Docker container for convenient deployment.

### Quick Start

```bash
docker run -d \
  --name infoscreen4 \
  -p 3000:3000 \
  -v /path/to/data:/app/data \
  --restart unless-stopped \
  ghcr.io/reaby/infoscreen4:latest
```

Or with Docker Compose:

```yaml
services:
  infoscreen:
    image: infoscreen4
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

### Data Directory

All persistent data (bundles, slides, media, user accounts) is stored in `/app/data`. On first start, if the mounted directory is empty, the container automatically seeds it with default content including example slides and backgrounds.

### User Accounts

On first start, the container generates random passwords for the default `admin` and `user` accounts and prints them to the container log:

```
========================================
  Generated login credentials
========================================
  Admin:    admin / aB3kM9xP2nLq
  Streamer: user  / wR7jN4vD6mYs
========================================
  Change these in the admin UI or by
  editing data/users.json
========================================
```

View credentials with `docker logs infoscreen4`. Passwords are only generated once — on subsequent starts the existing `users.json` is preserved.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PUID` | `1000` | User ID the app runs as |
| `PGID` | `1000` | Group ID the app runs as |
| `PORT` | `3000` | Server listen port |
| `HOST` | `0.0.0.0` | Server bind address |
| `GENERATE_SELFSIGNED_CERT` | `false` | Generate a self-signed TLS certificate on startup |

### HTTPS / TLS

For production, the recommended approach is to run Infoscreen4 behind a reverse proxy that handles TLS. [Caddy](https://caddyserver.com/) provides automatic HTTPS with no configuration:

```yaml
services:
  infoscreen:
    image: ghcr.io/reaby/infoscreen4:latest
    volumes:
      - ./data:/app/data
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
    restart: unless-stopped

volumes:
  caddy_data:
```

With a `Caddyfile`:

```
infoscreen.example.com {
    reverse_proxy infoscreen:3000
}
```

Caddy automatically obtains and renews TLS certificates from Let's Encrypt. Replace `infoscreen.example.com` with your domain.

For local/LAN use without a domain, you can set `GENERATE_SELFSIGNED_CERT=true` to have the container generate a self-signed certificate. The cert is stored in the data directory and reused across restarts.

## 4. Setup Guide For Production (Manual)

### Prerequisites

- Node.js 20+ recommended.
- pnpm 9+ recommended.

### Install and Build

```bash
pnpm install
pnpm run build
```

### Configure Environment

Create a `.env` file in the project root (or provide environment variables via your process manager):

```env
NODE_ENV=production
HOST=<your lan ip>
PORT=3000
```

### Start Server

```bash
pnpm run start
```

### Optional: Generate Local Self-Signed Cert

```bash
pnpm run gen-cert
```

If `key.pem` and `cert.pem` exist (or `SSL_KEY` / `SSL_CERT` are set), the custom server automatically starts in HTTPS mode.

### Optional: PM2 Example

```bash
pm2 start "pnpm run start" --name infoscreen4 --cwd /path/to/infoscreen4 --update-env
pm2 save
```

## 5. Contributing

Contributions are welcome.

If you want to improve Infoscreen4, feel free to open an issue to discuss ideas, report bugs, or propose features. Pull requests are appreciated, especially when they are focused, clearly described, and easy to test.

Please keep changes aligned with the existing coding style and include relevant updates to docs when behavior changes.

## 6. Setup Guide For Development

### Prerequisites

- Node.js 20+ recommended.
- pnpm 9+ recommended.

### Install Dependencies

```bash
pnpm install
```

### Start Development Server

```bash
pnpm run dev
```

Open `http://localhost:3000`.

Helpful routes:

- `/` main screen
- `/admin` admin interface
- `/display/[displayId]` specific display client
- `/send` stream sender page

### Development Notes

- The app uses a custom `server.ts` entrypoint (not plain `next dev`).
- Runtime data is stored under `data/`.
- For camera/screen capture in browser testing, use `localhost` or HTTPS.

## 7. Thanks

Big thanks to the AI tools that helped accelerate this project:

- Gemini: logo generation and code support.
- Claude: code support.
- GitHub LLMs (including Copilot): code support, iteration speed, and overall development flow.

This project became significantly better and faster to build thanks to that collaboration.
