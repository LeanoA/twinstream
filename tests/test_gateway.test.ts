import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

import { DeltaCompressor } from '../gateway/delta_compressor.js';
import { TelemetryServer } from '../gateway/telemetry_server.js';
import { PhysicsEngine } from '../simulator/physics_engine.js';
import type { FullStatePayload, DeltaPacketPayload } from '../schema/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const fullStateSchema = JSON.parse(fs.readFileSync(path.join(rootDir, 'schema/full_state.schema.json'), 'utf-8'));
const deltaPacketSchema = JSON.parse(fs.readFileSync(path.join(rootDir, 'schema/delta_packet.schema.json'), 'utf-8'));

const Ajv2020Constructor: any = (Ajv2020Module as any).default || Ajv2020Module;
const addFormatsFn: any = (addFormatsModule as any).default || addFormatsModule;
const ajv = new Ajv2020Constructor({ allErrors: true, strict: false });
addFormatsFn(ajv);

const validateFullState = ajv.compile(fullStateSchema);
const validateDeltaPacket = ajv.compile(deltaPacketSchema);

describe('DeltaCompressor Unit Tests', () => {
  it('should filter changes by deadband threshold and emit compact tuple deltas', () => {
    const compressor = new DeltaCompressor({ defaultThreshold: 0.001 });

    const state1: FullStatePayload = {
      timestamp: 1000,
      signals: {
        'assembly_00_pos_x': 1.0,
        'assembly_00_pos_y': 2.0,
        'assembly_00_temp_01': 45.0
      }
    };

    // First frame initializes baseline: all channels emitted
    const packet1 = compressor.compress(state1);
    expect(packet1).not.toBeNull();
    expect(packet1!.seq).toBe(1);
    expect(packet1!.deltas.length).toBe(3);
    expect(validateDeltaPacket(packet1)).toBe(true);

    // Second frame: pos_x changes by 0.005 (> 0.001), pos_y changes by 0.0002 (<= 0.001), temp unchanged
    const state2: FullStatePayload = {
      timestamp: 1010,
      signals: {
        'assembly_00_pos_x': 1.005,
        'assembly_00_pos_y': 2.0002,
        'assembly_00_temp_01': 45.0
      }
    };

    const packet2 = compressor.compress(state2);
    expect(packet2).not.toBeNull();
    expect(packet2!.seq).toBe(2);
    expect(packet2!.deltas.length).toBe(1);
    expect(packet2!.deltas[0]).toEqual(['assembly_00_pos_x', 1.005]);
    expect(validateDeltaPacket(packet2)).toBe(true);
  });

  it('should suppress numerical micro-noise below threshold', () => {
    const compressor = new DeltaCompressor({ defaultThreshold: 0.01 });

    compressor.compress({
      timestamp: 1000,
      signals: { sensor_a: 10.0 }
    });

    // 50 iterations with micro-noise (< 1e-4)
    for (let i = 1; i <= 50; i++) {
      const p = compressor.compress({
        timestamp: 1000 + i * 10,
        signals: { sensor_a: 10.0 + (Math.sin(i) * 0.001) }
      });
      expect(p!.deltas.length).toBe(0);
    }
  });

  it('should generate valid full-state snapshots conforming to schema', () => {
    const compressor = new DeltaCompressor({ defaultThreshold: 0.001 });
    const state: FullStatePayload = {
      timestamp: 2000,
      signals: {
        ch_01: 100.5,
        ch_02: 200.2
      }
    };

    const snapshot = compressor.getFullSnapshot(state);
    expect(snapshot.signals).toEqual(state.signals);
    expect(validateFullState(snapshot)).toBe(true);
  });
});

describe('TelemetryServer WebSocket Integration & 5 Mock Clients', () => {
  let server: TelemetryServer;
  let engine: PhysicsEngine;
  let serverPort: number;

  beforeAll(async () => {
    engine = new PhysicsEngine({ tickRateHz: 100 });
    server = new TelemetryServer({
      port: 0, // OS assigns an ephemeral port
      broadcastRateHz: 60,
      deadbandThreshold: 0.001,
      engine
    });

    await server.start();
    engine.start();
    serverPort = server.getPort();
  });

  afterAll(async () => {
    engine.stop();
    await server.stop();
  });

  it('should connect 5 concurrent clients, deliver initial full snapshot, and stream deltas', async () => {
    const clientCount = 5;
    const clients: WebSocket[] = [];
    const receivedSnapshots: FullStatePayload[] = [];
    const receivedDeltas: DeltaPacketPayload[][] = Array.from({ length: clientCount }, () => []);

    // Connect 5 concurrent WebSocket clients
    await new Promise<void>((resolve, reject) => {
      let connected = 0;
      for (let i = 0; i < clientCount; i++) {
        const ws = new WebSocket(`ws://127.0.0.1:${serverPort}`);
        clients.push(ws);

        ws.on('open', () => {
          connected++;
          if (connected === clientCount) {
            resolve();
          }
        });

        ws.on('error', (err) => reject(err));

        ws.on('message', (data: Buffer) => {
          const parsed = JSON.parse(data.toString('utf-8'));
          if ('signals' in parsed) {
            receivedSnapshots.push(parsed as FullStatePayload);
          } else if ('deltas' in parsed) {
            receivedDeltas[i].push(parsed as DeltaPacketPayload);
          }
        });
      }
    });

    expect(server.getConnectedClientCount()).toBe(clientCount);

    // Wait 500 ms for initial snapshots and stream flow
    await new Promise((r) => setTimeout(r, 500));

    // Assert every client received the initial full-state snapshot
    expect(receivedSnapshots.length).toBeGreaterThanOrEqual(clientCount);
    for (const snap of receivedSnapshots) {
      expect(validateFullState(snap)).toBe(true);
      expect(Object.keys(snap.signals).length).toBe(1000);
    }

    // Assert every client received streaming delta packets
    for (let i = 0; i < clientCount; i++) {
      expect(receivedDeltas[i].length).toBeGreaterThan(5);
      const firstDelta = receivedDeltas[i][0];
      expect(validateDeltaPacket(firstDelta)).toBe(true);
      expect(firstDelta.seq).toBeGreaterThan(0);
    }

    // Teardown clients cleanly
    for (const ws of clients) {
      ws.close();
    }
  });

  it('should verify > 75% bandwidth reduction under steady-state broadcast across 100 frames', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}`);
    let initialSnapshotReceived = false;
    let fullSnapshotBytes = 0;
    let totalDeltaBytes = 0;
    let deltaFramesReceived = 0;
    const targetFrames = 60; // ~1 second of 60 Hz broadcast

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {});
      ws.on('error', reject);

      ws.on('message', (data: Buffer) => {
        const rawStr = data.toString('utf-8');
        const parsed = JSON.parse(rawStr);

        if (!initialSnapshotReceived && 'signals' in parsed) {
          initialSnapshotReceived = true;
          fullSnapshotBytes = rawStr.length;
        } else if ('deltas' in parsed) {
          totalDeltaBytes += rawStr.length;
          deltaFramesReceived++;

          if (deltaFramesReceived >= targetFrames) {
            resolve();
          }
        }
      });
    });

    ws.close();

    // Hypothetical uncompressed streaming byte total = targetFrames * fullSnapshotBytes
    const uncompressedTotalBytes = targetFrames * fullSnapshotBytes;
    const bandwidthReduction = 1 - (totalDeltaBytes / uncompressedTotalBytes);
    const reductionPercent = (bandwidthReduction * 100).toFixed(2);

    console.log(`\n[Bandwidth Benchmark] Frames: ${deltaFramesReceived}`);
    console.log(`  Full Snapshot Size: ${(fullSnapshotBytes / 1024).toFixed(2)} KB`);
    console.log(`  Average Delta Frame Size: ${(totalDeltaBytes / deltaFramesReceived / 1024).toFixed(2)} KB`);
    console.log(`  Total Delta Stream Bytes: ${(totalDeltaBytes / 1024).toFixed(2)} KB`);
    console.log(`  Total Uncompressed Equivalent: ${(uncompressedTotalBytes / 1024).toFixed(2)} KB`);
    console.log(`  Observed Bandwidth Reduction: ${reductionPercent}%\n`);

    // Invariant requirement: reduction MUST be strictly > 75%
    expect(bandwidthReduction).toBeGreaterThan(0.75);
  });
});
