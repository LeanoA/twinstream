import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { TelemetryReceiver } from '../client/src/telemetry_receiver.js';
import { FullStatePayload, DeltaPacketPayload } from '../client/src/types.js';

describe('TelemetryReceiver & Zero-Allocation Interpolator', () => {
  let receiver: TelemetryReceiver;
  let mockAssemblyMap: Map<string, THREE.Object3D>;

  beforeEach(() => {
    mockAssemblyMap = new Map();
    const assemblyNames = [
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
    ];

    for (const name of assemblyNames) {
      const obj = new THREE.Object3D();
      obj.name = name;
      mockAssemblyMap.set(name, obj);
    }

    receiver = new TelemetryReceiver({
      lerpAlpha: 0.5,
      slerpAlpha: 0.5,
      uncompressedFrameBytes: 50000
    });
    receiver.registerAssemblies(mockAssemblyMap);
  });

  it('pre-allocates exactly 10 transform states with matching assembly meshes', () => {
    const states = receiver.getTransformStates();
    expect(states).toHaveLength(10);

    for (let i = 0; i < states.length; i++) {
      const state = states[i];
      expect(state.currentPos.isVector3).toBe(true);
      expect(state.targetPos.isVector3).toBe(true);
      expect(state.currentQuat.isQuaternion).toBe(true);
      expect(state.targetQuat.isQuaternion).toBe(true);
      expect(state.mesh).toBe(mockAssemblyMap.get(state.assemblyId));
    }
  });

  it('synchronizes baseline full state snapshot immediately without visual delay', () => {
    const snapshot: FullStatePayload = {
      timestamp: 1000.0,
      channels: {
        'assembly_00_base_pos_x': 0.0,
        'assembly_00_base_pos_y': 0.0,
        'assembly_00_base_pos_z': 0.0,
        'assembly_01_turret_pos_y': 0.5,
        'assembly_01_turret_rot_y': 0.7071,
        'assembly_01_turret_rot_w': 0.7071,
        'assembly_02_shoulder_pos_y': 1.25,
        'aux_temp_sensor_unmapped': 45.2
      }
    };

    receiver.applyFullState(snapshot);

    const states = receiver.getTransformStates();
    const turret = states[1];
    const shoulder = states[2];

    expect(turret.currentPos.y).toBeCloseTo(0.5, 4);
    expect(turret.targetPos.y).toBeCloseTo(0.5, 4);
    expect(turret.mesh.position.y).toBeCloseTo(0.5, 4);
    expect(turret.currentQuat.y).toBeCloseTo(0.7071, 4);
    expect(turret.currentQuat.w).toBeCloseTo(0.7071, 4);

    expect(shoulder.currentPos.y).toBeCloseTo(1.25, 4);
    expect(shoulder.targetPos.y).toBeCloseTo(1.25, 4);
  });

  it('unpacks delta packets in-place and updates target registers', () => {
    const deltaPacket: DeltaPacketPayload = {
      seq: 42,
      timestamp: 1016.6,
      deltas: [
        ['assembly_01_turret_pos_x', 0.15],
        ['assembly_01_turret_pos_y', 0.65],
        ['assembly_02_shoulder_pos_z', 0.85],
        ['assembly_02_shoulder_rot_x', 0.38268],
        ['assembly_02_shoulder_rot_w', 0.92388],
        ['assembly_09_sensor_pod_pos_z', 1.82]
      ]
    };

    receiver.applyDeltaPacket(deltaPacket, 5000); // 5 KB delta packet

    const metrics = receiver.getMetrics();
    expect(metrics.seq).toBe(42);
    expect(metrics.lastDeltaCount).toBe(6);
    expect(metrics.reductionPercentage).toBe(90.0); // (1 - 5000/50000) * 100 = 90%

    const states = receiver.getTransformStates();
    const turret = states[1];
    const shoulder = states[2];
    const pod = states[9];

    expect(turret.targetPos.x).toBeCloseTo(0.15, 4);
    expect(turret.targetPos.y).toBeCloseTo(0.65, 4);
    expect(shoulder.targetPos.z).toBeCloseTo(0.85, 4);
    expect(shoulder.targetQuat.x).toBeCloseTo(0.38268, 4);
    expect(shoulder.targetQuat.w).toBeCloseTo(0.92388, 4);
    expect(pod.targetPos.z).toBeCloseTo(1.82, 4);
  });

  it('guarantees zero heap allocation invariant during in-place Lerp and Slerp step', () => {
    const states = receiver.getTransformStates();
    const turret = states[1];

    // Cache exact object references
    const initialPosRef = turret.currentPos;
    const initialTargetPosRef = turret.targetPos;
    const initialQuatRef = turret.currentQuat;
    const initialTargetQuatRef = turret.targetQuat;

    // Set target values
    turret.targetPos.set(2.0, 4.0, 6.0);
    turret.targetQuat.set(0, 0.7071068, 0, 0.7071068);

    // Initial state: current is (0, 0, 0)
    expect(turret.currentPos.x).toBe(0);
    expect(turret.currentPos.y).toBe(0);
    expect(turret.currentPos.z).toBe(0);

    // Execute render loop step 1 (lerpAlpha = 0.5)
    receiver.updateTransforms();

    // Verify in-place mathematical convergence
    expect(turret.currentPos.x).toBeCloseTo(1.0, 4);
    expect(turret.currentPos.y).toBeCloseTo(2.0, 4);
    expect(turret.currentPos.z).toBeCloseTo(3.0, 4);
    expect(turret.mesh.position.x).toBeCloseTo(1.0, 4);

    // Execute render loop step 2
    receiver.updateTransforms();
    expect(turret.currentPos.x).toBeCloseTo(1.5, 4);
    expect(turret.currentPos.y).toBeCloseTo(3.0, 4);
    expect(turret.currentPos.z).toBeCloseTo(4.5, 4);

    // CRITICAL INVARIANT: Object identities MUST remain strictly identical (0 new allocations)
    expect(turret.currentPos).toBe(initialPosRef);
    expect(turret.targetPos).toBe(initialTargetPosRef);
    expect(turret.currentQuat).toBe(initialQuatRef);
    expect(turret.targetQuat).toBe(initialTargetQuatRef);
  });

  it('handles disconnect and cleanup gracefully', () => {
    receiver.disconnect();
    const metrics = receiver.getMetrics();
    expect(metrics.connected).toBe(false);
  });
});
