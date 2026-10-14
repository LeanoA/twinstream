# Technical Documentation Hub

Welcome to the technical documentation for **TwinStream: Decoupled 3D Digital Twin & High-Frequency Telemetry Gateway**.

---

## Documentation Index

### 1. [Architectural Decision Records (ADRs)](ARCHITECTURE_DECISIONS.md)
Detailed records of all major engineering decisions, technical tradeoffs, and architectural consequences:
* **ADR-01**: Three-Tier Decoupled Pipeline (Physics vs. Gateway vs. WebGL).
* **ADR-02**: Deadband Delta Compression with Compact Tuples.
* **ADR-03**: URDF Kinematic Hierarchy & Robotics Frame Conventions.
* **ADR-04**: Quaternion $\mathbb{H}$ SLERP with Antipodal Dot Product Correction.
* **ADR-05**: Zero-Allocation In-Place WebGL Render Loop.
* **ADR-06**: Containerized Microservices: Nginx Alpine (< 30 MB) + Node 22 Alpine Unprivileged.
* **ADR-07**: Deterministic Headless Benchmarking Engine vs. Live Socket Tests.

### 2. [Engineering Glossary & Key Concepts](GLOSSARY_AND_CONCEPTS.md)
Comprehensive glossary of abbreviations, industry standards, and core theoretical concepts:
* Abbreviations: ADR, CAD, DoF, FIFO, FPS, GC, IPC, ISO 9787, Lerp, ODD, REP-103, ROS, SDD, SLERP, SPA, URDF, V8, WebGL, WS.
* Theoretical Foundations: The 16.67 ms Frame Budget, Deadband Threshold ($\epsilon$), Quaternions & The Double Cover of $\text{SO}(3)$, Forward Kinematics Tree, V8 Garbage Collection Mechanics, and WebSocket Backpressure.

### 3. [Hard-Learned Engineering Lessons](LESSONS_LEARNED.md)
Practical lessons discovered and solved during production development:
* **Lesson 1**: Never stream high-frequency physics directly into DOM/WebGL threads.
* **Lesson 2**: Garbage collection churn is the #1 killer of 60 FPS WebGL applications.
* **Lesson 3**: Beware the "floating parts" anti-pattern in digital twins.
* **Lesson 4**: The antipodal singularity in quaternion SLERP.
* **Lesson 5**: Alpine Linux container loopback IPv6 (`::1`) vs. IPv4 (`127.0.0.1`).
* **Lesson 6**: Microservice container diet: Nginx Alpine (< 30 MB) vs. Node runtime (> 150 MB).
* **Lesson 7**: Cross-environment layout path resolution (TSX vs. compiled Node JS).

### 4. [Publication-Grade Article Draft](../ARTICLE_DRAFT.md)
Full engineering case study suitable for publication on Medium or engineering blogs:
* Executive TL;DR with quantitative benchmarks.
* Complete mathematical derivations (Deadband, Quaternion SLERP, Kinematics).
* Empirical benchmark tables (Monolithic vs. Decoupled Delta).
* Architectural takeaways and senior engineering reflections.
