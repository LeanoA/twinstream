import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class SceneManager {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private assemblyObjects: Map<string, THREE.Object3D> = new Map();
  private resizeObserver: ResizeObserver | null = null;
  private boundResizeHandler: () => void;

  // Cached materials for zero-allocation rendering and high-visibility industrial aesthetics
  private materials = {
    chassis: new THREE.MeshStandardMaterial({
      color: 0x3b4252,
      roughness: 0.3,
      metalness: 0.7
    }),
    joint: new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.2,
      metalness: 0.85
    }),
    accentAmber: new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.3,
      metalness: 0.5
    }),
    accentBlue: new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.15,
      metalness: 0.8,
      emissive: 0x0284c7,
      emissiveIntensity: 1.0
    }),
    gripper: new THREE.MeshStandardMaterial({
      color: 0xcfd8dc,
      roughness: 0.1,
      metalness: 0.95
    }),
    ground: new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.7,
      metalness: 0.3
    })
  };

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x13171f);
    this.scene.fog = new THREE.FogExp2(0x13171f, 0.015);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(4.5, 3.2, 5.5);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.6, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // Prevent subsurface orbit
    this.controls.minDistance = 1.0;
    this.controls.maxDistance = 25.0;

    this.boundResizeHandler = this.handleResize.bind(this);
  }

  public init(): void {
    this.setupLighting();
    this.setupEnvironment();
    this.buildProceduralAssemblies();

    window.addEventListener('resize', this.boundResizeHandler);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.boundResizeHandler);
      this.resizeObserver.observe(this.container);
    }
  }

  private setupLighting(): void {
    // 1. Hemisphere Light: Natural skylight + ground bounce
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x334155, 2.2);
    hemiLight.position.set(0, 15, 0);
    this.scene.add(hemiLight);

    // 2. Ambient Light: Soft overall base illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(ambientLight);

    // 3. Key Light: Strong front-top directional light with soft shadows
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(6, 10, 5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 30;
    keyLight.shadow.camera.left = -6;
    keyLight.shadow.camera.right = 6;
    keyLight.shadow.camera.top = 6;
    keyLight.shadow.camera.bottom = -6;
    keyLight.shadow.bias = -0.0003;
    this.scene.add(keyLight);

    // 4. Fill Light: Opposite side fill preventing pitch-black shadows
    const fillLight = new THREE.DirectionalLight(0x93c5fd, 1.8);
    fillLight.position.set(-6, 6, -3);
    this.scene.add(fillLight);

    // 5. Back Rim Light: Highlights silhouettes and edge bevels
    const rimLight = new THREE.DirectionalLight(0xfde68a, 1.5);
    rimLight.position.set(2, 6, -6);
    this.scene.add(rimLight);
  }

  private setupEnvironment(): void {
    // Heavy circular pedestal ground disc
    const groundGeo = new THREE.CircleGeometry(6, 48);
    const groundMesh = new THREE.Mesh(groundGeo, this.materials.ground);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = -0.01;
    groundMesh.receiveShadow = true;
    this.scene.add(groundMesh);

    // Engineering grid helper
    const grid = new THREE.GridHelper(10, 20, 0x475569, 0x334155);
    grid.position.y = 0;
    this.scene.add(grid);
  }

  /**
   * Procedural construction of 10 robotic assemblies structured according to
   * the URDF (Unified Robot Description Format) / ROS REP-103 standard.
   *
   * Formats a hierarchical kinematic tree (parent -> child) using contiguous,
   * interlocking mechanical links without air gaps or floating pieces.
   */
  private buildProceduralAssemblies(): void {
    // =========================================================================
    // Link 0: Base Mounting Platform (Root)
    // =========================================================================
    const asm0 = new THREE.Group();
    asm0.name = 'assembly_00_base';

    // Octagonal/cylindrical floor pedestal: y from 0 to 0.18
    const basePlate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.95, 0.18, 32),
      this.materials.chassis
    );
    basePlate.position.y = 0.09;
    basePlate.castShadow = true;
    basePlate.receiveShadow = true;

    // Turntable bearing collar: y from 0.18 to 0.35
    const baseTurntableCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.58, 0.62, 0.17, 32),
      this.materials.joint
    );
    baseTurntableCollar.position.y = 0.265;
    baseTurntableCollar.castShadow = true;

    // Amber safety rim
    const baseSafetyRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.75, 0.02, 16, 48),
      this.materials.accentAmber
    );
    baseSafetyRing.rotation.x = Math.PI / 2;
    baseSafetyRing.position.y = 0.18;

    asm0.add(basePlate, baseTurntableCollar, baseSafetyRing);
    this.registerAssembly(asm0);
    this.scene.add(asm0);

    // =========================================================================
    // Link 1: Azimuth Turret Rotating Joint (Child of Link 0)
    // Joint Origin: [0, 0.35, 0] relative to Base
    // =========================================================================
    const asm1 = new THREE.Group();
    asm1.name = 'assembly_01_turret';
    asm1.position.set(0, 0.35, 0);

    // Rotating plinth flush with base collar
    const turretPlinth = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 0.12, 32),
      this.materials.joint
    );
    turretPlinth.position.y = 0.06;
    turretPlinth.castShadow = true;

    // Dual upright fork stanchions cradling the shoulder axis at local y = 0.45
    const leftStanchion = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.42, 0.38),
      this.materials.chassis
    );
    leftStanchion.position.set(-0.28, 0.27, 0);
    leftStanchion.castShadow = true;

    const rightStanchion = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.42, 0.38),
      this.materials.chassis
    );
    rightStanchion.position.set(0.28, 0.27, 0);
    rightStanchion.castShadow = true;

    // Turret center motor casing
    const turretMotor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.28, 24),
      this.materials.accentAmber
    );
    turretMotor.position.set(0, 0.2, -0.1);
    turretMotor.castShadow = true;

    asm1.add(turretPlinth, leftStanchion, rightStanchion, turretMotor);
    this.registerAssembly(asm1);
    asm0.add(asm1); // Hierarchical link

    // =========================================================================
    // Link 2: Shoulder Pitch Joint & Boom (Child of Link 1)
    // Joint Origin: [0, 0.45, 0] relative to Turret (between fork stanchions)
    // =========================================================================
    const asm2 = new THREE.Group();
    asm2.name = 'assembly_02_shoulder';
    asm2.position.set(0, 0.45, 0);

    // Transverse axle cylinder spanning between fork stanchions
    const shoulderAxle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.58, 24),
      this.materials.joint
    );
    shoulderAxle.rotation.z = Math.PI / 2;
    shoulderAxle.castShadow = true;

    // Main Upper Arm Boom (Link 2 body): extends along local +Y from 0 to 0.95!
    const boomBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.95, 0.22),
      this.materials.chassis
    );
    boomBody.position.set(0, 0.475, 0);
    boomBody.castShadow = true;

    // Boom decorative side reinforcement plates
    const boomPlateL = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.85, 0.18),
      this.materials.accentAmber
    );
    boomPlateL.position.set(-0.13, 0.475, 0);
    const boomPlateR = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.85, 0.18),
      this.materials.accentAmber
    );
    boomPlateR.position.set(0.13, 0.475, 0);

    // Rear counterweight balancing the arm
    const counterweight = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.22, 0.3),
      this.materials.chassis
    );
    counterweight.position.set(0, -0.08, -0.25);
    counterweight.castShadow = true;

    asm2.add(shoulderAxle, boomBody, boomPlateL, boomPlateR, counterweight);
    this.registerAssembly(asm2);
    asm1.add(asm2); // Hierarchical link

    // =========================================================================
    // Link 3: Elbow Pitch Joint (Child of Link 2)
    // Joint Origin: [0, 0.95, 0] relative to Shoulder (at tip of Boom)
    // =========================================================================
    const asm3 = new THREE.Group();
    asm3.name = 'assembly_03_elbow';
    asm3.position.set(0, 0.95, 0);

    // Transverse elbow pivot cylinder
    const elbowHinge = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.46, 24),
      this.materials.joint
    );
    elbowHinge.rotation.z = Math.PI / 2;
    elbowHinge.castShadow = true;

    // Elbow actuator housing
    const elbowHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.15, 24),
      this.materials.accentAmber
    );
    elbowHousing.rotation.z = Math.PI / 2;
    elbowHousing.position.set(0.2, 0, 0);
    elbowHousing.castShadow = true;

    asm3.add(elbowHinge, elbowHousing);
    this.registerAssembly(asm3);
    asm2.add(asm3); // Hierarchical link

    // =========================================================================
    // Link 4: Forearm Roll Actuator & Body (Child of Link 3)
    // Joint Origin: [0, 0, 0] relative to Elbow
    // =========================================================================
    const asm4 = new THREE.Group();
    asm4.name = 'assembly_04_forearm';
    asm4.position.set(0, 0, 0);

    // Forearm structural casing extending along local +Y from 0 to 0.85!
    const forearmCasing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.2, 0.85, 24),
      this.materials.chassis
    );
    forearmCasing.position.set(0, 0.425, 0);
    forearmCasing.castShadow = true;

    // Forearm mid-band collar
    const forearmCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.17, 0.08, 24),
      this.materials.accentAmber
    );
    forearmCollar.position.set(0, 0.425, 0);
    forearmCollar.castShadow = true;

    asm4.add(forearmCasing, forearmCollar);
    this.registerAssembly(asm4);
    asm3.add(asm4); // Hierarchical link

    // =========================================================================
    // Link 5: Wrist Pitch Gimbal (Child of Link 4)
    // Joint Origin: [0, 0.85, 0] relative to Forearm (at tip of Forearm)
    // =========================================================================
    const asm5 = new THREE.Group();
    asm5.name = 'assembly_05_wrist_pitch';
    asm5.position.set(0, 0.85, 0);

    // Outer pitch gimbal yoke
    const wristPitchYoke = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.18, 0.2),
      this.materials.joint
    );
    wristPitchYoke.position.set(0, 0.06, 0);
    wristPitchYoke.castShadow = true;

    asm5.add(wristPitchYoke);
    this.registerAssembly(asm5);
    asm4.add(asm5); // Hierarchical link

    // =========================================================================
    // Link 6: Wrist Yaw Gimbal (Child of Link 5)
    // Joint Origin: [0, 0.12, 0] relative to Wrist Pitch
    // =========================================================================
    const asm6 = new THREE.Group();
    asm6.name = 'assembly_06_wrist_yaw';
    asm6.position.set(0, 0.12, 0);

    // Inner rotary gimbal hub
    const wristYawHub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.12, 24),
      this.materials.joint
    );
    wristYawHub.position.set(0, 0.05, 0);
    wristYawHub.castShadow = true;

    asm6.add(wristYawHub);
    this.registerAssembly(asm6);
    asm5.add(asm6); // Hierarchical link

    // =========================================================================
    // Link 7: Wrist Roll Flange (Child of Link 6)
    // Joint Origin: [0, 0.10, 0] relative to Wrist Yaw
    // =========================================================================
    const asm7 = new THREE.Group();
    asm7.name = 'assembly_07_wrist_roll';
    asm7.position.set(0, 0.1, 0);

    // Circular ISO tool face flange
    const wristRollFlange = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.04, 24),
      this.materials.accentAmber
    );
    wristRollFlange.position.set(0, 0.02, 0);
    wristRollFlange.castShadow = true;

    asm7.add(wristRollFlange);
    this.registerAssembly(asm7);
    asm6.add(asm7); // Hierarchical link

    // =========================================================================
    // Link 8: Multi-Jaw End Effector Tool (Child of Link 7)
    // Joint Origin: [0, 0.04, 0] relative to Tool Flange
    // =========================================================================
    const asm8 = new THREE.Group();
    asm8.name = 'assembly_08_end_effector';
    asm8.position.set(0, 0.04, 0);

    // Tool bracket base
    const toolBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.05, 0.12),
      this.materials.chassis
    );
    toolBase.position.set(0, 0.025, 0);
    toolBase.castShadow = true;

    // Two parallel pneumatic gripper finger jaws
    const finger1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.14, 0.035),
      this.materials.gripper
    );
    finger1.position.set(-0.055, 0.095, 0);
    finger1.castShadow = true;

    const finger2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.14, 0.035),
      this.materials.gripper
    );
    finger2.position.set(0.055, 0.095, 0);
    finger2.castShadow = true;

    asm8.add(toolBase, finger1, finger2);
    this.registerAssembly(asm8);
    asm7.add(asm8); // Hierarchical link

    // =========================================================================
    // Link 9: Sensory Payload Pod (Child of Link 8)
    // Joint Origin: [0.08, 0.06, 0.08] bracket-mounted on Tool
    // =========================================================================
    const asm9 = new THREE.Group();
    asm9.name = 'assembly_09_sensor_pod';
    asm9.position.set(0.08, 0.06, 0.08);

    // Optical inspection pod head
    const podSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 24, 16),
      this.materials.chassis
    );
    podSphere.castShadow = true;

    // Blue luminescent optical scanning lens ring
    const lensRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.06, 0.018, 16, 32),
      this.materials.accentBlue
    );
    lensRing.position.set(0, 0, 0.05);
    lensRing.castShadow = true;

    // Mounting bracket arm linking to gripper chassis
    const podBracket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.08, 12),
      this.materials.joint
    );
    podBracket.rotation.z = Math.PI / 4;
    podBracket.position.set(-0.03, -0.03, -0.03);

    asm9.add(podSphere, lensRing, podBracket);
    this.registerAssembly(asm9);
    asm8.add(asm9); // Hierarchical link
  }

  private registerAssembly(group: THREE.Group): void {
    this.assemblyObjects.set(group.name, group);
  }

  public getAssemblyObjects(): Map<string, THREE.Object3D> {
    return this.assemblyObjects;
  }

  public render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  public handleResize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  }

  public dispose(): void {
    window.removeEventListener('resize', this.boundResizeHandler);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.controls.dispose();

    // Dispose all procedural meshes & materials
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        if (object.geometry) object.geometry.dispose();
      }
    });

    Object.values(this.materials).forEach((mat) => mat.dispose());

    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
