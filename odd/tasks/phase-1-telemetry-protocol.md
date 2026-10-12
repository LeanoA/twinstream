# Feature: Phase 1 — Telemetry Protocol & Data Contracts

## Objective
Establish strict, language-agnostic data contracts for full-state snapshots and deadband delta streaming packets, alongside a canonical 1,000-channel telemetry layout mapped to a 3D digital twin assembly, verified with automated contract testing.

## Problem Formulation
Decoupling continuous high-frequency mathematical simulation solvers from browser WebGL renderers requires strict serialization contracts. Without standardized full-state snapshots and zero-allocation flat delta packet schemas, high-throughput streaming floods the browser event loop with JSON deserialization and triggers garbage collection stutters below 60 FPS.

## Scope & Constraints
- **In Scope**:
  - `package.json`: Root package configuration with TypeScript, AJV, and Vitest.
  - `tsconfig.json`: Modern Node.js ES2022 TypeScript configuration.
  - `schema/full_state.schema.json`: JSON Schema Draft 2020-12 defining full-state snapshots (`timestamp` + `signals` dictionary).
  - `schema/delta_packet.schema.json`: JSON Schema Draft 2020-12 defining compact delta packets (`timestamp` + `seq` + 2-element tuple deltas `[[channel_id, value], ...]`).
  - `schema/types.ts`: TypeScript interfaces for full state, delta packet, and telemetry layout.
  - `scripts/generate_telemetry_layout.ts`: Deterministic layout generator script.
  - `data/mock_telemetry_layout.json`: Canonical layout with exactly 1,000 channels across 10 3D assemblies.
  - `tests/test_contracts.test.ts`: Automated contract verification test suite.
- **Constraints**:
  - Zero-allocation delta tuple format `[channel_id, value]` to protect 60 FPS invariant.
  - Standard JSON Schema Draft 2020-12 validated with AJV.
  - Absolute domain anonymity: generic engineering digital twin.

## Configuration & Runner
- **TDD Mode**: Disabled (functional validation checks per task).
- **Test Runner**: `npm test` (`vitest run tests/test_contracts.test.ts`)
- **Delivery Strategy**: `ask-on-risk` (Forecast: ~280 authored changed lines).

## Actionable Checklist

- [x] **TASK-P1-01**: Initialize Node.js & TypeScript tooling (`package.json`, `tsconfig.json`)
  - *Applicable Checks*: Dependencies install cleanly; TypeScript config compiles with `npm run typecheck`.
  - *Evidence*: `package.json` created, `npm install` succeeded (56 packages added), `tsc --noEmit` exits with code 0.

- [x] **TASK-P1-02**: Define JSON Schema for full-state snapshots (`schema/full_state.schema.json`)
  - *Applicable Checks*: Valid JSON Schema Draft 2020-12; validates `{ timestamp: number, signals: Record<string, number> }`.
  - *Evidence*: Validated with Ajv2020 in `tests/test_contracts.test.ts` (5/5 passing).

- [x] **TASK-P1-03**: Define JSON Schema for compact delta packets (`schema/delta_packet.schema.json`)
  - *Applicable Checks*: Valid JSON Schema Draft 2020-12; validates `{ timestamp: number, seq: number, deltas: [string, number][] }`.
  - *Evidence*: Validated with Ajv2020 in `tests/test_contracts.test.ts` (5/5 passing).

- [x] **TASK-P1-04**: Define TypeScript interface contracts (`schema/types.ts`)
  - *Applicable Checks*: TypeScript exports compile cleanly with zero type errors.
  - *Evidence*: `npm run typecheck` passed with 0 errors.

- [x] **TASK-P1-05**: Implement telemetry layout generator (`scripts/generate_telemetry_layout.ts`)
  - *Applicable Checks*: Generates exactly 10 3D sub-assemblies with 7 kinematic channels and 93 sensors each.
  - *Evidence*: `scripts/generate_telemetry_layout.ts` authored; verified with assembly and channel checks.

- [x] **TASK-P1-06**: Generate canonical telemetry layout fixture (`data/mock_telemetry_layout.json`)
  - *Applicable Checks*: Contains exactly 1,000 unique channels with positive deadband thresholds.
  - *Evidence*: `npm run generate:layout` generated `data/mock_telemetry_layout.json` (334 KB, 1,000 channels).

- [x] **TASK-P1-07**: Implement automated contract test suite (`tests/test_contracts.test.ts`)
  - *Applicable Checks*: Verifies meta-schema validity, synthetic payload compliance, and mutation negative rejection.
  - *Evidence*: 15 automated test cases authored across 4 describe suites.

- [x] **TASK-P1-08**: Execute test suite and verify 100% compliance
  - *Applicable Checks*: `npm test` (`vitest run tests/test_contracts.test.ts`) exits with code 0.
  - *Evidence*: 15/15 tests passed in 323ms.

## Progress & Verification Evidence
- Branch: `feature/phase-1-telemetry-protocol`
- Initialized: 2026-10-12
- Completed: 2026-10-12
- Status: Verified (Definition of Done met: schemas and 1,000-channel layout validate with 100% pass rate)
- Commit: `bb20fca` (`feat(contracts): define JSON schemas, telemetry layout, and contract tests`)
