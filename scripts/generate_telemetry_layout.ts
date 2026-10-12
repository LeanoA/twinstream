import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TelemetryLayout, AssemblyMetadata, TelemetryChannelMetadata } from '../schema/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSEMBLIES: AssemblyMetadata[] = [
  { assembly_id: 'assembly_00_base', name: 'Base Mounting Platform', mesh_type: 'base' },
  { assembly_id: 'assembly_01_turret', name: 'Azimuth Turret Rotating Joint', mesh_type: 'turret', parent_id: 'assembly_00_base' },
  { assembly_id: 'assembly_02_shoulder', name: 'Shoulder Pitch Joint & Boom', mesh_type: 'arm_lower', parent_id: 'assembly_01_turret' },
  { assembly_id: 'assembly_03_elbow', name: 'Elbow Pitch Joint & Arm Link', mesh_type: 'arm_upper', parent_id: 'assembly_02_shoulder' },
  { assembly_id: 'assembly_04_forearm', name: 'Forearm Roll Actuator', mesh_type: 'arm_upper', parent_id: 'assembly_03_elbow' },
  { assembly_id: 'assembly_05_wrist_pitch', name: 'Wrist Pitch Gimbal', mesh_type: 'wrist_pitch', parent_id: 'assembly_04_forearm' },
  { assembly_id: 'assembly_06_wrist_yaw', name: 'Wrist Yaw Gimbal', mesh_type: 'wrist_yaw', parent_id: 'assembly_05_wrist_pitch' },
  { assembly_id: 'assembly_07_wrist_roll', name: 'Wrist Roll Flange', mesh_type: 'wrist_roll', parent_id: 'assembly_06_wrist_yaw' },
  { assembly_id: 'assembly_08_end_effector', name: 'Multi-Jaw End Effector Tool', mesh_type: 'end_effector', parent_id: 'assembly_07_wrist_roll' },
  { assembly_id: 'assembly_09_sensor_pod', name: 'High-Resolution Sensory Payload Pod', mesh_type: 'sensor_pod', parent_id: 'assembly_08_end_effector' }
];

export function generateTelemetryLayout(): TelemetryLayout {
  const channels: TelemetryChannelMetadata[] = [];

  for (const asm of ASSEMBLIES) {
    const aid = asm.assembly_id;

    // 1. Kinematic Position Channels (3 channels: x, y, z)
    channels.push(
      {
        channel_id: `${aid}_pos_x`,
        assembly_id: aid,
        signal_type: 'kinematic_pos',
        unit: 'm',
        deadband_threshold: 0.001,
        min_expected: -10.0,
        max_expected: 10.0,
        description: `Translational position X for ${asm.name}`
      },
      {
        channel_id: `${aid}_pos_y`,
        assembly_id: aid,
        signal_type: 'kinematic_pos',
        unit: 'm',
        deadband_threshold: 0.001,
        min_expected: -10.0,
        max_expected: 10.0,
        description: `Translational position Y for ${asm.name}`
      },
      {
        channel_id: `${aid}_pos_z`,
        assembly_id: aid,
        signal_type: 'kinematic_pos',
        unit: 'm',
        deadband_threshold: 0.001,
        min_expected: -10.0,
        max_expected: 10.0,
        description: `Translational position Z for ${asm.name}`
      }
    );

    // 2. Kinematic Rotation Quaternion Channels (4 channels: qx, qy, qz, qw)
    channels.push(
      {
        channel_id: `${aid}_rot_qx`,
        assembly_id: aid,
        signal_type: 'kinematic_rot',
        unit: 'rad',
        deadband_threshold: 0.0005,
        min_expected: -1.0,
        max_expected: 1.0,
        description: `Orientation quaternion Qx for ${asm.name}`
      },
      {
        channel_id: `${aid}_rot_qy`,
        assembly_id: aid,
        signal_type: 'kinematic_rot',
        unit: 'rad',
        deadband_threshold: 0.0005,
        min_expected: -1.0,
        max_expected: 1.0,
        description: `Orientation quaternion Qy for ${asm.name}`
      },
      {
        channel_id: `${aid}_rot_qz`,
        assembly_id: aid,
        signal_type: 'kinematic_rot',
        unit: 'rad',
        deadband_threshold: 0.0005,
        min_expected: -1.0,
        max_expected: 1.0,
        description: `Orientation quaternion Qz for ${asm.name}`
      },
      {
        channel_id: `${aid}_rot_qw`,
        assembly_id: aid,
        signal_type: 'kinematic_rot',
        unit: 'rad',
        deadband_threshold: 0.0005,
        min_expected: -1.0,
        max_expected: 1.0,
        description: `Orientation quaternion Qw for ${asm.name}`
      }
    );

    // 3. Auxiliary Sensor Channels (93 channels to reach exactly 100 per assembly)
    const auxiliaryDefinitions = [
      { prefix: 'temp_motor_winding', unit: 'degC', count: 4, deadband: 0.05, min: 20, max: 130 },
      { prefix: 'temp_bearing', unit: 'degC', count: 4, deadband: 0.05, min: 20, max: 100 },
      { prefix: 'temp_gearbox_oil', unit: 'degC', count: 2, deadband: 0.05, min: 20, max: 95 },
      { prefix: 'motor_current_phase', unit: 'A', count: 3, deadband: 0.01, min: -50, max: 50 },
      { prefix: 'bus_voltage', unit: 'V', count: 2, deadband: 0.02, min: 40, max: 60 },
      { prefix: 'vibration_accel_x', unit: 'm/s^2', count: 3, deadband: 0.01, min: -20, max: 20 },
      { prefix: 'vibration_accel_y', unit: 'm/s^2', count: 3, deadband: 0.01, min: -20, max: 20 },
      { prefix: 'vibration_accel_z', unit: 'm/s^2', count: 3, deadband: 0.01, min: -20, max: 20 },
      { prefix: 'torque_feedback', unit: 'Nm', count: 2, deadband: 0.05, min: -200, max: 200 },
      { prefix: 'strain_gauge', unit: 'uE', count: 12, deadband: 0.1, min: -1000, max: 1000 },
      { prefix: 'pressure_hydraulic', unit: 'bar', count: 6, deadband: 0.05, min: 0, max: 250 },
      { prefix: 'encoder_raw_pulse', unit: 'ticks', count: 2, deadband: 1.0, min: 0, max: 65535 },
      { prefix: 'optical_flow_sensor', unit: 'px/s', count: 4, deadband: 0.1, min: -500, max: 500 },
      { prefix: 'acoustic_emission', unit: 'dB', count: 4, deadband: 0.2, min: 10, max: 120 },
      { prefix: 'magnetic_flux', unit: 'uT', count: 3, deadband: 0.1, min: -200, max: 200 },
      { prefix: 'power_draw', unit: 'W', count: 2, deadband: 0.5, min: 0, max: 3000 },
      { prefix: 'thermal_flux', unit: 'W/m^2', count: 4, deadband: 0.2, min: -100, max: 500 },
      { prefix: 'moisture_humidity', unit: '%RH', count: 2, deadband: 0.5, min: 5, max: 95 },
      { prefix: 'harmonic_distortion', unit: '%', count: 2, deadband: 0.05, min: 0, max: 20 },
      { prefix: 'bus_packet_jitter', unit: 'us', count: 2, deadband: 2.0, min: 0, max: 500 },
      { prefix: 'bus_throughput', unit: 'KB/s', count: 2, deadband: 1.0, min: 0, max: 10000 },
      { prefix: 'aux_telemetry_spare', unit: 'raw', count: 22, deadband: 0.01, min: -100, max: 100 }
    ];

    let auxCount = 0;
    for (const def of auxiliaryDefinitions) {
      for (let i = 1; i <= def.count; i++) {
        auxCount++;
        const indexStr = String(i).padStart(2, '0');
        channels.push({
          channel_id: `${aid}_${def.prefix}_${indexStr}`,
          assembly_id: aid,
          signal_type: 'scalar_sensor',
          unit: def.unit,
          deadband_threshold: def.deadband,
          min_expected: def.min,
          max_expected: def.max,
          description: `${def.prefix.replace(/_/g, ' ')} #${indexStr} on ${asm.name}`
        });
      }
    }

    if (auxCount !== 93) {
      throw new Error(`Assembly ${aid} expected 93 auxiliary channels, got ${auxCount}`);
    }
  }

  if (channels.length !== 1000) {
    throw new Error(`Total channels expected: 1000, got ${channels.length}`);
  }

  return {
    version: '1.0.0',
    total_channels: channels.length,
    assemblies: ASSEMBLIES,
    channels
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const layout = generateTelemetryLayout();
  const dataDir = path.resolve(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const outputPath = path.join(dataDir, 'mock_telemetry_layout.json');
  fs.writeFileSync(outputPath, JSON.stringify(layout, null, 2), 'utf-8');
  console.log(`[SUCCESS] Generated mock telemetry layout: ${outputPath} (${layout.channels.length} channels across ${layout.assemblies.length} assemblies)`);
}
