# Feature: URDF Kinematic Robot Hierarchy & Contiguous Digital Twin

## Objective
Refactor the digital twin scene graph and simulation engine to follow the URDF / ROS REP-103 and ISO 9787 robotics standards. Establish a strict parent-child kinematic tree according to `parent_id` in `data/mock_telemetry_layout.json`, remodel procedural geometries into contiguous physical robot links (eliminating air gaps and floating components), fix quaternion channel bindings, and verify fluid multi-joint articulation at 60 FPS.

## Problem Formulation
Currently, all 10 assembly meshes are attached flatly to `this.scene` in world space, and procedural geometries consist of isolated cylindrical joint pins without physical boom links spanning the distance between joints. Consequently, components appear floating disconnected in the 3D viewport. In robotics digital twins, models must follow a hierarchical URDF kinematic tree where children inherit parent transforms, and each link physically extends between its parent joint axis and child joint axis.

## Scope & Constraints
- **In Scope**:
  - `client/src/telemetry_receiver.ts`: Fix quaternion channel bindings to use `rot_qx`, `rot_qy`, `rot_qz`, `rot_qw` matching `data/mock_telemetry_layout.json`.
  - `client/src/scene_manager.ts`: Link 10 assembly groups hierarchically according to `parent_id` (`Base -> Turret -> Shoulder -> Elbow -> Forearm -> WristPitch -> WristYaw -> WristRoll -> EndEffector -> SensorPod`).
  - `client/src/scene_manager.ts`: Remodel procedural geometries into realistic contiguous industrial robot castings (base pedestal, turret fork uprights, upper arm boom link, forearm casting, 3-axis wrist gimbals, parallel gripper, sensor head).
  - `simulator/physics_engine.ts`: Update forward kinematics to emit relative joint origin offsets and local joint articulation quaternions.
  - `tests/test_client_interpolator.test.ts`: Verify hierarchical transforms, quaternion channel bindings, and zero-allocation invariants.
  - `tests/test_simulator.test.ts`: Verify unit quaternion norms, signal bounds, and smooth joint articulation.
- **Constraints**:
  - **Zero Allocations**: Maintain 0 heap allocations inside `requestAnimationFrame`.
  - **Schema & Protocol Compliance**: All 1,000 channels, full-state snapshot schema, and delta packet schema remain 100% compliant.
  - **DoD**: The 10 assemblies form a contiguous, articulated industrial robot arm rotating fluidly at 60 FPS with zero floating gaps.

## Configuration & Runner
- **TDD Mode**: Disabled (functional and unit validation per task).
- **Test Runner**: `npm test` (`vitest run`) & `npm run build --prefix client`
- **Delivery Strategy**: `ask-on-risk` (Forecast: ~250 authored changed lines).

## Actionable Checklist

- [x] **TASK-URDF-01**: Fix quaternion channel bindings in `client/src/telemetry_receiver.ts` to `_rot_qx`, `_rot_qy`, `_rot_qz`, `_rot_qw`
  - *Applicable Checks*: Delta packet tuples for `rot_qx..qw` correctly resolve target registers in $O(1)$ time.
  - *Evidence*: Added `_rot_qx..qw` channel bindings in `telemetry_receiver.ts`; verified in unit tests.

- [x] **TASK-URDF-02**: Implement URDF hierarchical scene graph linking in `client/src/scene_manager.ts`
  - *Applicable Checks*: Children groups attached to parent groups following `parent_id` hierarchy.
  - *Evidence*: `asm0.add(asm1)`, `asm1.add(asm2)`, up to `asm8.add(asm9)` hierarchically configured in `SceneManager`.

- [x] **TASK-URDF-03**: Remodel contiguous procedural geometries in `client/src/scene_manager.ts`
  - *Applicable Checks*: Upper arm boom, forearm, turret uprights, and wrist gimbals visually bridge all joint axes without air gaps.
  - *Evidence*: Reconstructed 10 procedural links with physical boom spans, stanchions, and interlocking gimbals eliminating all air gaps.

- [x] **TASK-URDF-04**: Update `simulator/physics_engine.ts` forward kinematics to emit relative joint origin offsets and local joint articulation quaternions
  - *Applicable Checks*: Emitted joint offsets match URDF link dimensions; quaternions maintain $\|\mathbf{q}\| \equiv 1.0$.
  - *Evidence*: Emits relative joint offsets $[0, 0.35, 0]$, $[0, 0.45, 0]$, $[0, 0.95, 0]$, etc., with unit quaternions verified across 200 simulation ticks.

- [x] **TASK-URDF-05**: Update unit tests in `tests/test_client_interpolator.test.ts` and `tests/test_simulator.test.ts`
  - *Applicable Checks*: All unit tests pass with updated channel keys and kinematic assertions.
  - *Evidence*: 5/5 tests in `test_client_interpolator.test.ts` and 6/6 tests in `test_simulator.test.ts` pass cleanly.

- [x] **TASK-URDF-06**: Execute build verification (`npm run build --prefix client`) and full test suite (`npm test`)
  - *Applicable Checks*: Zero build errors, zero type errors, 100% tests passing across all suites.
  - *Evidence*: Full project test suite passed 31/31 tests across 4 files; `npm run build --prefix client` and `npm run typecheck` passed with 0 errors. Commit `5050a87`.
