"""Reads CSV sensor readings from the Arduino over serial and writes them to
an Excel workbook once 1000 readings have been collected.

The sketch (src/main.cpp) prints one line per loop iteration prefixed with
"DATA," followed by: millis,raw_angle,degrees,scaled_angle,magnet_status,distance_mm

Usage:
    python tools/log_to_excel.py --port COM3
    python tools/log_to_excel.py --port COM3 --count 1000 --out-dir logs

Every time --count readings have been buffered, a timestamped .xlsx file is
written to --out-dir and the buffer resets, so the script can be left running
to produce one workbook per batch indefinitely (Ctrl+C to stop).
"""

import argparse
import sys
from datetime import datetime
from pathlib import Path

import serial
from openpyxl import Workbook

HEADER = ["millis", "raw_angle", "degrees", "scaled_angle", "magnet_status", "distance_mm"]
DATA_TAG = "DATA"


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", required=True, help="Serial port, e.g. COM3")
    parser.add_argument("--baud", type=int, default=9600, help="Must match monitor_speed in platformio.ini")
    parser.add_argument("--count", type=int, default=1000, help="Readings per Excel file")
    parser.add_argument("--out-dir", default="logs", help="Directory to write .xlsx files into")
    return parser.parse_args()


def write_workbook(rows, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = out_dir / f"sensor_readings_{timestamp}.xlsx"

    wb = Workbook()
    ws = wb.active
    ws.title = "Readings"
    ws.append(HEADER)
    for row in rows:
        ws.append(row)
    wb.save(path)
    return path


def main():
    args = parse_args()
    out_dir = Path(args.out_dir)

    try:
        ser = serial.Serial(args.port, args.baud, timeout=5)
    except serial.SerialException as exc:
        print(f"Could not open {args.port}: {exc}", file=sys.stderr)
        return 1

    print(f"Listening on {args.port} @ {args.baud} baud. Writing a workbook every {args.count} readings.")
    print("Press Ctrl+C to stop.")

    rows = []
    try:
        while True:
            line = ser.readline().decode("utf-8", errors="ignore").strip()
            if not line:
                continue

            fields = line.split(",")
            if fields[0] != DATA_TAG or len(fields) != len(HEADER) + 1:
                continue  # ignore banner/status lines that aren't data rows

            rows.append(fields[1:])
            print(f"  [{len(rows)}/{args.count}] {line}")

            if len(rows) >= args.count:
                path = write_workbook(rows, out_dir)
                print(f"Wrote {len(rows)} readings to {path}")
                rows = []
    except KeyboardInterrupt:
        print("\nStopped.")
        if rows:
            path = write_workbook(rows, out_dir)
            print(f"Wrote partial batch of {len(rows)} readings to {path}")
    finally:
        ser.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
