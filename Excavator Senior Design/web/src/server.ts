import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { WebSocketServer, WebSocket } from 'ws';
import { createFrameDecoder, type ArmState } from './protocol.js';
import { startSimulator } from './sim.js';
import {
  DEFAULT_SERIAL_PATH_WIN32,
  DEFAULT_SERIAL_PATH_POSIX,
  DEFAULT_BAUD_RATE,
  DEFAULT_HTTP_PORT,
  DEFAULT_BROADCAST_HZ,
  SERIAL_RECONNECT_DELAY_MS,
  STATS_LOG_INTERVAL_MS,
  HZ_MEASUREMENT_INTERVAL_MS,
  SIM_DEFAULT_HZ,
  SHUTDOWN_FORCE_EXIT_MS,
} from './constants.js';

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PORT_PATH = opt('port', process.platform === 'win32' ? DEFAULT_SERIAL_PATH_WIN32 : DEFAULT_SERIAL_PATH_POSIX);
const BAUD = Number(opt('baud', String(DEFAULT_BAUD_RATE)));
const HTTP_PORT = Number(opt('http', String(DEFAULT_HTTP_PORT)));
const SIM = flag('sim');
const BROADCAST_HZ = Number(opt('render-hz', String(DEFAULT_BROADCAST_HZ)));

if (flag('list')) {
  const ports = await SerialPort.list();
  if (ports.length === 0) console.log('No serial ports found.');
  for (const p of ports) {
    console.log(`${p.path}\t${p.manufacturer ?? '—'}\t${p.vendorId ?? ''}:${p.productId ?? ''}`);
  }
  process.exit(0);
}

// ------------------------------------------------------------- shared state

/**
 * The single mutable frame every consumer reads from. Serial writes into it at
 * whatever rate the controller runs; the broadcast timer reads it at a fixed
 * rate. Nothing downstream ever sees a partial update, so no queue is needed —
 * a dropped intermediate frame is not worth buffering for a live view.
 */
let latest: ArmState | null = null;
let seq = 0;
let framesThisSecond = 0;
let parseErrors = 0;
let measuredHz = 0;
let linkUp = false;

setInterval(() => {
  measuredHz = framesThisSecond;
  framesThisSecond = 0;
}, HZ_MEASUREMENT_INTERVAL_MS).unref();

const decoder = createFrameDecoder();

function ingest(line: string): void {
  const { frame, malformed } = decoder.line(line);
  if (malformed) parseErrors++;
  if (!frame) return;
  framesThisSecond++;
  latest = { ...frame, rxAt: Date.now(), seq: ++seq, hz: measuredHz, sim: SIM };
}

// ------------------------------------------------------------ serial source

let port: SerialPort | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

function openSerial(): void {
  reconnectTimer = null;
  port = new SerialPort({ path: PORT_PATH, baudRate: BAUD, autoOpen: false });

  // ReadlineParser buffers across chunk boundaries, which is the whole reason
  // not to parse raw 'data' events — a frame can and will be split mid-number.
  const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
  parser.on('data', ingest);

  port.on('open', () => {
    linkUp = true;
    console.log(`[serial] open ${PORT_PATH} @ ${BAUD}`);
  });
  port.on('error', (err) => console.error(`[serial] ${err.message}`));
  port.on('close', () => {
    linkUp = false;
    console.warn('[serial] closed — retrying in 1s');
    scheduleReconnect();
  });

  port.open((err) => {
    if (err) {
      console.error(`[serial] ${err.message} — retrying in 1s`);
      scheduleReconnect();
    }
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(openSerial, SERIAL_RECONNECT_DELAY_MS);
}

if (SIM) {
  linkUp = true;
  startSimulator(ingest, SIM_DEFAULT_HZ);
  console.log(`[sim] synthesising frames at ${SIM_DEFAULT_HZ} Hz — no serial port opened`);
} else {
  openSerial();
}

// -------------------------------------------------------- http + websocket

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  const rel = url === '/' ? 'index.html' : decodeURIComponent(url).replace(/^\/+/, '');
  const file = path.join(publicDir, rel);

  if (!file.startsWith(publicDir)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, body) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  });
});

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  console.log(`[ws] client connected (${wss.clients.size} total)`);
  ws.on('error', () => ws.terminate());
});

/**
 * Fan out on a fixed timer rather than on every serial frame. A controller
 * streaming at 200 Hz would otherwise push 200 sockets writes and 200 React
 * renders per second for a display that can only show 60.
 */
setInterval(() => {
  if (!latest) return;
  const payload = JSON.stringify({ ...latest, hz: measuredHz, linkUp });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}, Math.round(1000 / BROADCAST_HZ));

setInterval(() => {
  const age = latest ? Date.now() - latest.rxAt : Infinity;
  console.log(
    `[stat] ${measuredHz} fps · seq ${seq} · errors ${parseErrors} · age ${
      Number.isFinite(age) ? `${age}ms` : 'no data'
    } · clients ${wss.clients.size}`,
  );
}, STATS_LOG_INTERVAL_MS).unref();

server.listen(HTTP_PORT, () => {
  console.log(`[http] http://localhost:${HTTP_PORT}`);
});

let shuttingDown = false;

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nShutting down');

  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (port?.isOpen) port.close();

  // wss.close() alone only stops new connections — clients already connected
  // (e.g. a browser tab left open) keep their sockets alive, which would
  // otherwise block server.close()'s callback forever. Terminate them first.
  for (const client of wss.clients) client.terminate();
  wss.close();
  server.closeAllConnections();

  // Fallback in case some other open handle we didn't account for keeps the
  // event loop alive — Ctrl+C should never hang no matter what.
  const forceExit = setTimeout(() => process.exit(1), SHUTDOWN_FORCE_EXIT_MS);

  server.close(() => {
    clearTimeout(forceExit);
    process.exit(0);
  });
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, shutdown);
}
