# Feature: Phase 3 — Node.js Telemetry Gateway & Delta Compressor

## Objective
Implement an intermediate telemetry gateway decoupling high-frequency (100 Hz) physics simulation from WebGL clients, providing deadband delta compression ($|\Delta s_i| > \epsilon$) to achieve $> 75\%$ bandwidth reduction, multi-client WebSocket distribution at 60 Hz, initial full-state synchronization, and backpressure protection.

## Problem Formulation
Transmitting 1,000 raw channels uncompressed at 100 Hz generates ~30 MB/s per client, swamping network interfaces and causing V8 garbage collection jitter in browser clients. Phase 3 inserts a Node.js gateway that filters invariant or micro-fluctuating sensor values below a deadband threshold $\epsilon = 0.001$, packs deltas into compact 2-element tuples `[channel_id, value]`, throttles broadcast pacing to 60 Hz (~16.6 ms), and delivers initial snapshots upon connection.

## Scope & Constraints
- **In Scope**:
  - `package.json`: Install `ws` runtime dependency and `@types/ws` dev dependency; add `gateway` script.
  - `gateway/delta_compressor.ts`: Class `DeltaCompressor` with configurable deadband threshold, last-sent state cache, monotonic `seq` increments, and snapshot synchronization.
  - `gateway/telemetry_server.ts`: Class `TelemetryServer` using `ws` on port 8080 (configurable), initial full-state handshake, decoupled 60 Hz broadcast loop, backpressure buffering check (`bufferedAmount < 64 KB`), and metrics reporting.
  - `gateway/index.ts`: Standalone process entry point wiring `PhysicsEngine` (100 Hz) to `TelemetryServer` (60 Hz).
  - `tests/test_gateway.test.ts`: Automated test suite covering deadband unit tests, 5 concurrent mock WebSocket clients, and empirical bandwidth reduction assertion ($> 75\%$).
- **Constraints**:
  - Bandwidth: Steady-state bandwidth reduction $> 75\%$ compared to uncompressed full-state snapshots.
  - Schema Compliance: Initial frame strictly validates against `schema/full_state.schema.json`; subsequent frames strictly validate against `schema/delta_packet.schema.json`.
  - Pacing: Broadcast decoupled from 100 Hz simulation, emitting at 60 Hz without event loop stalls.
  - Memory: Backpressure threshold (64 KB) prevents unbounded buffer growth on slow consumers.

## Configuration & Runner
- **TDD Mode**: Disabled (functional validation checks per task).
- **Test Runner**: `npm test` (`vitest run tests/test_gateway.test.ts`)
- **Delivery Strategy**: `ask-on-risk` (Forecast: ~340 authored changed lines).

## Actionable Checklist

- [x] **TASK-P3-01**: Install `ws` runtime dependency and `@types/ws` dev dependency in `package.json`
  - *Applicable Checks*: `npm list ws` succeeds; `@types/ws` available for TypeScript compilation.
  - *Evidence*: Installed `ws@^8.22.0` and `@types/ws@^8.18.2`; `tsc --noEmit` verified clean.

- [x] **TASK-P3-02**: Add `gateway` script (`"gateway": "tsx gateway/index.ts"`) to `package.json`
  - *Applicable Checks*: Script present in `package.json`.
  - *Evidence*: Added `"gateway": "tsx gateway/index.ts"` to `package.json`.

- [x] **TASK-P3-03**: Implement `DeltaCompressor` class with deadband threshold filtering ($|\Delta s_i| > \epsilon$) in `gateway/delta_compressor.ts`
  - *Applicable Checks*: Omits channels where $|s_i(t) - s_i(\text{last})| \le \epsilon$.
  - *Evidence*: `DeltaCompressor` filters sub-deadband fluctuations; verified in unit tests.

- [x] **TASK-P3-04**: Implement compact tuple delta serialization (`[channel_id, value]`), monotonic `seq` increments, and empty frame suppression in `gateway/delta_compressor.ts`
  - *Applicable Checks*: Produced packets conform to `schema/delta_packet.schema.json`.
  - *Evidence*: Formats flat `[channel_id, value]` tuples with monotonic `seq` validation against JSON Schema Draft 2020-12.

- [x] **TASK-P3-05**: Implement reference state cache synchronization and full-state snapshot delivery in `gateway/delta_compressor.ts`
  - *Applicable Checks*: Snapshot conforms to `schema/full_state.schema.json`.
  - *Evidence*: `getFullSnapshot` returns full-state dictionary with all 1,000 channels and synchronizes delta cache.

- [x] **TASK-P3-06**: Implement `TelemetryServer` class with `ws` server initialization on port 8080 and clean shutdown in `gateway/telemetry_server.ts`
  - *Applicable Checks*: Server starts and closes cleanly; releases port binding.
  - *Evidence*: `start()` and `stop()` verified across ephemeral and fixed ports; zero dangling handles.

- [x] **TASK-P3-07**: Implement client connection lifecycle with immediate initial `FullStatePayload` delivery in `gateway/telemetry_server.ts`
  - *Applicable Checks*: Client receives full state as first message upon connection.
  - *Evidence*: Verified across 5 concurrent mock clients; each client receives valid 1,000-channel snapshot on `open`.

- [x] **TASK-P3-08**: Implement decoupled 60 Hz broadcast loop with backpressure buffer check in `gateway/telemetry_server.ts`
  - *Applicable Checks*: Broadcasts delta packets to connected clients; drops frames when `bufferedAmount > 65536`.
  - *Evidence*: 60 Hz broadcast loop sends compact deltas and monitors `socket.bufferedAmount` with `droppedFrames` metric.

- [x] **TASK-P3-09**: Implement standalone process entry point connecting `PhysicsEngine` to `TelemetryServer` in `gateway/index.ts`
  - *Applicable Checks*: Standalone script boots simulation and gateway cleanly.
  - *Evidence*: `gateway/index.ts` wires `PhysicsEngine` (100 Hz) to `TelemetryServer` (60 Hz) with live CLI telemetry logging.

- [x] **TASK-P3-10**: Implement unit tests for `DeltaCompressor` in `tests/test_gateway.test.ts`
  - *Applicable Checks*: Deadband filtering, float noise suppression, and AJV schema validation pass.
  - *Evidence*: 3 unit test cases passing in Vitest with AJV 2020 validation.

- [x] **TASK-P3-11**: Implement integration tests for `TelemetryServer` with 5 concurrent mock WebSocket clients in `tests/test_gateway.test.ts`
  - *Applicable Checks*: 5 clients connect, receive initial snapshot, and stream deltas continuously.
  - *Evidence*: 5 concurrent mock WebSocket clients connected and verified receiving streams.

- [x] **TASK-P3-12**: Implement empirical bandwidth verification in `tests/test_gateway.test.ts` asserting $> 75\%$ reduction
  - *Applicable Checks*: Steady-state byte comparison asserts $> 75\%$ compression ratio.
  - *Evidence*: Observed bandwidth reduction of **86.70%** (delta stream: 6.58 KB/frame vs uncompressed: 49.44 KB/frame).

- [x] **TASK-P3-13**: Execute test suite via `npm test` and verify 100% pass rate
  - *Applicable Checks*: All tests in `tests/test_contracts.test.ts`, `tests/test_simulator.test.ts`, and `tests/test_gateway.test.ts` pass with exit code 0.
  - *Evidence*: 26/26 tests passing across 3 test suites in 7.51s.

## Progress & Verification Evidence
- Branch: `feature/phase-3-telemetry-gateway`
- Initialized: 2026-10-13
- Completed: 2026-10-13
- Status: Verified (Definition of Done met: 86.70% bandwidth reduction > 75%, 5 concurrent clients, 100 Hz -> 60 Hz decoupling)
- Commits:
  - `7f8bdd5`: `feat(gateway): implement delta compressor and 60 Hz telemetry websocket server`
