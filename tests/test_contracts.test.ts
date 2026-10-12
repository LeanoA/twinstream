import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import type { FullStatePayload, DeltaPacketPayload, TelemetryLayout } from '../schema/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const fullStateSchemaPath = path.join(rootDir, 'schema/full_state.schema.json');
const deltaPacketSchemaPath = path.join(rootDir, 'schema/delta_packet.schema.json');
const layoutPath = path.join(rootDir, 'data/mock_telemetry_layout.json');

const fullStateSchema = JSON.parse(fs.readFileSync(fullStateSchemaPath, 'utf-8'));
const deltaPacketSchema = JSON.parse(fs.readFileSync(deltaPacketSchemaPath, 'utf-8'));
const layout: TelemetryLayout = JSON.parse(fs.readFileSync(layoutPath, 'utf-8'));

// Handle ESM default import interop across bundlers and ts-node/tsx
const Ajv2020Constructor: any = (Ajv2020Module as any).default || Ajv2020Module;
const addFormatsFn: any = (addFormatsModule as any).default || addFormatsModule;

const ajv = new Ajv2020Constructor({ allErrors: true, strict: false });
addFormatsFn(ajv);

const validateFullState: any = ajv.compile(fullStateSchema);
const validateDeltaPacket: any = ajv.compile(deltaPacketSchema);

describe('Meta-Schema & Schema Compilation', () => {
  it('should compile full_state.schema.json without errors', () => {
    expect(validateFullState).toBeTypeOf('function');
  });

  it('should compile delta_packet.schema.json without errors', () => {
    expect(validateDeltaPacket).toBeTypeOf('function');
  });
});

describe('Full-State Snapshot Contract', () => {
  it('should validate a valid 1,000-channel full-state snapshot', () => {
    const signals: Record<string, number> = {};
    for (const channel of layout.channels) {
      signals[channel.channel_id] = 0.0;
    }

    const payload: FullStatePayload = {
      timestamp: 1773349200000,
      signals,
      metadata: {
        sessionId: 'sim-session-001',
        tick: 1,
        channelCount: layout.channels.length
      }
    };

    const valid = validateFullState(payload);
    expect(valid).toBe(true);
    expect(validateFullState.errors).toBeNull();
  });

  it('should reject payload missing timestamp', () => {
    const payload = {
      signals: { 'assembly_00_pos_x': 1.0 }
    };
    const valid = validateFullState(payload as any);
    expect(valid).toBe(false);
    expect(validateFullState.errors?.some((e: any) => e.params?.missingProperty === 'timestamp')).toBe(true);
  });

  it('should reject payload missing signals dictionary', () => {
    const payload = {
      timestamp: 1773349200000
    };
    const valid = validateFullState(payload as any);
    expect(valid).toBe(false);
    expect(validateFullState.errors?.some((e: any) => e.params?.missingProperty === 'signals')).toBe(true);
  });

  it('should reject non-numeric signal values', () => {
    const payload = {
      timestamp: 1773349200000,
      signals: {
        'assembly_00_pos_x': 'invalid_string'
      }
    };
    const valid = validateFullState(payload as any);
    expect(valid).toBe(false);
    expect(validateFullState.errors?.some((e: any) => e.message?.includes('must be number'))).toBe(true);
  });

  it('should reject unknown top-level properties', () => {
    const payload = {
      timestamp: 1773349200000,
      signals: { 'assembly_00_pos_x': 0.0 },
      unknown_field: 'illegal'
    };
    const valid = validateFullState(payload as any);
    expect(valid).toBe(false);
  });
});

describe('Compact Delta Packet Contract', () => {
  it('should validate a valid compact delta packet with tuples', () => {
    const payload: DeltaPacketPayload = {
      timestamp: 1773349200010,
      seq: 1042,
      deltas: [
        ['assembly_01_rot_qy', 0.707106],
        ['assembly_02_temp_bearing_01', 42.5]
      ]
    };

    const valid = validateDeltaPacket(payload);
    expect(valid).toBe(true);
    expect(validateDeltaPacket.errors).toBeNull();
  });

  it('should validate a heartbeat delta packet with zero deltas', () => {
    const payload: DeltaPacketPayload = {
      timestamp: 1773349200020,
      seq: 1043,
      deltas: []
    };

    const valid = validateDeltaPacket(payload);
    expect(valid).toBe(true);
    expect(validateDeltaPacket.errors).toBeNull();
  });

  it('should reject a delta packet with negative or non-integer sequence number', () => {
    const payload = {
      timestamp: 1773349200020,
      seq: -1,
      deltas: []
    };
    const valid = validateDeltaPacket(payload as any);
    expect(valid).toBe(false);
  });

  it('should reject malformed tuple structures with fewer or more than 2 elements', () => {
    const payloadSingle = {
      timestamp: 1773349200020,
      seq: 1,
      deltas: [['only_channel_id']]
    };
    expect(validateDeltaPacket(payloadSingle as any)).toBe(false);

    const payloadTriple = {
      timestamp: 1773349200020,
      seq: 2,
      deltas: [['channel_id', 1.0, 'extra_third_element']]
    };
    expect(validateDeltaPacket(payloadTriple as any)).toBe(false);
  });

  it('should reject inverted tuple data types [number, string]', () => {
    const payload = {
      timestamp: 1773349200020,
      seq: 1,
      deltas: [[12345, 'wrong_value_order']]
    };
    expect(validateDeltaPacket(payload as any)).toBe(false);
  });
});

describe('Telemetry Layout Metadata Integrity', () => {
  it('should have exactly 10 assemblies and 1,000 unique channels', () => {
    expect(layout.assemblies).toHaveLength(10);
    expect(layout.channels).toHaveLength(1000);

    const uniqueIds = new Set(layout.channels.map(c => c.channel_id));
    expect(uniqueIds.size).toBe(1000);
  });

  it('should assign exactly 100 channels to each assembly', () => {
    for (const asm of layout.assemblies) {
      const asmChannels = layout.channels.filter(c => c.assembly_id === asm.assembly_id);
      expect(asmChannels).toHaveLength(100);

      const kinematicPos = asmChannels.filter(c => c.signal_type === 'kinematic_pos');
      const kinematicRot = asmChannels.filter(c => c.signal_type === 'kinematic_rot');
      const scalarSensors = asmChannels.filter(c => c.signal_type === 'scalar_sensor');

      expect(kinematicPos).toHaveLength(3);
      expect(kinematicRot).toHaveLength(4);
      expect(scalarSensors).toHaveLength(93);
    }
  });

  it('should verify all channels have positive deadband thresholds and valid ranges', () => {
    for (const channel of layout.channels) {
      expect(channel.deadband_threshold).toBeGreaterThan(0);
      expect(channel.max_expected).toBeGreaterThan(channel.min_expected);
      expect(channel.unit).toBeTruthy();
    }
  });
});
