#!/usr/bin/env bash
# INFOCUS Asset Management — additive Ubuntu/Debian deployment.
# Managed by infocus-assets installer; never source an application .env file.
set -Eeuo pipefail
set +x
umask 027

APP=infocus-assets
ROOT=/opt/infocus-assets
CONFIG=/etc/infocus-assets
ENV_FILE=$CONFIG/app.env
MAINTENANCE=$CONFIG/maintenance.env
SITE=/etc/nginx/sites-available/infocus-assets.conf
ENABLED=/etc/nginx/sites-enabled/infocus-assets.conf
UNIT=/etc/systemd/system/infocus-assets.service
MARKER='# Managed by infocus-assets installer'
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
DOMAIN=''; EMAIL=''; REQUESTED_PORT=''; DB_PORT=''; LETSENCRYPT=false; DRY_RUN=false
WORK=''

info() { printf '\n[INFOCUS] %s\n' "$*"; }
die() { printf '\n[INFOCUS] ERROR: %s\n' "$*" >&2; exit 1; }
cleanup() { [[ -z "$WORK" ]] || rm -rf -- "$WORK"; }
trap cleanup EXIT
trap 'printf "\n[INFOCUS] Installation stopped at line %s. Review the error above; do not reset the database.\n" "$LINENO" >&2' ERR
usage() {
  cat <<'HELP'
INFOCUS Asset Management — Ubuntu/Debian installer (systemd required)

  sudo bash scripts/install.sh --domain assets.example.com
  sudo bash scripts/install.sh --domain assets.example.com --letsencrypt --email admin@example.com
  bash scripts/install.sh --domain assets.example.com --dry-run

Options:
  --domain HOST    Dedicated hostname, without https:// or a path. Prompts if absent.
  --port PORT      First-install API port (default 5000; occupied ports are skipped).
  --db-port PORT   Existing local PostgreSQL cluster port; otherwise auto-detect.
  --letsencrypt   Obtain/keep a trusted certificate using Certbot webroot (DNS must work).
  --email EMAIL   Required with --letsencrypt; accepts Let's Encrypt subscriber terms.
  --dry-run       Print the plan; do not install, create files, or contact the database.
  --help          Print this help.

Uses /opt/infocus-assets, /etc/infocus-assets, systemd infocus-assets.service,
and /etc/nginx/sites-available/infocus-assets.conf. Existing unrelated sites stay intact.
Without --letsencrypt, HTTPS initially uses a self-signed certificate (browser warning).
After adding DNS, rerun with --letsencrypt --email. Existing trusted certificates persist.
Reruns preserve credentials, migrate forward, build a new release, and restart the app.
The database is asset_management; dedicated roles are infocus_assets_owner and infocus_assets.
No sample data or administrator is created. See docs/DEPLOYMENT.md for first-admin bootstrap.
HELP
}
while (($#)); do
  case "$1" in
    --domain|--email|--port|--db-port)
      (($# >= 2)) && [[ "$2" != --* ]] || die "Missing value for $1."
      case "$1" in
        --domain) DOMAIN=${2,,};; --email) EMAIL=$2;; --port) REQUESTED_PORT=$2;; --db-port) DB_PORT=$2;;
      esac
      shift 2;;
    --letsencrypt) LETSENCRYPT=true; shift;;
    --dry-run) DRY_RUN=true; shift;;
    --help|-h) usage; exit 0;;
    *) die "Unknown option: $1. Use --help.";;
  esac
done
valid_port() { [[ "$1" =~ ^[1-9][0-9]{0,4}$ ]] && ((10#$1 <= 65535)); }
valid_domain() {
  [[ ${#1} -le 253 && "$1" == *.* && "$1" != *..* && "$1" != *. ]] || return 1
  local label
  IFS=. read -r -a labels <<< "$1"
  for label in "${labels[@]}"; do
    [[ ${#label} -le 63 && "$label" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || return 1
  done
  [[ ! "$1" =~ ^[0-9.]+$ ]]
}
read_setting() { awk -v key="$2" 'index($0,key "=")==1 { sub(/^[^=]*=/, ""); sub(/\r$/, ""); print; exit }' "$1"; }
[[ -z "$REQUESTED_PORT" ]] || valid_port "$REQUESTED_PORT" || die 'Invalid --port (1–65535).'
[[ -z "$REQUESTED_PORT" ]] || ((REQUESTED_PORT >= 1024)) || die '--port must be an unprivileged API port (1024–65535).'
[[ -z "$DB_PORT" ]] || valid_port "$DB_PORT" || die 'Invalid --db-port (1–65535).'
[[ -z "$DOMAIN" ]] || valid_domain "$DOMAIN" || die 'Use a valid dedicated hostname, without a scheme, port, or path.'
if $LETSENCRYPT; then
  [[ "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || die '--letsencrypt requires --email with a valid contact address.'
fi
if $DRY_RUN; then
  cat <<PLAN
Dry run: no changes and no database connection.
Source: $SOURCE
Hostname: ${DOMAIN:-<prompt or existing hostname>}; HTTPS: $(if $LETSENCRYPT; then printf "Let's Encrypt"; else printf 'existing certificate or new self-signed certificate'; fi)
1. Check Ubuntu/Debian, root/systemd, managed paths, existing Nginx configuration, and port conflicts.
2. Install missing build tools/PostgreSQL/Nginx. Reuse compatible Node or install isolated Node 22.
3. Preserve or generate separate runtime/migration database credentials and JWT secrets.
4. Build a new non-root release under $ROOT/releases; never copy local .env or node_modules.
5. Create database asset_management only if absent; verify owner/role/schema; deploy Prisma migrations.
6. Restrict runtime role to application DML; point systemd at the verified release on loopback.
7. Add $SITE: frontend at /, API at /api/, HTTP redirects to HTTPS.
8. Validate Nginx before reload; verify API/database and HTTPS SPA routes locally without DNS.
9. Keep previous releases and credentials. Print first-administrator and DNS next steps.
API port: ${REQUESTED_PORT:-5000 (or existing; next free on first install)}; PostgreSQL port: ${DB_PORT:-auto-detect local cluster}.
PLAN
  exit 0
fi
[[ $EUID -eq 0 ]] || die 'Run with sudo. Use --dry-run to inspect the plan without root.'
[[ "$(uname -s)" == Linux && -f /etc/debian_version ]] || die 'This installer requires Ubuntu/Debian Linux. Use the README local steps on Windows.'
[[ -d /run/systemd/system ]] || die 'A running systemd host is required; this is not a Docker/WSL image bootstrap script.'
[[ -f "$SOURCE/package-lock.json" && -f "$SOURCE/scripts/setup-db.sh" && -f "$SOURCE/backend/prisma/schema.prisma" ]] || die 'Run from a complete application checkout.'
command -v flock >/dev/null || die 'Install util-linux (flock) before running this installer.'
exec 9>/run/lock/infocus-assets-install.lock
flock -n 9 || die 'Another INFOCUS installation is already running.'
managed_file() { [[ ! -e "$1" && ! -L "$1" ]] || { [[ -f "$1" && ! -L "$1" ]] && grep -Fqx "$MARKER" "$1"; }; }
for file in "$ENV_FILE" "$MAINTENANCE" "$SITE" "$UNIT"; do
  managed_file "$file" || die "Refusing to overwrite unmanaged file: $file."
done
for directory in "$ROOT" "$CONFIG"; do
  [[ ! -L "$directory" ]] || die "Managed directory must not be a symlink: $directory."
  [[ ! -e "$directory" || -f "$directory/.infocus-managed" ]] || die "Refusing to reuse unmanaged directory: $directory."
done
if id "$APP" >/dev/null 2>&1; then
  [[ -f "$ROOT/.infocus-managed" ]] || die 'An unrelated infocus-assets OS account already exists; refusing to adopt it.'
elif [[ -e /var/lib/infocus-assets ]]; then
  die 'An unrelated /var/lib/infocus-assets directory exists; refusing to adopt it.'
fi
[[ ! -e /etc/letsencrypt/live/$APP || -f "$ENV_FILE" ]] || die 'An unrelated Certbot certificate already uses the infocus-assets name.'
if [[ -e "$ENABLED" || -L "$ENABLED" ]]; then
  [[ -L "$ENABLED" && "$(readlink -- "$ENABLED")" == "$SITE" ]] || die "Unmanaged enabled site exists: $ENABLED."
fi
if [[ -e "$ROOT/current" && ! -L "$ROOT/current" ]]; then die "$ROOT/current must be the managed release symlink."; fi
if [[ -f "$ENV_FILE" ]]; then
  [[ -f "$MAINTENANCE" ]] || die 'Runtime configuration exists but maintenance.env is missing; restore it from backup.'
  for file in "$ENV_FILE" "$MAINTENANCE"; do
    [[ "$(stat -c %u "$file")" == 0 ]] || die "Configuration must be root-owned: $file."
    (( (8#$(stat -c %a "$file") & 0022) == 0 )) || die "Configuration must not be writable by group/others: $file."
  done
  EXISTING_DOMAIN=$(read_setting "$ENV_FILE" APP_URL); EXISTING_DOMAIN=${EXISTING_DOMAIN#https://}
  [[ -z "$DOMAIN" || "$DOMAIN" == "$EXISTING_DOMAIN" ]] || die 'Changing an existing hostname requires a planned configuration/certificate update; use the existing domain.'
  DOMAIN=$EXISTING_DOMAIN
fi
if [[ -z "$DOMAIN" ]]; then
  [[ -t 0 ]] || die 'Pass --domain for a non-interactive installation.'
  read -r -p 'Dedicated application hostname (e.g. assets.company.com): ' DOMAIN
  DOMAIN=${DOMAIN,,}
fi
valid_domain "$DOMAIN" || die 'Invalid hostname.'
WORK=$(mktemp -d /tmp/infocus-assets-install.XXXXXXXX)
chmod 700 "$WORK"
if command -v nginx >/dev/null; then
  nginx -t || die 'Existing Nginx configuration is invalid. Correct it before installation.'
  nginx -T > "$WORK/nginx-existing.txt" 2>/dev/null
  if awk -v managed="$SITE" -v enabled="$ENABLED" -v domain="$DOMAIN" '
    /^# configuration file / { file=$4; sub(/:$/, "", file); reading=0; next }
    file!=managed && file!=enabled {
      sub(/#.*/, ""); gsub(/;/, " ; ")
      for(i=1;i<=NF;i++) {
        if($i=="server_name") reading=1
        else if($i==";") reading=0
        else if(reading && $i==domain) found=1
      }
    } END { exit !found }' "$WORK/nginx-existing.txt"; then
    die "An unrelated Nginx site already owns $DOMAIN. No site was overwritten."
  fi
fi
info 'Checking system packages and local PostgreSQL.'
export DEBIAN_FRONTEND=noninteractive
PACKAGES=()
for pair in 'curl:curl' 'openssl:openssl' 'rsync:rsync' 'xz:xz-utils' 'ss:iproute2' 'make:build-essential' 'g++:build-essential' 'python3:python3' 'nginx:nginx'; do
  command -v "${pair%%:*}" >/dev/null || PACKAGES+=("${pair#*:}")
done
[[ -f /etc/ssl/certs/ca-certificates.crt ]] || PACKAGES+=(ca-certificates)
if ! command -v psql >/dev/null; then PACKAGES+=(postgresql postgresql-client); fi
if $LETSENCRYPT && ! command -v certbot >/dev/null; then PACKAGES+=(certbot); fi
if ((${#PACKAGES[@]})); then apt-get update; apt-get install -y --no-install-recommends "${PACKAGES[@]}"; fi
nginx -T > "$WORK/nginx-existing.txt" 2>/dev/null || die 'Nginx configuration is invalid.'
grep -Eq '^[[:space:]]*include[[:space:]]+/etc/nginx/sites-enabled/\*[[:space:]]*;' "$WORK/nginx-existing.txt" || die 'Nginx must include /etc/nginx/sites-enabled/* in its http block. Review your custom configuration; this installer does not change global Nginx settings.'
id postgres >/dev/null 2>&1 || die 'PostgreSQL client exists but local postgres OS user does not; install/configure a local PostgreSQL server first.'
systemctl start postgresql
if [[ -z "$DB_PORT" && -f "$MAINTENANCE" ]]; then DB_PORT=$(read_setting "$MAINTENANCE" PG_ADMIN_PORT); fi
if [[ -z "$DB_PORT" ]]; then
  if command -v pg_lsclusters >/dev/null; then
    mapfile -t PG_PORTS < <(pg_lsclusters --no-header | awk '$4 ~ /^online/ {print $3}')
    ((${#PG_PORTS[@]} <= 1)) || die 'Multiple PostgreSQL clusters are running. Specify the intended --db-port.'
    DB_PORT=${PG_PORTS[0]:-5432}
  else DB_PORT=5432; fi
fi
valid_port "$DB_PORT" || die 'Invalid stored PostgreSQL port.'
runuser -u postgres -- psql -X -w -p "$DB_PORT" -d postgres -Atqc 'SELECT 1' >/dev/null || die 'Cannot connect to the local PostgreSQL cluster through peer authentication; verify --db-port and server status.'

info 'Preparing isolated runtime and service account.'
install -d -m 755 "$ROOT" "$ROOT/releases" "$ROOT/bin"
install -d -m 750 "$CONFIG"
touch "$ROOT/.infocus-managed" "$CONFIG/.infocus-managed"
if id "$APP" >/dev/null 2>&1; then
  [[ "$(getent passwd "$APP" | cut -d: -f6)" == /var/lib/infocus-assets ]] || die 'Existing infocus-assets OS account has an unexpected home; refusing to reuse it.'
else useradd --system --user-group --home-dir /var/lib/infocus-assets --create-home --shell /usr/sbin/nologin "$APP"; fi
chown root:"$APP" "$CONFIG"
install -d -m 750 -o "$APP" -g "$APP" /var/lib/infocus-assets
node_supported() { "$1" -e 'let [a,b]=process.versions.node.split(".").map(Number);process.exit((a===22&&b>=12)||a===24?0:1)' >/dev/null 2>&1; }
NODE=''
if [[ -x "$ROOT/bin/node" ]] && node_supported "$ROOT/bin/node"; then NODE=$(readlink -f "$ROOT/bin/node")
elif command -v node >/dev/null && node_supported "$(command -v node)" && command -v npm >/dev/null; then NODE=$(readlink -f "$(command -v node)"); fi
if [[ "$NODE" == /home/* || "$NODE" == /root/* ]] || { [[ -n "$NODE" ]] && ! runuser -u "$APP" -- "$NODE" --version >/dev/null 2>&1; }; then NODE=''; fi
if [[ -z "$NODE" ]]; then
  case "$(uname -m)" in x86_64) ARCH=x64;; aarch64|arm64) ARCH=arm64;; *) die 'Automatic Node installation supports x86_64 and arm64 only.';; esac
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$WORK/SHASUMS256.txt"
  TARBALL=$(awk -v arch="$ARCH" '$2 ~ ("^node-v22\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$") {print $2}' "$WORK/SHASUMS256.txt")
  [[ "$TARBALL" =~ ^node-v22\.[0-9]+\.[0-9]+-linux-(x64|arm64)\.tar\.xz$ ]] || die 'Could not resolve an official Node 22 download.'
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/latest-v22.x/$TARBALL" -o "$WORK/$TARBALL"
  (cd "$WORK"; awk -v filename="$TARBALL" '$2==filename' SHASUMS256.txt | sha256sum --check --status) || die 'Node download checksum verification failed.'
  install -d -m 755 "$ROOT/node"
  tar -xJf "$WORK/$TARBALL" --no-same-owner --strip-components=1 -C "$ROOT/node"
  NODE=$ROOT/node/bin/node
fi
node_supported "$NODE" || die 'Node 22.12+ or Node 24 is required.'
NODE_DIR=$(dirname "$NODE")
NPM=$NODE_DIR/npm
[[ -x "$NPM" ]] || NPM=$(command -v npm || true)
[[ -n "$NPM" && -x "$NPM" ]] || die 'npm is missing from the selected Node installation.'
ln -sfn -- "$NODE" "$ROOT/bin/node"
ln -sfn -- "$(readlink -f "$NPM")" "$ROOT/bin/npm"
export PATH="$ROOT/bin:$NODE_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
info "Using Node $($NODE --version)."

port_busy() { ss -H -ltn | awk -v port=":$1" '$4 ~ (port "$") { found=1 } END { exit !found }'; }
if [[ -f "$ENV_FILE" ]]; then
  PORT=$(read_setting "$ENV_FILE" PORT)
  valid_port "$PORT" || die 'Invalid stored API port.'
  ((PORT >= 1024)) || die 'Stored API port must be unprivileged (1024 or above).'
  [[ -z "$REQUESTED_PORT" || "$REQUESTED_PORT" == "$PORT" ]] || die 'Existing API port is retained; change the managed configuration manually during maintenance.'
  [[ "$(read_setting "$MAINTENANCE" PG_ADMIN_PORT)" == "$DB_PORT" ]] || die 'Existing database port differs from --db-port; database relocation requires a planned migration.'
  [[ "$(read_setting "$ENV_FILE" NODE_ENV)" == production && "$(read_setting "$ENV_FILE" HOST)" == 127.0.0.1 && "$(read_setting "$ENV_FILE" TRUST_PROXY_HOPS)" == 1 ]] || die 'Production NODE_ENV/HOST/TRUST_PROXY_HOPS configuration was changed; review it before rerunning.'
  if port_busy "$PORT"; then
    MAIN_PID=$(systemctl show "$APP" --property=MainPID --value 2>/dev/null || true)
    [[ "$MAIN_PID" =~ ^[1-9][0-9]*$ ]] || die "Existing API port $PORT is occupied without a running managed service."
    ss -H -ltnp | awk -v port=":$PORT" -v pid="pid=$MAIN_PID," '$4 ~ (port "$") {if(index($0,pid)) owned=1; else foreign=1} END {exit !(owned && !foreign)}' || die "API port $PORT is occupied by another process; it was not stopped."
  fi
else
  PORT=${REQUESTED_PORT:-5000}
  while port_busy "$PORT"; do ((PORT+=1)); ((PORT<=65535)) || die 'No free API port found.'; done
  [[ "$PORT" == "${REQUESTED_PORT:-5000}" ]] || info "Requested API port occupied; selected $PORT."
  OWNER_PASS=$(openssl rand -hex 32); RUNTIME_PASS=$(openssl rand -hex 32)
  JWT=$(openssl rand -hex 48); REFRESH=$(openssl rand -hex 48)
  cat > "$MAINTENANCE" <<ENV
$MARKER
DATABASE_URL=postgresql://infocus_assets_owner:$OWNER_PASS@127.0.0.1:$DB_PORT/asset_management?schema=public
DB_RUNTIME_USER=infocus_assets
DB_RUNTIME_PASSWORD=$RUNTIME_PASS
PG_ADMIN_OS_USER=postgres
PG_ADMIN_USER=postgres
PG_ADMIN_PORT=$DB_PORT
PG_ADMIN_DATABASE=postgres
ENV
  chmod 600 "$MAINTENANCE"
  cat > "$ENV_FILE" <<ENV
$MARKER
NODE_ENV=production
HOST=127.0.0.1
PORT=$PORT
DATABASE_URL=postgresql://infocus_assets:$RUNTIME_PASS@127.0.0.1:$DB_PORT/asset_management?schema=public
JWT_SECRET=$JWT
JWT_REFRESH_SECRET=$REFRESH
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=1d
REMEMBER_TOKEN_EXPIRES_IN=30d
APP_URL=https://$DOMAIN
CORS_ORIGIN=https://$DOMAIN
TRUST_PROXY_HOPS=1
LOG_LEVEL=info
# Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM to enable recovery emails.
ENV
  unset OWNER_PASS RUNTIME_PASS JWT REFRESH
fi
chown root:"$APP" "$ENV_FILE"; chmod 640 "$ENV_FILE"
chown root:root "$MAINTENANCE"; chmod 600 "$MAINTENANCE"

info 'Building a fresh release as the unprivileged application account.'
RELEASE=$ROOT/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$
install -d -m 755 -o "$APP" -g "$APP" "$RELEASE"
rsync -a --safe-links --chown="$APP:$APP" --exclude='.git' --exclude='node_modules' --exclude='.env' --exclude='.env.*' --exclude='.local' --exclude='dist' --exclude='test-results' --exclude='playwright-report' --exclude='coverage' "$SOURCE/" "$RELEASE/"
runuser -u "$APP" -- env -i HOME=/var/lib/infocus-assets PATH="$PATH" NODE_ENV=development npm --prefix "$RELEASE" ci --include=dev
runuser -u "$APP" -- env -i HOME=/var/lib/infocus-assets PATH="$PATH" NODE_ENV=development npm --prefix "$RELEASE" run db:generate
runuser -u "$APP" -- env -i HOME=/var/lib/infocus-assets PATH="$PATH" NODE_ENV=production VITE_API_URL=/api npm --prefix "$RELEASE" run build
[[ -s "$RELEASE/frontend/dist/index.html" && -f "$RELEASE/backend/dist/server.js" ]] || die 'Build artifacts are missing.'
info 'Verifying database roles, schema, and forward migrations.'
env -i PATH="$PATH" HOME=/root bash "$RELEASE/scripts/setup-db.sh" --env-file "$MAINTENANCE"
# Prevent the running service from modifying its executable code. Nginx must traverse/read static files.
chown -R root:root "$RELEASE"
chmod -R a+rX,go-w "$RELEASE"

info 'Installing the managed systemd service and verifying the application.'
PREVIOUS=''
[[ ! -L "$ROOT/current" ]] || PREVIOUS=$(readlink -f "$ROOT/current")
[[ -z "$PREVIOUS" || "$PREVIOUS" == "$ROOT/releases/"* ]] || die 'Current release points outside the managed releases directory.'
[[ ! -f "$UNIT" ]] || cp -p "$UNIT" "$WORK/previous.service"
cat > "$UNIT" <<SERVICE
$MARKER
[Unit]
Description=INFOCUS Asset Management API
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=$APP
Group=$APP
WorkingDirectory=$ROOT/current/backend
EnvironmentFile=$ENV_FILE
ExecStart=$ROOT/bin/node $ROOT/current/backend/dist/server.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
KillSignal=SIGTERM
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
RestrictSUIDSGID=true
StateDirectory=$APP
ReadWritePaths=/var/lib/$APP
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$APP

[Install]
WantedBy=multi-user.target
SERVICE
chmod 644 "$UNIT"
ln -sfn -- "$RELEASE" "$ROOT/current.new"; mv -Tf -- "$ROOT/current.new" "$ROOT/current"
systemctl daemon-reload
systemctl enable "$APP"
STARTED=true
systemctl restart "$APP" || STARTED=false
HEALTH=false
for ((attempt=0;attempt<30;attempt++)); do
  $STARTED || break
  if systemctl is-active --quiet "$APP" && curl --fail --silent --max-time 2 "http://127.0.0.1:$PORT/api/health" | "$NODE" -e 'let x="";process.stdin.on("data",c=>x+=c);process.stdin.on("end",()=>{try{let j=JSON.parse(x);process.exit(j.success&&j.data?.status==="ok"&&j.data?.database==="connected"?0:1)}catch{process.exit(1)}})'; then HEALTH=true; break; fi
  sleep 1
done
if ! $HEALTH; then
  if [[ -n "$PREVIOUS" && -f "$WORK/previous.service" ]]; then
    ln -sfn -- "$PREVIOUS" "$ROOT/current.new"; mv -Tf -- "$ROOT/current.new" "$ROOT/current"
    cp -p "$WORK/previous.service" "$UNIT"; systemctl daemon-reload; systemctl restart "$APP" || true
  else systemctl stop "$APP" || true; fi
  die "API health check failed. Previous release restored when available; database migrations were not reversed. Inspect journalctl -u $APP."
fi

info 'Configuring the dedicated Nginx route and HTTPS.'
install -d -m 755 /etc/nginx/sites-available /etc/nginx/sites-enabled "$ROOT/acme/.well-known/acme-challenge"
TLS_DIR=$CONFIG/tls
install -d -m 700 "$TLS_DIR"
CERT=$TLS_DIR/cert.pem; KEY=$TLS_DIR/key.pem
if [[ -f /etc/letsencrypt/live/$APP/fullchain.pem && -f /etc/letsencrypt/live/$APP/privkey.pem ]]; then
  CERT=/etc/letsencrypt/live/$APP/fullchain.pem; KEY=/etc/letsencrypt/live/$APP/privkey.pem
else
  if [[ ! -f "$CERT" || ! -f "$KEY" ]] || ! openssl x509 -in "$CERT" -noout -checkend 604800 >/dev/null 2>&1; then
    openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 365 -subj "/CN=$DOMAIN" -addext "subjectAltName=DNS:$DOMAIN" -keyout "$KEY" -out "$CERT" >/dev/null 2>&1
    chmod 600 "$KEY"; chmod 644 "$CERT"
  fi
fi
render_nginx() {
  cat <<NGINX
$MARKER
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location ^~ /.well-known/acme-challenge/ { root $ROOT/acme; default_type text/plain; }
    location / { return 301 https://$DOMAIN\$request_uri; }
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $DOMAIN;
    ssl_certificate $CERT;
    ssl_certificate_key $KEY;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:INFOCUS_SSL:10m;
    root $ROOT/current/frontend/dist;
    index index.html;
    client_max_body_size 1m;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header X-Frame-Options DENY always;
    gzip on;
    gzip_vary on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    location = /api { return 308 /api/; }
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 90s;
        proxy_send_timeout 90s;
    }
    location ~* ^/assets/.*\.(js|css|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot)$ {
        try_files \$uri =404;
        expires 1y;
    }
    location = /index.html {
        expires -1;
    }
    location ~ /\. { deny all; }
    location / { try_files \$uri \$uri/ /index.html; }
}
NGINX
}
apply_nginx() {
  local previous="$WORK/nginx-previous.conf" had_site=false had_link=false
  if [[ -f "$SITE" ]]; then cp -p "$SITE" "$previous"; had_site=true; fi
  [[ ! -L "$ENABLED" ]] || had_link=true
  render_nginx > "$WORK/nginx-next.conf"
  install -m 644 "$WORK/nginx-next.conf" "$SITE"
  ln -sfn -- "$SITE" "$ENABLED"
  if nginx -t && { if systemctl is-active --quiet nginx; then systemctl reload nginx; else systemctl start nginx; fi; }; then
    systemctl enable nginx
  else
    if $had_site; then cp -p "$previous" "$SITE"; else rm -f -- "$SITE"; fi
    $had_link || rm -f -- "$ENABLED"
    if nginx -t && systemctl is-active --quiet nginx; then systemctl reload nginx || true; fi
    die 'Nginx validation/reload failed; the previous managed site was restored. Other sites were not changed.'
  fi
}
apply_nginx
if $LETSENCRYPT; then
  info "Requesting trusted HTTPS for $DOMAIN. DNS and inbound TCP 80 must already reach this host."
  certbot certonly --non-interactive --agree-tos --email "$EMAIL" --webroot -w "$ROOT/acme" --cert-name "$APP" -d "$DOMAIN" --keep-until-expiring || die "Certbot failed. The working existing/self-signed site remains; fix DNS/firewall and rerun with --letsencrypt --email $EMAIL."
  CERT=/etc/letsencrypt/live/$APP/fullchain.pem; KEY=/etc/letsencrypt/live/$APP/privkey.pem
  apply_nginx
  HOOK=/etc/letsencrypt/renewal-hooks/deploy/infocus-assets-reload
  managed_file "$HOOK" || die "Refusing to overwrite unmanaged renewal hook: $HOOK."
  install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
  cat > "$HOOK" <<'RENEW'
#!/usr/bin/env bash
# Managed by infocus-assets installer
set -euo pipefail
nginx -t
systemctl reload nginx
RENEW
  chmod 755 "$HOOK"
  if systemctl list-unit-files certbot.timer --no-legend | grep -q '^certbot.timer'; then systemctl enable --now certbot.timer; fi
fi
info 'Verifying HTTPS, API routing, and client-side page routing without relying on DNS.'
CURL_TLS=()
[[ "$CERT" != "$TLS_DIR/cert.pem" ]] || CURL_TLS=(--cacert "$CERT")
curl --fail --silent --show-error --noproxy '*' "${CURL_TLS[@]}" --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health" | "$NODE" -e 'let x="";process.stdin.on("data",c=>x+=c);process.stdin.on("end",()=>{try{let j=JSON.parse(x);process.exit(j.success&&j.data?.database==="connected"?0:1)}catch{process.exit(1)}})' || die 'HTTPS API/database verification failed.'
curl --fail --silent --show-error --noproxy '*' "${CURL_TLS[@]}" --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/login" -o "$WORK/login.html"
cmp -s "$WORK/login.html" "$RELEASE/frontend/dist/index.html" || die 'Nginx did not serve the application SPA for /login; check includes/sites.'
curl --fail --silent --show-error --noproxy '*' "${CURL_TLS[@]}" --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/assets/00000000-0000-0000-0000-000000000000" -o "$WORK/asset-route.html"
cmp -s "$WORK/asset-route.html" "$RELEASE/frontend/dist/index.html" || die 'Nginx did not serve the application SPA for an asset detail URL.'
info "Verified: INFOCUS is running at https://$DOMAIN (API on loopback:$PORT)."
printf '\nNginx site: %s\nService: sudo systemctl status %s\nLogs: sudo journalctl -u %s -f\n' "$SITE" "$APP" "$APP"
printf 'Add your DNS A/AAAA record to this server. Expose TCP 80/443; keep PostgreSQL and API ports private.\n'
if [[ "$CERT" == "$TLS_DIR/cert.pem" ]]; then
  printf 'HTTPS currently uses a self-signed certificate. After DNS, rerun with --letsencrypt --email YOUR_EMAIL.\n'
fi
printf '\nCreate the first administrator (no demo accounts are installed):\n'
printf '  cd %s/current/backend\n' "$ROOT"
printf '  sudo -u %s %s/bin/node --env-file=%s %s/current/node_modules/tsx/dist/cli.mjs %s/current/backend/scripts/create-admin.ts\n' "$APP" "$ROOT" "$ENV_FILE" "$ROOT" "$ROOT"
printf '\nBack up PostgreSQL and %s before upgrades. Old releases are retained; migrations are never reversed automatically.\n' "$CONFIG"
