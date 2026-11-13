#!/usr/bin/env bash
# One-command setup of Dawwen on an AWS Learner Lab EC2 server (Ubuntu 24.04) — ADR-026.
#
#   git clone -b test/learner-lab https://github.com/mokhtarAbdallh/ai-executive-assistant.git
#   cd ai-executive-assistant && ./deploy/lab/setup.sh
#
# Re-running is safe: it keeps the existing .env.lab (keys, passwords, database) and
# only rebuilds/restarts the containers. Use --reconfigure to enter new API keys.
set -euo pipefail

cd "$(dirname "$0")/../.."
LAB=deploy/lab
ENV_FILE="$LAB/.env.lab"
COMPOSE=(docker compose -f "$LAB/docker-compose.yml" --env-file "$ENV_FILE")
say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# ---------- 1. Packages: Docker, AWS CLI, swap ----------
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  say "Installing Docker (Ubuntu packages)"
  sudo apt-get update -y
  sudo apt-get install -y docker.io docker-compose-v2 curl openssl
  sudo usermod -aG docker "$USER"
fi
if ! command -v aws >/dev/null; then
  say "Installing AWS CLI"
  sudo snap install aws-cli --classic
fi
# Building three images on a 4 GB server needs swap.
if ! swapon --show | grep -q /swapfile; then
  say "Adding 4 GB swap"
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
# Run docker through sudo until the new group membership applies (next login).
if ! docker info >/dev/null 2>&1; then COMPOSE=(sudo "${COMPOSE[@]}"); fi

# ---------- 2. Checks: LabRole + container access to it ----------
say "Checking the server's AWS role (LabInstanceProfile)"
TOKEN=$(curl -sf -X PUT http://169.254.169.254/latest/api/token \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 300") || fail "No instance metadata — is this an EC2 server?"
md() { curl -sf -H "X-aws-ec2-metadata-token: $TOKEN" "http://169.254.169.254/latest/meta-data/$1"; }
md iam/security-credentials/ >/dev/null ||
  fail "No IAM role on this server. EC2 → Actions → Security → Modify IAM role → LabInstanceProfile"
INSTANCE_ID=$(md instance-id)
HOP=$(aws ec2 describe-instances --region us-east-1 --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].MetadataOptions.HttpPutResponseHopLimit' --output text 2>/dev/null || echo "?")
if [ "$HOP" = "1" ]; then
  say "Letting containers use the server role (metadata hop limit 1 → 2)"
  aws ec2 modify-instance-metadata-options --region us-east-1 --instance-id "$INSTANCE_ID" \
    --http-put-response-hop-limit 2 --http-endpoint enabled >/dev/null ||
    fail "Set it by hand: EC2 → Actions → Instance settings → Modify instance metadata options → hop limit 2"
fi
PUBLIC_IP=$(md public-ipv4) || fail "This server has no public IP. Attach an Elastic IP."

# ---------- 3. Configuration (.env.lab, secrets stay on this server) ----------
if [ ! -f "$ENV_FILE" ] || [ "${1:-}" = "--reconfigure" ]; then
  say "Configuration"
  SITE_HOST="${PUBLIC_IP//./-}.sslip.io"
  echo "Site address: https://$SITE_HOST"
  read -rsp "Groq API key (gsk_…, hidden): " GROQ_KEY; echo
  read -rsp "Gemini API key (hidden): " GEMINI_KEY; echo
  [ -n "$GROQ_KEY" ] && [ -n "$GEMINI_KEY" ] || fail "Both keys are required."

  EXISTING_DB_PASSWORD=""
  [ -f "$ENV_FILE" ] && EXISTING_DB_PASSWORD=$(grep '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
  [ -f "$ENV_FILE" ] && EXISTING_SECRET=$(grep '^APP_SECRET=' "$ENV_FILE" | cut -d= -f2-)

  say "Creating S3 bucket and SQS queue (LabRole)"
  RESOURCES=$(AWS_REGION=us-east-1 bash "$LAB/aws-resources.sh" "https://$SITE_HOST")

  umask 077
  sed \
    -e "s|^SITE_ADDRESS=.*|SITE_ADDRESS=$SITE_HOST|" \
    -e "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=https://$SITE_HOST|" \
    -e "s|^CORS_ORIGINS=.*|CORS_ORIGINS=https://$SITE_HOST|" \
    -e "s|^DB_PASSWORD=.*|DB_PASSWORD=${EXISTING_DB_PASSWORD:-$(openssl rand -hex 24)}|" \
    -e "s|^APP_SECRET=.*|APP_SECRET=${EXISTING_SECRET:-$(openssl rand -hex 32)}|" \
    -e "s|^ASR_HTTP_API_KEY=.*|ASR_HTTP_API_KEY=$GROQ_KEY|" \
    -e "s|^LLM_API_KEY=.*|LLM_API_KEY=$GEMINI_KEY|" \
    -e "s|^AUDIO_BUCKET=.*|$(echo "$RESOURCES" | grep '^AUDIO_BUCKET=')|" \
    -e "s|^AUDIO_QUEUE_URL=.*|$(echo "$RESOURCES" | grep '^AUDIO_QUEUE_URL=')|" \
    "$LAB/.env.lab.example" >"$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

# ---------- 4. Build and start ----------
say "Building and starting (first time: 10–20 minutes on t3.medium)"
COMPOSE_PARALLEL_LIMIT=1 "${COMPOSE[@]}" build
"${COMPOSE[@]}" up -d

say "Waiting for the API"
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T api node -e \
    "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    break
  fi
  sleep 5
done

# ---------- 5. First admin account ----------
ADMIN_FILE="$HOME/dawwen-admin.txt"
if [ ! -f "$ADMIN_FILE" ]; then
  say "Creating the admin account"
  ADMIN_EMAIL="admin@dawwen.lab"
  ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=')
  "${COMPOSE[@]}" exec -T -e EMAIL="$ADMIN_EMAIL" -e PASSWORD="$ADMIN_PASSWORD" api node -e "
    fetch('http://localhost:8080/api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: process.env.EMAIL, password: process.env.PASSWORD, name: 'Admin' }),
    }).then(async (r) => { if (!r.ok && r.status !== 409) { console.error(r.status, await r.text()); process.exit(1); } });"
  DB_USER=$(grep '^DB_USER=' "$ENV_FILE" | cut -d= -f2-)
  DB_NAME=$(grep '^DB_NAME=' "$ENV_FILE" | cut -d= -f2-)
  "${COMPOSE[@]}" exec -T postgres psql -q -U "$DB_USER" -d "$DB_NAME" -c \
    "UPDATE users SET \"isPlatformAdmin\" = true WHERE email = '$ADMIN_EMAIL';"
  umask 077
  printf 'email: %s\npassword: %s\n' "$ADMIN_EMAIL" "$ADMIN_PASSWORD" >"$ADMIN_FILE"
fi

SITE=$(grep '^SITE_ADDRESS=' "$ENV_FILE" | cut -d= -f2-)
say "Done"
echo "Open:         https://$SITE   (the first visit can take a minute while the certificate is issued)"
echo "Admin login:  cat $ADMIN_FILE"
echo "Logs:         ${COMPOSE[*]} logs -f worker"
echo "Before you leave: stop the server from the EC2 console to save the lab budget."
