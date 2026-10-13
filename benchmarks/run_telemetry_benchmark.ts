import { fileURLToPath } from 'node:url';
import { PhysicsEngine } from '../simulator/physics_engine.js';
import { DeltaCompressor } from '../gateway/delta_compressor.js';
import type { FullStatePayload } from '../schema/types.js';

export interface ModeMetrics {
  packetCount: number;
  totalBytes: number;
  avgPacketBytes: number;
  throughputKBps: number;
  totalParseTimeUs: number;
  avgParseTimeUs: number;
  frameBudgetPercent: number; // Percentage of 16.67 ms (60 FPS) frame budget
}

export interface BenchmarkReport {
  durationSeconds: number;
  simulationTicks: number;
  broadcastTicks: number;
  channelCount: number;
  deadbandEpsilon: number;
  monolithic: ModeMetrics;
  decoupled: ModeMetrics;
  reduction: {
    bandwidthPercent: number;
    payloadRatio: number;
    parseSpeedup: number;
    frameBudgetGainPercent: number;
  };
}

export interface BenchmarkOptions {
  simulationDurationSeconds?: number;
  simHz?: number;
  broadcastHz?: number;
  deadband?: number;
  silent?: boolean;
  quiescent?: boolean;
}

/**
 * Runs a comparative empirical benchmark comparing Monolithic Full-State Streaming
 * against Decoupled Deadband Delta Compression across 1,000 telemetry channels.
 */
export function runTelemetryBenchmark(options: BenchmarkOptions = {}): BenchmarkReport {
  const durationSeconds = options.simulationDurationSeconds ?? 5.0;
  const simHz = options.simHz ?? 100;
  const broadcastHz = options.broadcastHz ?? 60;
  const deadband = options.deadband ?? 0.001;
  const silent = options.silent ?? false;
  const quiescent = options.quiescent ?? false;

  const totalSimTicks = Math.round(durationSeconds * simHz);
  const totalBroadcastTicks = Math.round(durationSeconds * broadcastHz);

  const engine = new PhysicsEngine({ tickRateHz: simHz });
  const compressor = new DeltaCompressor({ defaultThreshold: deadband });

  // Mode accumulators
  let monoBytes = 0;
  let monoParseTimeNs = 0n;
  let monoPackets = 0;

  let decoupledBytes = 0;
  let decoupledParseTimeNs = 0n;
  let decoupledPackets = 0;

  let channelCount = 1000;

  // Execute benchmark sampling loop
  for (let b = 0; b < totalBroadcastTicks; b++) {
    const timeSec = b / broadcastHz;
    // Calculate corresponding physics simulation tick
    const simTick = quiescent ? 0 : Math.floor(timeSec * simHz);

    // Evaluate physics deterministically
    engine.evaluatePhysics(simTick);
    const state: FullStatePayload = engine.getCurrentState();
    channelCount = Object.keys(state.signals).length;

    // --- Mode A: Monolithic Full-State Broadcast ---
    const monoPayload = JSON.stringify(state);
    const monoByteLen = Buffer.byteLength(monoPayload, 'utf-8');
    monoBytes += monoByteLen;
    monoPackets++;

    // Benchmark V8 JSON deserialization cost
    const t0Mono = process.hrtime.bigint();
    JSON.parse(monoPayload);
    const t1Mono = process.hrtime.bigint();
    monoParseTimeNs += t1Mono - t0Mono;

    // --- Mode B: Decoupled Deadband Delta Compression ---
    let decoupledPayloadStr: string;
    if (b === 0) {
      // Initial handshake: full snapshot to prime client state
      const snapshot = compressor.getFullSnapshot(state);
      decoupledPayloadStr = JSON.stringify(snapshot);
    } else {
      // Incremental broadcast: compressed delta packet
      const deltaPacket = compressor.compress(state);
      decoupledPayloadStr = JSON.stringify(deltaPacket ?? { timestamp: state.timestamp, seq: b + 1, deltas: [] });
    }

    const decoupledByteLen = Buffer.byteLength(decoupledPayloadStr, 'utf-8');
    decoupledBytes += decoupledByteLen;
    decoupledPackets++;

    // Benchmark V8 JSON deserialization cost
    const t0Dec = process.hrtime.bigint();
    JSON.parse(decoupledPayloadStr);
    const t1Dec = process.hrtime.bigint();
    decoupledParseTimeNs += t1Dec - t0Dec;
  }

  // Calculate Metrics
  const FRAME_BUDGET_US = 16_666.67; // 16.67 ms frame budget for 60 FPS

  const monoAvgPacketBytes = monoBytes / monoPackets;
  const monoThroughputKBps = (monoBytes / 1024) / durationSeconds;
  const monoTotalParseUs = Number(monoParseTimeNs) / 1000;
  const monoAvgParseUs = monoTotalParseUs / monoPackets;
  const monoBudgetPct = (monoAvgParseUs / FRAME_BUDGET_US) * 100;

  const decoupledAvgPacketBytes = decoupledBytes / decoupledPackets;
  const decoupledThroughputKBps = (decoupledBytes / 1024) / durationSeconds;
  const decoupledTotalParseUs = Number(decoupledParseTimeNs) / 1000;
  const decoupledAvgParseUs = decoupledTotalParseUs / decoupledPackets;
  const decoupledBudgetPct = (decoupledAvgParseUs / FRAME_BUDGET_US) * 100;

  const bandwidthReductionPct = ((monoBytes - decoupledBytes) / monoBytes) * 100;
  const payloadRatio = monoBytes / decoupledBytes;
  const parseSpeedup = monoAvgParseUs / decoupledAvgParseUs;
  const budgetGainPct = monoBudgetPct - decoupledBudgetPct;

  const report: BenchmarkReport = {
    durationSeconds,
    simulationTicks: totalSimTicks,
    broadcastTicks: totalBroadcastTicks,
    channelCount,
    deadbandEpsilon: deadband,
    monolithic: {
      packetCount: monoPackets,
      totalBytes: monoBytes,
      avgPacketBytes: Math.round(monoAvgPacketBytes),
      throughputKBps: Math.round(monoThroughputKBps * 100) / 100,
      totalParseTimeUs: Math.round(monoTotalParseUs),
      avgParseTimeUs: Math.round(monoAvgParseUs * 10) / 10,
      frameBudgetPercent: Math.round(monoBudgetPct * 100) / 100
    },
    decoupled: {
      packetCount: decoupledPackets,
      totalBytes: decoupledBytes,
      avgPacketBytes: Math.round(decoupledAvgPacketBytes),
      throughputKBps: Math.round(decoupledThroughputKBps * 100) / 100,
      totalParseTimeUs: Math.round(decoupledTotalParseUs),
      avgParseTimeUs: Math.round(decoupledAvgParseUs * 10) / 10,
      frameBudgetPercent: Math.round(decoupledBudgetPct * 100) / 100
    },
    reduction: {
      bandwidthPercent: Math.round(bandwidthReductionPct * 100) / 100,
      payloadRatio: Math.round(payloadRatio * 10) / 10,
      parseSpeedup: Math.round(parseSpeedup * 10) / 10,
      frameBudgetGainPercent: Math.round(budgetGainPct * 100) / 100
    }
  };

  if (!silent) {
    printBenchmarkTable(report);
  }

  return report;
}

/**
 * Renders a formatted comparison table to standard output.
 */
export function printBenchmarkTable(report: BenchmarkReport): void {
  console.log('\n=========================================================================================');
  console.log('      3D DIGITAL TWIN TELEMETRY STREAMING BENCHMARK: MONOLITHIC VS. DECOUPLED DELTA      ');
  console.log('=========================================================================================');
  console.log(` Duration: ${report.durationSeconds.toFixed(1)} s | Sim: 100 Hz (${report.simulationTicks} ticks) | Broadcast: 60 Hz (${report.broadcastTicks} frames) | Channels: ${report.channelCount} | Deadband ε: ${report.deadbandEpsilon}`);
  console.log('-----------------------------------------------------------------------------------------');
  console.log(
    ' Metric'.padEnd(35) +
    ' Monolithic (Full-State)'.padEnd(26) +
    ' Decoupled (Delta ε=0.001)'.padEnd(28) +
    ' Improvement'
  );
  console.log('-----------------------------------------------------------------------------------------');

  const formatKB = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
  const formatMB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

  console.log(
    ' Total Transmitted Volume'.padEnd(35) +
    formatMB(report.monolithic.totalBytes).padEnd(26) +
    formatMB(report.decoupled.totalBytes).padEnd(28) +
    `-${report.reduction.bandwidthPercent}% (${report.reduction.payloadRatio}x smaller)`
  );

  console.log(
    ' Average Packet Size'.padEnd(35) +
    formatKB(report.monolithic.avgPacketBytes).padEnd(26) +
    formatKB(report.decoupled.avgPacketBytes).padEnd(28) +
    `-${report.reduction.bandwidthPercent}%`
  );

  console.log(
    ' Network Throughput'.padEnd(35) +
    `${report.monolithic.throughputKBps.toFixed(1)} KB/s`.padEnd(26) +
    `${report.decoupled.throughputKBps.toFixed(1)} KB/s`.padEnd(28) +
    `-${report.reduction.bandwidthPercent}%`
  );

  console.log(
    ' Client V8 Parse Latency (avg)'.padEnd(35) +
    `${report.monolithic.avgParseTimeUs.toFixed(1)} µs`.padEnd(26) +
    `${report.decoupled.avgParseTimeUs.toFixed(1)} µs`.padEnd(28) +
    `${report.reduction.parseSpeedup}x faster`
  );

  console.log(
    ' 60 FPS Frame Budget Consumed'.padEnd(35) +
    `${report.monolithic.frameBudgetPercent.toFixed(2)}%`.padEnd(26) +
    `${report.decoupled.frameBudgetPercent.toFixed(2)}%`.padEnd(28) +
    `+${report.reduction.frameBudgetGainPercent.toFixed(2)}% headroom`
  );

  console.log('=========================================================================================\n');
}

// Standalone execution entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isQuiescent = process.argv.includes('--quiescent');
  const durationArg = process.argv.find(a => a.startsWith('--duration='));
  const duration = durationArg ? parseFloat(durationArg.split('=')[1]) : 5.0;

  console.log(`[Benchmark] Starting telemetry stream benchmark (Duration: ${duration}s, Quiescent: ${isQuiescent})...`);
  runTelemetryBenchmark({
    simulationDurationSeconds: duration,
    quiescent: isQuiescent
  });
}
