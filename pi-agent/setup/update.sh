#!/usr/bin/env bash
# Vernal Pi Agent — in-place update script
#
# Pulls the latest agent code from the repo and restarts the service.
# Run as root on a deployed Pi.
#
# Usage:
#   sudo bash setup/update.sh
#
# What this does:
#   1. Stops the agent service cleanly
#   2. Copies the latest agent + portal source into /opt/sow-now-agent
#   3. Updates Python dependencies in the venv
#   4. Restarts the agent service
#   5. Tails the journal so you can confirm it came up cleanly
#
# Run from the repo root on the Pi, or scp the agent source first:
#   scp -r pi-agent/agent pi-agent/portal pi-agent/requirements.txt \
#       pi-agent/setup/update.sh \
#       pi@sn-001.local:~/sow-now-update/
#   ssh pi@sn-001.local "cd ~/sow-now-update && sudo bash update.sh"

set -euo pipefail

AGENT_DIR="/opt/sow-now-agent"
# SOURCE_DIR: directory containing agent/, portal/, requirements.txt.
# Accept an explicit path as $1 to avoid BASH_SOURCE resolution issues under sudo.
if [ -n "${1:-}" ] && [ -d "$1/agent" ]; then
    SOURCE_DIR="$(cd "$1" && pwd)"
elif [ -d "$(pwd)/agent" ]; then
    SOURCE_DIR="$(pwd)"
else
    SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    [ -d "$SOURCE_DIR/agent" ] || SOURCE_DIR="$(cd "$SOURCE_DIR/.." && pwd)"
fi

echo "🌱 Sow Now agent update starting..."

# ── 1. Stop agent cleanly ─────────────────────────────────────────────────────
echo "  Stopping sow-now-agent..."
systemctl stop sow-now-agent
# Confirm rtl_433 subprocess is gone
for i in $(seq 1 5); do
    pgrep -f rtl_433 > /dev/null 2>&1 || break
    sleep 1
done
if pgrep -f rtl_433 > /dev/null 2>&1; then
    echo "  rtl_433 still running — force killing..."
    pkill -9 -f rtl_433 || true
fi
echo "  Agent stopped."

# ── 2. Copy latest source ─────────────────────────────────────────────────────
echo "  Copying agent source to $AGENT_DIR..."
cp -r "$SOURCE_DIR/agent"        "$AGENT_DIR/"
cp -r "$SOURCE_DIR/portal"       "$AGENT_DIR/"
cp    "$SOURCE_DIR/requirements.txt" "$AGENT_DIR/"
chown -R sownow:sownow "$AGENT_DIR"
echo "  Source updated."

# ── 3. Update Python dependencies ─────────────────────────────────────────────
echo "  Updating Python dependencies..."
"$AGENT_DIR/venv/bin/pip" install --quiet --upgrade pip
"$AGENT_DIR/venv/bin/pip" install --quiet -r "$AGENT_DIR/requirements.txt"
echo "  Dependencies up to date."

# ── 4. Reload systemd and restart agent ──────────────────────────────────────
echo "  Restarting sow-now-agent..."
systemctl daemon-reload
systemctl start sow-now-agent
sleep 3

# ── 5. Confirm it came up ─────────────────────────────────────────────────────
if systemctl is-active --quiet sow-now-agent; then
    echo ""
    echo "✅ Update complete — agent is running."
    echo ""
    echo "Tailing journal (Ctrl+C to exit):"
    echo "────────────────────────────────────────"
    journalctl -u sow-now-agent -f --no-pager -n 20
else
    echo ""
    echo "❌ Agent failed to start. Last 20 log lines:"
    journalctl -u sow-now-agent --no-pager -n 20
    exit 1
fi
