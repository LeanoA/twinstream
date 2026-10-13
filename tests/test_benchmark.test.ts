import { describe, it, expect } from 'vitest';
import { runTelemetryBenchmark } from '../benchmarks/run_telemetry_benchmark.js';

describe('Phase 6: Telemetry Benchmarking Suite', () => {
  it('should return a well-formed BenchmarkReport structure with complete metrics', () => {
    const report = runTelemetryBenchmark({
      simulationDurationSeconds: 1.0,
      simHz: 100,
      broadcastHz: 60,
      deadband: 0.001,
      silent: true
    });

    expect(report.durationSeconds).toBe(1.0);
    expect(report.simulationTicks).toBe(100);
    expect(report.broadcastTicks).toBe(60);
    expect(report.channelCount).toBe(1000);
    expect(report.deadbandEpsilon).toBe(0.001);

    // Monolithic metrics
    expect(report.monolithic.packetCount).toBe(60);
    expect(report.monolithic.totalBytes).toBeGreaterThan(0);
    expect(report.monolithic.avgPacketBytes).toBeGreaterThan(30_000); // ~40-50 KB
    expect(report.monolithic.throughputKBps).toBeGreaterThan(1_500); // > 1.5 MB/s
    expect(report.monolithic.avgParseTimeUs).toBeGreaterThan(0);

    // Decoupled metrics
    expect(report.decoupled.packetCount).toBe(60);
    expect(report.decoupled.totalBytes).toBeGreaterThan(0);
    expect(report.decoupled.avgPacketBytes).toBeLessThan(report.monolithic.avgPacketBytes);
    expect(report.decoupled.throughputKBps).toBeLessThan(report.monolithic.throughputKBps);

    // Reduction metrics
    expect(report.reduction.bandwidthPercent).toBeGreaterThan(0);
    expect(report.reduction.payloadRatio).toBeGreaterThan(1);
    expect(report.reduction.parseSpeedup).toBeGreaterThan(1);
  });

  it('should achieve >= 75% bandwidth reduction under continuous dynamic multi-joint motion', () => {
    const report = runTelemetryBenchmark({
      simulationDurationSeconds: 2.0,
      simHz: 100,
      broadcastHz: 60,
      deadband: 0.001,
      silent: true
    });

    // In normal dynamic operation with sinusoidal joint motions and sensor noise,
    // delta compression eliminates inactive joints and invariant sensor signals.
    expect(report.reduction.bandwidthPercent).toBeGreaterThanOrEqual(75.0);
    expect(report.reduction.payloadRatio).toBeGreaterThanOrEqual(4.0);
    expect(report.decoupled.avgPacketBytes).toBeLessThan(12_000);
  });

  it('should achieve >= 99% bandwidth reduction under quiescent (zero-motion) simulation', () => {
    const report = runTelemetryBenchmark({
      simulationDurationSeconds: 2.0,
      simHz: 100,
      broadcastHz: 60,
      deadband: 0.001,
      silent: true,
      quiescent: true
    });

    // In stationary state, only the initial handshake packet carries state.
    // Subsequent broadcast frames emit empty deltas, eliminating wire volume.
    expect(report.reduction.bandwidthPercent).toBeGreaterThanOrEqual(99.0);
    expect(report.reduction.payloadRatio).toBeGreaterThanOrEqual(100.0);
    expect(report.decoupled.throughputKBps).toBeLessThan(50); // < 50 KB/s
  });

  it('should demonstrate >= 3x faster client V8 JSON parsing latency for delta packets', () => {
    const report = runTelemetryBenchmark({
      simulationDurationSeconds: 2.0,
      simHz: 100,
      broadcastHz: 60,
      deadband: 0.001,
      silent: true
    });

    // Parsing compact 2-element tuples [[channel_id, val], ...] is significantly lighter
    // for V8 than parsing a 1,000-key nested object tree.
    expect(report.reduction.parseSpeedup).toBeGreaterThanOrEqual(3.0);
    expect(report.decoupled.avgParseTimeUs).toBeLessThan(report.monolithic.avgParseTimeUs);
  });

  it('should verify frame budget consumption remains negligible (< 0.5%) in decoupled mode', () => {
    const report = runTelemetryBenchmark({
      simulationDurationSeconds: 2.0,
      simHz: 100,
      broadcastHz: 60,
      deadband: 0.001,
      silent: true
    });

    // Decoupled parsing must consume less than 0.5% of the 16.67 ms (60 FPS) frame budget
    expect(report.decoupled.frameBudgetPercent).toBeLessThan(0.5);
    expect(report.reduction.frameBudgetGainPercent).toBeGreaterThan(0.5);
  });
});
