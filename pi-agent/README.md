# Vernal Pi Agent

Python agent for the Raspberry Pi Zero 2W hub. Receives sensor data from the
Ecowitt WS69 weather station (via RTL-SDR) and soil/greenhouse LoRa nodes,
buffers locally in SQLite, and uploads to Cloudflare.

## Hardware Requirements

| Component | Part | Notes |
|-----------|------|-------|
| Computer  | Raspberry Pi Zero 2W | Pre-soldered header version |
| Storage   | 32 GB Samsung Endurance microSD | Endurance grade for constant writes |
| RTL-SDR   | Generic RTL2832U dongle | Receives WS69 on 433 MHz |
| OTG adapter | Micro-USB OTG → USB-A | Required for RTL-SDR on Zero 2W |
| LoRa HAT  | Waveshare SX1262 LoRa HAT (433 MHz) | SPI-connected |
| PSU       | 5 V / 2.5 A USB-C | Official Pi PSU preferred |

## First-Time Setup

### 1. Flash the OS

Flash **Raspberry Pi OS Lite 64-bit (Bookworm)** using Raspberry Pi Imager.

Enable SSH and set a hostname (`vernal-hub`) in the Imager advanced settings.
Add your SSH public key in the Imager settings — this is the only SSH access method
(password auth is disabled by the setup script).

### 2. Boot and SSH in

```bash
ssh pi@vernal-hub.local
```

### 3. Clone repo and run setup

```bash
git clone https://github.com/YOUR_ORG/vernal.git
cd vernal/pi-agent
sudo bash setup/install.sh
```

### 4. Provision the device

In the Vernal app, tap **Set up hub** and scan the QR code on the bottom of the hub box.
The app will POST to the provisioning API and return a device JWT.

Copy the returned values into `/etc/vernal/config.json`:

```bash
sudo cp /etc/vernal/config.json.example /etc/vernal/config.json
sudo nano /etc/vernal/config.json
# Fill in device_id and device_jwt from the app
sudo chmod 600 /etc/vernal/config.json
```

### 5. Add node AES keys

Each LoRa sensor node has a unique AES-128 key burned in at manufacture.
These are provided on a key sheet shipped inside the box.

```bash
sudo nano /etc/vernal/node_keys.json
```

Format:
```json
{
  "1": "aabbccddeeff00112233445566778899",
  "2": "112233445566778899aabbccddeeff00"
}
```

```bash
sudo chmod 600 /etc/vernal/node_keys.json
sudo chown vernal:vernal /etc/vernal/node_keys.json
```

### 6. Start the agent

```bash
sudo systemctl start vernal-agent
sudo journalctl -u vernal-agent -f
```

### 7. Reboot (activates SPI for LoRa HAT)

```bash
sudo reboot
```

## Monitoring

```bash
# Live agent logs
sudo journalctl -u vernal-agent -f

# Check service status
sudo systemctl status vernal-agent

# Inspect local SQLite buffer
sqlite3 /var/lib/vernal/readings.db "SELECT COUNT(*) FROM readings WHERE uploaded=0;"
```

## OTA Updates

The agent checks for updates nightly via a systemd timer pulling from the main
branch of the GitHub repo. If files change, services are restarted automatically.

To trigger a manual update:
```bash
cd /opt/vernal-agent && git pull && sudo systemctl restart vernal-agent
```
