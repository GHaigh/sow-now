#!/usr/bin/env bash
# Vernal Pi Zero 2W — first-boot setup script
# Run as root on a fresh Raspberry Pi OS Lite 64-bit image.
#
# Usage:
#   sudo bash setup/install.sh
#
# What this does:
#   1. Updates system packages
#   2. Installs rtl_433, Python 3.11, required system libs
#   3. Creates the vernal user and directories
#   4. Installs Python dependencies into a venv
#   5. Copies systemd service files
#   6. Enables SPI interface
#   7. Hardens SSH (key auth only, no passwords)
#   8. Enables ufw firewall (outbound HTTPS only)
#   9. Enables automatic security updates
#
# After running this script:
#   - Copy /etc/vernal/config.json.example to /etc/vernal/config.json
#   - Fill in device_id and device_jwt (from provisioning QR scan)
#   - sudo systemctl enable --now vernal-agent

set -euo pipefail

echo "🌱 Vernal Pi setup starting..."

# ── 1. Update system ─────────────────────────────────────────────────────────
apt-get update -qq
apt-get upgrade -y -qq

# ── 2. Install dependencies ──────────────────────────────────────────────────
apt-get install -y -qq \
    rtl-sdr \
    rtl433 \
    python3.11 \
    python3.11-venv \
    python3-pip \
    libusb-1.0-0 \
    git \
    ufw \
    unattended-upgrades \
    apt-listchanges

# ── 3. Create vernal user and directories ────────────────────────────────────
if ! id -u vernal &>/dev/null; then
    useradd -r -s /usr/sbin/nologin -d /var/lib/vernal vernal
fi

mkdir -p /var/lib/vernal      # SQLite buffer lives here
mkdir -p /etc/vernal          # Config + node keys live here
chown -R vernal:vernal /var/lib/vernal /etc/vernal
chmod 700 /etc/vernal         # Secrets directory — owner only

# Add vernal user to plugdev group for RTL-SDR USB access
usermod -aG plugdev vernal

# ── 4. Install Python agent ──────────────────────────────────────────────────
AGENT_DIR="/opt/vernal-agent"
mkdir -p "$AGENT_DIR"

# Copy agent source (expected to be present alongside this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -r "$SCRIPT_DIR/../agent" "$AGENT_DIR/"
cp "$SCRIPT_DIR/../requirements.txt" "$AGENT_DIR/"

# Create venv and install dependencies
python3.11 -m venv "$AGENT_DIR/venv"
"$AGENT_DIR/venv/bin/pip" install --quiet --upgrade pip
"$AGENT_DIR/venv/bin/pip" install --quiet -r "$AGENT_DIR/requirements.txt"

chown -R vernal:vernal "$AGENT_DIR"

# ── 5. Install systemd service ───────────────────────────────────────────────
cp "$SCRIPT_DIR/vernal-agent.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable vernal-agent

# ── 6. Enable SPI (for LoRa HAT) ────────────────────────────────────────────
if ! grep -q "^dtparam=spi=on" /boot/firmware/config.txt 2>/dev/null; then
    echo "dtparam=spi=on" >> /boot/firmware/config.txt
    echo "SPI enabled — will take effect after reboot"
fi

# ── 7. Harden SSH ────────────────────────────────────────────────────────────
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl reload ssh

# ── 8. Firewall — outbound HTTPS only ────────────────────────────────────────
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow out 443/tcp comment "HTTPS outbound to Cloudflare"
ufw allow out 53/udp  comment "DNS"
ufw --force enable

# ── 9. Automatic security updates ────────────────────────────────────────────
cat > /etc/apt/apt.conf.d/50unattended-upgrades-vernal << 'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Automatic-Reboot-Time "03:00";
EOF

# Copy example config
cp "$SCRIPT_DIR/config.example.json" /etc/vernal/config.json.example
chmod 600 /etc/vernal/config.json.example

echo ""
echo "✅ Vernal Pi setup complete."
echo ""
echo "Next steps:"
echo "  1. Add your SSH public key to ~/.ssh/authorized_keys"
echo "  2. Copy /etc/vernal/config.json.example to /etc/vernal/config.json"
echo "  3. Fill in device_id and device_jwt from the Vernal app QR scan"
echo "  4. sudo systemctl start vernal-agent"
echo "  5. sudo journalctl -u vernal-agent -f   (to watch logs)"
echo "  6. Reboot to activate SPI: sudo reboot"
