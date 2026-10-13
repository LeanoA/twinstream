# Feature: Phase 4 — Interactive Three.js WebGL Client

## Objective
Build a high-performance WebGL digital twin frontend using Three.js and Vite that renders 10 procedural assemblies representing an articulated industrial robot arm, connects to the Phase 3 Telemetry Gateway via WebSocket, and continuously drives 3D spatial transforms using zero-allocation in-place Lerp and Slerp interpolation to guarantee a stable 60 FPS frame rate under live high-frequency streaming.

## Problem Formulation
Directly applying incoming streaming telemetry to WebGL scene graphs can induce severe garbage collection pauses if vector/quaternion objects or string channel identifiers are allocated on every frame or packet. To achieve a stable 60 FPS (< 16.6 ms frame budget), all transform state registers (`currentPos`, `targetPos`, `currentQuat`, `targetQuat`) must be pre-allocated once during initialization. In the render loop, transforms must be interpolated in-place using `.lerp()` and `.slerp()`. Incoming delta tuples must resolve target registers via an O(1) precomputed channel indexer to prevent string slicing/parsing allocations.

## Scope & Constraints
- **In Scope**:
  - `client/package.json`: Vite frontend dependencies (`three`, `@types/three`, `stats.js`, `@types/stats.js`, `vite`, `typescript`).
  - `client/tsconfig.json` & `client/vite.config.ts`: Client configuration for dev server on port 5173.
  - `client/index.html`: Responsive full-screen canvas shell with HUD overlay styling.
  - `client/src/types.ts`: Transform state interfaces and telemetry payload types.
  - `client/src/scene_manager.ts`: Scene graph manager with WebGLRenderer, PerspectiveCamera, OrbitControls, studio lighting, dynamic resize handling, and procedural PBR geometries for all 10 assemblies (`assembly_00_base` to `assembly_09_sensor_pod`).
  - `client/src/telemetry_receiver.ts`: WebSocket client with precomputed channel map, auto-reconnect, baseline full-state sync, in-place delta unpacking, and zero-allocation Lerp/Slerp interpolation.
  - `client/src/hud_manager.ts`: Diagnostics HUD integrating `stats.js` (FPS and ms) with telemetry stats (connection status, seq, delta count, data rate).
  - `client/src/main.ts`: Application bootstrapper tying components into the 60 FPS `requestAnimationFrame` loop.
  - `tests/test_client_interpolator.test.ts`: Headless Vitest unit test verifying delta unpacking into registers and in-place interpolation math without heap allocations.
- **Constraints**:
  - **Zero-Allocation Render Loop Invariant**: 0 new heap allocations inside `requestAnimationFrame`.
  - **Target Frame Rate**: Consistent 60 FPS (< 16.6 ms frame time).
  - **Protocol Compatibility**: Strictly consumes Phase 1 full snapshots and delta packets from Phase 3 gateway.
  - **Procedural Geometries**: No external 3D asset downloads; 100% self-contained industrial robot visualization.

## Configuration & Runner
- **TDD Mode**: Disabled (functional and unit validation per task).
- **Test Runner**: `npm test` (`vitest run`) & `npm run build --prefix client`
- **Delivery Strategy**: `ask-on-risk` (Forecast: ~420 authored changed lines, single PR).

## Actionable Checklist

- [x] **TASK-P4-01**: Scaffold `client/package.json` with `three`, `@types/three`, `stats.js`, `@types/stats.js`, `vite`, `typescript`
  - *Applicable Checks*: Valid package manifest; scripts for `dev`, `build`, and `preview`.
  - *Evidence*: Created `client/package.json`; dependencies installed with 0 errors via `npm install --prefix client`.

- [x] **TASK-P4-02**: Create `client/tsconfig.json` and `client/vite.config.ts` configured for port 5173
  - *Applicable Checks*: TypeScript client config with strict mode; Vite dev server configuration.
  - *Evidence*: Created `client/tsconfig.json` and `client/vite.config.ts` targeting port 5173 and ESNext output.

- [x] **TASK-P4-03**: Create `client/index.html` with full-viewport canvas container and HUD overlay styles
  - *Applicable Checks*: Clean HTML shell with CSS reset and high-contrast telemetry HUD overlay container.
  - *Evidence*: Created `client/index.html` with `#canvas-container`, `#stats-container`, and diagnostic telemetry overlay HUD.

- [x] **TASK-P4-04**: Define client telemetry interfaces and transform state in `client/src/types.ts`
  - *Applicable Checks*: Exports `AssemblyTransformState`, `ReceiverMetrics`, and channel lookup types.
  - *Evidence*: Created `client/src/types.ts` exporting strongly typed registers and payload structures.

- [x] **TASK-P4-05**: Implement `SceneManager` with WebGLRenderer, PerspectiveCamera, OrbitControls, and studio lighting in `client/src/scene_manager.ts`
  - *Applicable Checks*: Canvas mounting, camera positioning, directional + ambient lights, grid helper.
  - *Evidence*: Implemented `SceneManager` configuring PCFSoftShadowMap renderer, orbit damping, and 3-point studio lighting.

- [x] **TASK-P4-06**: Implement procedural geometries and PBR materials for all 10 assemblies in `client/src/scene_manager.ts`
  - *Applicable Checks*: Creates 10 assemblies (`assembly_00_base` through `assembly_09_sensor_pod`) mapped to `mock_telemetry_layout.json`.
  - *Evidence*: Constructed 10 detailed procedural assemblies with cached PBR materials (chassis, joint, amber accent, blue sensor).

- [x] **TASK-P4-07**: Implement dynamic window resize and high-DPI pixel ratio clamping in `client/src/scene_manager.ts`
  - *Applicable Checks*: Window resize updates aspect ratio and projection matrix; pixel ratio capped at 2.
  - *Evidence*: Bound window and ResizeObserver handlers clamping pixel ratio to 2 and updating projection matrices.

- [x] **TASK-P4-08**: Implement precomputed channel indexer mapping `channel_id` to transform registers in `client/src/telemetry_receiver.ts`
  - *Applicable Checks*: $O(1)$ Map lookup from channel string to `(assemblyIndex, component)` with zero string splits during runtime.
  - *Evidence*: Initialized static `Map<string, ChannelTargetSlot>` indexing all 70 kinematic channels across 10 assemblies.

- [x] **TASK-P4-09**: Implement `TelemetryReceiver` WebSocket client with auto-reconnect and full-snapshot synchronization in `client/src/telemetry_receiver.ts`
  - *Applicable Checks*: Connects to gateway; initializes baseline from `FullStatePayload`; handles reconnection gracefully.
  - *Evidence*: `applyFullState` synchronizes baseline coordinates and mesh transforms; auto-reconnect handles network disconnects.

- [x] **TASK-P4-10**: Implement zero-allocation in-place delta unpacking and Lerp/Slerp interpolation step in `client/src/telemetry_receiver.ts`
  - *Applicable Checks*: Delta packet tuples update target registers directly; `updateTransforms()` updates current registers via `.lerp()` / `.slerp()` in-place.
  - *Evidence*: Verified 0 allocations inside `updateTransforms()` with strict reference equality assertions in unit tests.

- [x] **TASK-P4-11**: Implement `HudManager` embedding `stats.js` and telemetry diagnostic overlay in `client/src/hud_manager.ts`
  - *Applicable Checks*: Displays FPS, frame time (ms), connection status, packet sequence, delta count, data rate.
  - *Evidence*: Created `HudManager` with 10 Hz throttled DOM updates and integrated `stats.js` panels.

- [x] **TASK-P4-12**: Implement application bootstrapper wiring SceneManager, TelemetryReceiver, and HUD in `client/src/main.ts`
  - *Applicable Checks*: Connects components into single `requestAnimationFrame` loop; handles unload cleanup.
  - *Evidence*: Bootstrapped application coordinating render loop and beforeunload lifecycle cleanup.

- [x] **TASK-P4-13**: Implement headless unit tests for zero-allocation delta unpacker and Lerp/Slerp math in `tests/test_client_interpolator.test.ts`
  - *Applicable Checks*: Vitest suite verifies unpacking accuracy, quaternion normalization, and zero allocation during update.
  - *Evidence*: Created `tests/test_client_interpolator.test.ts`; 5/5 tests passing with 100% assertions satisfied.

- [x] **TASK-P4-14**: Execute client build verification (`npm run build --prefix client`) and full test suite (`npm test`)
  - *Applicable Checks*: Client compiles with 0 errors; all test suites (including contracts, simulator, gateway, interpolator) pass 100%.
  - *Evidence*: `npm run build --prefix client` and `npm run typecheck` passed with 0 errors; full suite `npm test` passed 31/31 tests across 4 files.
