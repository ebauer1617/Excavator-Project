/**
 * Every tunable constant in one place: linkage geometry, mechanical limits,
 * serial/network defaults, client render timing, and simulator tuning.
 * Dependency-free (no Node or DOM globals) so it compiles under both
 * tsconfig.client.json and tsconfig.server.json, same as protocol.ts.
 */
import type { JointName } from './protocol.js';

// ------------------------------------------------------------- kinematics

/** Link lengths, metres. Boom foot pin -> boom tip -> stick tip -> bucket tip. */
export const LINK_LENGTHS = {
  boom: 5.7, // boom foot pin to boom/stick pin
  stick: 2.9, // boom/stick pin to stick/bucket pin
  bucket: 1.5, // stick/bucket pin to bucket tip
} as const;

/**
 * Mechanical stops, degrees — sizes the client's rendered viewport to the
 * arm's actual reachable envelope (frames are no longer rejected for
 * falling outside these; see createFrameDecoder in protocol.ts).
 */
export const JOINT_LIMITS = {
  boom: [-20, 70], // relative to horizontal; boom foot pin is the coordinate origin
  // Bench-calibrated 2026-08: raw_angle=3358 (fully extended up) -> -20°
  // (near-collinear with the boom, renders straight), raw_angle=405 (fully
  // in) -> -120° (folded, renders curled). See ENCODER1_ZERO_OFFSET_DEG /
  // ENCODER1_DIRECTION.
  stick: [-120, -20], // relative to the boom
  // Bench-calibrated 2026-08: raw_angle=2223 (fully extended, teeth
  // colinear with the stick) -> 0°, raw_angle=1085 (fully curled in,
  // teeth facing the machine) -> -100°.
  bucket: [-100, 0], // relative to the stick
} as const satisfies Record<JointName, readonly [number, number]>;

/** Canonical joint order, used to iterate telemetry and rendering state. */
export const JOINTS: readonly JointName[] = ['boom', 'stick', 'bucket'];

// -------------------------------------------------------- sensor calibration

/** AS5600 magnetic encoder resolution: 0..4095 counts per revolution. Fixed by the sensor's datasheet, not a calibration value. */
export const ENCODER_BITS = 12;

/**
 * Encoder1 (stick) rotational sense: +1 if raw_angle increases as the joint
 * opens/extends, -1 if it increases as the joint closes/curls in. This
 * encoder's mounting runs opposite to the bucket's — bench-calibration
 * (2026-08) only fit the two known stops (raw 3358 -> extended, raw 405 ->
 * fully in) to within ~0.3° once this was flipped to -1; +1 was off by
 * ~100° in the wrong direction. Re-derive if the sensor is remounted.
 */
export const ENCODER1_DIRECTION = -1;

/** Encoder2 (bucket) rotational sense — see ENCODER1_DIRECTION. This one matches the "raw increases as the joint opens" default. */
export const ENCODER2_DIRECTION = 1;

/**
 * Encoder1 (stick) mechanical-zero calibration, degrees — subtracted after
 * ENCODER1_DIRECTION is applied, so the joint reads 0° at its true reference
 * pose. Bench-calibrated 2026-08 by averaging the offset implied by both
 * stops: raw_angle=3358 (extended) should read -20° and raw_angle=405
 * (fully in) should read -120° (see JOINT_LIMITS.stick); each lands within
 * ~0.25° of that. Recalibrate the same way if the sensor is remounted: read
 * raw_angle at a known stop, convert to degrees (raw_angle * 360 / 4096),
 * apply ENCODER1_DIRECTION, and solve for the offset that matches that
 * stop's JOINT_LIMITS value.
 */
export const ENCODER1_ZERO_OFFSET_DEG = 84.6;

/**
 * Encoder2 (bucket) mechanical-zero calibration, degrees — same derivation
 * as ENCODER1_ZERO_OFFSET_DEG. Bench-calibrated 2026-08: raw_angle=2223
 * (extended/colinear) -> 0°, raw_angle=1085 (fully in) -> -100° (see
 * JOINT_LIMITS.bucket); each lands within ~0.01° of that.
 */
export const ENCODER2_ZERO_OFFSET_DEG = 195.4;

/**
 * ToF reading at the boom's lowest (fully down) position, mm.
 * Bench-calibrated 2026-08; recalibrate by lowering the boom to its
 * mechanical stop and recording the ToF: distance_mm value from the serial
 * log at that position.
 */
export const TOF_DISTANCE_MIN_MM = 65;

/**
 * ToF reading at the boom's highest (fully extended/up) position, mm.
 * Bench-calibrated 2026-08; recalibrate by raising the boom to its
 * mechanical stop and recording the ToF: distance_mm value from the serial
 * log at that position.
 */
export const TOF_DISTANCE_MAX_MM = 105;

/** Number of recent ToF distance_mm readings averaged together before converting to a boom angle — the raw reading jitters a few mm frame to frame, this smooths it out. */
export const TOF_SMOOTHING_WINDOW = 10;

// ---------------------------------------------------------- serial / network

/** Fallback serial device path on Windows when --port isn't given. */
export const DEFAULT_SERIAL_PATH_WIN32 = 'COM5';
/** Fallback serial device path on Linux/macOS when --port isn't given. */
export const DEFAULT_SERIAL_PATH_POSIX = '/dev/ttyUSB0';
/** Serial baud rate — must match the controller firmware's UART config. */
export const DEFAULT_BAUD_RATE = 115200;
/** Port the HTTP server (and the WebSocket server riding on it) listens on. */
export const DEFAULT_HTTP_PORT = 8080;
/** Rate the bridge fans telemetry out to browsers, independent of serial rate. */
export const DEFAULT_BROADCAST_HZ = 60;
/** Delay before retrying a closed or failed serial connection, ms. */
export const SERIAL_RECONNECT_DELAY_MS = 1000;
/** How often the bridge logs a one-line health summary to the console, ms. */
export const STATS_LOG_INTERVAL_MS = 5000;
/** Window over which incoming serial frame rate is measured, ms. */
export const HZ_MEASUREMENT_INTERVAL_MS = 1000;
/** How long graceful shutdown (Ctrl+C) waits for sockets to close before forcing exit. */
export const SHUTDOWN_FORCE_EXIT_MS = 1000;

// ------------------------------------------------------------- client render

/** Smoothing time constant, ms. ~55 ms hides 20 Hz stair-stepping without visible lag. */
export const TAU_MS = 55;
/** A link older than this is considered dead: rendered dim, HUD flips to "stale". */
export const STALE_MS = 400;
/** How long the bucket-tip trace persists before fading out, ms. */
export const TRACE_MS = 2600;
/** Delay before the browser retries a dropped WebSocket connection, ms. */
export const CLIENT_RECONNECT_DELAY_MS = 1000;
/** Pose shown before the first telemetry frame arrives, degrees. */
export const INITIAL_POSE: Record<JointName, number> = { boom: 25, stick: -95, bucket: -55 };
/** Angle-grid resolution used to sample the reachable-workspace bounding box; higher = tighter fit, slower startup. */
export const WORKSPACE_SAMPLE_STEPS = 20;
/** Fractional padding around the reachable envelope so the arm never touches the canvas edge. */
export const VIEW_PAD = 1.08;
/** Screen-space margins (px) the reachable envelope is fit inside. */
export const VIEW_MARGIN = {
  left: 110, // room for the undercarriage/house sprite
  right: 140, // room for the "max reach" label
  top: 40,
  bottom: 40,
} as const;

/** Secondary text and labels. */
export const COLOR_MUTED = '#5C6874';
/** Boom and stick fill. */
export const COLOR_STEEL = '#8A97A4';
/** Bucket fill and live pin ring — brand accent. */
export const COLOR_AMBER = '#F2A93B';
/** Bucket fill when telemetry is stale. */
export const COLOR_AMBER_DIM = '#7A5A24';

// -------------------------------------------------------------- simulator

/** Frame rate the built-in simulator synthesises at when none is given. */
export const SIM_DEFAULT_HZ = 100;
/** Full sweep period per joint, ms — how long one up-down cycle takes. */
export const SIM_SWEEP_PERIOD_MS: Record<JointName, number> = {
  boom: 7000,
  stick: 4300,
  bucket: 2600,
};
/** Phase offset per joint, radians — keeps the joints from moving in lockstep. */
export const SIM_SWEEP_PHASE_RAD: Record<JointName, number> = {
  boom: 0,
  stick: 1.1,
  bucket: 2.4,
};
/** Sweep amplitude as a fraction of each joint's full range — kept under 1 so noise never grazes the limits. */
export const SIM_SWEEP_AMPLITUDE_FACTOR = 0.82;
/** Peak-to-peak random jitter added to each simulated angle, degrees. */
export const SIM_NOISE_AMPLITUDE_DEG = 0.15;
