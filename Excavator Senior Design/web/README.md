# Excavator arm telemetry

Reads joint angles off a serial port in Node, fans them out over WebSocket, and draws
a three-joint boom/stick/bucket arm on a canvas at 60 fps.

```
controller ──UART──> serialport ──> ReadlineParser ──> parseArmLine ──┐
                                                                      │  latest (mutable)
browser canvas <── rAF + smoothing <── WebSocket <── 60 Hz timer <─────┘
```

## Dependency Setup

* install nodejs
* install pnpm # can also use npm instead and adjust the commands below accordingly

## Quick start

Run the server (sim):

```bash
pnpm install
pnpm run dev:sim
# http://localhost:8080
```

With a real device:

```bash
pnpm run ports                     # list attached serial ports
pnpm run dev -- --port /dev/ttyUSB0 --baud 115200
```

Flags: `--port`, `--baud`, `--http` (default 8080), `--render-hz` (default 60), `--sim`, `--list`.

Then open a browser view:

http://localhost:8080/

Shutting down:

`Ctrl + c`

Make sure to close the browser session when shutting down the server.

## Wire format

One ASCII line per sample, NMEA-style so a bad byte can be detected rather than
rendered:

```
$ARM,<uptime_ms>,<boom_deg>,<stick_deg>,<bucket_deg>*<xor_hex>
$ARM,182340,35.20,-104.80,-60.10*42
```

Angles are **relative to the parent link**, which is what a joint encoder or a
draw-wire sensor on the cylinder gives you directly. The checksum suffix is
optional so you can hand-type frames into a terminal while bringing the board up.

`parseArmLine` returns `null` for anything malformed — boot banners, half-lines
after a reset, out-of-range values — so the bridge counts nulls as parse errors
instead of drawing garbage.

Link lengths are compile-time constants in `src/protocol.ts` and never travel
over the wire.

## Controller side

```cpp
void loop() {
  float boom = readBoom(), stick = readStick(), bucket = readBucket();
  char payload[64];
  snprintf(payload, sizeof payload, "ARM,%lu,%.2f,%.2f,%.2f",
           millis(), boom, stick, bucket);
  uint8_t ck = 0;
  for (char* p = payload; *p; p++) ck ^= *p;
  Serial.printf("$%s*%02X\n", payload, ck);
  delay(10);   // 100 Hz
}
```

## Why the two rates are decoupled

The serial callback only writes into a single mutable `latest` object. A separate
timer serialises and broadcasts that object at 60 Hz, and the browser writes
incoming angles into a plain object that only the `requestAnimationFrame` loop
reads.

Nothing queues. A 200 Hz controller with a 60 Hz display should drop
intermediate frames, not buffer them — a stale frame is worse than a skipped one
for a live view. This is also why the client keeps angles out of framework state:
pushing 200 messages/second through React state thrashes reconciliation for
frames the display can never show.

## Smoothing

`shown += (target - shown) * (1 - exp(-dt / TAU))` in `src/client/main.ts`.
`TAU_MS = 55` hides the stair-stepping of a 20 Hz stream without visible lag;
drop it toward 20 ms if your telemetry is already at 100 Hz and you want the
response crisper. The `exp(-dt/tau)` form is frame-rate independent, so it
behaves the same on a 60 Hz and a 144 Hz display.

If you add a swing joint that can wrap past ±180°, take the shortest angular
delta before smoothing: `Math.atan2(Math.sin(d), Math.cos(d))`.

## Testing without hardware

`--sim` is the easy path. To exercise the real serialport code path, make a
virtual pair and write frames into one end:

```bash
socat -d -d pty,raw,echo=0,link=/tmp/ttyFAKE pty,raw,echo=0,link=/tmp/ttyHOST
npm run dev -- --port /tmp/ttyHOST
# then write $ARM lines to /tmp/ttyFAKE
```

## Going faster

At sustained rates above ~500 Hz, ASCII parsing and `JSON.stringify` start to
show up in a profile. Swap `ReadlineParser` for
`@serialport/parser-delimiter` with a binary sync word and decode with a
`DataView`, and send the WebSocket payload as a 16-byte `ArrayBuffer` instead of
JSON. The rest of the architecture is unchanged.

## Layout

```
src/protocol.ts       types, line codec, forward kinematics (shared)
src/server.ts         serial read loop, reconnect, WS fan-out, static server
src/sim.ts            synthetic frame source
src/client/main.ts    WebSocket intake, smoothing, canvas render
public/index.html     instrument panel shell
```

`protocol.ts` is compiled by both tsconfigs, so the parser and the kinematics
used by the renderer are literally the same code the bridge validates against.
