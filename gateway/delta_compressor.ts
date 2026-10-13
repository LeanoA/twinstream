import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FullStatePayload, DeltaPacketPayload, DeltaTuple, TelemetryLayout } from '../schema/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultLayoutPath = path.resolve(__dirname, '../data/mock_telemetry_layout.json');

export interface DeltaCompressorOptions {
  /** Default deadband threshold |Δs_i| > ε (default: 0.001) */
  defaultThreshold?: number;
  /** Explicit per-channel threshold overrides */
  channelThresholds?: Record<string, number>;
  /** If true, returns null when zero channels exceed deadband (default: false) */
  suppressEmptyPackets?: boolean;
  /** Optional path to mock_telemetry_layout.json to read per-channel deadbands */
  layoutPath?: string;
}

/**
 * High-performance Deadband Delta Compressor.
 * Filters invariant or micro-fluctuating telemetry channels below a deadband threshold ε,
 * serializing changes into compact 2-element tuples [[channel_id, value], ...].
 */
export class DeltaCompressor {
  private defaultThreshold: number;
  private channelThresholds: Map<string, number> = new Map();
  private suppressEmptyPackets: boolean;
  private lastSentState: Map<string, number> = new Map();
  private seq = 0;

  constructor(options: DeltaCompressorOptions = {}) {
    this.defaultThreshold = options.defaultThreshold ?? 0.001;
    this.suppressEmptyPackets = options.suppressEmptyPackets ?? false;

    const resolvedLayoutPath = options.layoutPath ?? (fs.existsSync(defaultLayoutPath) ? defaultLayoutPath : undefined);

    // Load layout deadband definitions if available
    if (resolvedLayoutPath && fs.existsSync(resolvedLayoutPath)) {
      try {
        const layout: TelemetryLayout = JSON.parse(fs.readFileSync(resolvedLayoutPath, 'utf-8'));
        if (Array.isArray(layout.channels)) {
          for (const ch of layout.channels) {
            if (typeof ch.deadband_threshold === 'number') {
              this.channelThresholds.set(ch.channel_id, ch.deadband_threshold);
            }
          }
        }
      } catch {
        // Fall back to default threshold on parse error
      }
    }

    // Apply explicit per-channel overrides
    if (options.channelThresholds) {
      for (const [chId, thresh] of Object.entries(options.channelThresholds)) {
        this.channelThresholds.set(chId, thresh);
      }
    }
  }

  /**
   * Compares the incoming state against the cached last-sent state.
   * Emits a compact delta packet containing only channels exceeding the deadband threshold.
   */
  public compress(state: FullStatePayload): DeltaPacketPayload | null {
    const deltas: DeltaTuple[] = [];
    const signals = state.signals;

    for (const [channelId, val] of Object.entries(signals)) {
      const prevVal = this.lastSentState.get(channelId);
      const threshold = this.channelThresholds.get(channelId) ?? this.defaultThreshold;

      // Unseen channel or delta exceeds deadband threshold
      if (prevVal === undefined || Math.abs(val - prevVal) > threshold) {
        deltas.push([channelId, val]);
        this.lastSentState.set(channelId, val);
      }
    }

    if (deltas.length === 0 && this.suppressEmptyPackets) {
      return null;
    }

    this.seq++;
    return {
      timestamp: state.timestamp,
      seq: this.seq,
      deltas
    };
  }

  /**
   * Generates or synchronizes a full state snapshot conforming to schema/full_state.schema.json.
   * Updates internal cache so subsequent compress calls emit deltas relative to this state.
   */
  public getFullSnapshot(state?: FullStatePayload): FullStatePayload {
    if (state) {
      for (const [channelId, val] of Object.entries(state.signals)) {
        this.lastSentState.set(channelId, val);
      }
      return {
        timestamp: state.timestamp,
        signals: { ...state.signals },
        metadata: {
          seq: this.seq,
          channelCount: Object.keys(state.signals).length,
          ...state.metadata
        }
      };
    }

    // Synthesize snapshot from cached state
    const signalsObj: Record<string, number> = {};
    for (const [channelId, val] of this.lastSentState.entries()) {
      signalsObj[channelId] = val;
    }

    return {
      timestamp: Date.now(),
      signals: signalsObj,
      metadata: {
        seq: this.seq,
        channelCount: this.lastSentState.size
      }
    };
  }

  /**
   * Resets the compressor sequence and cached state.
   */
  public reset(initialState?: FullStatePayload): void {
    this.seq = 0;
    this.lastSentState.clear();

    if (initialState) {
      for (const [channelId, val] of Object.entries(initialState.signals)) {
        this.lastSentState.set(channelId, val);
      }
    }
  }

  /**
   * Returns current sequence number.
   */
  public getSequence(): number {
    return this.seq;
  }

  /**
   * Returns a copy of the last acknowledged state.
   */
  public getLastAcknowledgedState(): Record<string, number> {
    const res: Record<string, number> = {};
    for (const [k, v] of this.lastSentState.entries()) {
      res[k] = v;
    }
    return res;
  }

  /**
   * Returns count of tracked channels.
   */
  public getTrackedChannelCount(): number {
    return this.lastSentState.size;
  }
}
