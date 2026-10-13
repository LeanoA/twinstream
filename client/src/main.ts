import { SceneManager } from './scene_manager';
import { TelemetryReceiver } from './telemetry_receiver';
import { HudManager } from './hud_manager';

function bootstrap(): void {
  const container = document.getElementById('canvas-container');
  if (!container) {
    throw new Error('Canvas container element #canvas-container not found.');
  }

  // 1. Initialize Scene Graph & Procedural Robot Assemblies
  const sceneManager = new SceneManager(container);
  sceneManager.init();

  // 2. Configure WebSocket Telemetry Receiver
  const gatewayHost = window.location.hostname || 'localhost';
  const gatewayUrl = `ws://${gatewayHost}:8080`;

  const receiver = new TelemetryReceiver({
    url: gatewayUrl,
    lerpAlpha: 0.25,
    slerpAlpha: 0.25
  });

  receiver.registerAssemblies(sceneManager.getAssemblyObjects());
  receiver.connect();

  // 3. Initialize Diagnostic HUD and Stats
  const hudManager = new HudManager();

  // 4. Zero-Allocation 60 FPS requestAnimationFrame Loop
  function animate(): void {
    requestAnimationFrame(animate);

    hudManager.beginFrame();

    // Interpolate transforms in-place (0 allocations)
    receiver.updateTransforms();

    // Render 3D viewport & OrbitControls damping
    sceneManager.render();

    // Throttled HUD update
    hudManager.update(receiver.getMetrics());

    hudManager.endFrame();
  }

  requestAnimationFrame(animate);

  // 5. Clean teardown on unload
  window.addEventListener('beforeunload', () => {
    receiver.disconnect();
    sceneManager.dispose();
    hudManager.dispose();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
