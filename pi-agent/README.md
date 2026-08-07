# Sow Now Pi Agent

Python agent for the Raspberry Pi Zero 2W hub. Receives sensor data from Ecowitt
wireless sensors via an RTL-SDR dongle, buffers locally in SQLite, and uploads to
Cloudflare.

---

## Hardware required per hub

| Component   | Part                            | Notes                                      |
|-------------|---------------------------------|--------------------------------------------|
| Computer    | Raspberry Pi Zero W             | Pre-soldered header version                |
| Storage     | 32 GB Samsung Endurance microSD | Endurance grade — handles constant writes  |
| RTL-SDR     | Generic RTL2832U dongle         | Receives all Ecowitt sensors on 868 MHz    |
| OTG adapter | Micro-USB OTG → USB-A           | Required to connect RTL-SDR to the Zero 2W |
| PSU         | 5 V / 2.5 A USB-C               | Official Pi PSU preferred                  |

---

## Supported sensors

| Sensor                   | Model         | Data                              |
|--------------------------|---------------|-----------------------------------|
| Outdoor weather station  | Ecowitt WS69  | Temp, humidity, wind, rain, UV    |
| Soil moisture            | Ecowitt WH51  | Moisture %, battery               |
| Temp / humidity          | Ecowitt WH31  | Temp, humidity, battery           |

All sensors transmit at **868 MHz** and are decoded by `rtl_433`.

---

## Manufacturing a hub (your job — not the customer's)

Each hub must be prepared before it goes in the box. Do this once per unit.

### Step 1 — Generate the device config

On your Mac, from the `vernal` directory:

```bash
DEVICE_JWT_SECRET=<your_secret> node scripts/manufacture-hub.mjs sn-001
```

Replace `sn-001` with the serial for this unit (sn-002, sn-003 etc.).

This inserts the device into the production database and saves a ready-to-use
`config.json` to `scripts/output/sn-001.config.json`.

> The `DEVICE_JWT_SECRET` is the production secret set in Cloudflare. Store it
> somewhere safe (password manager). Never commit it.

### Step 2 — Flash the SD card

1. Open **Raspberry Pi Imager**
2. Choose **Raspberry Pi OS Lite 32-bit (Bookworm)**
3. Click the ⚙️ advanced settings before writing:
   - Hostname: `sn-001` (match the serial)
   - Enable SSH
   - Add your SSH public key (from `~/.ssh/id_ed25519.pub`)
   - Do **not** set a password — the setup script disables password auth
4. Write to the SD card

### Step 3 — Boot and run setup

Insert the SD card, plug in power, wait ~30 seconds, then SSH in:

```bash
ssh pi@sn-001.local
```

Install git and clone the repo:

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/GHaigh/sow-now.git
cd sow-now/pi-agent
sudo bash setup/install.sh
```

This takes 3–5 minutes. It installs `rtl_433`, Python, the agent and portal,
sets up systemd services, hardens SSH, and configures the firewall (SSH stays open).

### Step 4 — Copy the config to the Pi

From your Mac (in the `vernal` directory):

```bash
scp scripts/output/sn-001.config.json pi@sn-001.local:/tmp/config.json
ssh pi@sn-001.local "sudo mv /tmp/config.json /etc/sow-now/config.json && sudo chmod 600 /etc/sow-now/config.json"
```

### Step 5 — Reboot

```bash
ssh pi@sn-001.local "sudo reboot"
```

The hub is now ready to go in the box.

---

## Customer setup (what the customer does)

1. Plug in the hub and wait ~30 seconds
2. Connect phone to the `SowNow-XXXX` Wi-Fi hotspot
3. A setup page opens automatically — enter home Wi-Fi password
4. Open the Sow Now app and scan the QR code on the box to link the hub to their account

That's it. No command lines, no config files.

---

## Monitoring (for debugging)

SSH into the hub and run:

```bash
# Live agent logs
sudo journalctl -u sow-now-agent -f

# Check service status
sudo systemctl status sow-now-agent

# How many readings are queued to upload
sqlite3 /var/lib/sow-now/readings.db "SELECT COUNT(*) FROM readings WHERE uploaded=0;"
```

---

## OTA updates

The agent pulls from the `main` branch nightly and restarts automatically if anything changed.

To trigger a manual update on a hub:

```bash
cd /opt/sow-now-agent && git pull && sudo systemctl restart sow-now-agent
```
