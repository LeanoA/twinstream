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

  // Cached materials for zero-allocation rendering and uniform aesthetics
  private materials = {
    chassis: new THREE.MeshStandardMaterial({
      color: 0x24292f,
      roughness: 0.35,
      metalness: 0.85
    }),
    joint: new THREE.MeshStandardMaterial({
      color: 0x30363d,
      roughness: 0.25,
      metalness: 0.9
    }),
    accentAmber: new THREE.MeshStandardMaterial({
      color: 0xd29922,
      roughness: 0.4,
      metalness: 0.6
    }),
    accentBlue: new THREE.MeshStandardMaterial({
      color: 0x1f6feb,
      roughness: 0.3,
      metalness: 0.7,
      emissive: 0x09264a,
      emissiveIntensity: 0.4
    }),
    gripper: new THREE.MeshStandardMaterial({
      color: 0x8b949e,
      roughness: 0.2,
      metalness: 0.9
    }),
    ground: new THREE.MeshStandardMaterial({
      color: 0x161b22,
      roughness: 0.85,
      metalness: 0.15
    })
  };

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1117);
    this.scene.fog = new THREE.FogExp2(0x0d1117, 0.035);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(4.5, 3.5, 5.5);

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
    this.controls.target.set(0, 1.8, 0);
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
    const ambientLight = new THREE.AmbientLight(0x22272e, 1.6);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(5, 8, 4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 25;
    keyLight.shadow.camera.left = -5;
    keyLight.shadow.camera.right = 5;
    keyLight.shadow.camera.top = 5;
    keyLight.shadow.camera.bottom = -5;
    keyLight.shadow.bias = -0.0005;
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x58a6ff, 0.8);
    fillLight.position.set(-4, 3, -3);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xd29922, 0.5);
    rimLight.position.set(0, 4, -5);
    this.scene.add(rimLight);
  }

  private setupEnvironment(): void {
    // Ground plate
    const groundGeo = new THREE.CircleGeometry(6, 48);
    const groundMesh = new THREE.Mesh(groundGeo, this.materials.ground);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = -0.01;
    groundMesh.receiveShadow = true;
    this.scene.add(groundMesh);

    // Engineering grid helper
    const grid = new THREE.GridHelper(10, 20, 0x30363d, 0x161b22);
    grid.position.y = 0;
    this.scene.add(grid);
  }

  /**
   * Procedural construction of 10 robotic assemblies corresponding 1:1
   * with data/mock_telemetry_layout.json assembly identifiers.
   */
  private buildProceduralAssemblies(): void {
    // Assembly 0: Base Mounting Platform
    const asm0 = new THREE.Group();
    asm0.name = 'assembly_00_base';
    const baseCyl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.9, 0.25, 32),
      this.materials.chassis
    );
    baseCyl.position.y = 0.125;
    baseCyl.castShadow = true;
    baseCyl.receiveShadow = true;
    const baseCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.65, 0.65, 0.1, 32),
      this.materials.joint
    );
    baseCollar.position.y = 0.3;
    baseCollar.castShadow = true;
    asm0.add(baseCyl, baseCollar);
    this.registerAssembly(asm0);

    // Assembly 1: Azimuth Turret Rotating Joint
    const asm1 = new THREE.Group();
    asm1.name = 'assembly_01_turret';
    const turretBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.6, 0.4, 32),
      this.materials.joint
    );
    turretBody.castShadow = true;
    const turretStanchion1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.45, 0.3),
      this.materials.chassis
    );
    turretStanchion1.position.set(-0.25, 0.25, 0);
    turretStanchion1.castShadow = true;
    const turretStanchion2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.45, 0.3),
      this.materials.chassis
    );
    turretStanchion2.position.set(0.25, 0.25, 0);
    turretStanchion2.castShadow = true;
    asm1.add(turretBody, turretStanchion1, turretStanchion2);
    this.registerAssembly(asm1);

    // Assembly 2: Shoulder Pitch Joint & Boom
    const asm2 = new THREE.Group();
    asm2.name = 'assembly_02_shoulder';
    const shoulderPin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.55, 24),
      this.materials.joint
    );
    shoulderPin.rotation.z = Math.PI / 2;
    shoulderPin.castShadow = true;
    const shoulderRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.32, 0.03, 16, 32),
      this.materials.accentAmber
    );
    shoulderRing.rotation.y = Math.PI / 2;
    shoulderRing.castShadow = true;
    asm2.add(shoulderPin, shoulderRing);
    this.registerAssembly(asm2);

    // Assembly 3: Elbow Pitch Joint & Arm Link
    const asm3 = new THREE.Group();
    asm3.name = 'assembly_03_elbow';
    const elbowPin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.26, 0.48, 24),
      this.materials.joint
    );
    elbowPin.rotation.z = Math.PI / 2;
    elbowPin.castShadow = true;
    const elbowTruss = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.6, 0.2),
      this.materials.chassis
    );
    elbowTruss.position.y = 0.3;
    elbowTruss.castShadow = true;
    asm3.add(elbowPin, elbowTruss);
    this.registerAssembly(asm3);

    // Assembly 4: Forearm Roll Actuator
    const asm4 = new THREE.Group();
    asm4.name = 'assembly_04_forearm';
    const forearmBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.24, 0.8, 24),
      this.materials.chassis
    );
    forearmBody.castShadow = true;
    const forearmBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.08, 24),
      this.materials.accentAmber
    );
    forearmBand.castShadow = true;
    asm4.add(forearmBody, forearmBand);
    this.registerAssembly(asm4);

    // Assembly 5: Wrist Pitch Gimbal
    const asm5 = new THREE.Group();
    asm5.name = 'assembly_05_wrist_pitch';
    const wristPitchYoke = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.25, 0.2),
      this.materials.joint
    );
    wristPitchYoke.castShadow = true;
    asm5.add(wristPitchYoke);
    this.registerAssembly(asm5);

    // Assembly 6: Wrist Yaw Gimbal
    const asm6 = new THREE.Group();
    asm6.name = 'assembly_06_wrist_yaw';
    const wristYawHub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.2, 24),
      this.materials.joint
    );
    wristYawHub.castShadow = true;
    asm6.add(wristYawHub);
    this.registerAssembly(asm6);

    // Assembly 7: Wrist Roll Flange
    const asm7 = new THREE.Group();
    asm7.name = 'assembly_07_wrist_roll';
    const wristRollFlange = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 0.08, 24),
      this.materials.accentAmber
    );
    wristRollFlange.castShadow = true;
    asm7.add(wristRollFlange);
    this.registerAssembly(asm7);

    // Assembly 8: Multi-Jaw End Effector Tool
    const asm8 = new THREE.Group();
    asm8.name = 'assembly_08_end_effector';
    const toolBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.06, 0.14),
      this.materials.chassis
    );
    toolBase.castShadow = true;
    const finger1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.16, 0.04),
      this.materials.gripper
    );
    finger1.position.set(-0.06, 0.1, 0);
    finger1.castShadow = true;
    const finger2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.16, 0.04),
      this.materials.gripper
    );
    finger2.position.set(0.06, 0.1, 0);
    finger2.castShadow = true;
    asm8.add(toolBase, finger1, finger2);
    this.registerAssembly(asm8);

    // Assembly 9: High-Resolution Sensory Payload Pod
    const asm9 = new THREE.Group();
    asm9.name = 'assembly_09_sensor_pod';
    const podSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 24, 16),
      this.materials.accentBlue
    );
    podSphere.castShadow = true;
    const lensRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.08, 0.02, 16, 32),
      this.materials.accentAmber
    );
    lensRing.castShadow = true;
    asm9.add(podSphere, lensRing);
    this.registerAssembly(asm9);
  }

  private registerAssembly(group: THREE.Group): void {
    this.scene.add(group);
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
