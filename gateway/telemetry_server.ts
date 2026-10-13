import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { DeltaCompressor } from './delta_compressor.js';
import type { PhysicsEngine } from '../simulator/physics_engine.js';
import type { FullStatePayload, DeltaPacketPayload } from '../schema/types.js';

export interface TelemetryServerOptions {
  /** WebSocket port (default: 8080) */
  port?: number;
  /** Host interface (default: '0.0.0.0') */
  host?: string;
  /** Paced broadcast frequency in Hz (default: 60) */
  broadcastRateHz?: number;
  /** Deadband threshold for delta compressor (default: 0.001) */
  deadbandThreshold?: number;
  /** Buffer limit in bytes to detect slow consumers and drop frames (default: 64 KB = 65,536) */
  backpressureThresholdBytes?: number;
  /** Optional PhysicsEngine instance to attach immediately */
  engine?: PhysicsEngine;
}

export interface GatewayMetrics {
  connectedClients: number;
  totalBytesSent: number;
  uncompressedBytesEstimated: number;
  fullSnapshotsSent: number;
  deltaPacketsSent: number;
  droppedFrames: number;
  broadcastTicks: number;
  compressionRatio: number;
}

/**
 * High-Frequency Telemetry WebSocket Gateway.
 * Bridges continuous 100 Hz physics simulation with multi-client WebGL consumers,
 * providing deadband delta compression, initial state handshakes, 60 Hz pacing,
 * and memory-safe backpressure management.
 */
export class TelemetryServer {
  private port: number;
  private host: string;
  private broadcastRateHz: number;
  private backpressureThresholdBytes: number;

  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private compressor: DeltaCompressor;

  private engine: PhysicsEngine | null = null;
  private unsubscribeEngine: (() => void) | null = null;
  private latestState: FullStatePayload | null = null;

  private broadcastTimer: NodeJS.Timeout | null = null;

  private metrics: GatewayMetrics = {
    connectedClients: 0,
    totalBytesSent: 0,
    uncompressedBytesEstimated: 0,
    fullSnapshotsSent: 0,
    deltaPacketsSent: 0,
    droppedFrames: 0,
    broadcastTicks: 0,
    compressionRatio: 0
  };

  constructor(options: TelemetryServerOptions = {}) {
    this.port = options.port ?? 8080;
    this.host = options.host ?? '0.0.0.0';
    this.broadcastRateHz = options.broadcastRateHz ?? 60;
    this.backpressureThresholdBytes = options.backpressureThresholdBytes ?? 65536;

    this.compressor = new DeltaCompressor({
      defaultThreshold: options.deadbandThreshold ?? 0.001,
      suppressEmptyPackets: false
    });

    if (options.engine) {
      this.attachEngine(options.engine);
    }
  }

  /**
   * Starts the WebSocket server and the paced broadcast timer.
   */
  public async start(): Promise<void> {
    if (this.wss) return;

    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port, host: this.host }, () => {
        const address = this.wss?.address();
        if (typeof address === 'object' && address !== null) {
          this.port = address.port;
        }

        // Start 60 Hz broadcast loop
        const intervalMs = Math.max(1, Math.floor(1000 / this.broadcastRateHz));
        this.broadcastTimer = setInterval(() => this.broadcastTick(), intervalMs);

        resolve();
      });

      this.wss.on('error', (err) => {
        reject(err);
      });

      this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        this.handleClientConnection(ws);
      });
    });
  }

  /**
   * Gracefully shuts down the gateway server, terminating all active connections.
   */
  public async stop(): Promise<void> {
    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
      this.broadcastTimer = null;
    }

    if (this.unsubscribeEngine) {
      this.unsubscribeEngine();
      this.unsubscribeEngine = null;
    }

    for (const client of this.clients) {
      try {
        client.terminate();
      } catch {
        // Ignore termination errors during shutdown
      }
    }
    this.clients.clear();
    this.metrics.connectedClients = 0;

    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss?.close(() => resolve());
      });
      this.wss = null;
    }
  }

  /**
   * Attaches a PhysicsEngine instance to ingest continuous simulation state updates.
   */
  public attachEngine(engine: PhysicsEngine): void {
    if (this.unsubscribeEngine) {
      this.unsubscribeEngine();
    }

    this.engine = engine;
    this.latestState = engine.getCurrentState();

    // Seed the compressor baseline with current simulation state
    this.compressor.reset(this.latestState);

    this.unsubscribeEngine = engine.onTick((state: FullStatePayload) => {
      this.latestState = state;
    });
  }

  /**
   * Handles new client connection lifecycle: sends initial full snapshot immediately.
   */
  private handleClientConnection(ws: WebSocket): void {
    this.clients.add(ws);
    this.metrics.connectedClients = this.clients.size;

    // Send immediate FullStatePayload snapshot on connect
    const snapshotState = this.latestState ?? this.engine?.getCurrentState();
    if (snapshotState) {
      const snapshot = this.compressor.getFullSnapshot(snapshotState);
      const snapshotStr = JSON.stringify(snapshot);

      try {
        ws.send(snapshotStr);
        this.metrics.fullSnapshotsSent++;
        this.metrics.totalBytesSent += snapshotStr.length;
        this.metrics.uncompressedBytesEstimated += snapshotStr.length;
      } catch {
        // Failed send during connection
      }
    }

    ws.on('close', () => {
      this.clients.delete(ws);
      this.metrics.connectedClients = this.clients.size;
    });

    ws.on('error', () => {
      this.clients.delete(ws);
      this.metrics.connectedClients = this.clients.size;
    });
  }

  /**
   * Paced broadcast tick (e.g. 60 Hz). Evaluates delta compression and broadcasts to open clients.
   */
  private broadcastTick(): void {
    if (this.clients.size === 0 || !this.latestState) {
      return;
    }

    const deltaPacket = this.compressor.compress(this.latestState);
    if (!deltaPacket) {
      return;
    }

    const payloadStr = JSON.stringify(deltaPacket);
    const uncompressedSize = JSON.stringify(this.latestState).length;

    let sentToAny = false;

    for (const ws of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) {
        continue;
      }

      // Memory-safety backpressure check
      if (ws.bufferedAmount > this.backpressureThresholdBytes) {
        this.metrics.droppedFrames++;
        continue;
      }

      try {
        ws.send(payloadStr);
        sentToAny = true;
        this.metrics.totalBytesSent += payloadStr.length;
        this.metrics.uncompressedBytesEstimated += uncompressedSize;
      } catch {
        this.metrics.droppedFrames++;
      }
    }

    if (sentToAny) {
      this.metrics.deltaPacketsSent++;
    }
    this.metrics.broadcastTicks++;

    // Update real-time compression ratio
    if (this.metrics.uncompressedBytesEstimated > 0) {
      this.metrics.compressionRatio = Math.max(
        0,
        1 - this.metrics.totalBytesSent / this.metrics.uncompressedBytesEstimated
      );
    }
  }

  /**
   * Returns current port number bound by WebSocket server.
   */
  public getPort(): number {
    return this.port;
  }

  /**
   * Returns active connected client count.
   */
  public getConnectedClientCount(): number {
    return this.clients.size;
  }

  /**
   * Returns copy of gateway telemetry metrics.
   */
  public getMetrics(): GatewayMetrics {
    return { ...this.metrics };
  }
}
