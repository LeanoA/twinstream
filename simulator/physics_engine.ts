import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FullStatePayload, TelemetryLayout, TelemetryChannelMetadata } from '../schema/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface PhysicsEngineOptions {
  tickRateHz?: number;
  layoutPath?: string;
  jitterToleranceMs?: number;
}

export interface TickMetrics {
  tickCount: number;
  elapsedMs: number;
  meanIntervalMs: number;
  stdDevIntervalMs: number;
  maxJitterMs: number;
  cumulativeDriftMs: number;
}

export class PhysicsEngine {
  private tickRateHz: number;
  private periodNs: bigint;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  private startTime: bigint = 0n;
  private lastTickTime: bigint = 0n;
  private tickCount = 0;

  private intervals: number[] = [];
  private layout: TelemetryLayout;
  private channels: TelemetryChannelMetadata[];
  private channelMap: Map<string, TelemetryChannelMetadata>;

  // Pre-allocated signals buffer to eliminate V8 garbage collection allocations
  private signals: Record<string, number> = {};
  private listeners: Set<(payload: FullStatePayload) => void> = new Set();

  constructor(options: PhysicsEngineOptions = {}) {
    this.tickRateHz = options.tickRateHz ?? 100;
    this.periodNs = 1_000_000_000n / BigInt(this.tickRateHz);

    const layoutFile = options.layoutPath ?? path.resolve(__dirname, '../data/mock_telemetry_layout.json');
    if (!fs.existsSync(layoutFile)) {
      throw new Error(`Telemetry layout file not found at: ${layoutFile}`);
    }

    this.layout = JSON.parse(fs.readFileSync(layoutFile, 'utf-8'));
    this.channels = this.layout.channels;
    this.channelMap = new Map();

    for (const ch of this.channels) {
      this.channelMap.set(ch.channel_id, ch);
      this.signals[ch.channel_id] = 0.0;
    }
  }

  public onTick(callback: (payload: FullStatePayload) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  public isRunning(): boolean {
    return this.running;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.tickCount = 0;
    this.intervals = [];
    this.startTime = process.hrtime.bigint();
    this.lastTickTime = this.startTime;

    this.scheduleNextTick();
  }

  public stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNextTick(): void {
    if (!this.running) return;

    const step = () => {
      if (!this.running) return;

      const now = process.hrtime.bigint();
      const intervalMs = Number(now - this.lastTickTime) / 1_000_000;
      this.lastTickTime = now;

      // Skip the very first 0-delta initialization tick from interval statistics
      if (this.tickCount > 0) {
        this.intervals.push(intervalMs);
        if (this.intervals.length > 1000) {
          this.intervals.shift();
        }
      }

      this.evaluatePhysics(this.tickCount);
      this.tickCount++;

      const payload = this.getCurrentState();
      for (const listener of this.listeners) {
        try {
          listener(payload);
        } catch (err) {
          console.error('[PhysicsEngine] Listener error:', err);
        }
      }

      // Self-correcting monotonic delay calculation:
      // Target time = startTime + (tickCount * periodNs)
      const targetTime = this.startTime + BigInt(this.tickCount) * this.periodNs;
      const delayNs = targetTime - process.hrtime.bigint();
      const delayMs = Math.max(0, Number(delayNs) / 1_000_000);

      this.timer = setTimeout(step, delayMs);
    };

    // First tick fires immediately
    step();
  }

  /**
   * Computes forward kinematics and auxiliary sensor signals for all 1,000 channels.
   * Modifies the internal signal map in-place for zero-allocation performance.
   */
  public evaluatePhysics(tick: number): void {
    const t = (tick * Number(this.periodNs)) / 1_000_000_000; // time in seconds

    // 1. Joint Kinematics across 10 assemblies
    // Assembly 0: Base
    this.setKinematics('assembly_00_base', [0, 0, 0], [0, 0, 0, 1]);

    // Assembly 1: Turret (azimuth yaw around Y)
    const yaw1 = 0.5 * Math.sin(0.4 * Math.PI * t);
    this.setKinematics('assembly_01_turret', [0, 0.5, 0], this.fromAxisAngle([0, 1, 0], yaw1));

    // Assembly 2: Shoulder (pitch around X)
    const pitch2 = 0.35 * Math.sin(0.6 * Math.PI * t + 0.3);
    this.setKinematics('assembly_02_shoulder', [0, 1.2 + 0.05 * Math.cos(0.4 * Math.PI * t), 0], this.fromAxisAngle([1, 0, 0], pitch2));

    // Assembly 3: Elbow (pitch around X)
    const pitch3 = 0.4 * Math.cos(0.8 * Math.PI * t);
    this.setKinematics('assembly_03_elbow', [0, 2.0 + 0.1 * Math.sin(0.6 * Math.PI * t), 0.4 * Math.cos(pitch2)], this.fromAxisAngle([1, 0, 0], pitch3));

    // Assembly 4: Forearm (roll around Z)
    const roll4 = 0.3 * Math.sin(Math.PI * t);
    this.setKinematics('assembly_04_forearm', [0.1 * Math.sin(yaw1), 2.6, 0.8 + 0.15 * Math.sin(0.5 * Math.PI * t)], this.fromAxisAngle([0, 0, 1], roll4));

    // Assembly 5: Wrist Pitch (pitch around X)
    const pitch5 = 0.25 * Math.cos(1.2 * Math.PI * t);
    this.setKinematics('assembly_05_wrist_pitch', [0.15 * Math.sin(yaw1), 3.1, 1.1], this.fromAxisAngle([1, 0, 0], pitch5));

    // Assembly 6: Wrist Yaw (yaw around Y)
    const yaw6 = 0.2 * Math.sin(1.4 * Math.PI * t);
    this.setKinematics('assembly_06_wrist_yaw', [0.2 * Math.sin(yaw1), 3.4, 1.3], this.fromAxisAngle([0, 1, 0], yaw6));

    // Assembly 7: Wrist Roll (roll around Z)
    const roll7 = 0.4 * Math.sin(0.7 * Math.PI * t);
    this.setKinematics('assembly_07_wrist_roll', [0.2 * Math.sin(yaw1), 3.7, 1.5], this.fromAxisAngle([0, 0, 1], roll7));

    // Assembly 8: End Effector
    const toolPitch = 0.15 * Math.sin(1.5 * Math.PI * t);
    this.setKinematics('assembly_08_end_effector', [0.25 * Math.sin(yaw1), 4.0, 1.7 + 0.05 * Math.sin(2 * Math.PI * t)], this.fromAxisAngle([1, 0, 0], toolPitch));

    // Assembly 9: Sensor Pod
    const podYaw = 0.1 * Math.cos(Math.PI * t);
    this.setKinematics('assembly_09_sensor_pod', [0.25 * Math.sin(yaw1), 4.2, 1.8], this.fromAxisAngle([0, 1, 0], podYaw));

    // 2. Correlated Auxiliary Sensors for each assembly
    const armSpeed = Math.abs(Math.cos(0.4 * Math.PI * t)) + Math.abs(Math.cos(0.6 * Math.PI * t));

    for (const asm of this.layout.assemblies) {
      const aid = asm.assembly_id;
      const asmIndex = parseInt(aid.split('_')[1], 10);
      const phaseOffset = asmIndex * 0.4;

      // Temperatures (35 - 80 C)
      const baseTemp = 30.0 + asmIndex * 2.0;
      this.setSignal(`${aid}_temp_motor_winding_01`, baseTemp + 15.0 * (0.5 + 0.5 * Math.sin(0.05 * t + phaseOffset)) + 5.0 * armSpeed);
      this.setSignal(`${aid}_temp_motor_winding_02`, baseTemp + 14.5 * (0.5 + 0.5 * Math.sin(0.05 * t + phaseOffset)) + 4.8 * armSpeed);
      this.setSignal(`${aid}_temp_motor_winding_03`, baseTemp + 15.2 * (0.5 + 0.5 * Math.sin(0.05 * t + phaseOffset)) + 5.1 * armSpeed);
      this.setSignal(`${aid}_temp_motor_winding_04`, baseTemp + 13.8 * (0.5 + 0.5 * Math.sin(0.05 * t + phaseOffset)) + 4.5 * armSpeed);

      this.setSignal(`${aid}_temp_bearing_01`, baseTemp - 5.0 + 8.0 * (0.5 + 0.5 * Math.cos(0.04 * t + phaseOffset)));
      this.setSignal(`${aid}_temp_bearing_02`, baseTemp - 5.2 + 8.1 * (0.5 + 0.5 * Math.cos(0.04 * t + phaseOffset)));
      this.setSignal(`${aid}_temp_bearing_03`, baseTemp - 4.8 + 7.9 * (0.5 + 0.5 * Math.cos(0.04 * t + phaseOffset)));
      this.setSignal(`${aid}_temp_bearing_04`, baseTemp - 5.0 + 8.0 * (0.5 + 0.5 * Math.cos(0.04 * t + phaseOffset)));

      this.setSignal(`${aid}_temp_gearbox_oil_01`, baseTemp - 2.0 + 10.0 * (0.5 + 0.5 * Math.sin(0.03 * t + phaseOffset)));
      this.setSignal(`${aid}_temp_gearbox_oil_02`, baseTemp - 1.8 + 9.8 * (0.5 + 0.5 * Math.sin(0.03 * t + phaseOffset)));

      // Current (phases A, B, C)
      const currentMag = 5.0 + 18.0 * armSpeed;
      this.setSignal(`${aid}_motor_current_phase_01`, currentMag * Math.sin(20.0 * t + phaseOffset));
      this.setSignal(`${aid}_motor_current_phase_02`, currentMag * Math.sin(20.0 * t + phaseOffset + (2 * Math.PI) / 3));
      this.setSignal(`${aid}_motor_current_phase_03`, currentMag * Math.sin(20.0 * t + phaseOffset + (4 * Math.PI) / 3));

      // Bus Voltages (48V nominal)
      this.setSignal(`${aid}_bus_voltage_01`, 48.0 + 1.2 * Math.sin(0.2 * t) - 0.2 * armSpeed);
      this.setSignal(`${aid}_bus_voltage_02`, 47.9 + 1.1 * Math.cos(0.2 * t) - 0.2 * armSpeed);

      // Accelerometer vibrations
      const vibBase = 0.5 * Math.sin(50.0 * t + phaseOffset) + 0.3 * Math.sin(120.0 * t);
      this.setSignal(`${aid}_vibration_accel_x_01`, vibBase + 0.1 * Math.sin(250.0 * t));
      this.setSignal(`${aid}_vibration_accel_x_02`, vibBase * 0.95);
      this.setSignal(`${aid}_vibration_accel_x_03`, vibBase * 1.05);

      this.setSignal(`${aid}_vibration_accel_y_01`, vibBase * 0.8 + 0.2 * Math.cos(80.0 * t));
      this.setSignal(`${aid}_vibration_accel_y_02`, vibBase * 0.82);
      this.setSignal(`${aid}_vibration_accel_y_03`, vibBase * 0.78);

      this.setSignal(`${aid}_vibration_accel_z_01`, vibBase * 1.1 + 0.2 * Math.sin(150.0 * t));
      this.setSignal(`${aid}_vibration_accel_z_02`, vibBase * 1.08);
      this.setSignal(`${aid}_vibration_accel_z_03`, vibBase * 1.12);

      // Torque feedback
      const torqueVal = (10.0 + 35.0 * armSpeed) * Math.sin(0.8 * Math.PI * t + phaseOffset);
      this.setSignal(`${aid}_torque_feedback_01`, torqueVal);
      this.setSignal(`${aid}_torque_feedback_02`, torqueVal * 0.99);

      // Strain gauges (12 channels)
      for (let s = 1; s <= 12; s++) {
        const sId = String(s).padStart(2, '0');
        const strainVal = (40.0 + s * 10.0) * Math.sin(0.5 * Math.PI * t + phaseOffset * s);
        this.setSignal(`${aid}_strain_gauge_${sId}`, strainVal);
      }

      // Hydraulic pressures (6 channels)
      for (let p = 1; p <= 6; p++) {
        const pId = String(p).padStart(2, '0');
        const pressVal = 140.0 + 20.0 * Math.sin(0.3 * Math.PI * t + p);
        this.setSignal(`${aid}_pressure_hydraulic_${pId}`, pressVal);
      }

      // Encoders (2 channels: wrapping pulse count)
      const encoderTicks = Math.floor((t * 2000 + asmIndex * 500) % 65536);
      this.setSignal(`${aid}_encoder_raw_pulse_01`, encoderTicks);
      this.setSignal(`${aid}_encoder_raw_pulse_02`, (encoderTicks + 128) % 65536);

      // Optical flow (4 channels)
      for (let of = 1; of <= 4; of++) {
        const ofId = String(of).padStart(2, '0');
        this.setSignal(`${aid}_optical_flow_sensor_${ofId}`, 50.0 * armSpeed * Math.sin(2.0 * t + of));
      }

      // Acoustic emission (4 channels)
      for (let ac = 1; ac <= 4; ac++) {
        const acId = String(ac).padStart(2, '0');
        this.setSignal(`${aid}_acoustic_emission_${acId}`, 35.0 + 15.0 * armSpeed + 2.0 * Math.sin(10.0 * t + ac));
      }

      // Magnetic flux (3 channels)
      for (let mf = 1; mf <= 3; mf++) {
        const mfId = String(mf).padStart(2, '0');
        this.setSignal(`${aid}_magnetic_flux_${mfId}`, 45.0 + 5.0 * Math.sin(t + mf));
      }

      // Power draw (2 channels)
      const power = 300.0 + 800.0 * armSpeed;
      this.setSignal(`${aid}_power_draw_01`, power);
      this.setSignal(`${aid}_power_draw_02`, power * 1.02);

      // Thermal flux (4 channels)
      for (let tf = 1; tf <= 4; tf++) {
        const tfId = String(tf).padStart(2, '0');
        this.setSignal(`${aid}_thermal_flux_${tfId}`, 50.0 + 20.0 * armSpeed * Math.cos(0.1 * t + tf));
      }

      // Moisture / humidity (2 channels)
      this.setSignal(`${aid}_moisture_humidity_01`, 45.0 + 3.0 * Math.sin(0.01 * t));
      this.setSignal(`${aid}_moisture_humidity_02`, 44.8 + 2.9 * Math.cos(0.01 * t));

      // Harmonic distortion (2 channels)
      this.setSignal(`${aid}_harmonic_distortion_01`, 1.5 + 0.8 * armSpeed);
      this.setSignal(`${aid}_harmonic_distortion_02`, 1.4 + 0.75 * armSpeed);

      // Bus packet jitter & throughput
      this.setSignal(`${aid}_bus_packet_jitter_01`, 12.0 + 4.0 * Math.sin(0.5 * t));
      this.setSignal(`${aid}_bus_packet_jitter_02`, 11.5 + 3.8 * Math.cos(0.5 * t));
      this.setSignal(`${aid}_bus_throughput_01`, 1200.0 + 400.0 * armSpeed);
      this.setSignal(`${aid}_bus_throughput_02`, 1190.0 + 395.0 * armSpeed);

      // Auxiliary spare channels (22 channels)
      for (let sp = 1; sp <= 22; sp++) {
        const spId = String(sp).padStart(2, '0');
        this.setSignal(`${aid}_aux_telemetry_spare_${spId}`, 10.0 * Math.sin(0.2 * t + sp));
      }
    }
  }

  private setKinematics(aid: string, pos: [number, number, number], quat: [number, number, number, number]): void {
    this.setSignal(`${aid}_pos_x`, pos[0]);
    this.setSignal(`${aid}_pos_y`, pos[1]);
    this.setSignal(`${aid}_pos_z`, pos[2]);

    this.setSignal(`${aid}_rot_qx`, quat[0]);
    this.setSignal(`${aid}_rot_qy`, quat[1]);
    this.setSignal(`${aid}_rot_qz`, quat[2]);
    this.setSignal(`${aid}_rot_qw`, quat[3]);
  }

  /**
   * Constructs a strictly normalized quaternion [qx, qy, qz, qw] from axis and angle.
   * Guarantees Euclidean norm ||q|| = 1.0 ± 1e-6.
   */
  private fromAxisAngle(axis: [number, number, number], angleRad: number): [number, number, number, number] {
    const half = angleRad * 0.5;
    const s = Math.sin(half);
    const c = Math.cos(half);

    // Normalize input axis
    const axisLen = Math.hypot(axis[0], axis[1], axis[2]) || 1.0;
    const ax = (axis[0] / axisLen) * s;
    const ay = (axis[1] / axisLen) * s;
    const az = (axis[2] / axisLen) * s;
    const aw = c;

    // Euclidean normalization
    const qLen = Math.hypot(ax, ay, az, aw);
    return [ax / qLen, ay / qLen, az / qLen, aw / qLen];
  }

  private setSignal(channelId: string, val: number): void {
    const meta = this.channelMap.get(channelId);
    if (!meta) return;

    // Strict boundary clamping to guarantee [min_expected, max_expected]
    const clamped = Math.max(meta.min_expected, Math.min(meta.max_expected, val));
    this.signals[channelId] = clamped;
  }

  public getCurrentState(): FullStatePayload {
    return {
      timestamp: Date.now(),
      signals: { ...this.signals },
      metadata: {
        sessionId: 'sim-continuous-100hz',
        tick: this.tickCount,
        channelCount: this.channels.length
      }
    };
  }

  public getMetrics(): TickMetrics {
    const n = this.intervals.length;
    if (n === 0) {
      return {
        tickCount: this.tickCount,
        elapsedMs: 0,
        meanIntervalMs: 0,
        stdDevIntervalMs: 0,
        maxJitterMs: 0,
        cumulativeDriftMs: 0
      };
    }

    const sum = this.intervals.reduce((acc, v) => acc + v, 0);
    const mean = sum / n;
    const variance = this.intervals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);

    const targetPeriodMs = 1000 / this.tickRateHz;
    const maxJitter = Math.max(...this.intervals.map(v => Math.abs(v - targetPeriodMs)));

    const actualDurationMs = Number(process.hrtime.bigint() - this.startTime) / 1_000_000;
    const expectedDurationMs = this.tickCount * targetPeriodMs;
    const cumulativeDriftMs = Math.abs(actualDurationMs - expectedDurationMs);

    return {
      tickCount: this.tickCount,
      elapsedMs: actualDurationMs,
      meanIntervalMs: mean,
      stdDevIntervalMs: stdDev,
      maxJitterMs: maxJitter,
      cumulativeDriftMs
    };
  }
}

// Standalone execution entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const engine = new PhysicsEngine({ tickRateHz: 100 });
  console.log('[PhysicsEngine] Initialized. Starting continuous 100 Hz simulation...');

  let frameCount = 0;
  engine.onTick(() => {
    frameCount++;
    if (frameCount % 100 === 0) {
      const m = engine.getMetrics();
      console.log(`[PhysicsEngine] Ticks: ${m.tickCount} | Mean Period: ${m.meanIntervalMs.toFixed(2)} ms | StdDev: ${m.stdDevIntervalMs.toFixed(2)} ms | Drift: ${m.cumulativeDriftMs.toFixed(2)} ms`);
    }
  });

  engine.start();

  process.on('SIGINT', () => {
    console.log('\n[PhysicsEngine] Stopping engine...');
    engine.stop();
    process.exit(0);
  });
}
