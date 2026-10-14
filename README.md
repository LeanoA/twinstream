# TwinStream: Decoupled 3D Digital Twin & High-Frequency Telemetry Gateway

[![Stack](https://img.shields.io/badge/Stack-Three.js%20%7C%20TypeScript%20%7C%20Node.js%20WebSockets%20%7C%20Vite%20%7C%20Docker-blue.svg)](#)
[![Tests](https://img.shields.io/badge/Tests-51%2F51%20Passing%20(100%25)-brightgreen.svg)](#)
[![CI / CD](https://github.com/LeanoA/twinstream/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/LeanoA/twinstream/actions/workflows/deploy-pages.yml)
[![Performance](https://img.shields.io/badge/Performance-60%20FPS%20%7C%20Zero--Allocation%20Render%20Loop-brightgreen.svg)](#)
[![Bandwidth](https://img.shields.io/badge/Network-87.1%25%20Delta%20Compression-orange.svg)](#)
[![Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-success.svg)](https://leanoa.github.io/twinstream/)
[![Kinematics](https://img.shields.io/badge/Kinematics-URDF--Inspired%20%7C%20Three.js%20%2BY-blueviolet.svg)](#)
[![SDLC](https://img.shields.io/badge/SDLC-Spec--Driven%20Development%20(SDD)-purple.svg)](#)

A battle-tested reference architecture demonstrating how to decouple continuous, high-frequency physical simulation engines ($100\text{ Hz}$, 1,000 channels) from browser-based 3D visualizers. Implements a high-throughput **Node.js/TypeScript Telemetry Gateway** with deadband delta compression ($\epsilon = 0.001$), driving an interactive **Three.js WebGL Digital Twin** at a rock-solid 60 FPS without garbage collector pauses or network saturation. Features an autonomous in-browser **Web Worker demo fallback** for static hosting (e.g., GitHub Pages).

---

## ⚡ Key Achievements

* **$87.1\%$ Bandwidth Reduction:** Cut dynamic streaming volume from $14.42\text{ MB}$ down to $1.87\text{ MB}$ over 5s ($2,954\text{ KB/s} \to 382\text{ KB/s}$); $> 99.5\%$ reduction during stationary hold ($12.4\text{ KB/s}$).
* **$15\times$ Faster V8 Deserialization:** Reduced client JSON parsing latency from $231.4\ \mu\text{s}$ to $15.5\ \mu\text{s}$ per broadcast packet.
* **Rock-Solid 60 FPS WebGL Rendering:** Slashed telemetry frame-budget consumption from $1.39\%$ to $0.09\%$ of the $16.67\text{ ms}$ render window, freeing up $99.9\%$ of the main thread for GPU draw calls and zero-allocation SLERP interpolation.
* **Robotics Kinematic Fidelity:** Modeled an articulated 10-assembly robot using a URDF-inspired hierarchical scene graph with standard robotics link/joint nomenclatures, adapted to Three.js's $+Y$-up coordinate convention with contiguous mechanical links.
* **Autonomous In-Browser Web Worker Demo:** Implemented dual-mode telemetry ingestion. When the Node.js gateway is unreachable (e.g. on static GitHub Pages), a background Web Worker autonomously simulates URDF kinematics and deadband delta compression at 60 FPS without blocking the main WebGL thread, accompanied by a clear visual disclaimer.
* **Production Docker Topology:** Orchestrated via Docker Compose with an unprivileged Node 22 Alpine gateway and an ultra-lightweight Nginx Alpine web server ($< 30\text{ MB}$ image).

---

## 🚀 Quickstart

### 0. 🌐 Instant Interactive Web Demo (Zero Setup)
Test the interactive 3D digital twin directly in your browser without spinning up local servers or Docker containers:
👉 **[https://leanoa.github.io/twinstream/](https://leanoa.github.io/twinstream/)**

*(Static deployment runs on an autonomous background Web Worker computing URDF forward kinematics and deadband delta compression at 60 FPS, completely freeing the main thread for GPU draw calls).*

### 1. Production Mode (Docker Compose)
To launch the complete containerized stack with zero host dependencies:
```bash
docker compose up -d --build
```
* **Frontend Web Client**: Open [http://localhost:5173](http://localhost:5173) in your browser.
* **Telemetry Gateway**: WebSocket streaming active on `ws://localhost:8080`.
* To stop: `docker compose down`.

### 2. Local Development Mode
Prerequisites: Node.js 22+, npm.
```bash
# 1. Install dependencies
npm install
npm install --prefix client

# 2. Build client assets
npm run client:build

# 3. Launch Telemetry Gateway & Physics Simulator (Port 8080)
npm run gateway

# 4. In a separate terminal, launch Vite Development Server (Port 5173)
npm run client
```

### 3. Standalone / Static Web Demo (In-Browser Web Worker)
For static hosting (e.g., GitHub Pages) or portfolio walkthroughs without spinning up Docker or Node.js servers:
```bash
# Build static client bundle with relative asset paths (base: './')
npm run client:build

# Preview static bundle locally
npm run preview --prefix client
```
* The client detects WebSocket unavailability within 1,500 ms and autonomously boots `telemetry_worker.ts` in the background.
* The 3D robot articulates at 60 FPS directly in the browser with live deadband delta compression metrics and an explicit visual disclaimer notice.

### 4. Empirical Benchmarks
Run the headless benchmarking suite comparing Monolithic vs. Decoupled Delta streaming:
```bash
npm run benchmark

# To test stationary (quiescent) state:
npm run benchmark -- --quiescent
```

### 5. Automated Test Suite
Execute the full Vitest suite (51 automated tests across 7 test suites):
```bash
npm test
```

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    subgraph PhysicsLayer["1. Continuous Physics Layer (100 Hz)"]
        Physics["PhysicsEngine\n(1,000 Channels, URDF Kinematics)"]
        InternalBuffer["Pre-allocated Float64 Buffer\n(Zero V8 Allocation)"]
        Physics --> InternalBuffer
    end

    subgraph GatewayLayer["2. Telemetry Gateway (60 Hz Paced)"]
        Compressor["DeltaCompressor\n(Deadband Filtering: |Δs| > ε)"]
        WSGateway["WebSocket Server (ws)\n(Port 8080, Backpressure Guard)"]
        InternalBuffer -->|IPC / Memory State| Compressor
        Compressor --> WSGateway
    end

    subgraph ClientLayer["3. Three.js WebGL Client (60 FPS Render Loop)"]
        Receiver["TelemetryReceiver\n(WebSocket Client)"]
        RingBuffer["Target State Ring Buffer\n(Lerp / Slerp Interpolator)"]
        SceneMgr["SceneManager\n(Contiguous URDF Meshes, Three.js)"]
        Renderer["WebGLRenderer\n(requestAnimationFrame @ 60 FPS)"]

        WSGateway -->|Compact Delta JSON [[ch, val], ...]| Receiver
        Receiver --> RingBuffer
        RingBuffer --> SceneMgr
        SceneMgr --> Renderer
    end
```

### Key Architectural Decisions
1. **Decoupled Frequencies**: Physics simulates at $100\text{ Hz}$ ($10\text{ ms}$) for numerical stability; Gateway downsamples to $60\text{ Hz}$ ($16.67\text{ ms}$) matching display refresh rates; WebGL client renders independently at $60\text{ FPS}$ with Lerp/Slerp spatial smoothing.
2. **Deadband Compression ($\epsilon = 0.001$)**: Filters invariant channels; transmits only signals where $|s_i(t) - s_i(t_{\text{last}})| > \epsilon$.
3. **Zero-Allocation Render Loop**: Uses pre-allocated math scratchpads (`_scratchPos`, `_scratchQuat`) to completely eliminate heap allocation during animation frames, eliminating V8 Garbage Collection Stop-the-World pauses.
4. **Autonomous Web Worker Fallback**: Features dual-mode ingestion. If WebSocket connection to the gateway is unavailable or times out, the client automatically spins up a background Web Worker running forward kinematics and deadband compression without blocking the main WebGL thread.

---

## 📊 Empirical Benchmarks (5-Second Continuous Dynamic Motion)

| Metric | Monolithic (Full-State Baseline) | Decoupled (Deadband $\epsilon = 0.001$) | Improvement |
|---|---|---|---|
| **Total Transmitted Volume** | $14.42\text{ MB}$ | $1.87\text{ MB}$ | **$-87.06\%$ ($7.7\times$ smaller)** |
| **Average Packet Size** | $49.2\text{ KB}$ | $6.4\text{ KB}$ | **$-87.06\%$** |
| **Network Throughput** | $2,954.1\text{ KB/s}$ | $382.3\text{ KB/s}$ | **$-87.06\%$** |
| **V8 JSON Parse Latency (avg)** | $231.4\ \mu\text{s}$ | $15.5\ \mu\text{s}$ | **$15.0\times$ faster** |
| **60 FPS Frame Budget Consumed** | $1.39\%$ | $0.09\%$ | **$+1.30\%$ headroom** |
| **Quiescent (Hold) Throughput** | $2,872.2\text{ KB/s}$ | $12.4\text{ KB/s}$ | **$-99.57\%$ ($231.3\times$ smaller)** |
| **Quiescent Parse Latency** | $220.7\ \mu\text{s}$ | $1.6\ \mu\text{s}$ | **$142\times$ faster** |

---

## 📁 Repository Structure

```
.
├── .dockerignore                     # Docker context exclusion rules
├── Dockerfile.gateway               # Multi-stage Node 22 Alpine build for gateway
├── Dockerfile.client                # Multi-stage Vite build + Nginx Alpine runner
├── docker-compose.yml               # Multi-service topology (gateway: 8080, client: 5173)
├── package.json                     # Root scripts, Vitest runner, dependencies
├── tsconfig.json                    # TypeScript compiler configuration
├── schema/                          # JSON Schema data contracts
│   ├── full_state.schema.json       # 1,000-channel full snapshot contract
│   └── delta_packet.schema.json     # Compact tuple delta packet contract
├── data/                            # Static layout definitions
│   └── mock_telemetry_layout.json   # 1,000-channel metadata & deadbands
├── simulator/                       # 100 Hz continuous physics engine
│   └── physics_engine.ts            # Kinematics solver & signal generator
├── gateway/                         # High-frequency telemetry gateway
│   ├── delta_compressor.ts          # Deadband delta compression engine
│   ├── telemetry_server.ts          # WebSocket broadcast server with backpressure
│   └── index.ts                     # Gateway executable entry point
├── client/                          # Three.js WebGL frontend (Vite + TypeScript)
│   ├── nginx.conf                   # Nginx SPA fallback, gzip & cache headers
│   ├── src/scene_manager.ts         # Contiguous URDF kinematic meshes & lighting
│   ├── src/telemetry_receiver.ts    # Zero-allocation Lerp/Slerp interpolator & dual-mode fallback
│   ├── src/hud_manager.ts           # Diagnostic HUD & demo disclaimer manager
│   ├── src/workers/
│   │   └── telemetry_worker.ts      # Autonomous in-browser Web Worker kinematics & deadband engine
│   └── src/main.ts                  # App lifecycle & stats.js monitor
├── benchmarks/                      # Empirical performance profiling
│   └── run_telemetry_benchmark.ts   # Headless comparative benchmark engine
├── tests/                           # Automated Vitest test suite (51 tests)
│   ├── test_contracts.test.ts       # Schema validation & type assertions
│   ├── test_simulator.test.ts       # 100 Hz timer precision & kinematic bounds
│   ├── test_gateway.test.ts         # WebSocket multi-client & deadband tests
│   ├── test_client_interpolator.test.ts # Lerp/Slerp interpolation precision
│   ├── test_demo_worker.test.ts     # Autonomous Web Worker kinematics & fallback tests
│   ├── test_docker_topology.test.ts # Multi-stage Docker & Compose verification
│   └── test_benchmark.test.ts       # Headless benchmark thresholds & metrics
├── docs/                            # In-depth technical documentation
│   ├── README.md                    # Technical documentation hub index
│   ├── ARCHITECTURE_DECISIONS.md    # Architecture Decision Records (ADRs 01-07)
│   ├── GLOSSARY_AND_CONCEPTS.md     # Abbreviations, standards & mathematical theory
│   └── LESSONS_LEARNED.md           # Hard-learned production engineering lessons
└── ARTICLE_DRAFT.md                 # Publication-grade technical case study
```

---

## 📚 Technical Documentation & Deep Dives

* 📖 **[Documentation Hub](docs/README.md)**: Central index to all engineering references.
* 🏛️ **[Architectural Decision Records (ADRs)](docs/ARCHITECTURE_DECISIONS.md)**: In-depth rationale for the three-tier architecture, deadband algorithms, quaternion kinematics, and zero-allocation patterns.
* 📐 **[Glossary & Mathematical Concepts](docs/GLOSSARY_AND_CONCEPTS.md)**: Full theoretical derivations (Quaternion SLERP, Forward Kinematics, V8 GC Mechanics).
* 💡 **[Hard-Learned Lessons](docs/LESSONS_LEARNED.md)**: Practical gotchas (Alpine loopback IPv6 vs IPv4, antipodal quaternion spins, floating parts).
* 📝 **[Publication-Ready Article Draft](ARTICLE_DRAFT.md)**: Complete engineering case study ready for Medium or technical blogs.

---

## 📜 License

MIT License. Designed and engineered for high-performance real-time telemetry systems.
