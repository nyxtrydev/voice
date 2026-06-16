#!/usr/bin/env bash
set -e

ENV_FILE="$(dirname "$0")/../.env"
PORT=4000

# ── Check ngrok auth ──────────────────────────────────
if ! ngrok config check 2>&1 | grep -qi "valid"; then
  echo ""
  echo "  ngrok needs an auth token."
  echo "  1. Sign up free at https://dashboard.ngrok.com"
  echo "  2. Copy your authtoken"
  echo "  3. Run: ngrok config add-authtoken <YOUR_TOKEN>"
  echo "  Then run this script again."
  echo ""
  exit 1
fi

# ── Kill any running ngrok ────────────────────────────
pkill -f "ngrok http" 2>/dev/null || true
sleep 1

# ── Start ngrok in background ─────────────────────────
ngrok http $PORT --log=stdout --log-level=warn > /tmp/ngrok.log 2>&1 &
NGROK_PID=$!
echo "Starting ngrok (pid $NGROK_PID)..."

# ── Poll for public URL ───────────────────────────────
PUBLIC_URL=""
for i in $(seq 1 20); do
  sleep 1
  PUBLIC_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null \
    | python3 -c "
import sys, json
try:
  t = json.load(sys.stdin).get('tunnels', [])
  https = [u['public_url'] for u in t if u.get('proto') == 'https']
  print(https[0] if https else '')
except:
  print('')
" 2>/dev/null)
  [ -n "$PUBLIC_URL" ] && break
done

if [ -z "$PUBLIC_URL" ]; then
  echo "Could not get ngrok URL. Check /tmp/ngrok.log for errors."
  exit 1
fi

# ── Update .env ───────────────────────────────────────
sed -i '' "s|PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=$PUBLIC_URL|" "$ENV_FILE"
sed -i '' "s|CORS_ORIGIN=.*|CORS_ORIGIN=$PUBLIC_URL,http://localhost:4000|" "$ENV_FILE"
echo "Updated .env → PUBLIC_BASE_URL=$PUBLIC_URL"

# ── Print Twilio webhook URLs ─────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Set this as your Twilio phone number webhook URL:"
echo ""
AGENT_IDS=$(psql "postgres://voiceagentos:voiceagentos@localhost:5432/voiceagentos" \
  -t -c "SELECT id FROM agents WHERE status='live' LIMIT 5" 2>/dev/null | tr -d ' \n' | sed 's/|/ /g') 2>/dev/null || AGENT_IDS=""

if [ -n "$AGENT_IDS" ]; then
  for ID in $AGENT_IDS; do
    [ -n "$ID" ] && echo "  $PUBLIC_URL/twilio/voice?agentId=$ID"
  done
else
  echo "  $PUBLIC_URL/twilio/voice?agentId=<AGENT_ID>"
  echo ""
  echo "  (Find agent IDs in the dashboard → Agents)"
fi
echo ""
echo " Twilio Console → Phone Numbers → Manage"
echo "  → Voice & Fax → A call comes in → Webhook"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Start dev server ──────────────────────────────────
cd "$(dirname "$0")/.."
npm run dev
