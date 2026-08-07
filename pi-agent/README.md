# Sow Now Pi Agent

Python agent for the Raspberry Pi Zero W/Zero 2W hub. Receives all sensor data
from Ecowitt wireless sensors via a single RTL-SDR dongle, buffers locally in
SQLite, and uploads to Cloudflare.

## First-Boot WiFi Setup (Captive Portal)

On first boot, if no WiFi credentials are configured, the hub automatically
starts a temporary Wi-Fi hotspot called **`SowNow-XXXX`** (where XXXX is unique
to each hub).

1. Customer plugs in the hub and waits ~30 seconds
2. They connect their phone to the `SowNow-XXXX` network
3. A setup page opens automatically at `192.168.4.1`
4. They pick their home network and enter the password
5. The hub writes the credentials, kills the hotspot, and joins their home WiFi
6. The Sow Now agent starts automatically once online

The portal is implemented in `portal/portal.py` using stdlib `asyncio` — no
external Python dependencies. `hostapd` and `dnsmasq` are installed via apt.

> **Note:** The Pi Zero W's CYW43438 chipset does **not** support concurrent
> AP+STA mode. The portal runs before any WiFi connection is established,
> which sidesteps this limitation entirely.

## Supported Sensors

| Sensor | Model | Data |
|--------|-------|------|
| Outdoor weather station | Ecowitt WS69 | Temp, humidity, wind, rain, UV, solar |
| Soil moisture (per bed) | Ecowitt WH51 | Moisture %, battery |
| Greenhouse temp/humidity | Ecowitt WH31 | Temp, humidity, battery |

All sensors transmit at **868 MHz** (EU/UK ISM band) and are decoded by `rtl_433`.

## Hardware Requirements

| Component | Part | Notes |
|-----------|------|-------|
| Computer  | Raspberry Pi Zero 2W | Pre-soldered header version |
| Storage   | 32 GB Samsung Endurance microSD | Endurance grade for constant writes |
| RTL-SDR   | Generic RTL2832U dongle | Receives all Ecowitt sensors on 868 MHz |
| OTG adapter | Micro-USB OTG → USB-A | Required for RTL-SDR on Zero 2W |
| PSU       | 5 V / 2.5 A USB-C | Official Pi PSU preferred |

## First-Time Setup

### 1. Flash the OS

Flash **Raspberry Pi OS Lite 32-bit (Bookworm)** using Raspberry Pi Imager.

Enable SSH and set a hostname (`sow-now-hub`) in the Imager advanced settings.
Add your SSH public key in the Imager settings — this is the only SSH access method
(password auth is disabled by the setup script).

### 2. Boot and SSH in

```bash
ssh pi@sow-now-hub.local
```

### 3. Clone repo and run setup

```bash
git clone https://github.com/GHaigh/sow-now.git
cd sow-now/pi-agent
sudo bash setup/install.sh
```

### 4. Provision the device

In the Vernal app, tap **Set up hub** and scan the QR code on the bottom of the hub box.
The app will POST to the provisioning API and return a device JWT.

Copy the returned values into `/etc/sow-now/config.json`:

```bash
sudo cp /etc/sow-now/config.json.example /etc/sow-now/config.json
sudo nano /etc/sow-now/config.json
# Fill in device_id and device_jwt from the app
sudo chmod 600 /etc/sow-now/config.json
```

### 5. Start the agent

```bash
sudo systemctl start sow-now-agent
sudo journalctl -u sow-now-agent -f
```

## Monitoring

```bash
# Live agent logs
sudo journalctl -u sow-now-agent -f

# Check service status
sudo systemctl status sow-now-agent

# Inspect local SQLite buffer
sqlite3 /var/lib/sow-now/readings.db "SELECT COUNT(*) FROM readings WHERE uploaded=0;"
```

## OTA Updates

The agent checks for updates nightly via a systemd timer pulling from the main
branch of the GitHub repo. If files change, services are restarted automatically.

To trigger a manual update:
```bash
cd /opt/sow-now-agent && git pull && sudo systemctl restart sow-now-agent
```
