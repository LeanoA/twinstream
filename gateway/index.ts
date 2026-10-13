import { PhysicsEngine } from '../simulator/physics_engine.js';
import { TelemetryServer } from './telemetry_server.js';

const PORT = Number(process.env.PORT ?? 8080);
const BROADCAST_HZ = Number(process.env.BROADCAST_HZ ?? 60);
const SIMULATION_HZ = Number(process.env.SIMULATION_HZ ?? 100);
const DEADBAND = Number(process.env.DEADBAND ?? 0.001);

async function main() {
  console.log('=================================================================');
  console.log(' Decoupled 3D Digital Twin & High-Frequency Telemetry Gateway    ');
  console.log('=================================================================');
  console.log(`[Config] Simulation: ${SIMULATION_HZ} Hz | Broadcast: ${BROADCAST_HZ} Hz | Deadband: ε = ${DEADBAND}`);

  const engine = new PhysicsEngine({ tickRateHz: SIMULATION_HZ });
  const server = new TelemetryServer({
    port: PORT,
    broadcastRateHz: BROADCAST_HZ,
    deadbandThreshold: DEADBAND,
    engine
  });

  await server.start();
  engine.start();

  console.log(`[Gateway] WebSocket server listening on ws://localhost:${server.getPort()}`);
  console.log(`[Simulator] Continuous 100 Hz physics engine started.`);
  console.log(`[Gateway] Ready for Three.js WebGL client connections.\n`);

  // Periodic status banner
  const statusInterval = setInterval(() => {
    const m = server.getMetrics();
    const e = engine.getMetrics();
    const ratioPct = (m.compressionRatio * 100).toFixed(1);
    const kbs = (m.totalBytesSent / 1024 / (e.elapsedMs / 1000 || 1)).toFixed(1);

    console.log(
      `[Stats] Clients: ${m.connectedClients} | Delta Frames: ${m.deltaPacketsSent} | ` +
      `Bandwidth: ${kbs} KB/s | Bandwidth Reduction: ${ratioPct}% | Dropped: ${m.droppedFrames}`
    );
  }, 2000);

  const shutdown = async () => {
    console.log('\n[Gateway] Gracefully shutting down...');
    clearInterval(statusInterval);
    engine.stop();
    await server.stop();
    console.log('[Gateway] Server stopped cleanly.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Gateway] Fatal error during startup:', err);
  process.exit(1);
});
