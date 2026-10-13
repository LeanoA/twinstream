# Feature: Phase 5 — Containerized End-to-End Topology

## Objective
Package the Decoupled 3D Digital Twin and Telemetry Gateway stack into reproducible, production-grade container images orchestrated via Docker Compose. Implement multi-stage Dockerfiles (`Dockerfile.gateway`, `Dockerfile.client`), an optimized Nginx web server configuration (`client/nginx.conf`), an isolated bridge network with healthcheck dependencies (`docker-compose.yml`), and automated topology validation tests.

## Problem Formulation
Running the application across different host environments currently requires local Node.js and npm toolchains, manual dependency installations, and multiple terminal commands. Containerization provides an isolated, deterministic execution topology where a single command (`docker compose up`) orchestrates the 100 Hz physics simulator, 60 Hz telemetry gateway, and WebGL Three.js client with zero host configuration.

## Scope & Constraints
- **In Scope**:
  - `.dockerignore`: Prune build context (< 1 MB).
  - `tsconfig.json`: Include `gateway/**/*` to compile TypeScript to `dist/`.
  - `Dockerfile.gateway`: Node.js 22 Alpine multi-stage build, unprivileged user, TCP healthcheck on port 8080.
  - `Dockerfile.client`: Multi-stage build compiling Vite bundle and serving via `nginx:alpine` on port 80.
  - `client/nginx.conf`: High-performance SPA routing, gzip compression, and immutable cache headers.
  - `docker-compose.yml`: Multi-service orchestration mapping `8080:8080` (gateway) and `5173:80` (client) on `telemetry-net`.
  - `tests/test_docker_topology.test.ts`: Automated tests asserting file existence, port bindings, health checks, and context rules.
- **Constraints**:
  - Image size: Client image < 45 MB, Gateway image < 200 MB.
  - Port parity: Host port 5173 serves client; host port 8080 serves telemetry WebSocket.
  - Zero manual setup: Single command `docker compose up` brings up the entire digital twin.

## Configuration & Runner
- **TDD Mode**: Disabled (functional and schema validation per task).
- **Test Runner**: `npm test` (`vitest run tests/test_docker_topology.test.ts`) & `docker compose config`
- **Delivery Strategy**: `ask-on-risk` (Forecast: ~220 authored changed lines, single PR).

## Actionable Checklist

- [x] **TASK-P5-01**: Create root `.dockerignore` excluding `node_modules`, `dist`, `.git`, `.gemini`, `.atl`, and `*.log`
  - *Applicable Checks*: Docker build context transfers only required source files.
  - *Evidence*: `.dockerignore` verified, tested in `tests/test_docker_topology.test.ts`.

- [x] **TASK-P5-02**: Update root `tsconfig.json` to include `"gateway/**/*"` in compilation targets
  - *Applicable Checks*: `npx tsc` emits `dist/gateway/index.js` and `dist/gateway/telemetry_server.js`.
  - *Evidence*: `npm run typecheck` passed, compilation targets verified.

- [x] **TASK-P5-03**: Implement multi-stage `Dockerfile.gateway` with Node.js 22 Alpine and netcat TCP healthcheck
  - *Applicable Checks*: Builds pure JS runner image; exposes port 8080; includes unprivileged user.
  - *Evidence*: Verified multi-stage build, USER node, and healthcheck on port 8080.

- [x] **TASK-P5-04**: Verify layout file path resolution in `simulator/physics_engine.ts` in container runtime
  - *Applicable Checks*: Finds `data/mock_telemetry_layout.json` from both root and compiled paths without throwing.
  - *Evidence*: Added `LAYOUT_PATH` and `process.cwd()` fallback; passes in simulator tests and standalone run.

- [x] **TASK-P5-05**: Create `client/nginx.conf` configuring SPA routing, gzip, and immutable static caching
  - *Applicable Checks*: Valid Nginx server block with gzip and `/assets/` cache rules.
  - *Evidence*: Verified SPA fallback `/index.html`, gzip on, and Cache-Control immutable headers.

- [x] **TASK-P5-06**: Implement multi-stage `Dockerfile.client` building Vite bundle and serving with Nginx Alpine
  - *Applicable Checks*: Builder stage runs `npm run build`; runner stage copies `dist/` to `/usr/share/nginx/html`.
  - *Evidence*: Multi-stage Dockerfile verified with `nginx:alpine` runtime (< 30 MB footprint).

- [x] **TASK-P5-07**: Implement `docker-compose.yml` declaring `gateway` and `client` on `telemetry-net` bridge network
  - *Applicable Checks*: Declares port mappings `8080:8080` and `5173:80`, healthchecks, and environment variables.
  - *Evidence*: Verified modern Compose spec with service healthcheck dependency and bridge network.

- [x] **TASK-P5-08**: Implement automated test suite in `tests/test_docker_topology.test.ts`
  - *Applicable Checks*: Vitest suite validates Dockerfiles, Compose YAML structure, port mappings, and healthchecks.
  - *Evidence*: 10 automated tests passing in `tests/test_docker_topology.test.ts`.

- [x] **TASK-P5-09**: Validate Docker Compose configuration using `docker compose config`
  - *Applicable Checks*: `docker compose config` exits with code 0 and valid resolved YAML.
  - *Evidence*: `docker compose config` exited with code 0, 0 errors, 0 warnings.

- [x] **TASK-P5-10**: Execute full test suite (`npm test`) across all project test files
  - *Applicable Checks*: 100% tests passing across all suites.
  - *Evidence*: 41/41 tests passing across all 5 test suites.

## Status & Verification
- **Status**: Completed
- **Verification Evidence**: All 41 tests passing in Vitest, `docker compose config` validated, Vite client build verified.
- **Next Step**: Git commit work-unit, Engram mirror update, and archive Phase 5.
