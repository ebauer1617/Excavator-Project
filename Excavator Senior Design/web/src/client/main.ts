import { forwardKinematics, type ArmState, type JointName, type Point } from '../protocol.js';
import {
  JOINTS,
  JOINT_LIMITS,
  LINK_LENGTHS,
  TAU_MS,
  STALE_MS,
  TRACE_MS,
  CLIENT_RECONNECT_DELAY_MS,
  INITIAL_POSE,
  WORKSPACE_SAMPLE_STEPS,
  VIEW_PAD,
  VIEW_MARGIN,
  COLOR_MUTED,
  COLOR_STEEL,
  COLOR_AMBER,
  COLOR_AMBER_DIM,
} from '../constants.js';

/**
 * True reachable envelope of the linkage, sampled across the full joint-limit
 * grid. Used to place the origin so dig depth (below the pin) gets real
 * screen space instead of assuming the arm only ever swings upward.
 */
function computeWorkspaceBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
  const STEPS = WORKSPACE_SAMPLE_STEPS;
  const range = (lo: number, hi: number) =>
    Array.from({ length: STEPS + 1 }, (_, i) => lo + ((hi - lo) * i) / STEPS);

  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  for (const boom of range(...JOINT_LIMITS.boom)) {
    for (const stick of range(...JOINT_LIMITS.stick)) {
      for (const bucket of range(...JOINT_LIMITS.bucket)) {
        const { boomTip, stickTip, tip } = forwardKinematics({ boom, stick, bucket });
        for (const p of [boomTip, stickTip, tip]) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

const WORKSPACE = computeWorkspaceBounds();

// ------------------------------------------------------------------- state

const target: Record<JointName, number> = { ...INITIAL_POSE };
const shown: Record<JointName, number> = { ...target };

let lastRxAt = 0;
let lastState: ArmState | null = null;
let msgTimes: number[] = [];
const trace: Array<Point & { at: number }> = [];

// --------------------------------------------------------------- transport

const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;

function setStatus(kind: 'live' | 'stale' | 'down', text: string): void {
  statusDot.dataset.kind = kind;
  statusText.textContent = text;
}

function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener('message', (ev) => {
    const state = JSON.parse(ev.data as string) as ArmState;
    // Write straight into a mutable object. No framework state, no re-render —
    // the rAF loop is the only thing that reads this.
    for (const j of JOINTS) target[j] = state[j];
    lastState = state;
    lastRxAt = performance.now();
    msgTimes.push(lastRxAt);
  });

  ws.addEventListener('close', () => {
    setStatus('down', 'bridge offline — reconnecting');
    setTimeout(connect, CLIENT_RECONNECT_DELAY_MS);
  });
  ws.addEventListener('error', () => ws.close());
}

connect();

// ------------------------------------------------------------------ canvas

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let view = { w: 0, h: 0, px: 24, ox: 0, oy: 0 };

function resize(): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Fit the true reachable envelope — including how far the bucket can dig
  // below the pin — between fixed screen margins, padded a little so the
  // linkage never touches the edge at full extension.
  const rawSpanX = WORKSPACE.maxX - WORKSPACE.minX;
  const rawSpanY = WORKSPACE.maxY - WORKSPACE.minY;
  const padX = (rawSpanX * (VIEW_PAD - 1)) / 2;
  const padY = (rawSpanY * (VIEW_PAD - 1)) / 2;
  const originX = WORKSPACE.minX - padX;
  const originY = WORKSPACE.maxY + padY;

  const px = Math.min(
    (rect.width - VIEW_MARGIN.left - VIEW_MARGIN.right) / (rawSpanX * VIEW_PAD),
    (rect.height - VIEW_MARGIN.top - VIEW_MARGIN.bottom) / (rawSpanY * VIEW_PAD),
  );

  view = {
    w: rect.width,
    h: rect.height,
    px,
    ox: VIEW_MARGIN.left - originX * px,
    oy: VIEW_MARGIN.top + originY * px,
  };
}
new ResizeObserver(resize).observe(canvas);
resize();

/** A link drawn as a tapered box in metres, with pin bosses at both ends. */
function link(len: number, w0: number, w1: number, fill: string): void {
  ctx.beginPath();
  ctx.moveTo(0, -w0 / 2);
  ctx.lineTo(len, -w1 / 2);
  ctx.lineTo(len, w1 / 2);
  ctx.lineTo(0, w0 / 2);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  for (const [x, r] of [
    [0, w0 / 2],
    [len, w1 / 2],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, 0, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Excavator bucket: a flat scoop face, a big convex back, and a single
 * tooth tip — a side profile only ever shows one, even though a real
 * bucket has several across its width. Origin is the bucket pin (heel).
 */
function bucket(len: number, fill: string): void {
  const outsideHeelY = 0.16 * len; // back corner where the bucket pin sits
  const insideHeelY = -0.05 * len; // flat-face corner near the pin
  const tipX = 0.98 * len; // the tooth tip — the bucket's max reach
  const tipY = -0.03 * len;

  ctx.beginPath();
  ctx.moveTo(0, outsideHeelY);
  // Convex back, heel straight to the tooth tip.
  ctx.quadraticCurveTo(0.58 * len, 0.5 * len, tipX, tipY);
  // Flat scoop face, straight from the tooth back to the heel.
  ctx.lineTo(0, insideHeelY);
  ctx.closePath();

  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(0.02 * len, 0.015);
  ctx.strokeStyle = 'rgba(16,21,26,0.45)';
  ctx.stroke();
}

function pin(radius: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#10151A';
  ctx.fill();
  ctx.lineWidth = radius * 0.35;
  ctx.strokeStyle = COLOR_AMBER;
  ctx.stroke();
}

function render(now: number): void {
  const stale = now - lastRxAt > STALE_MS;
  ctx.clearRect(0, 0, view.w, view.h);

  const { px, ox, oy } = view;
  const reach = LINK_LENGTHS.boom + LINK_LENGTHS.stick + LINK_LENGTHS.bucket;

  // Ground line and maximum-reach envelope, in screen space.
  ctx.strokeStyle = '#232C35';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, oy + 26);
  ctx.lineTo(view.w, oy + 26);
  ctx.stroke();

  ctx.setLineDash([2, 6]);
  ctx.beginPath();
  ctx.arc(ox, oy, reach * px, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Undercarriage and house.
  ctx.fillStyle = '#1E262E';
  ctx.fillRect(ox - 58, oy + 6, 96, 20);
  ctx.fillRect(ox - 34, oy - 26, 66, 32);

  // Tip trace — oldest segments fade out.
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1];
    const b = trace[i];
    const alpha = 1 - (now - b.at) / TRACE_MS;
    if (alpha <= 0) continue;
    ctx.strokeStyle = `rgba(242,169,59,${(alpha * 0.55).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(ox + a.x * px, oy - a.y * px);
    ctx.lineTo(ox + b.x * px, oy - b.y * px);
    ctx.stroke();
  }

  // The arm itself. Nesting the transforms *is* the forward kinematics:
  // each rotate() is a joint, each translate() is a link.
  const rad = Math.PI / 180;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(px, -px);
  ctx.globalAlpha = stale ? 0.35 : 1;

  ctx.rotate(shown.boom * rad);
  link(LINK_LENGTHS.boom, 0.62, 0.4, COLOR_STEEL);
  pin(0.3);
  ctx.translate(LINK_LENGTHS.boom, 0);

  ctx.rotate(shown.stick * rad);
  link(LINK_LENGTHS.stick, 0.42, 0.28, COLOR_STEEL);
  pin(0.22);
  ctx.translate(LINK_LENGTHS.stick, 0);

  ctx.rotate(shown.bucket * rad);
  bucket(LINK_LENGTHS.bucket, stale ? COLOR_AMBER_DIM : COLOR_AMBER);
  pin(0.18);

  ctx.restore();
  ctx.globalAlpha = 1;

  // Labels live outside the flipped transform so text isn't mirrored.
  ctx.font = '500 11px "Barlow Semi Condensed", system-ui, sans-serif';
  ctx.fillStyle = COLOR_MUTED;
  ctx.fillText(`max reach ${reach.toFixed(1)} m`, ox + reach * px * 0.62, oy - reach * px * 0.82);
}

// ------------------------------------------------------------- frame loop

const out: Record<string, HTMLElement> = {};
for (const id of ['boom', 'stick', 'bucket', 'tipx', 'tipy', 'rate', 'uptime', 'seq']) {
  out[id] = document.getElementById(`v-${id}`)!;
}

let prev = performance.now();
let hudDue = 0;

function frame(now: number): void {
  const dt = Math.min(now - prev, 120);
  prev = now;

  // Exponential approach: frame-rate independent, and the only thing standing
  // between a 20 Hz telemetry stream and visible stair-stepping.
  const k = 1 - Math.exp(-dt / TAU_MS);
  for (const j of JOINTS) shown[j] += (target[j] - shown[j]) * k;

  const { tip } = forwardKinematics(shown);
  const last = trace[trace.length - 1];
  if (!last || Math.hypot(tip.x - last.x, tip.y - last.y) > 0.02) {
    trace.push({ ...tip, at: now });
  }
  while (trace.length && now - trace[0].at > TRACE_MS) trace.shift();

  render(now);

  if (now > hudDue) {
    hudDue = now + 100;
    msgTimes = msgTimes.filter((t) => now - t < 1000);
    const stale = now - lastRxAt > STALE_MS;

    for (const j of JOINTS) out[j].textContent = `${shown[j].toFixed(1)}°`;
    out.tipx.textContent = `${tip.x.toFixed(2)} m`;
    out.tipy.textContent = `${tip.y.toFixed(2)} m`;
    out.rate.textContent = `${msgTimes.length} Hz`;
    out.seq.textContent = lastState ? String(lastState.seq) : '—';
    out.uptime.textContent = lastState ? `${(lastState.t / 1000).toFixed(1)} s` : '—';

    if (!lastState) setStatus('down', 'waiting for first frame');
    else if (stale) setStatus('stale', 'signal lost');
    else setStatus('live', lastState.sim ? 'simulated source' : 'serial link up');
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
