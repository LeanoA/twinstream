# Feature: GitHub Actions CI Pipeline for Automated Verification & Build

## Objective
Configure an automated GitHub Actions CI workflow (`.github/workflows/ci.yml`) to validate every push and pull request to `main`. The pipeline will execute TypeScript typechecking, run the complete Vitest test suite (51 tests), and verify production client asset building (`vite build`).

## Problem Formulation
Currently, tests and builds are verified locally. To maintain production standards and provide visible passing CI badges on GitHub for portfolio reviewers, a remote continuous integration pipeline is needed that guarantees zero regressions on pushes to `main` and pull requests.

## Scope & Constraints
- **In Scope**:
  - `.github/workflows/ci.yml`: Multi-step workflow on `ubuntu-latest` with Node.js 22.
  - Dependency caching (`actions/setup-node` with `cache: 'npm'`).
  - Strict pipeline steps:
    1. Checkout repository (`actions/checkout@v4`).
    2. Setup Node.js 22 runtime.
    3. Install dependencies (`npm ci` for root and client).
    4. Typecheck workspace (`npm run typecheck`).
    5. Run Vitest test suite (`npm test`).
    6. Verify client bundle compilation (`npm run client:build`).
  - Add CI workflow status badge to `README.md`.
- **Constraints**:
  - Keep pipeline fast (< 2 minutes execution window).
  - Use official GitHub actions (`actions/checkout@v4`, `actions/setup-node@v4`).
  - No secrets or credentials required for public testing.

## Configuration & Runner
- **TDD Mode**: Disabled (infrastructure/workflow task).
- **Test Runner**: GitHub Actions Runner (`ubuntu-latest`).
- **Delivery Strategy**: `single-pr` on branch `feature/github-actions-ci`.

## Actionable Checklist

- [ ] **TASK-CI-01**: Create `.github/workflows/ci.yml` with Node 22 matrix, npm caching, typecheck, tests, and build steps
  - *Applicable Checks*: Workflow YAML syntax valid, triggers on push/PR to `main`.
- [ ] **TASK-CI-02**: Add CI status badge to root `README.md` linked to the repository workflow runs
  - *Applicable Checks*: Badge renders correctly with status from `github/actions/workflow/status`.
- [ ] **TASK-CI-03**: Verify end-to-end execution on GitHub Actions runner and confirm green run
  - *Applicable Checks*: All 51 tests pass, client builds cleanly, pipeline exits code 0.

## Status & Verification
- **Status**: Pending / Backlog
- **Next Step**: When authorized, create branch `feature/github-actions-ci` and implement `.github/workflows/ci.yml`.
