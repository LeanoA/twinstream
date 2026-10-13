# Architectural Decision Records (ADRs)

This document records the foundational engineering and architectural decisions made throughout the design and implementation of the **Decoupled 3D Digital Twin & High-Frequency Telemetry Gateway** (`case-03-realtime-3d-telemetry`).

---

## ADR-01: Three-Tier Decoupled Pipeline (Physics vs. Gateway vs. WebGL)

### Context & Problem
Continuous physical systems (industrial robotics, aerospace vehicles, turbomachinery) produce mathematical telemetry at high simulation frequencies (100 Hz to 1,000 Hz) across 1,000+ state signals. Streaming these raw signals directly to browser-based 3D applications causes:
1. Network saturation (megabytes per second of redundant data).
2. JavaScript main-thread starvation (constant JSON parsing blocking UI tasks).
3. WebGL frame drops down to 18 FPS due to V8 garbage collection (GC) sweeps.

### Decision
Decouple the system into three distinct, independently paced tiers:
1. **Tier 1 — Simulation Core (100 Hz)**: Continuous physics integration running at $10\text{ ms}$ tick intervals with high-resolution compensation (`process.hrtime.bigint()`).
2. **Tier 2 — Telemetry Gateway (60 Hz Paced)**: Downsamples state, computes deadband delta compression, manages WebSocket client lifecycles, and buffers slow consumers.
3. **Tier 3 — WebGL Digital Twin (60 FPS Render Loop)**: Renders 3D components independently in the browser using `requestAnimationFrame`, continuously smoothing spatial motion via interpolation.

### Consequences
* **Positive**: Simulation numerical accuracy is preserved at 100 Hz without overwhelming the network; browser renders at steady 60 FPS without packet arrival synchronization jitter.
* **Negative**: Requires state buffering and spatial interpolation logic on the client.

---

## ADR-02: Deadband Delta Compression with Compact Tuples

### Context & Problem
Transmitting full JSON state snapshots of 1,000 channels every frame generates $\sim 48\text{ KB}$ per packet. At 60 Hz, this consumes $\sim 3\text{ MB/s}$ of network bandwidth per client. In steady-state operation, $> 80\%$ of sensor signals vary only within micro-fluctuation noise thresholds.

### Decision
Implement the `DeltaCompressor` class using deadband threshold filtering:
* A channel signal $s_i(t)$ is transmitted if and only if $|s_i(t) - s_i(t_{\text{last}})| > \epsilon_i$ (default $\epsilon = 0.001$).
* Updates are encoded as compact 2-element tuples: `[[channel_id, new_value], ...]`.
* On initial WebSocket connection, the client receives a single `FullStatePayload` handshake to prime its cache, followed exclusively by incremental `DeltaPacketPayload` broadcasts.

### Consequences
* **Positive**: Slashes dynamic network bandwidth by **$87.1\%$** ($14.4\text{ MB} \to 1.87\text{ MB}$ over 5s) and steady-state bandwidth by **$> 99.5\%$**. Reduces V8 JSON parsing time by **$15\times$** ($231\ \mu\text{s} \to 15.5\ \mu\text{s}$).
* **Negative**: Requires client state tracking; packet loss requires sequence number tracking or snapshot re-request.

---

## ADR-03: ROS REP-103 & ISO 9787 Hierarchical Scene Graph

### Context & Problem
Initial 3D rendering implementations rendered independent meshes in world space. When joint telemetry was applied, mechanical links disconnected and appeared to "float in mid-air," violating mechanical robotics reality.

### Decision
Model the 10-assembly robotic arm as a contiguous kinematic hierarchy conforming to:
* **ISO 9787 (Manipulating Industrial Robots — Coordinate Systems and Motion Nomenclatures)**: Contiguous mechanical links connected by revolute and prismatic joints.
* **ROS REP-103 (Standard Units of Measure and Coordinate Conventions)**:
  - Metric units: meters ($\text{m}$), radians ($\text{rad}$), seconds ($\text{s}$).
  - Coordinate orientation: $+X$ forward, $+Y$ left, $+Z$ up (or Three.js standard $+Y$ up, $+Z$ forward).
  - Kinematic Tree: $\text{Base} \to \text{Turret} \to \text{Shoulder} \to \text{Elbow} \to \text{Forearm} \to \text{WristPitch} \to \text{WristYaw} \to \text{WristRoll} \to \text{EndEffector} \to \text{SensorPod}$.

### Consequences
* **Positive**: Child assemblies inherit parent transformations automatically via Three.js `scene.updateMatrixWorld()`. Geometry remains mechanically attached and photorealistic.
* **Negative**: Telemetry channel coordinates must represent joint-relative local transformations rather than global world coordinates.

---

## ADR-04: Quaternion $\mathbb{H}$ SLERP with Antipodal Dot Product Correction

### Context & Problem
Using Euler angles ($\text{roll}, \text{pitch}, \text{yaw}$) for 3D rotations leads to gimbal lock singularities and non-uniform interpolation speeds. Furthermore, linear interpolation of quaternions (Lerp) distorts angular velocity.

### Decision
1. Represent all 3D rotations strictly as normalized unit quaternions $\mathbf{q} \in \mathbb{H}, \|\mathbf{q}\|_2 = 1$.
2. Enforce Euclidean normalization ($\|\mathbf{q}\| = 1.0 \pm 10^{-6}$) after every physics simulation step.
3. In the client render loop, use **Spherical Linear Interpolation (SLERP)** along the geodesic of the 4D unit sphere $S^3$.
4. Check for antipodal quaternions ($\mathbf{q}_0 \cdot \mathbf{q}_1 < 0$) and negate $\mathbf{q}_1$ to prevent violent $360^\circ$ visual flips.

### Consequences
* **Positive**: Constant angular velocity, zero gimbal lock, zero rotational flipping artifacts.
* **Negative**: SLERP requires trigonometric evaluations ($\arccos$, $\sin$), though modern WebGL runtimes execute this in $< 1\ \mu\text{s}$ per joint.

---

## ADR-05: Zero-Allocation In-Place WebGL Render Loop

### Context & Problem
Instantiating Three.js math objects (`new THREE.Vector3()`, `new THREE.Quaternion()`, `new THREE.Matrix4()`) inside the `requestAnimationFrame` loop creates thousands of short-lived objects per second. This triggers aggressive V8 minor garbage collection and periodic major Stop-The-World GC sweeps (15 ms to 40 ms), dropping frames.

### Decision
Allocate all vectors, quaternions, and matrices **once** during module initialization as static scratchpad instances (`_scratchPos`, `_scratchTargetPos`, `_scratchQuat`, `_scratchTargetQuat`). In the render loop, update transforms strictly in-place using `.set()`, `.copy()`, `.lerpVectors()`, and `.slerpQuaternions()`.

### Consequences
* **Positive**: Zero heap memory allocation in the render loop; zero GC-induced frame drops; rock-solid 60 FPS rendering.
* **Negative**: Requires disciplined code structure; functions sharing scratchpads must not re-enter concurrently.

---

## ADR-06: Containerized Microservices: Nginx Alpine (< 30 MB) + Node 22 Alpine Unprivileged

### Context & Problem
Running the digital twin in production requires orchestrating backend streaming and frontend WebGL assets without host dependency mismatches. Running a full Node.js runtime container for static frontend delivery wastes $150+\text{ MB}$ of container memory.

### Decision
1. **Frontend (`Dockerfile.client`)**: Multi-stage build compiling Vite TypeScript bundle and deploying static assets to `nginx:alpine` ($< 30\text{ MB}$ image footprint). Configured with SPA fallback routing, gzip compression, and 1-year immutable cache headers for `/assets/`.
2. **Backend Gateway (`Dockerfile.gateway`)**: Multi-stage Node.js 22 Alpine image, compiling TypeScript to `dist/`, running as unprivileged user `node`, and exposing port 8080.
3. **Orchestration (`docker-compose.yml`)**: Bridge network (`telemetry-net`) with service health checks binding host ports `5173` (client) and `8080` (gateway).

### Consequences
* **Positive**: Lightweight deployment, instant boot, minimal attack surface, reproducible across all hosts with a single command (`docker compose up`).
* **Negative**: Requires multi-stage Docker build pipeline.

---

## ADR-07: Deterministic Headless Benchmarking Engine vs. Live Socket Tests

### Context & Problem
Benchmarking the efficiency of delta compression over live WebSocket ports introduces non-deterministic OS network buffers, loopback jitter, and port contention in CI pipelines.

### Decision
Implement `benchmarks/run_telemetry_benchmark.ts` as a deterministic, headless benchmarking engine:
* Drives `PhysicsEngine.evaluatePhysics(tick)` deterministically.
* Passes states through `DeltaCompressor`.
* Measures serialised payload byte lengths and V8 JSON deserialization cost (`JSON.parse`) using `process.hrtime.bigint()`.
* Directly calculates frame-budget consumption against the 16.67 ms (60 FPS) window.

### Consequences
* **Positive**: 100% reproducible benchmark metrics; executes in $< 1\text{ second}$ in CI; directly proves the $> 87\%$ bandwidth reduction and $15\times$ parsing speedup.
* **Negative**: Does not measure physical NIC hardware transmission latency.
