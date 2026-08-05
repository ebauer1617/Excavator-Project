import { formatSensorLines } from './protocol.js';
import {
  JOINT_LIMITS,
  SIM_DEFAULT_HZ,
  SIM_SWEEP_PERIOD_MS,
  SIM_SWEEP_PHASE_RAD,
  SIM_SWEEP_AMPLITUDE_FACTOR,
  SIM_NOISE_AMPLITUDE_DEG,
} from './constants.js';

/**
 * Emits well-formed Encoder1/Encoder2/ToF line groups on an interval,
 * matching the real firmware's sensor-debug output, so the bridge and
 * client can be exercised with no controller attached. Each line is
 * emitted separately, same as a real ReadlineParser 'data' event. Motion
 * is a slow Lissajous sweep inside the mechanical stops, plus a little
 * noise, so smoothing and range-checking both get tested.
 */
export function startSimulator(emit: (line: string) => void, hz = SIM_DEFAULT_HZ): () => void {
  const t0 = Date.now();

  const sweep = (lo: number, hi: number, periodMs: number, phase: number, t: number) => {
    const mid = (lo + hi) / 2;
    const amp = ((hi - lo) / 2) * SIM_SWEEP_AMPLITUDE_FACTOR;
    return mid + amp * Math.sin((2 * Math.PI * t) / periodMs + phase);
  };

  const timer = setInterval(() => {
    const t = Date.now() - t0;
    const noise = () => (Math.random() - 0.5) * SIM_NOISE_AMPLITUDE_DEG;
    const boom = sweep(...JOINT_LIMITS.boom, SIM_SWEEP_PERIOD_MS.boom, SIM_SWEEP_PHASE_RAD.boom, t) + noise();
    const stick = sweep(...JOINT_LIMITS.stick, SIM_SWEEP_PERIOD_MS.stick, SIM_SWEEP_PHASE_RAD.stick, t) + noise();
    const bucket = sweep(...JOINT_LIMITS.bucket, SIM_SWEEP_PERIOD_MS.bucket, SIM_SWEEP_PHASE_RAD.bucket, t) + noise();
    for (const line of formatSensorLines({ boom, stick, bucket })) emit(line);
  }, Math.max(1, Math.round(1000 / hz)));

  return () => clearInterval(timer);
}
