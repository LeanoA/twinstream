import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { InBrowserPhysicsWorker, fromAxisAngle, ASSEMBLIES } from '../client/src/workers/telemetry_worker.js';
import { TelemetryReceiver } from '../client/src/telemetry_receiver.js';

describe('Autonomous In-Browser Telemetry Worker & Fallback Engine', () => {
  describe('InBrowserPhysicsWorker Kinematics & Compression', () => {
    it('constructs normalized unit quaternions from axis-angle pairs', () => {
      // 90 deg rotation around Y axis
      const q = fromAxisAngle([0, 1, 0], Math.PI / 2);
      const norm = Math.hypot(q[0], q[1], q[2], q[3]);
      expect(norm).toBeCloseTo(1.0, 5);
      expect(q[0]).toBeCloseTo(0, 5);
      expect(q[1]).toBeCloseTo(Math.sin(Math.PI / 4), 5);
      expect(q[2]).toBeCloseTo(0, 5);
      expect(q[3]).toBeCloseTo(Math.cos(Math.PI / 4), 5);
    });

    it('emits a 1,000-channel baseline snapshot on start', () => {
      const messages: any[] = [];
      const worker = new InBrowserPhysicsWorker((msg) => messages.push(msg));

      worker.start();
      worker.stop();

      expect(messages.length).toBeGreaterThanOrEqual(1);
      const snapshotMsg = messages[0];
      expect(snapshotMsg.type).toBe('snapshot');
      expect(snapshotMsg.mode).toBe('worker');
      expect(snapshotMsg.payload.channels).toBeDefined();

      const channelKeys = Object.keys(snapshotMsg.payload.channels);
      expect(channelKeys.length).toBe(1000);

      // Verify all 10 assemblies are present in the snapshot
      for (const aid of ASSEMBLIES) {
        expect(snapshotMsg.payload.channels[`${aid}_pos_x`]).toBeDefined();
        expect(snapshotMsg.payload.channels[`${aid}_pos_y`]).toBeDefined();
        expect(snapshotMsg.payload.channels[`${aid}_pos_z`]).toBeDefined();
        expect(snapshotMsg.payload.channels[`${aid}_rot_qx`]).toBeDefined();
        expect(snapshotMsg.payload.channels[`${aid}_rot_qy`]).toBeDefined();
        expect(snapshotMsg.payload.channels[`${aid}_rot_qz`]).toBeDefined();
        expect(snapshotMsg.payload.channels[`${aid}_rot_qw`]).toBeDefined();
      }
    });

    it('emits incremental delta packets on subsequent ticks with deadband filtering', () => {
      const messages: any[] = [];
      const worker = new InBrowserPhysicsWorker((msg) => messages.push(msg));

      worker.start();
      expect(messages.length).toBe(1); // Snapshot

      // Trigger one kinematic tick
      worker.tick();
      expect(messages.length).toBe(2);

      const deltaMsg = messages[1];
      expect(deltaMsg.type).toBe('delta');
      expect(deltaMsg.mode).toBe('worker');
      expect(Array.isArray(deltaMsg.payload.deltas)).toBe(true);

      // Deltas must only be emitted for channels exceeding the deadband
      const deltas = deltaMsg.payload.deltas;
      expect(deltas.length).toBeGreaterThan(0);
      expect(deltas.length).toBeLessThan(1000); // Deadband filtering ensures significant reduction

      worker.stop();
    });
  });

  describe('TelemetryReceiver Dual-Mode Fallback & Recovery', () => {
    let mockAssemblyMap: Map<string, THREE.Object3D>;

    beforeEach(() => {
      mockAssemblyMap = new Map();
      for (const name of ASSEMBLIES) {
        const obj = new THREE.Object3D();
        obj.name = name;
        mockAssemblyMap.set(name, obj);
      }
    });

    it('activates mock Web Worker when WebSocket connection times out or fails', async () => {
      // Create a mock worker interface
      let workerStarted = false;
      let onmessageHandler: ((e: MessageEvent) => void) | null = null;

      const mockWorker: any = {
        postMessage: vi.fn((data: any) => {
          if (data.action === 'start') {
            workerStarted = true;
          } else if (data.action === 'stop') {
            workerStarted = false;
          }
        }),
        terminate: vi.fn(),
        set onmessage(handler: any) {
          onmessageHandler = handler;
        },
        get onmessage() {
          return onmessageHandler;
        }
      };

      const receiver = new TelemetryReceiver({
        url: 'ws://unreachable-gateway-address:9999',
        connectionTimeoutMs: 50,
        enableWorkerFallback: true,
        workerFactory: () => mockWorker
      });

      receiver.registerAssemblies(mockAssemblyMap);

      // Connect triggers WebSocket attempt with fallback timeout
      receiver.connect();

      // Wait for the 50 ms connection timeout to trigger
      await new Promise((resolve) => setTimeout(resolve, 80));

      const metrics = receiver.getMetrics();
      expect(metrics.connected).toBe(true);
      expect(metrics.connectionMode).toBe('worker');
      expect(workerStarted).toBe(true);

      // Verify that worker messages update receiver state
      expect(onmessageHandler).toBeDefined();

      // 1. Dispatch initial snapshot
      onmessageHandler!({
        data: {
          type: 'snapshot',
          payload: {
            timestamp: 1000,
            channels: {
              'assembly_01_turret_pos_y': 0.45,
              'assembly_01_turret_rot_qy': 0.7071,
              'assembly_01_turret_rot_qw': 0.7071
            }
          },
          byteLength: 25000
        }
      } as MessageEvent);

      const states = receiver.getTransformStates();
      const turretState = states[1];
      expect(turretState.currentPos.y).toBeCloseTo(0.45, 4);
      expect(turretState.targetPos.y).toBeCloseTo(0.45, 4);

      // 2. Dispatch delta packet
      onmessageHandler!({
        data: {
          type: 'delta',
          payload: {
            seq: 2,
            timestamp: 1016,
            deltas: [
              ['assembly_01_turret_pos_y', 0.55]
            ]
          },
          byteLength: 320
        }
      } as MessageEvent);

      expect(turretState.targetPos.y).toBeCloseTo(0.55, 4);
      expect(receiver.getMetrics().seq).toBe(2);
      expect(receiver.getMetrics().lastDeltaCount).toBe(1);

      // 3. Step interpolation
      receiver.updateTransforms();
      expect(turretState.currentPos.y).toBeGreaterThan(0.45);

      // Clean teardown
      receiver.disconnect();
      expect(receiver.getMetrics().connected).toBe(false);
      expect(receiver.getMetrics().connectionMode).toBe('disconnected');
      expect(mockWorker.terminate).toHaveBeenCalled();
    });

    it('allows toggling between worker and live connection modes', () => {
      let workerActive = false;
      const mockWorker: any = {
        postMessage: vi.fn((data: any) => {
          if (data.action === 'start') workerActive = true;
          if (data.action === 'stop') workerActive = false;
        }),
        terminate: vi.fn(),
        onmessage: null
      };

      const receiver = new TelemetryReceiver({
        enableWorkerFallback: false,
        workerFactory: () => mockWorker
      });

      receiver.registerAssemblies(mockAssemblyMap);
      expect(receiver.getMetrics().connectionMode).toBe('disconnected');

      // Start worker manually
      receiver.startWorker();
      expect(receiver.getMetrics().connectionMode).toBe('worker');
      expect(workerActive).toBe(true);

      // Toggle mode (should stop worker)
      receiver.toggleMode();
      expect(workerActive).toBe(false);

      receiver.disconnect();
    });
  });
});
