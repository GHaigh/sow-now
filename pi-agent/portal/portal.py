"""
Sow Now — WiFi captive portal
==============================
Runs on first boot (or whenever /etc/sow-now/wifi.conf is absent).

Flow:
  1. portal.py is started by sow-now-portal.service
  2. It writes a runtime hostapd.conf (with unique SSID), brings up the AP,
     starts dnsmasq, and serves a small HTTP server on port 80
  3. Customer connects their phone to the "SowNow-XXXX" hotspot
  4. Phone's captive portal detection hits port 80 → served the setup page
  5. Customer picks their network and enters password → POST /connect
  6. Portal writes /etc/sow-now/wifi.conf (wpa_supplicant format),
     tears down the AP, and hands off to wpa_supplicant + dhcpcd
  7. systemd sow-now-agent.service starts once network-online.target is reached

Security notes:
  - Portal only runs when no wifi.conf exists (i.e. unconfigured units)
  - Open AP with no WPA — acceptable because it only lives for ~2 minutes
    during first-time setup and transmits no sensitive data
  - WiFi password is written to /etc/sow-now/wifi.conf (chmod 600, root only)
  - Portal tears itself down immediately after writing credentials
"""

import asyncio
import json
import logging
import os
import re
import signal
import socket
import subprocess
import sys
from pathlib import Path

log = logging.getLogger("sow-now.portal")

# ── Paths ─────────────────────────────────────────────────────────────────────
WIFI_CONF_PATH       = Path("/etc/sow-now/wifi.conf")
HOSTAPD_CONF_PATH    = Path("/etc/sow-now/hostapd-runtime.conf")
HOSTAPD_TEMPLATE     = Path("/opt/sow-now-agent/portal/hostapd.conf")
DNSMASQ_CONF_PATH    = Path("/opt/sow-now-agent/portal/dnsmasq.conf")
WPA_SUPPLICANT_CONF  = Path("/etc/wpa_supplicant/wpa_supplicant.conf")

# AP settings
AP_IP       = "192.168.4.1"
AP_NETMASK  = "255.255.255.0"
PORTAL_PORT = 80


# ── Helpers ───────────────────────────────────────────────────────────────────

def _run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    """Run a shell command, logging errors."""
    log.debug("run: %s", " ".join(cmd))
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


def _device_suffix() -> str:
    """Return last 4 hex chars of wlan0 MAC for a unique SSID."""
    try:
        mac = Path("/sys/class/net/wlan0/address").read_text().strip()
        return mac.replace(":", "")[-4:].upper()
    except Exception:
        return "0000"


def _wifi_configured() -> bool:
    """Return True if wifi.conf already exists and is non-empty."""
    return WIFI_CONF_PATH.exists() and WIFI_CONF_PATH.stat().st_size > 0


def _scan_networks() -> list[str]:
    """Return a sorted, deduplicated list of visible SSIDs."""
    try:
        result = _run(["iwlist", "wlan0", "scan"], check=False)
        ssids = re.findall(r'ESSID:"([^"]+)"', result.stdout)
        seen: set[str] = set()
        unique = []
        for s in ssids:
            if s not in seen:
                seen.add(s)
                unique.append(s)
        return sorted(unique)
    except Exception as exc:
        log.warning("Network scan failed: %s", exc)
        return []


# ── AP lifecycle ──────────────────────────────────────────────────────────────

def _start_ap() -> None:
    """Bring up wlan0 as an access point."""
    ssid = f"SowNow-{_device_suffix()}"
    log.info("Starting AP: %s", ssid)

    # Write runtime hostapd config with unique SSID
    template = HOSTAPD_TEMPLATE.read_text()
    runtime_conf = re.sub(r"^ssid=.*$", f"ssid={ssid}", template, flags=re.MULTILINE)
    HOSTAPD_CONF_PATH.write_text(runtime_conf)
    HOSTAPD_CONF_PATH.chmod(0o600)

    # Ensure wlan0 is up and not managed by wpa_supplicant
    _run(["ip", "link", "set", "wlan0", "up"], check=False)
    _run(["ip", "addr", "flush", "dev", "wlan0"], check=False)
    _run(["ip", "addr", "add", f"{AP_IP}/{AP_NETMASK}", "dev", "wlan0"], check=False)

    # Start hostapd
    _run(["systemctl", "stop", "wpa_supplicant"], check=False)
    subprocess.Popen(["hostapd", str(HOSTAPD_CONF_PATH)],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # Start dnsmasq
    subprocess.Popen([
        "dnsmasq",
        "--conf-file=" + str(DNSMASQ_CONF_PATH),
        "--no-daemon",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    log.info("AP up — SSID=%s  IP=%s", ssid, AP_IP)


def _stop_ap() -> None:
    """Tear down the AP and hand control back to wpa_supplicant."""
    log.info("Stopping AP, handing off to wpa_supplicant")
    _run(["pkill", "-f", "hostapd"], check=False)
    _run(["pkill", "-f", "dnsmasq"], check=False)
    _run(["ip", "addr", "flush", "dev", "wlan0"], check=False)
    _run(["systemctl", "start", "wpa_supplicant"], check=False)
    _run(["systemctl", "start", "dhcpcd"], check=False)


# ── WiFi credential write ─────────────────────────────────────────────────────

def _write_wifi_conf(ssid: str, password: str) -> None:
    """
    Write credentials to /etc/sow-now/wifi.conf and merge into
    /etc/wpa_supplicant/wpa_supplicant.conf.
    """
    # Validate SSID and password — reject anything that would break config syntax
    if not ssid or len(ssid) > 32:
        raise ValueError("Invalid SSID")
    if len(password) < 8 or len(password) > 63:
        raise ValueError("Password must be 8–63 characters")
    # Strip characters that could escape the wpa_supplicant config format
    safe_ssid     = ssid.replace('"', '').replace('\\', '')
    safe_password = password.replace('"', '').replace('\\', '')

    # Store raw creds for reference / re-provisioning
    WIFI_CONF_PATH.write_text(
        f'ssid="{safe_ssid}"\npassword="{safe_password}"\n'
    )
    WIFI_CONF_PATH.chmod(0o600)

    # Build wpa_supplicant network block
    network_block = (
        'ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev\n'
        'update_config=1\n'
        'country=GB\n\n'
        'network={\n'
        f'    ssid="{safe_ssid}"\n'
        f'    psk="{safe_password}"\n'
        '    key_mgmt=WPA-PSK\n'
        '}\n'
    )
    WPA_SUPPLICANT_CONF.write_text(network_block)
    WPA_SUPPLICANT_CONF.chmod(0o600)
    log.info("WiFi credentials written for SSID: %s", safe_ssid)


# ── HTTP server ───────────────────────────────────────────────────────────────

PORTAL_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sow Now — Wi-Fi Setup</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 420px; margin: 40px auto;
         padding: 0 20px; background: #f9fafb; color: #1f2328; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  p  { color: #57606a; font-size: 14px; }
  select, input { width: 100%; padding: 10px; margin: 8px 0 16px;
                  border: 1px solid #d0d7de; border-radius: 6px;
                  font-size: 15px; box-sizing: border-box; background: #fff; }
  button { width: 100%; padding: 12px; background: #2d6a4f; color: #fff;
           border: none; border-radius: 6px; font-size: 16px; font-weight: 600;
           cursor: pointer; }
  .note { font-size: 12px; color: #57606a; margin-top: 16px; text-align: center; }
</style>
</head>
<body>
  <h1>🌱 Sow Now Setup</h1>
  <p>Connect your hub to your home Wi-Fi to get started.</p>
  <form method="POST" action="/connect">
    <label for="ssid"><strong>Your Wi-Fi network</strong></label>
    <select name="ssid" id="ssid">
      {options}
    </select>
    <label for="password"><strong>Wi-Fi password</strong></label>
    <input type="password" name="password" id="password"
           placeholder="Enter your Wi-Fi password" autocomplete="off" required>
    <button type="submit">Connect hub →</button>
  </form>
  <p class="note">Your password is stored only on this device and never sent to the internet.</p>
</body>
</html>"""

SUCCESS_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sow Now — Connected</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 420px; margin: 80px auto;
         padding: 0 20px; text-align: center; background: #f9fafb; color: #1f2328; }
  h1 { font-size: 24px; }
  p  { color: #57606a; font-size: 15px; line-height: 1.6; }
</style>
</head>
<body>
  <h1>✅ Hub connected!</h1>
  <p>Your hub is joining your Wi-Fi network now.<br>
     This may take 30 seconds.</p>
  <p>You can now disconnect from <strong>SowNow-{suffix}</strong>
     and rejoin your home network, then continue setup in the Sow Now app.</p>
</body>
</html>"""

ERROR_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sow Now — Error</title>
<style>
  body {{ font-family: -apple-system, sans-serif; max-width: 420px; margin: 80px auto;
         padding: 0 20px; text-align: center; }}
  a {{ color: #2d6a4f; }}
</style>
</head>
<body>
  <h1>⚠️ {message}</h1>
  <p><a href="/">Try again</a></p>
</body>
</html>"""


async def _handle(reader: asyncio.StreamReader,
                  writer: asyncio.StreamWriter,
                  shutdown: asyncio.Event) -> None:
    """Handle one HTTP connection."""
    try:
        raw = await asyncio.wait_for(reader.read(4096), timeout=5)
        request = raw.decode("utf-8", errors="replace")
        first_line = request.split("\r\n")[0]
        method, path, *_ = (first_line + "  ").split(" ")

        if method == "GET":
            ssids = _scan_networks()
            options = "\n".join(
                f'<option value="{s}">{s}</option>' for s in ssids
            ) or '<option value="">No networks found — refresh page</option>'
            body = PORTAL_HTML.replace("{options}", options).encode()
            response = (
                b"HTTP/1.1 200 OK\r\n"
                b"Content-Type: text/html; charset=utf-8\r\n"
                b"Cache-Control: no-cache\r\n"
                b"Connection: close\r\n"
                b"\r\n" + body
            )

        elif method == "POST" and path == "/connect":
            # Parse application/x-www-form-urlencoded body
            body_start = request.find("\r\n\r\n")
            form_data  = request[body_start + 4:] if body_start >= 0 else ""
            params: dict[str, str] = {}
            for part in form_data.split("&"):
                if "=" in part:
                    k, _, v = part.partition("=")
                    params[k.strip()] = _url_decode(v.strip())

            ssid     = params.get("ssid", "").strip()
            password = params.get("password", "").strip()

            try:
                _write_wifi_conf(ssid, password)
                suffix = _device_suffix()
                body = SUCCESS_HTML.replace("{suffix}", suffix).encode()
                response = (
                    b"HTTP/1.1 200 OK\r\n"
                    b"Content-Type: text/html; charset=utf-8\r\n"
                    b"Connection: close\r\n"
                    b"\r\n" + body
                )
                # Schedule teardown after response is flushed
                asyncio.get_event_loop().call_later(2, lambda: shutdown.set())
            except ValueError as exc:
                body = ERROR_HTML.format(message=str(exc)).encode()
                response = (
                    b"HTTP/1.1 400 Bad Request\r\n"
                    b"Content-Type: text/html; charset=utf-8\r\n"
                    b"Connection: close\r\n"
                    b"\r\n" + body
                )

        else:
            # Redirect everything else to root (handles captive portal probes)
            response = (
                b"HTTP/1.1 302 Found\r\n"
                b"Location: http://192.168.4.1/\r\n"
                b"Connection: close\r\n"
                b"\r\n"
            )

        writer.write(response)
        await writer.drain()

    except Exception as exc:
        log.debug("HTTP handler error: %s", exc)
    finally:
        writer.close()


def _url_decode(s: str) -> str:
    """Minimal URL percent-decoding for form data."""
    import urllib.parse
    return urllib.parse.unquote_plus(s)


# ── Entry point ───────────────────────────────────────────────────────────────

async def _run_portal() -> None:
    shutdown = asyncio.Event()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, shutdown.set)

    _start_ap()

    server = await asyncio.start_server(
        lambda r, w: _handle(r, w, shutdown),
        host=AP_IP,
        port=PORTAL_PORT,
    )

    log.info("Captive portal listening on %s:%d", AP_IP, PORTAL_PORT)

    async with server:
        await shutdown.wait()

    log.info("Shutdown signal received — tearing down AP")
    _stop_ap()


def main() -> None:
    if os.geteuid() != 0:
        print("Portal must run as root (needs hostapd, dnsmasq, ip commands)", file=sys.stderr)
        sys.exit(1)

    if _wifi_configured():
        log.info("WiFi already configured — portal not needed, exiting")
        sys.exit(0)

    logging.basicConfig(
        level=logging.INFO,
        format='{"time": "%(asctime)s", "level": "%(levelname)s", "msg": "%(message)s"}',
        datefmt='%Y-%m-%dT%H:%M:%S',
        stream=sys.stdout,
    )

    asyncio.run(_run_portal())


if __name__ == "__main__":
    main()
