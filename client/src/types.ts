import * as THREE from 'three';

export type TransformComponent = 'pos_x' | 'pos_y' | 'pos_z' | 'rot_x' | 'rot_y' | 'rot_z' | 'rot_w';

export interface ChannelTargetSlot {
  assemblyIndex: number;
  type: 'pos' | 'rot';
  axis: 'x' | 'y' | 'z' | 'w';
}

export interface AssemblyTransformState {
  assemblyId: string;
  name: string;
  currentPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  currentQuat: THREE.Quaternion;
  targetQuat: THREE.Quaternion;
  mesh: THREE.Object3D;
}

export type ConnectionMode = 'websocket' | 'worker' | 'disconnected';

export interface ReceiverMetrics {
  connected: boolean;
  connectionMode: ConnectionMode;
  seq: number;
  lastDeltaCount: number;
  bytesPerSecond: number;
  reductionPercentage: number;
  lastPacketTimestamp: number;
}

export interface TelemetryLayoutChannel {
  channel_id: string;
  name: string;
  unit: string;
  sampling_rate_hz: number;
  deadband_threshold: number;
}

export interface TelemetryLayoutAssembly {
  assembly_id: string;
  name: string;
  channels: TelemetryLayoutChannel[];
}

export interface TelemetryLayout {
  assemblies: TelemetryLayoutAssembly[];
}

export interface FullStatePayload {
  timestamp: number;
  channels: Record<string, number>;
}

export interface DeltaPacketPayload {
  seq: number;
  timestamp: number;
  deltas: [string, number][];
}
