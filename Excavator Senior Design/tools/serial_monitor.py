#!/usr/bin/env python3
"""Read and print sensor lines from the Arduino's serial output.

Usage:
    python serial_monitor.py COM3
    python serial_monitor.py /dev/ttyACM0 --baud 115200
"""

import argparse
import datetime
import logging
import sys

import serial

logger = logging.getLogger("serial_monitor")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", help="Serial port name (e.g. COM3, /dev/ttyACM0)")
    parser.add_argument("--baud", type=int, default=115200, help="Baud rate (default: 115200)")
    parser.add_argument(
        "--log",
        default=None,
        help="Path to also write output to (default: serial_log_<timestamp>.txt)",
    )
    args = parser.parse_args()

    # Auto-name the log file with a timestamp so repeated runs don't overwrite each other.
    log_path = args.log or datetime.datetime.now().strftime("serial_log_%Y%m%d_%H%M%S.txt")

    # Set up a logger that timestamps every message and sends it to both the
    # console and a file, instead of manually printing/writing twice.
    formatter = logging.Formatter("[%(asctime)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    file_handler = logging.FileHandler(log_path)
    file_handler.setFormatter(formatter)
    logger.setLevel(logging.INFO)
    logger.addHandler(console_handler)
    logger.addHandler(file_handler)

    try:
        # Opens the port; "with" makes sure it gets closed automatically on exit.
        with serial.Serial(args.port, args.baud, timeout=1) as ser:
            logger.info(f"Listening on {args.port} @ {args.baud} baud (Ctrl+C to stop)")
            logger.info(f"Logging to {log_path}")
            # Loop forever, reading one line at a time as the Arduino sends it.
            while True:
                # readline() gives raw bytes, so decode to text and strip the trailing newline.
                line = ser.readline().decode("utf-8", errors="replace").rstrip()
                if line:  # timeout with no data comes back as an empty string; skip logging that
                    logger.info(line)
    except serial.SerialException as e:
        # Happens if the port name is wrong or already in use by another program.
        logger.error(f"Error opening {args.port}: {e}")
        sys.exit(1)
    except KeyboardInterrupt:
        # Lets Ctrl+C exit cleanly instead of printing a traceback.
        logger.info("Stopped.")


if __name__ == "__main__":
    main()
