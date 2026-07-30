# Hub Hardware Alternatives — Sow Now

The default hub hardware is a **Raspberry Pi Zero 2W**, but if stock is tight, the
following boards are supported with varying levels of code changes required.

## Option 1: Raspberry Pi Zero W (original) ✅ Drop-in, zero changes

| Spec | Value |
|------|-------|
| CPU | Single-core ARM11 @ 1 GHz |
| RAM | 512 MB |
| WiFi | 802.11n built-in |
| USB | Micro-USB OTG (host via adapter) |
| Code changes | **None** |
| Price (UK) | ~£9 (Pimoroni, The Pi Hut, CPC) |
| Availability | Excellent |

**Recommended near-term substitute.** Slightly slower than Zero 2W but all Python
agent code, `rtl_433`, SPI LoRa HAT, and `install.sh` run unchanged.

Single-core ARM11 is more than fast enough: the agent is mostly waiting on I/O.

---

## Option 2: Orange Pi Zero 2W ⚠️ Needs ~30-line change

| Spec | Value |
|------|-------|
| CPU | Quad-core ARM Cortex-A53 @ 1.5 GHz |
| RAM | 1 GB LPDDR4 |
| WiFi | 802.11ac (WiFi 5) + BT 5.0 |
| USB | USB-C OTG (host via adapter) |
| OS | Ubuntu 22.04 arm64 |
| Code changes | `RPi.GPIO` → `lgpio`, `install.sh` SPI lines |
| Price (UK) | ~£18 (Amazon, AliExpress) |
| Availability | Good |

**Viable for bulk orders.** Faster and cheaper per unit than Zero 2W at scale.

### Changes required

**`pi-agent/requirements.txt`** — replace:
```
RPi.GPIO==0.7.1
```
with:
```
lgpio==0.2.2.0
gpiozero==2.0.1
```

**`pi-agent/setup/install.sh`** — replace the SPI enable block:
```bash
# For Orange Pi Zero 2W — replace /boot/firmware/config.txt block with:
if ! grep -q "spi-spidev" /boot/orangepiEnv.txt 2>/dev/null; then
    echo "overlays=spi-spidev" >> /boot/orangepiEnv.txt
    echo "param_spidev_spi_bus=0" >> /boot/orangepiEnv.txt
fi
```

**`pi-agent/agent/lora_reader.py`** — the `sx126x` library uses `RPi.GPIO` internally.
Replace with the `lgpio`-based fork or use the generic `pyLoRa` library:
```bash
pip install pyLoRa
```
and update the `SX126x(...)` instantiation to use `pyLoRa`'s `LoRa()` class.

---

## Option 3: Waveshare RP2350-PiZero ❌ Not suitable for hub role

This board uses the RP2350 microcontroller (no Linux, no USB host, no WiFi).
It **cannot** run `rtl_433`, host an RTL-SDR dongle, or connect to WiFi natively.

It **is** suitable as a more capable sensor node (replacing ATtiny85) if you want
more flash/RAM or easier firmware development with MicroPython or the Pi Pico C SDK.

---

## Checking Pi Zero 2W stock (UK)

- **[rpilocator.com](https://rpilocator.com)** — real-time stock alerts
- **Pimoroni** — `pimoroni.com/products/raspberry-pi-zero-2-w`
- **The Pi Hut** — `thepihut.com`
- **CPC Farnell** — `cpc.farnell.com`
- **Okdo** — `okdo.com`

Set up an RSS/email alert on rpilocator for instant restocking notifications.
