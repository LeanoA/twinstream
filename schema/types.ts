/**
 * Core TypeScript definitions for Case 03: Decoupled 3D Digital Twin & High-Frequency Telemetry Gateway.
 * Provides compile-time safety mirroring the JSON Schema Draft 2020-12 specifications.
 */

export interface TelemetryMetadata {
  sessionId?: string;
  tick?: number;
  channelCount?: number;
  [key: string]: unknown;
}

export interface FullStatePayload {
  timestamp: number;
  signals: Record<string, number>;
  metadata?: TelemetryMetadata;
}

/**
 * 2-element tuple representing [channel_id, new_value].
 * Using flat tuples eliminates property key duplication and reduces V8 object allocation in high-frequency streams.
 */
export type DeltaTuple = [channelId: string, value: number];

export interface DeltaPacketPayload {
  timestamp: number;
  seq: number;
  deltas: DeltaTuple[];
}

export type SignalType = 'kinematic_pos' | 'kinematic_rot' | 'scalar_sensor';

export interface TelemetryChannelMetadata {
  channel_id: string;
  assembly_id: string;
  signal_type: SignalType;
  unit: string;
  deadband_threshold: number;
  min_expected: number;
  max_expected: number;
  description: string;
}

export interface AssemblyMetadata {
  assembly_id: string;
  name: string;
  mesh_type: 'base' | 'turret' | 'arm_lower' | 'arm_upper' | 'wrist_pitch' | 'wrist_yaw' | 'wrist_roll' | 'end_effector' | 'sensor_pod' | 'counterweight';
  parent_id?: string;
}

export interface TelemetryLayout {
  version: string;
  total_channels: number;
  assemblies: AssemblyMetadata[];
  channels: TelemetryChannelMetadata[];
}
