import * as THREE from 'three';
import {
  AssemblyTransformState,
  ChannelTargetSlot,
  ConnectionMode,
  DeltaPacketPayload,
  FullStatePayload,
  ReceiverMetrics
} from './types.js';

export interface TelemetryReceiverOptions {
  url?: string;
  lerpAlpha?: number;
  slerpAlpha?: number;
  uncompressedFrameBytes?: number;
  enableWorkerFallback?: boolean;
  connectionTimeoutMs?: number;
  workerFactory?: () => Worker;
}

export class TelemetryReceiver {
  private url: string;
  private lerpAlpha: number;
  private slerpAlpha: number;
  private uncompressedFrameBytes: number;
  private enableWorkerFallback: boolean;
  private connectionTimeoutMs: number;
  private workerFactory?: () => Worker;

  private socket: WebSocket | null = null;
  private worker: Worker | null = null;
  private workerActive = false;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isDestroyed = false;

  private transformStates: AssemblyTransformState[] = [];
  private assemblyIndexMap: Map<string, number> = new Map();
  private channelIndex: Map<string, ChannelTargetSlot> = new Map();

  // Diagnostics and bandwidth metrics
  private metrics: ReceiverMetrics = {
    connected: false,
    connectionMode: 'disconnected',
    seq: 0,
    lastDeltaCount: 0,
    bytesPerSecond: 0,
    reductionPercentage: 0,
    lastPacketTimestamp: 0
  };

  private bytesAccumulator = 0;
  private lastRateCheckTime = performance.now();

  constructor(options: TelemetryReceiverOptions = {}) {
    this.url = options.url || 'ws://localhost:8080';
    this.lerpAlpha = options.lerpAlpha ?? 0.25;
    this.slerpAlpha = options.slerpAlpha ?? 0.25;
    // Estimated uncompressed full-state JSON payload size (~49.4 KB)
    this.uncompressedFrameBytes = options.uncompressedFrameBytes ?? 49400;
    this.enableWorkerFallback = options.enableWorkerFallback ?? true;
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 1500;
    this.workerFactory = options.workerFactory;
  }

  /**
   * Registers 3D assembly meshes and initializes pre-allocated transform registers.
   * Builds the precomputed channel indexer for O(1) string lookups.
   */
  public registerAssemblies(assemblyObjects: Map<string, THREE.Object3D>): void {
    this.transformStates = [];
    this.assemblyIndexMap.clear();
    this.channelIndex.clear();

    const assemblyOrder = [
      { id: 'assembly_00_base', name: 'Base Platform' },
      { id: 'assembly_01_turret', name: 'Azimuth Turret' },
      { id: 'assembly_02_shoulder', name: 'Shoulder Joint' },
      { id: 'assembly_03_elbow', name: 'Elbow Joint' },
      { id: 'assembly_04_forearm', name: 'Forearm Actuator' },
      { id: 'assembly_05_wrist_pitch', name: 'Wrist Pitch' },
      { id: 'assembly_06_wrist_yaw', name: 'Wrist Yaw' },
      { id: 'assembly_07_wrist_roll', name: 'Wrist Roll' },
      { id: 'assembly_08_end_effector', name: 'End Effector Tool' },
      { id: 'assembly_09_sensor_pod', name: 'Sensory Pod' }
    ];

    for (let i = 0; i < assemblyOrder.length; i++) {
      const { id, name } = assemblyOrder[i];
      const mesh = assemblyObjects.get(id) || new THREE.Object3D();

      const state: AssemblyTransformState = {
        assemblyId: id,
        name,
        currentPos: mesh.position.clone(),
        targetPos: mesh.position.clone(),
        currentQuat: mesh.quaternion.clone(),
        targetQuat: mesh.quaternion.clone(),
        mesh
      };

      this.transformStates.push(state);
      this.assemblyIndexMap.set(id, i);

      // Precompute channel ID map for zero-allocation runtime lookup
      this.bindTransformChannel(`${id}_pos_x`, i, 'pos', 'x');
      this.bindTransformChannel(`${id}_pos_y`, i, 'pos', 'y');
      this.bindTransformChannel(`${id}_pos_z`, i, 'pos', 'z');
      this.bindTransformChannel(`${id}_rot_qx`, i, 'rot', 'x');
      this.bindTransformChannel(`${id}_rot_qy`, i, 'rot', 'y');
      this.bindTransformChannel(`${id}_rot_qz`, i, 'rot', 'z');
      this.bindTransformChannel(`${id}_rot_qw`, i, 'rot', 'w');
      // Backward-compatible aliases
      this.bindTransformChannel(`${id}_rot_x`, i, 'rot', 'x');
      this.bindTransformChannel(`${id}_rot_y`, i, 'rot', 'y');
      this.bindTransformChannel(`${id}_rot_z`, i, 'rot', 'z');
      this.bindTransformChannel(`${id}_rot_w`, i, 'rot', 'w');
    }
  }

  private bindTransformChannel(
    channelId: string,
    assemblyIndex: number,
    type: 'pos' | 'rot',
    axis: 'x' | 'y' | 'z' | 'w'
  ): void {
    this.channelIndex.set(channelId, {
      assemblyIndex,
      type,
      axis
    });
  }

  public connect(): void {
    if (this.isDestroyed) return;

    if (typeof WebSocket === 'undefined') {
      if (this.enableWorkerFallback) {
        this.startWorker();
      }
      return;
    }

    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }

    // Set fallback timeout if worker fallback is enabled
    if (this.enableWorkerFallback && !this.workerActive && this.metrics.connectionMode !== 'websocket') {
      this.connectionTimer = setTimeout(() => {
        this.connectionTimer = null;
        if (this.metrics.connectionMode !== 'websocket') {
          console.info(`[TelemetryReceiver] WebSocket connection timed out after ${this.connectionTimeoutMs}ms. Activating autonomous Web Worker fallback.`);
          this.startWorker();
        }
      }, this.connectionTimeoutMs);
    }

    try {
      this.socket = new WebSocket(this.url);

      this.socket.onopen = () => {
        if (this.connectionTimer) {
          clearTimeout(this.connectionTimer);
          this.connectionTimer = null;
        }
        if (this.workerActive) {
          this.stopWorker();
        }
        this.metrics.connected = true;
        this.metrics.connectionMode = 'websocket';
      };

      this.socket.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data);
      };

      this.socket.onclose = () => {
        if (this.metrics.connectionMode === 'websocket') {
          this.metrics.connected = false;
          this.metrics.connectionMode = 'disconnected';
        }
        if (this.enableWorkerFallback && !this.workerActive) {
          this.startWorker();
        }
        this.scheduleReconnect();
      };

      this.socket.onerror = () => {
        if (this.connectionTimer) {
          clearTimeout(this.connectionTimer);
          this.connectionTimer = null;
        }
        if (this.metrics.connectionMode === 'websocket') {
          this.metrics.connected = false;
          this.metrics.connectionMode = 'disconnected';
        }
        if (this.socket) {
          this.socket.close();
        }
        if (this.enableWorkerFallback && !this.workerActive) {
          this.startWorker();
        }
      };
    } catch {
      if (this.connectionTimer) {
        clearTimeout(this.connectionTimer);
        this.connectionTimer = null;
      }
      if (this.enableWorkerFallback && !this.workerActive) {
        this.startWorker();
      }
      this.scheduleReconnect();
    }
  }

  public startWorker(): void {
    if (this.workerActive || this.isDestroyed) return;

    if (!this.worker) {
      if (this.workerFactory) {
        this.worker = this.workerFactory();
      } else if (typeof Worker !== 'undefined') {
        try {
          this.worker = new Worker(new URL('./workers/telemetry_worker.ts', import.meta.url), {
            type: 'module'
          });
        } catch (err) {
          console.warn('[TelemetryReceiver] Failed to initialize Web Worker fallback:', err);
          return;
        }
      } else {
        return;
      }

      this.worker.onmessage = (event: MessageEvent) => {
        if (!this.workerActive) return;
        const msg = event.data;
        if (!msg) return;

        if (msg.type === 'snapshot' && msg.payload) {
          this.applyFullState(msg.payload);
          this.bytesAccumulator += msg.byteLength || 0;
          this.updateDataRate();
        } else if (msg.type === 'delta' && msg.payload) {
          this.applyDeltaPacket(msg.payload, msg.byteLength);
          this.bytesAccumulator += msg.byteLength || 0;
          this.updateDataRate();
        }
      };
    }

    this.workerActive = true;
    this.metrics.connected = true;
    this.metrics.connectionMode = 'worker';
    this.worker.postMessage({ action: 'start' });
  }

  public stopWorker(): void {
    if (!this.workerActive) return;
    this.workerActive = false;
    if (this.worker) {
      this.worker.postMessage({ action: 'stop' });
    }
    if (this.metrics.connectionMode === 'worker') {
      this.metrics.connected = false;
      this.metrics.connectionMode = 'disconnected';
    }
  }

  public toggleMode(): ConnectionMode {
    if (this.metrics.connectionMode === 'worker') {
      this.stopWorker();
      this.connect();
      return this.metrics.connectionMode;
    } else {
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
      this.startWorker();
      return this.metrics.connectionMode;
    }
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  public handleMessage(data: string | ArrayBuffer): void {
    const messageStr = typeof data === 'string' ? data : new TextDecoder().decode(data);
    const byteLength = typeof data === 'string' ? data.length : data.byteLength;

    this.bytesAccumulator += byteLength;
    this.updateDataRate();

    let parsed: any;
    try {
      parsed = JSON.parse(messageStr);
    } catch {
      return;
    }

    if (parsed.channels && typeof parsed.channels === 'object') {
      // Full state snapshot baseline
      this.applyFullState(parsed as FullStatePayload);
    } else if (parsed.signals && typeof parsed.signals === 'object') {
      // Dual naming support if gateway sends 'signals'
      this.applyFullState({
        timestamp: parsed.timestamp || Date.now(),
        channels: parsed.signals
      });
    } else if (parsed.deltas && Array.isArray(parsed.deltas)) {
      // High-frequency delta packet
      this.applyDeltaPacket(parsed as DeltaPacketPayload, byteLength);
    }
  }

  /**
   * Applies initial baseline snapshot to both current and target registers,
   * avoiding initial interpolation snap or visual delay.
   */
  public applyFullState(payload: FullStatePayload): void {
    const channels = payload.channels || (payload as any).signals || {};
    for (const channelId in channels) {
      const slot = this.channelIndex.get(channelId);
      if (!slot) continue;

      const val = channels[channelId];
      const state = this.transformStates[slot.assemblyIndex];
      if (!state) continue;

      if (slot.type === 'pos') {
        state.targetPos[slot.axis as 'x' | 'y' | 'z'] = val;
        state.currentPos[slot.axis as 'x' | 'y' | 'z'] = val;
        state.mesh.position[slot.axis as 'x' | 'y' | 'z'] = val;
      } else {
        state.targetQuat[slot.axis as 'x' | 'y' | 'z' | 'w'] = val;
        state.currentQuat[slot.axis as 'x' | 'y' | 'z' | 'w'] = val;
      }
    }

    // Apply baseline orientations to meshes
    for (let i = 0; i < this.transformStates.length; i++) {
      const state = this.transformStates[i];
      state.targetQuat.normalize();
      state.currentQuat.copy(state.targetQuat);
      state.mesh.quaternion.copy(state.currentQuat);
    }

    this.metrics.lastPacketTimestamp = payload.timestamp;
  }

  /**
   * In-place unpacking of delta tuples: resolves target register slot via
   * static Map lookup and mutates target coordinates without string allocations.
   */
  public applyDeltaPacket(payload: DeltaPacketPayload, packetBytes?: number): void {
    const deltas = payload.deltas;
    const count = deltas.length;

    for (let i = 0; i < count; i++) {
      const tuple = deltas[i];
      const channelId = tuple[0];
      const val = tuple[1];

      const slot = this.channelIndex.get(channelId);
      if (!slot) continue;

      const state = this.transformStates[slot.assemblyIndex];
      if (!state) continue;

      if (slot.type === 'pos') {
        state.targetPos[slot.axis as 'x' | 'y' | 'z'] = val;
      } else {
        state.targetQuat[slot.axis as 'x' | 'y' | 'z' | 'w'] = val;
      }
    }

    this.metrics.seq = payload.seq;
    this.metrics.lastDeltaCount = count;
    this.metrics.lastPacketTimestamp = payload.timestamp;

    if (packetBytes !== undefined && this.uncompressedFrameBytes > 0) {
      const reduction = Math.max(0, (1 - packetBytes / this.uncompressedFrameBytes) * 100);
      this.metrics.reductionPercentage = Math.round(reduction * 10) / 10;
    }
  }

  /**
   * ZERO-ALLOCATION RENDER LOOP STEP:
   * Linearly interpolates positions and spherically interpolates quaternions in-place.
   * Must be called every frame within requestAnimationFrame.
   */
  public updateTransforms(): void {
    const states = this.transformStates;
    const len = states.length;
    const lerpA = this.lerpAlpha;
    const slerpA = this.slerpAlpha;

    for (let i = 0; i < len; i++) {
      const state = states[i];
      // In-place vector lerp (0 allocations)
      state.currentPos.lerp(state.targetPos, lerpA);
      state.mesh.position.copy(state.currentPos);

      // In-place quaternion slerp (0 allocations)
      state.currentQuat.slerp(state.targetQuat, slerpA);
      state.mesh.quaternion.copy(state.currentQuat);
    }
  }

  private updateDataRate(): void {
    const now = performance.now();
    const elapsedMs = now - this.lastRateCheckTime;
    if (elapsedMs >= 1000) {
      const bytesPerSec = (this.bytesAccumulator / elapsedMs) * 1000;
      this.metrics.bytesPerSecond = Math.round(bytesPerSec);
      this.bytesAccumulator = 0;
      this.lastRateCheckTime = now;
    }
  }

  public getTransformStates(): AssemblyTransformState[] {
    return this.transformStates;
  }

  public getMetrics(): ReceiverMetrics {
    return this.metrics;
  }

  public disconnect(): void {
    this.isDestroyed = true;
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    if (this.worker) {
      this.worker.postMessage({ action: 'stop' });
      this.worker.terminate();
      this.worker = null;
    }
    this.workerActive = false;
    this.metrics.connected = false;
    this.metrics.connectionMode = 'disconnected';
  }
}
