#!/usr/bin/env bash
# Vernal Pi Zero 2W — first-boot setup script
# Run as root on a fresh Raspberry Pi OS Lite 32-bit image.
#
# Usage:
#   sudo bash setup/install.sh
#
# What this does:
#   1. Updates system packages
#   2. Installs rtl_433, Python 3.11, hostapd, dnsmasq, required system libs
#   3. Creates the sownow user and directories
#   4. Installs Python agent + portal into a venv
#   5. Copies systemd service files (portal + agent)
#   6. Hardens SSH (key auth only, no passwords)
#   7. Enables ufw firewall (outbound HTTPS + DNS only)
#   8. Enables automatic security updates
#
# After running this script:
#   - Copy /etc/sow-now/config.json.example to /etc/sow-now/config.json
#   - Fill in device_id and device_jwt (from provisioning QR scan)
#   - sudo systemctl enable --now sow-now-agent

set -euo pipefail

echo "🌱 Vernal Pi setup starting..."

# ── 1. Update system ─────────────────────────────────────────────────────────
apt-get update -qq
apt-get upgrade -y -qq

# ── 2. Install dependencies ──────────────────────────────────────────────────
apt-get install -y -qq \
    rtl-sdr \
    python3.11 \
    python3.11-venv \
    python3-pip \
    libusb-1.0-0 \
    hostapd \
    dnsmasq \
    wireless-tools \
    git \
    curl \
    unzip \
    ufw \
    unattended-upgrades \
    apt-listchanges

# ── 3. Install rtl_433 from source (armv6 compatible) ────────────────────────
apt-get install -y -qq \
    cmake \
    libusb-1.0-0-dev \
    librtlsdr-dev \
    build-essential

RTL433_VERSION="25.12"
curl -fsSL "https://github.com/merbanan/rtl_433/archive/refs/tags/${RTL433_VERSION}.tar.gz" -o /tmp/rtl433.tar.gz
tar -xf /tmp/rtl433.tar.gz -C /tmp
cmake -S /tmp/rtl_433-${RTL433_VERSION} -B /tmp/rtl433-build \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX=/usr/local
cmake --build /tmp/rtl433-build --parallel 2
cmake --install /tmp/rtl433-build
rm -rf /tmp/rtl433.tar.gz /tmp/rtl_433-${RTL433_VERSION} /tmp/rtl433-build

# ── 3b. Blacklist kernel DVB drivers that claim the RTL-SDR dongle ───────────
# Without this, dvb_usb_rtl28xxu loads on plug-in and prevents rtl_433 from
# opening the device as an SDR.
cat > /etc/modprobe.d/rtlsdr-blacklist.conf << 'EOF'
blacklist dvb_usb_rtl28xxu
blacklist dvb_usb_v2
blacklist rtl2832_sdr
blacklist rtl2832
EOF

# ── 3c. udev rule — grant userspace access to RTL-SDR dongle ─────────────────
# Required for rtl_433 to open the device without hanging.
cat > /etc/udev/rules.d/rtl-sdr.rules << 'EOF'
SUBSYSTEM=="usb", ATTRS{idVendor}=="0bda", ATTRS{idProduct}=="2832", GROUP="plugdev", MODE="0666", SYMLINK+="rtl_sdr"
SUBSYSTEM=="usb", ATTRS{idVendor}=="0bda", ATTRS{idProduct}=="2838", GROUP="plugdev", MODE="0666", SYMLINK+="rtl_sdr"
EOF
udevadm control --reload-rules

# Disable hostapd and dnsmasq default services — we manage them from the portal
systemctl disable hostapd dnsmasq 2>/dev/null || true
systemctl stop    hostapd dnsmasq 2>/dev/null || true

# ── 3. Create sownow user and directories ────────────────────────────────────
if ! id -u sownow &>/dev/null; then
    useradd -r -s /usr/sbin/nologin -d /var/lib/sow-now sownow
fi

mkdir -p /var/lib/sow-now      # SQLite buffer lives here
mkdir -p /etc/sow-now          # Config + node keys live here
chown -R sownow:sownow /var/lib/sow-now /etc/sow-now
chmod 700 /etc/sow-now         # Secrets directory — owner only

# Add sownow user to plugdev group for RTL-SDR USB access
usermod -aG plugdev sownow

# ── 4. Install Python agent ──────────────────────────────────────────────────
AGENT_DIR="/opt/sow-now-agent"
mkdir -p "$AGENT_DIR"

# Copy agent + portal source (expected to be present alongside this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -r "$SCRIPT_DIR/../agent"  "$AGENT_DIR/"
cp -r "$SCRIPT_DIR/../portal" "$AGENT_DIR/"
cp "$SCRIPT_DIR/../requirements.txt" "$AGENT_DIR/"

# Create venv and install dependencies
python3.11 -m venv "$AGENT_DIR/venv"
"$AGENT_DIR/venv/bin/pip" install --quiet --upgrade pip
"$AGENT_DIR/venv/bin/pip" install --quiet -r "$AGENT_DIR/requirements.txt"

chown -R sownow:sownow "$AGENT_DIR"

# ── 5. Install systemd services ──────────────────────────────────────────────
cp "$SCRIPT_DIR/sow-now-portal.service"    /etc/systemd/system/
cp "$SCRIPT_DIR/sow-now-provision.service" /etc/systemd/system/
cp "$SCRIPT_DIR/sow-now-agent.service"     /etc/systemd/system/
systemctl daemon-reload
systemctl enable sow-now-portal sow-now-provision sow-now-agent

# ── 6. Harden SSH ────────────────────────────────────────────────────────────
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl reload ssh

# ── 7. Firewall ───────────────────────────────────────────────────────────────
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow in  22/tcp  comment "SSH"
ufw allow out 443/tcp comment "HTTPS outbound to Cloudflare"
ufw allow out 53/udp  comment "DNS"
ufw --force enable

# ── 8. Automatic security updates ────────────────────────────────────────────
cat > /etc/apt/apt.conf.d/50unattended-upgrades-sownow << 'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Automatic-Reboot-Time "03:00";
EOF

# Copy example config
cp "$SCRIPT_DIR/config.example.json" /etc/sow-now/config.json.example
chown root:root /etc/sow-now/config.json.example
chmod 600 /etc/sow-now/config.json.example

echo ""
echo "✅ Sow Now Pi setup complete."
echo ""
echo "──────────────────────────────────────────────────────────"
echo "  MANUFACTURE STEP (run on each unit before boxing):"
echo ""
echo "  Write /etc/sow-now/provision.json with the unit's"
echo "  device_id and provision_token from the Vernal admin panel:"
echo ""
echo '  echo '"'"'{"device_id":"dev-sn-XXX","provision_token":"SN-XXXXXXXX"}'"'"' \'
echo "       > /etc/sow-now/provision.json"
echo "  chmod 600 /etc/sow-now/provision.json"
echo ""
echo "  Then reboot to verify the unit enters the captive portal."
echo "──────────────────────────────────────────────────────────"
echo ""
echo "Customer unboxing flow (automatic after manufacture step):"
echo "  1. Customer plugs in hub"
echo "  2. Phone connects to 'SowNow-XXXX' WiFi, enters home network password"
echo "  3. Hub connects to internet, starts polling for QR scan"
echo "  4. Customer scans QR in app → JWT delivered to hub automatically"
echo "  5. Agent starts, sensors appear in app within 5 minutes"
echo ""
echo "Monitor: sudo journalctl -u sow-now-provision -f"
echo "         sudo journalctl -u sow-now-agent -f"
