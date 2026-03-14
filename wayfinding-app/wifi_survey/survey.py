"""
survey.py — WiFi Fingerprinting Phase 1 Survey Tool (Windows)
==============================================================
Walk to each grid cell in your building, enter its (row, col),
and this script records averaged RSSI from all visible WiFi networks.

Output: fingerprint_db.json  (one entry per cell)

Usage:
    python survey.py

Requirements:
    - Windows (uses `netsh wlan`)
    - Python 3.7+  (no extra packages)
    - WiFi must be enabled (not necessarily connected)
"""

import subprocess
import json
import os
import time
import re

# ── Config ────────────────────────────────────────────────────────────────────

DB_FILE       = "fingerprint_db.json"   # output file
NUM_READINGS  = 5                        # scans per cell (more = more accurate)
SCAN_DELAY    = 0.8                      # seconds between scans

# ── WiFi scanning ─────────────────────────────────────────────────────────────

def scan_wifi_windows():
    """
    Run `netsh wlan show networks mode=bssid` and return a dict of
    { ssid: rssi_dBm } for all visible networks.
    Signal% → dBm approximation: dBm = (pct / 2) - 100
    """
    try:
        result = subprocess.run(
            ["netsh", "wlan", "show", "networks", "mode=bssid"],
            capture_output=True, text=True, timeout=15
        )
    except subprocess.TimeoutExpired:
        print("  [warn] scan timed out, returning empty")
        return {}
    except FileNotFoundError:
        print("  [error] netsh not found — are you on Windows?")
        return {}

    networks = {}
    current_ssid = None

    for line in result.stdout.splitlines():
        line = line.strip()

        # Match: "SSID 1 : MyNetwork"
        ssid_match = re.match(r"SSID\s+\d+\s*:\s*(.+)", line)
        if ssid_match:
            current_ssid = ssid_match.group(1).strip()
            continue

        # Match: "Signal : 74%"
        signal_match = re.match(r"Signal\s*:\s*(\d+)%", line)
        if signal_match and current_ssid:
            pct  = int(signal_match.group(1))
            rssi = round((pct / 2) - 100, 1)   # convert to dBm
            # Keep strongest reading if SSID appears multiple times (multiple BSSIDs)
            if current_ssid not in networks or rssi > networks[current_ssid]:
                networks[current_ssid] = rssi

    return networks


def take_averaged_reading(num=NUM_READINGS, delay=SCAN_DELAY):
    """
    Take `num` scans and return a dict of { ssid: average_rssi }.
    RSSI is noisy, so averaging 5 readings cuts down variance significantly.
    """
    all_readings = []

    for i in range(num):
        print(f"    Scan {i+1}/{num}...", end=" ", flush=True)
        reading = scan_wifi_windows()
        all_readings.append(reading)
        print(f"{len(reading)} networks")
        if i < num - 1:
            time.sleep(delay)

    # Collect all SSIDs seen across any scan
    all_ssids = set()
    for r in all_readings:
        all_ssids.update(r.keys())

    # Average RSSI for each SSID (only over scans where it was visible)
    averaged = {}
    for ssid in sorted(all_ssids):
        values = [r[ssid] for r in all_readings if ssid in r]
        averaged[ssid] = round(sum(values) / len(values), 1)

    return averaged


# ── Main survey loop ──────────────────────────────────────────────────────────

def main():
    # Load existing DB so you can resume a partial survey
    db = {}
    if os.path.exists(DB_FILE):
        with open(DB_FILE) as f:
            db = json.load(f)
        print(f"Loaded {len(db)} existing fingerprints from {DB_FILE}")

    print("\n" + "=" * 50)
    print("  WiFi Fingerprinting Survey Tool  (Phase 1)")
    print("=" * 50)
    print("Walk to each OPEN (non-wall) grid cell.")
    print("Enter its row,col coordinates and press Enter.")
    print("Commands: 'list'=show recorded cells  'done'=quit\n")

    while True:
        cell_input = input("Cell (row,col) or command: ").strip().lower()

        if cell_input == "done":
            break

        if cell_input == "list":
            if not db:
                print("  No cells recorded yet.")
            else:
                print(f"  Recorded {len(db)} cells: " + ", ".join(sorted(db.keys())))
            continue

        if cell_input == "":
            continue

        # Parse row,col
        try:
            parts = cell_input.split(",")
            row, col = int(parts[0].strip()), int(parts[1].strip())
        except Exception:
            print("  Invalid format. Use: row,col  (e.g., 3,5)")
            continue

        cell_id = f"{row},{col}"
        if cell_id in db:
            overwrite = input(f"  Cell {cell_id} already recorded. Overwrite? (y/n): ").strip().lower()
            if overwrite != "y":
                continue

        print(f"\nRecording fingerprint for cell ({row}, {col})...")
        readings = take_averaged_reading()

        if not readings:
            print("  No networks found — check that WiFi is enabled.\n")
            continue

        db[cell_id] = readings

        # Save after every cell so you don't lose data if interrupted
        with open(DB_FILE, "w") as f:
            json.dump(db, f, indent=2)

        print(f"  Saved! {len(readings)} networks. Total cells in DB: {len(db)}\n")

    print(f"\nSurvey complete. {len(db)} cells saved to '{DB_FILE}'.")
    print("Copy this file into wayfinding-app/js/ for use in the navigation app.")


if __name__ == "__main__":
    main()
