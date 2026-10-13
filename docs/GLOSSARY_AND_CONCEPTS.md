# Engineering Glossary & Key Concepts

A reference guide to abbreviations, theoretical principles, and mathematical concepts utilized throughout the **Decoupled 3D Digital Twin & High-Frequency Telemetry Gateway** reference architecture.

---

## 1. Abbreviations & Acronyms

| Abbreviation | Expanded Form | Definition / Context |
|---|---|---|
| **ADR** | Architecture Decision Record | Document capturing an important architectural decision, context, and consequences. |
| **CAD** | Computer-Aided Design | Digital modeling of physical parts and mechanical assemblies. |
| **DoF** | Degrees of Freedom | Number of independent parameters defining the configuration or motion of a mechanical system. |
| **FIFO** | First-In, First-Out | Queue structure where the oldest entries are processed first. |
| **FPS** | Frames Per Second | Frequency at which consecutive images are rendered by the display hardware (target: 60 FPS = 16.67 ms/frame). |
| **GC** | Garbage Collection | Automated memory management reclaiming heap space occupied by unreachable objects in runtimes like V8. |
| **IPC** | Inter-Process Communication | Mechanisms for exchanging data between independent OS processes. |
| **ISO 9787** | International Organization for Standardization 9787 | Standard defining coordinate systems and motion nomenclatures for manipulating industrial robots. |
| **JSON** | JavaScript Object Notation | Lightweight data-interchange text format used for WebSocket serialization. |
| **Lerp** | Linear Interpolation | Mathematical formula computing straight-line intermediate values between two positions: $\mathbf{p}(t) = (1-\alpha)\mathbf{p}_0 + \alpha\mathbf{p}_1$. |
| **ODD** | Organic Driven Development | Orchestration and execution workflow delivering verifiable work units with git commits and task synchronization. |
| **REP-103** | ROS Enhancement Proposal 103 | Robotics standard for standard units (SI) and coordinate conventions ($+X$ forward, $+Y$ left, $+Z$ up). |
| **ROS** | Robot Operating System | Open-source robotics middleware suite for hardware abstraction and device drivers. |
| **SDD** | Spec-Driven Development | Rigorous software engineering methodology driven by formal specifications, designs, and tasks before implementation. |
| **SLERP** | Spherical Linear Interpolation | Constant-velocity rotational interpolation along the geodesic of a 4D unit sphere for unit quaternions. |
| **SPA** | Single Page Application | Web application loading a single HTML document and updating UI dynamically via JavaScript. |
| **URDF** | Unified Robot Description Format | XML representation of a robot model specifying kinematic linkages, visual geometries, and joint limits. |
| **V8** | Google V8 JavaScript Engine | High-performance C++ JavaScript and WebAssembly engine powering Google Chrome and Node.js. |
| **WebGL** | Web Graphics Library | JavaScript API for rendering interactive 2D and 3D graphics within compatible browsers without plugins. |
| **WS / WSS** | WebSocket / WebSocket Secure | Full-duplex persistent communication protocol operating over a single TCP connection. |

---

## 2. Core Engineering & Theoretical Concepts

### 2.1 The 16.67 ms Frame Budget
In browser-based graphics, displaying animations at a fluid **60 FPS** requires the application to complete all JavaScript computation, physics updates, scene graph traversal, and WebGL draw call dispatches within **$16.667\text{ ms}$** ($1/60\text{ s}$):

$$\Delta t_{\text{frame}} \le 16.67\text{ ms}$$

If any task (such as heavy JSON parsing or garbage collection) blocks the single-threaded JavaScript execution context for longer than $16.67\text{ ms}$, the browser drops a display frame, causing visible stuttering (*jank*).

```
 0 ms                                             16.67 ms
 ┌─────────────────┬──────────────────┬──────────────┬────────┐
 │ WebSocket Parse │  Kinematics Lerp │ Three.js Draw│ GPU Idle│  ==> 60 FPS (Healthy)
 └─────────────────┴──────────────────┴──────────────┴────────┘
 ┌───────────────────────────────────────────────┬────────────┐
 │  GC Stop-the-World Pause (25 - 40 ms)         │ Three.js   │  ==> FRAME DROPPED (18 FPS)
 └───────────────────────────────────────────────┴────────────┘
```

---

### 2.2 Deadband Threshold Filtering ($\epsilon$)
A deadband is an interval of signal variation where no action is taken. In telemetry streaming, industrial sensors often experience tiny analog fluctuations (high-frequency noise) that convey zero meaningful state changes to human operators or 3D visualizers.

Given a signal $s_i(t)$ and its last transmitted value $s_i(t_{\text{last}})$, the transmission condition is:

$$|\Delta s_i(t)| = |s_i(t) - s_i(t_{\text{last}})| > \epsilon_i$$

* If $|\Delta s_i| \le \epsilon$, the signal is filtered out.
* If $|\Delta s_i| > \epsilon$, the signal is emitted, and the cached reference updates: $s_i(t_{\text{last}}) \leftarrow s_i(t)$.

---

### 2.3 Unit Quaternions in $\mathbb{H}$ & The Double Cover of $\text{SO}(3)$
Quaternions extend complex numbers into four dimensions:

$$\mathbf{q} = q_w + q_x \mathbf{i} + q_y \mathbf{j} + q_z \mathbf{k} \equiv [q_x, q_y, q_z, q_w]^T$$

where $\mathbf{i}^2 = \mathbf{j}^2 = \mathbf{k}^2 = \mathbf{i}\mathbf{j}\mathbf{k} = -1$.

A 3D rotation of angle $\theta$ around a normalized unit axis $\mathbf{u} = [u_x, u_y, u_z]^T$ is encoded as:

$$\mathbf{q} = \left[ u_x \sin\frac{\theta}{2},\, u_y \sin\frac{\theta}{2},\, u_z \sin\frac{\theta}{2},\, \cos\frac{\theta}{2} \right]^T$$

#### Key Advantages over Euler Angles:
1. **Zero Gimbal Lock**: No coordinate singularities at $90^\circ$ pitch angles.
2. **Smooth Interpolation**: Clean geodesic motion via SLERP.
3. **Compact Representation**: 4 floating-point values vs. 9 values in a $3 \times 3$ rotation matrix.

#### The Double Cover:
Quaternions $\mathbf{q}$ and $-\mathbf{q}$ represent the exact same 3D spatial orientation. When interpolating between $\mathbf{q}_0$ and $\mathbf{q}_1$, if the 4D dot product $\mathbf{q}_0 \cdot \mathbf{q}_1 < 0$, the target must be inverted ($\mathbf{q}_1 \leftarrow -\mathbf{q}_1$) to interpolate across the acute, shortest path on $S^3$.

---

### 2.4 Spherical Linear Interpolation (SLERP) Formula
Given two unit quaternions $\mathbf{q}_0$ and $\mathbf{q}_1$ with angular distance $\theta = \arccos(\mathbf{q}_0 \cdot \mathbf{q}_1)$, SLERP computes intermediate rotations over interpolation parameter $\alpha \in [0, 1]$:

$$\operatorname{Slerp}(\mathbf{q}_0, \mathbf{q}_1; \alpha) = \frac{\sin((1 - \alpha)\theta)}{\sin\theta} \mathbf{q}_0 + \frac{\sin(\alpha\theta)}{\sin\theta} \mathbf{q}_1$$

When $\theta \approx 0$ ($\cos\theta > 0.9995$), division by $\sin\theta \to 0$ becomes numerically unstable; the algorithm gracefully falls back to normalized linear interpolation ($\text{NLerp}$).

---

### 2.5 Forward Kinematics Tree
In robotics, forward kinematics computes the world position and orientation of each link from the base to the end-effector.

For a chain of $N$ links, each link $i$ has a local transformation matrix $\mathbf{T}_i^{\text{local}}$ relative to parent link $i-1$:

$$\mathbf{T}_i^{\text{local}} = \begin{bmatrix} \mathbf{R}_i & \mathbf{p}_i \\ \mathbf{0}^T & 1 \end{bmatrix}$$

The world transformation matrix $\mathbf{T}_i^{\text{world}}$ is computed recursively:

$$\mathbf{T}_i^{\text{world}} = \mathbf{T}_{i-1}^{\text{world}} \cdot \mathbf{T}_i^{\text{local}} = \prod_{k=0}^{i} \mathbf{T}_k^{\text{local}}$$

In Three.js, adding meshes as children of other meshes (`parentMesh.add(childMesh)`) builds this scene graph natively, evaluating transformations via `scene.updateMatrixWorld()`.

---

### 2.6 V8 Garbage Collection: Minor Scavenger vs. Major Mark-Sweep
Google V8 manages heap memory using two primary collectors:
1. **Scavenge (Minor GC)**: Collects young-generation memory using a Cheney copy algorithm. Very fast ($1\text{ ms} - 5\text{ ms}$), but frequent execution causes CPU cache churn.
2. **Mark-Sweep-Compact (Major GC)**: Collects old-generation memory when full. Requires sweeping the entire heap and updating pointers. This triggers **Stop-The-World pauses** lasting $15\text{ ms}$ to $40\text{ ms}$.

**The Zero-Allocation Rule**: Eliminating `new` keyword calls inside the 60 FPS animation loop prevents young objects from ever promoting to the old generation, completely eliminating Major GC pauses.

---

### 2.7 WebSocket Backpressure Management
When a client device slows down (due to CPU saturation, background tabs, or mobile network throttling), the server's TCP socket buffer fills up. Continuing to send packets without throttling causes unbounded memory accumulation in the server's Node.js heap.

**Backpressure Protection**:
* Monitor `client.bufferedAmount`.
* If `bufferedAmount > threshold` (default $64\text{ KB}$), skip intermediate delta packets for that client until the buffer drains.
* Drop telemetry frames gracefully rather than crashing the Node.js process with an out-of-memory error.
