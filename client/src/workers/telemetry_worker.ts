/**
 * Autonomous In-Browser Telemetry Simulation Worker
 * 
 * Runs a continuous kinematic simulation and deadband delta compressor inside
 * a dedicated Web Worker thread. This ensures the main UI/WebGL thread remains
 * completely unblocked for 60 FPS Three.js rendering when running as a standalone
 * demo (e.g. on GitHub Pages) without an active Node.js / WebSocket gateway.
 */

// In Web Worker thread context, declare ambient self
declare const self: any;

// Assembly definitions
export const ASSEMBLIES = [
  'assembly_00_base',
  'assembly_01_turret',
  'assembly_02_shoulder',
  'assembly_03_elbow',
  'assembly_04_forearm',
  'assembly_05_wrist_pitch',
  'assembly_06_wrist_yaw',
  'assembly_07_wrist_roll',
  'assembly_08_end_effector',
  'assembly_09_sensor_pod'
] as const;

/**
 * Normalizes an axis and constructs a unit quaternion [qx, qy, qz, qw].
 */
export function fromAxisAngle(axis: [number, number, number], angleRad: number): [number, number, number, number] {
  const half = angleRad * 0.5;
  const s = Math.sin(half);
  const c = Math.cos(half);

  const axisLen = Math.hypot(axis[0], axis[1], axis[2]) || 1.0;
  const ax = (axis[0] / axisLen) * s;
  const ay = (axis[1] / axisLen) * s;
  const az = (axis[2] / axisLen) * s;
  const aw = c;

  const qLen = Math.hypot(ax, ay, az, aw) || 1.0;
  return [ax / qLen, ay / qLen, az / qLen, aw / qLen];
}

export class InBrowserPhysicsWorker {
  private tickRateHz = 60;
  private deadband = 0.001;
  private timer: any = null;
  private tickCount = 0;
  private startTime = 0;
  private isRunning = false;
  private postMessageFn: (msg: any) => void;

  // Signal buffers
  private currentSignals: Record<string, number> = {};
  private lastSentSignals: Map<string, number> = new Map();
  private allChannelIds: string[] = [];
  private seq = 0;

  constructor(postMessageFn?: (msg: any) => void) {
    this.postMessageFn = postMessageFn || ((msg: any) => {
      if (typeof self !== 'undefined' && typeof (self as any).postMessage === 'function') {
        (self as any).postMessage(msg);
      }
    });
    this.initializeChannelRegistry();
  }

  /**
   * Generates the 1,000 telemetry channel IDs matching the layout contract.
   */
  private initializeChannelRegistry(): void {
    this.allChannelIds = [];

    for (let i = 0; i < ASSEMBLIES.length; i++) {
      const aid = ASSEMBLIES[i];
      // 7 kinematic channels
      this.allChannelIds.push(
        `${aid}_pos_x`,
        `${aid}_pos_y`,
        `${aid}_pos_z`,
        `${aid}_rot_qx`,
        `${aid}_rot_qy`,
        `${aid}_rot_qz`,
        `${aid}_rot_qw`
      );

      // Auxiliary sensor channels (93 channels per assembly to total 100 per assembly = 1,000 total)
      this.allChannelIds.push(
        `${aid}_temp_motor_winding_01`,
        `${aid}_temp_motor_winding_02`,
        `${aid}_temp_motor_winding_03`,
        `${aid}_temp_motor_winding_04`,
        `${aid}_temp_bearing_01`,
        `${aid}_temp_bearing_02`,
        `${aid}_temp_bearing_03`,
        `${aid}_temp_bearing_04`,
        `${aid}_temp_gearbox_oil_01`,
        `${aid}_temp_gearbox_oil_02`,
        `${aid}_motor_current_phase_01`,
        `${aid}_motor_current_phase_02`,
        `${aid}_motor_current_phase_03`,
        `${aid}_bus_voltage_01`,
        `${aid}_bus_voltage_02`,
        `${aid}_vibration_accel_x_01`,
        `${aid}_vibration_accel_x_02`,
        `${aid}_vibration_accel_x_03`,
        `${aid}_vibration_accel_y_01`,
        `${aid}_vibration_accel_y_02`,
        `${aid}_vibration_accel_y_03`,
        `${aid}_vibration_accel_z_01`,
        `${aid}_vibration_accel_z_02`,
        `${aid}_vibration_accel_z_03`,
        `${aid}_torque_feedback_01`,
        `${aid}_torque_feedback_02`
      );

      // Strain gauges (12 channels)
      for (let s = 1; s <= 12; s++) {
        this.allChannelIds.push(`${aid}_strain_gauge_${String(s).padStart(2, '0')}`);
      }

      // Hydraulic pressures (6 channels)
      for (let p = 1; p <= 6; p++) {
        this.allChannelIds.push(`${aid}_pressure_hydraulic_${String(p).padStart(2, '0')}`);
      }

      // Remaining auxiliary diagnostic signals
      for (let aux = 1; aux <= 49; aux++) {
        this.allChannelIds.push(`${aid}_aux_sensor_${String(aux).padStart(2, '0')}`);
      }
    }

    // Populate baseline values for all 1,000 channels
    for (const channelId of this.allChannelIds) {
      this.currentSignals[channelId] = 0.0;
    }
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startTime = performance.now();
    this.tickCount = 0;
    this.seq = 0;
    this.lastSentSignals.clear();

    // First tick: emit full state snapshot
    this.evaluateKinematics(0);
    this.emitInitialSnapshot();

    // Subsequent ticks: paced broadcast
    const intervalMs = 1000 / this.tickRateHz;
    this.timer = setInterval(() => {
      this.tick();
    }, intervalMs);
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public tick(): void {
    this.tickCount++;
    const t = (performance.now() - this.startTime) / 1000;
    this.evaluateKinematics(t);
    this.emitDeltaPacket();
  }

  private setKinematics(aid: string, pos: [number, number, number], quat: [number, number, number, number]): void {
    this.currentSignals[`${aid}_pos_x`] = pos[0];
    this.currentSignals[`${aid}_pos_y`] = pos[1];
    this.currentSignals[`${aid}_pos_z`] = pos[2];
    this.currentSignals[`${aid}_rot_qx`] = quat[0];
    this.currentSignals[`${aid}_rot_qy`] = quat[1];
    this.currentSignals[`${aid}_rot_qz`] = quat[2];
    this.currentSignals[`${aid}_rot_qw`] = quat[3];
  }

  /**
   * Evaluates continuous kinematics conforming to the ISO 9787 / ROS REP-103 tree.
   */
  private evaluateKinematics(t: number): void {
    // 0: Base
    this.setKinematics('assembly_00_base', [0, 0, 0], [0, 0, 0, 1]);

    // 1: Turret (azimuth yaw around Y)
    const yaw1 = 0.5 * Math.sin(0.4 * Math.PI * t);
    this.setKinematics('assembly_01_turret', [0, 0.35, 0], fromAxisAngle([0, 1, 0], yaw1));

    // 2: Shoulder (pitch around X)
    const pitch2 = 0.35 * Math.sin(0.6 * Math.PI * t + 0.3);
    this.setKinematics('assembly_02_shoulder', [0, 0.45, 0], fromAxisAngle([1, 0, 0], pitch2));

    // 3: Elbow (pitch around X)
    const pitch3 = 0.4 * Math.cos(0.8 * Math.PI * t);
    this.setKinematics('assembly_03_elbow', [0, 0.95, 0], fromAxisAngle([1, 0, 0], pitch3));

    // 4: Forearm (roll around Y)
    const roll4 = 0.3 * Math.sin(Math.PI * t);
    this.setKinematics('assembly_04_forearm', [0, 0, 0], fromAxisAngle([0, 1, 0], roll4));

    // 5: Wrist Pitch (pitch around X)
    const pitch5 = 0.25 * Math.cos(1.2 * Math.PI * t);
    this.setKinematics('assembly_05_wrist_pitch', [0, 0.85, 0], fromAxisAngle([1, 0, 0], pitch5));

    // 6: Wrist Yaw (yaw around Y)
    const yaw6 = 0.2 * Math.sin(1.4 * Math.PI * t);
    this.setKinematics('assembly_06_wrist_yaw', [0, 0.12, 0], fromAxisAngle([0, 1, 0], yaw6));

    // 7: Wrist Roll (roll around Z)
    const roll7 = 0.4 * Math.sin(0.7 * Math.PI * t);
    this.setKinematics('assembly_07_wrist_roll', [0, 0.10, 0], fromAxisAngle([0, 0, 1], roll7));

    // 8: End Effector (tool pitch)
    const pitch8 = 0.15 * Math.sin(1.8 * Math.PI * t);
    this.setKinematics('assembly_08_end_effector', [0, 0.08, 0], fromAxisAngle([1, 0, 0], pitch8));

    // 9: Sensor Pod (scanner yaw)
    const yaw9 = 0.3 * Math.cos(1.5 * Math.PI * t);
    this.setKinematics('assembly_09_sensor_pod', [0, 0.06, 0], fromAxisAngle([0, 1, 0], yaw9));

    // Auxiliary channel variations
    for (let i = 0; i < ASSEMBLIES.length; i++) {
      const aid = ASSEMBLIES[i];
      const phaseOffset = i * 0.628;

      this.currentSignals[`${aid}_temp_motor_winding_01`] = 42.0 + 2.5 * Math.sin(0.05 * t + phaseOffset);
      this.currentSignals[`${aid}_motor_current_phase_01`] = 3.5 + 8.0 * Math.abs(Math.sin(0.4 * Math.PI * t));
      this.currentSignals[`${aid}_bus_voltage_01`] = 48.0 + 0.03 * Math.sin(0.1 * t);
      this.currentSignals[`${aid}_vibration_accel_x_01`] = 0.15 * Math.sin(4.0 * t + phaseOffset);
      this.currentSignals[`${aid}_torque_feedback_01`] = 12.0 * Math.sin(0.8 * Math.PI * t + phaseOffset);

      for (let s = 1; s <= 12; s++) {
        const sId = String(s).padStart(2, '0');
        this.currentSignals[`${aid}_strain_gauge_${sId}`] = (i === 2)
          ? (25.0 + s * 5.0) * Math.sin(0.4 * Math.PI * t + s)
          : (10.0 + s * 2.0);
      }

      for (let p = 1; p <= 6; p++) {
        const pId = String(p).padStart(2, '0');
        this.currentSignals[`${aid}_pressure_hydraulic_${pId}`] = (i === 2)
          ? 140.0 + 12.0 * Math.sin(0.2 * Math.PI * t + p)
          : 140.0;
      }
    }
  }

  private emitInitialSnapshot(): void {
    this.seq++;
    const now = Date.now();

    for (const [k, v] of Object.entries(this.currentSignals)) {
      this.lastSentSignals.set(k, v);
    }

    const payload = {
      timestamp: now,
      channels: { ...this.currentSignals },
      metadata: {
        seq: this.seq,
        channelCount: Object.keys(this.currentSignals).length,
        source: 'in-browser-web-worker'
      }
    };

    // Calculate simulated wire length
    const jsonStr = JSON.stringify(payload);
    const byteLength = jsonStr.length;

    this.postMessageFn({
      type: 'snapshot',
      payload,
      byteLength,
      mode: 'worker'
    });
  }

  private emitDeltaPacket(): void {
    this.seq++;
    const deltas: [string, number][] = [];
    const now = Date.now();

    for (const [channelId, val] of Object.entries(this.currentSignals)) {
      const prevVal = this.lastSentSignals.get(channelId);
      const isRot = channelId.includes('_rot_');
      const thresh = isRot ? 0.0005 : this.deadband;

      if (prevVal === undefined || Math.abs(val - prevVal) > thresh) {
        deltas.push([channelId, val]);
        this.lastSentSignals.set(channelId, val);
      }
    }

    const payload = {
      timestamp: now,
      seq: this.seq,
      deltas
    };

    const jsonStr = JSON.stringify(payload);
    const byteLength = jsonStr.length;

    this.postMessageFn({
      type: 'delta',
      payload,
      byteLength,
      mode: 'worker'
    });
  }
}

// In dedicated worker thread context, register self.onmessage listener
const ctx: any = typeof self !== 'undefined' ? self : null;
if (ctx && typeof ctx.postMessage === 'function') {
  const workerInstance = new InBrowserPhysicsWorker((data) => ctx.postMessage(data));

  ctx.onmessage = (e: MessageEvent) => {
    const { action } = e.data || {};
    switch (action) {
      case 'start':
        workerInstance.start();
        break;
      case 'stop':
        workerInstance.stop();
        break;
    }
  };
}
