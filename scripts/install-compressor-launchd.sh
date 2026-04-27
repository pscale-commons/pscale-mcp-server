#!/usr/bin/env bash
# Install the world-compressor as a long-running launchd agent on macOS.
# Runs in the background, restarts on crash, survives reboots.
#
# Usage:
#   ANTHROPIC_API_KEY=sk-ant-... GM_SECRET_THORNKEEP=thorn142 \
#     ./scripts/install-compressor-launchd.sh
#
# Idempotent — safe to re-run to update credentials or paths.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="$HOME/.config/pscale-mcp-server"
ENV_FILE="$ENV_DIR/compressor.env"
LABEL="com.pscale.thornkeep-compressor"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"
NPX="$(command -v npx)"
BASH_PATH="$(command -v bash)"

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "ANTHROPIC_API_KEY is required (export it before running)" >&2
  exit 1
fi
if [[ -z "${GM_SECRET_THORNKEEP:-}" ]]; then
  echo "GM_SECRET_THORNKEEP is required (the secret you used to lock the GM blocks)" >&2
  exit 1
fi

mkdir -p "$ENV_DIR" "$LOG_DIR" "$(dirname "$PLIST")"

# 1. Write env file with restrictive permissions.
umask 077
cat > "$ENV_FILE" <<EOF
# pscale-mcp-server compressor credentials
# Mode 0600 — only your user can read this file.
# Rotate by editing in place, then: launchctl kickstart -k gui/\$UID/$LABEL

ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
SUPABASE_ANON_KEY=sb_publishable_rjE-rjL8kPCkXDK1ZcXauA_D84USWp9
COMPRESSOR_GAMES_CONFIG=${REPO_DIR}/scripts/compressor-games.example.json
COMPRESSOR_GM_SECRET_THORNKEEP=${GM_SECRET_THORNKEEP}
EOF
chmod 0600 "$ENV_FILE"

# 2. Write the launchd plist.
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${BASH_PATH}</string>
    <string>-c</string>
    <string>cd "${REPO_DIR}" &amp;&amp; set -a &amp;&amp; source "${ENV_FILE}" &amp;&amp; set +a &amp;&amp; "${NPX}" tsx scripts/world-compressor.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${REPO_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(dirname "${NPX}"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/thornkeep-compressor.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/thornkeep-compressor.err</string>
</dict>
</plist>
EOF

# 3. (Re)load the agent.
if launchctl list | grep -q "${LABEL}"; then
  echo "  unloading existing agent..."
  launchctl unload "$PLIST" 2>/dev/null || true
fi
echo "  loading agent..."
launchctl load "$PLIST"

# Brief pause so launchd has time to start the process before we list.
sleep 2

echo
echo "✓ installed"
echo
echo "  env:    $ENV_FILE  (chmod 0600)"
echo "  plist:  $PLIST"
echo "  stdout: $LOG_DIR/thornkeep-compressor.log"
echo "  stderr: $LOG_DIR/thornkeep-compressor.err"
echo
echo "Status:"
launchctl list | grep "${LABEL}" || echo "  (not yet visible — check $LOG_DIR/thornkeep-compressor.err)"
echo
echo "Useful commands:"
echo "  tail -f $LOG_DIR/thornkeep-compressor.log     # watch the compressor"
echo "  launchctl unload $PLIST                       # stop"
echo "  launchctl load $PLIST                         # start"
echo "  launchctl kickstart -k gui/\$UID/${LABEL}     # restart (after editing env)"
