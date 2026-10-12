import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { PhysicsEngine } from '../simulator/physics_engine.js';
import type { FullStatePayload, TelemetryLayout } from '../schema/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const fullStateSchema = JSON.parse(fs.readFileSync(path.join(rootDir, 'schema/full_state.schema.json'), 'utf-8'));
const layout: TelemetryLayout = JSON.parse(fs.readFileSync(path.join(rootDir, 'data/mock_telemetry_layout.json'), 'utf-8'));

const Ajv2020Constructor: any = (Ajv2020Module as any).default || Ajv2020Module;
const addFormatsFn: any = (addFormatsModule as any).default || addFormatsModule;

const ajv = new Ajv2020Constructor({ allErrors: true, strict: false });
addFormatsFn(ajv);
const validateFullState: any = ajv.compile(fullStateSchema);

describe('PhysicsEngine Lifecycle & Schema Compliance', () => {
  it('should initialize and report correct initial state', () => {
    const engine = new PhysicsEngine({ tickRateHz: 100 });
    expect(engine.isRunning()).toBe(false);

    const initial = engine.getCurrentState();
    expect(initial.signals).toBeDefined();
    expect(Object.keys(initial.signals)).toHaveLength(1000);
    expect(validateFullState(initial)).toBe(true);
  });

  it('should start, emit ticks to subscriber, and stop cleanly', async () => {
    const engine = new PhysicsEngine({ tickRateHz: 100 });
    const received: FullStatePayload[] = [];

    const unsubscribe = engine.onTick((payload) => {
      received.push(payload);
    });

    engine.start();
    expect(engine.isRunning()).toBe(true);

    // Await at least 5 ticks deterministically
    await new Promise<void>((resolve) => {
      let count = 0;
      const un = engine.onTick(() => {
        count++;
        if (count >= 5) {
          un();
          resolve();
        }
      });
    });

    engine.stop();
    expect(engine.isRunning()).toBe(false);
    const countAtStop = received.length;

    // Wait another 40 ms to assert no ghost ticks fire after stop()
    await new Promise((r) => setTimeout(r, 40));
    expect(received.length).toBe(countAtStop);
    expect(countAtStop).toBeGreaterThanOrEqual(5);

    unsubscribe();
  });
});

describe('Forward Kinematics & Physical Bounds', () => {
  it('should maintain unit quaternion normalization ||q|| = 1.0 across all assemblies', () => {
    const engine = new PhysicsEngine({ tickRateHz: 100 });

    // Sample across 200 simulation ticks (2 seconds)
    for (let tick = 0; tick < 200; tick++) {
      engine.evaluatePhysics(tick);
      const state = engine.getCurrentState();

      for (const asm of layout.assemblies) {
        const aid = asm.assembly_id;
        const qx = state.signals[`${aid}_rot_qx`];
        const qy = state.signals[`${aid}_rot_qy`];
        const qz = state.signals[`${aid}_rot_qz`];
        const qw = state.signals[`${aid}_rot_qw`];

        expect(qx).toBeDefined();
        expect(qy).toBeDefined();
        expect(qz).toBeDefined();
        expect(qw).toBeDefined();

        const norm = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
        expect(norm).toBeCloseTo(1.0, 4); // ||q|| = 1.0 ± 1e-4
      }
    }
  });

  it('should enforce that 100% of 1,000 signals stay strictly within [min_expected, max_expected]', () => {
    const engine = new PhysicsEngine({ tickRateHz: 100 });

    for (let tick = 0; tick < 100; tick++) {
      engine.evaluatePhysics(tick);
      const state = engine.getCurrentState();

      for (const ch of layout.channels) {
        const val = state.signals[ch.channel_id];
        expect(Number.isFinite(val)).toBe(true);
        expect(val).toBeGreaterThanOrEqual(ch.min_expected);
        expect(val).toBeLessThanOrEqual(ch.max_expected);
      }
    }
  });

  it('should verify smooth spatial continuity without teleportation jumps', () => {
    const engine = new PhysicsEngine({ tickRateHz: 100 });
    engine.evaluatePhysics(0);
    let prevState = engine.getCurrentState();

    for (let tick = 1; tick <= 50; tick++) {
      engine.evaluatePhysics(tick);
      const currState = engine.getCurrentState();

      for (const asm of layout.assemblies) {
        const aid = asm.assembly_id;
        const dx = Math.abs(currState.signals[`${aid}_pos_x`] - prevState.signals[`${aid}_pos_x`]);
        const dy = Math.abs(currState.signals[`${aid}_pos_y`] - prevState.signals[`${aid}_pos_y`]);
        const dz = Math.abs(currState.signals[`${aid}_pos_z`] - prevState.signals[`${aid}_pos_z`]);

        // Displacement per 10 ms tick must be physical and continuous (< 0.2 meters/tick)
        expect(dx).toBeLessThan(0.2);
        expect(dy).toBeLessThan(0.2);
        expect(dz).toBeLessThan(0.2);
      }

      prevState = currState;
    }
  });
});

describe('100 Hz Timer Precision & Jitter Tolerance (500 Ticks / 5 Seconds)', () => {
  it('should maintain 10 ms ± 2 ms tick interval with minimal drift over 500 ticks', async () => {
    const engine = new PhysicsEngine({ tickRateHz: 100 });
    const targetTicks = 500;

    await new Promise<void>((resolve) => {
      engine.onTick(() => {
        if (engine.getMetrics().tickCount >= targetTicks) {
          engine.stop();
          resolve();
        }
      });
      engine.start();
    });

    const metrics = engine.getMetrics();
    console.log(`\n[Test 100 Hz Results] Ticks: ${metrics.tickCount} | Elapsed: ${metrics.elapsedMs.toFixed(1)} ms | Mean Period: ${metrics.meanIntervalMs.toFixed(3)} ms | StdDev: ${metrics.stdDevIntervalMs.toFixed(3)} ms | Cumulative Drift: ${metrics.cumulativeDriftMs.toFixed(2)} ms`);

    expect(metrics.tickCount).toBeGreaterThanOrEqual(targetTicks);

    // Average interval must be 10 ms ± 2 ms (between 8.0 ms and 12.0 ms)
    expect(metrics.meanIntervalMs).toBeGreaterThanOrEqual(8.0);
    expect(metrics.meanIntervalMs).toBeLessThanOrEqual(12.0);

    // Standard deviation should be tight (< 4 ms)
    expect(metrics.stdDevIntervalMs).toBeLessThan(4.0);

    // Cumulative timer drift across 5 seconds (5000 ms) must be < 50 ms
    expect(metrics.cumulativeDriftMs).toBeLessThan(50.0);
  }, 10000); // 10 second timeout for 5-second simulation run
});
