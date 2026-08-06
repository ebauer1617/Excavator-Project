/**
 * Shared between the Node bridge and the browser client.
 * Compiled twice (tsconfig.server.json / tsconfig.client.json) — keep it
 * dependency-free and free of any Node or DOM globals.
 */
import {
  JOINT_LIMITS,
  LINK_LENGTHS,
  ENCODER_BITS,
  ENCODER1_ZERO_OFFSET_DEG,
  ENCODER2_ZERO_OFFSET_DEG,
  ENCODER1_DIRECTION,
  ENCODER2_DIRECTION,
  TOF_DISTANCE_MIN_MM,
  TOF_DISTANCE_MAX_MM,
} from './constants.js';

export type JointName = 'boom' | 'stick' | 'bucket';

/** One decoded telemetry frame. Angles are degrees, each relative to its parent link. */
export interface ArmFrame {
  /** Elapsed ms since the frame decoder was created, synthesized on the host — the sensor-debug firmware doesn't emit its own timestamp. */
  t: number;
  boom: number;
  stick: number;
  bucket: number;
}

/** What the bridge pushes to browsers. */
export interface ArmState extends ArmFrame {
  /** Host wall-clock ms at which the frame was decoded. */
  rxAt: number;
  /** Monotonic counter of accepted frames since the bridge started. */
  seq: number;
  /** Frames/second measured on the serial side. */
  hz: number;
  /** True when the bridge is synthesising data instead of reading a port. */
  sim: boolean;
}

// -------------------------------------------------------------- unit convert

/** Wraps a degree value into (-180, 180]. */
function wrapDeg(deg: number): number {
  let d = deg % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

/**
 * Converts a 12-bit AS5600 raw angle (0..4095) to a joint-relative degree,
 * using that joint's rotational sense (direction, ±1 — some encoders are
 * mounted so raw_angle increases as the joint closes rather than opens) and
 * mechanical-zero offset.
 */
function encoderToDeg(rawAngle: number, zeroOffsetDeg: number, direction: 1 | -1): number {
  const countsPerRev = 1 << ENCODER_BITS;
  return wrapDeg(direction * (rawAngle / countsPerRev) * 360 - zeroOffsetDeg);
}

/** Inverse of encoderToDeg — a joint-relative degree back to a 12-bit raw_angle count. Used by the simulator. */
function degToEncoderRaw(deg: number, zeroOffsetDeg: number, direction: 1 | -1): number {
  const countsPerRev = 1 << ENCODER_BITS;
  const rawDeg = direction * (deg + zeroOffsetDeg);
  const wrapped = ((rawDeg % 360) + 360) % 360;
  return Math.round((wrapped / 360) * countsPerRev) % countsPerRev;
}

/** Converts the ToF distance to a boom angle by linear interpolation between the calibrated extension bounds. */
function tofToBoomDeg(distanceMm: number): number {
  const frac = Math.min(1, Math.max(0, (distanceMm - TOF_DISTANCE_MIN_MM) / (TOF_DISTANCE_MAX_MM - TOF_DISTANCE_MIN_MM)));
  const [lo, hi] = JOINT_LIMITS.boom;
  return lo + (hi - lo) * frac;
}

/** Inverse of tofToBoomDeg — a boom angle back to a ToF distance reading, mm. Used by the simulator. */
function boomDegToTof(deg: number): number {
  const [lo, hi] = JOINT_LIMITS.boom;
  const frac = (deg - lo) / (hi - lo);
  return TOF_DISTANCE_MIN_MM + (TOF_DISTANCE_MAX_MM - TOF_DISTANCE_MIN_MM) * frac;
}

// ---------------------------------------------------------------- wire lines

const ENCODER_LINE = /^Encoder([12]):\s+magnet=(YES|NO)\s+raw_angle=(\d+)\s+angle=(\d+)\s+agc=(\d+)\s+magnitude=(\d+)\s*$/;
const TOF_LINE = /^ToF:\s+distance_mm=(\d+)\s+status=(\d+)\s*$/;

export interface DecodeResult {
  /** A completed frame — null on every line that doesn't finish one. Angles are passed through as decoded, uncalibrated readings included, so live data stays visible while ENCODER1_ZERO_OFFSET_DEG / ENCODER2_ZERO_OFFSET_DEG are still being tuned. */
  frame: ArmFrame | null;
  /** True if this line looked like a sensor line but failed to parse. False for banner/scan lines, blank separators, and expected "NOT FOUND" lines — those are normal, not corruption. */
  malformed: boolean;
}

/**
 * Stateful decoder for the real sensor-debug protocol. One cycle is three
 * lines — Encoder1, Encoder2, ToF — interleaved with startup banner lines
 * and blank separators, e.g.:
 *
 *   Encoder1: magnet=YES raw_angle=1106 angle=1106 agc=253 magnitude=2053
 *   Encoder2: NOT FOUND (check mux channel / wiring)
 *   ToF: distance_mm=101 status=2
 *
 * Encoder lines just update internal state; a frame is only emitted once a
 * ToF line arrives and both encoders have reported at least one valid
 * reading — an encoder that never reports (unwired, "NOT FOUND") blocks
 * frames instead of shipping a bogus angle for that joint.
 */
export function createFrameDecoder() {
  const startedAt = Date.now();
  let encoder1Deg: number | null = null;
  let encoder2Deg: number | null = null;

  return {
    line(raw: string): DecodeResult {
      const line = raw.trim();

      if (line.startsWith('Encoder1:') || line.startsWith('Encoder2:')) {
        const m = line.match(ENCODER_LINE);
        if (!m) return { frame: null, malformed: false }; // e.g. "NOT FOUND (check mux channel / wiring)"
        const [, which, magnet, rawAngleStr] = m;
        if (magnet !== 'YES') return { frame: null, malformed: false }; // no magnet detected, reading isn't trustworthy
        const deg =
          which === '1'
            ? encoderToDeg(Number(rawAngleStr), ENCODER1_ZERO_OFFSET_DEG, ENCODER1_DIRECTION)
            : encoderToDeg(Number(rawAngleStr), ENCODER2_ZERO_OFFSET_DEG, ENCODER2_DIRECTION);
        if (which === '1') encoder1Deg = deg;
        else encoder2Deg = deg;
        return { frame: null, malformed: false };
      }

      if (!line.startsWith('ToF:')) return { frame: null, malformed: false }; // banner/scan line or blank separator

      const tof = line.match(TOF_LINE);
      if (!tof) return { frame: null, malformed: true };
      if (encoder1Deg === null || encoder2Deg === null) return { frame: null, malformed: false }; // waiting on a first reading per encoder

      const frame: ArmFrame = {
        t: Date.now() - startedAt,
        boom: tofToBoomDeg(Number(tof[1])),
        stick: encoder1Deg,
        bucket: encoder2Deg,
      };
      return { frame, malformed: false };
    },
  };
}

/**
 * Inverse of createFrameDecoder's parsing: renders one Encoder1/Encoder2/ToF
 * cycle (plus the blank separator line), matching the real firmware's debug
 * output, so the simulator exercises the exact wire format.
 */
export function formatSensorLines(a: Record<JointName, number>): string[] {
  const e1 = degToEncoderRaw(a.stick, ENCODER1_ZERO_OFFSET_DEG, ENCODER1_DIRECTION);
  const e2 = degToEncoderRaw(a.bucket, ENCODER2_ZERO_OFFSET_DEG, ENCODER2_DIRECTION);
  const distanceMm = Math.round(boomDegToTof(a.boom));
  return [
    `Encoder1: magnet=YES raw_angle=${e1} angle=${e1} agc=253 magnitude=2053`,
    `Encoder2: magnet=YES raw_angle=${e2} angle=${e2} agc=253 magnitude=2053`,
    `ToF: distance_mm=${distanceMm} status=2`,
    '',
  ];
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Forward kinematics for the planar boom/stick/bucket chain.
 * Origin is the boom foot pin; +x forward, +y up; metres.
 */
export function forwardKinematics(a: Pick<ArmFrame, JointName>): {
  boomTip: Point;
  stickTip: Point;
  tip: Point;
} {
  const rad = Math.PI / 180;
  const t1 = a.boom * rad;
  const t2 = t1 + a.stick * rad;
  const t3 = t2 + a.bucket * rad;

  const boomTip = { x: LINK_LENGTHS.boom * Math.cos(t1), y: LINK_LENGTHS.boom * Math.sin(t1) };
  const stickTip = {
    x: boomTip.x + LINK_LENGTHS.stick * Math.cos(t2),
    y: boomTip.y + LINK_LENGTHS.stick * Math.sin(t2),
  };
  const tip = {
    x: stickTip.x + LINK_LENGTHS.bucket * Math.cos(t3),
    y: stickTip.y + LINK_LENGTHS.bucket * Math.sin(t3),
  };
  return { boomTip, stickTip, tip };
}
