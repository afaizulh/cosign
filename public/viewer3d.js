import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { USDZLoader } from "three/addons/loaders/USDZLoader.js";

const root = document.getElementById("viewer3d");
const assetButtons = Array.from(document.querySelectorAll("[data-viewer-asset]"));
if (root && assetButtons.length > 0) {
  try {
    init();
  } catch (err) {
    console.error(err);
    document.getElementById("viewer-loading")?.classList.add("hidden");
    const errorBox = document.getElementById("viewer-error");
    if (errorBox) {
      errorBox.textContent = "3D viewer is not supported in this browser. Download the model instead.";
      errorBox.classList.remove("hidden");
    }
  }
}

function init() {
  const loading = document.getElementById("viewer-loading");
  const loadingText = document.getElementById("viewer-loading-text");
  const errorBox = document.getElementById("viewer-error");
  const download = document.getElementById("viewer-download");
  const resetBtn = document.getElementById("viewer-reset");
  const autoBtn = document.getElementById("viewer-autorotate");
  const wireBtn = document.getElementById("viewer-wireframe");
  const fullBtn = document.getElementById("viewer-fullscreen");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  camera.position.set(2, 1.5, 2);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  root.prepend(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2));
  const key = new THREE.DirectionalLight(0xffffff, 2.5);
  key.position.set(4, 8, 6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.8);
  fill.position.set(-5, 2, -4);
  scene.add(fill);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.autoRotateSpeed = 1.5;

  const clock = new THREE.Clock();
  let current = null;
  let mixer = null;
  let wireframe = false;
  let loadToken = 0;

  const gltfLoader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/");
  gltfLoader.setDRACOLoader(dracoLoader);
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  const objLoader = new OBJLoader();
  const stlLoader = new STLLoader();
  const fbxLoader = new FBXLoader();
  const usdzLoader = new USDZLoader();

  function setLoading(text) {
    if (!loading) return;
    loading.classList.remove("hidden");
    if (loadingText) loadingText.textContent = text;
  }

  function clearLoading() {
    loading?.classList.add("hidden");
  }

  function showError(message) {
    clearLoading();
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
  }

  function clearError() {
    errorBox?.classList.add("hidden");
  }

  function disposeObject(object) {
    object.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!material) continue;
        for (const value of Object.values(material)) {
          if (value && value.isTexture) value.dispose();
        }
        material.dispose();
      }
    });
  }

  function clearCurrent() {
    if (mixer) {
      mixer.stopAllAction();
      mixer = null;
    }
    if (current) {
      scene.remove(current);
      disposeObject(current);
      current = null;
    }
  }

  async function loadModel(src, ext) {
    if (ext === "glb" || ext === "gltf") {
      const gltf = await gltfLoader.loadAsync(src);
      gltf.scene.userData.animations = gltf.animations;
      return gltf.scene;
    }
    if (ext === "obj") {
      return await objLoader.loadAsync(src);
    }
    if (ext === "stl") {
      const geometry = await stlLoader.loadAsync(src);
      geometry.computeVertexNormals();
      return new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.1, roughness: 0.7 })
      );
    }
    if (ext === "fbx") {
      return await fbxLoader.loadAsync(src);
    }
    if (ext === "usdz") {
      return await usdzLoader.loadAsync(src);
    }
    throw new Error(`Unsupported format: ${ext}`);
  }

  function frameObject(object) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;

    controls.target.copy(center);
    const distance = radius * 2.6;
    camera.position.copy(center).add(new THREE.Vector3(1, 0.65, 1).normalize().multiplyScalar(distance));
    camera.near = Math.max(radius / 100, 0.001);
    camera.far = radius * 100;
    camera.updateProjectionMatrix();

    controls.minDistance = radius * 0.4;
    controls.maxDistance = radius * 25;
    controls.update();
  }

  function setActive(button) {
    for (const b of assetButtons) {
      const active = b === button;
      b.classList.toggle("border-indigo-500", active);
      b.classList.toggle("bg-indigo-50", active);
      b.classList.toggle("border-slate-200", !active);
    }
  }

  function applyWireframe() {
    if (!current) return;
    current.traverse((node) => {
      if (!node.isMesh) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (material && "wireframe" in material) material.wireframe = wireframe;
      }
    });
    wireBtn?.setAttribute("aria-pressed", String(wireframe));
  }

  async function showAsset(button) {
    const src = button.dataset.src;
    const ext = (button.dataset.ext || "").toLowerCase();
    const name = button.dataset.name || "model";
    setActive(button);
    clearError();
    setLoading(`Loading ${name}…`);
    const token = ++loadToken;
    try {
      const object = await loadModel(src, ext);
      if (token !== loadToken) {
        disposeObject(object);
        return;
      }
      clearCurrent();
      current = object;
      wireframe = false;
      scene.add(current);
      const clips = object.userData?.animations || object.animations;
      if (clips?.length) {
        mixer = new THREE.AnimationMixer(object);
        for (const clip of clips) mixer.clipAction(clip).play();
      }
      frameObject(current);
      applyWireframe();
      if (download) download.href = src;
      clearLoading();
      if (location.hash !== `#${button.id}`) {
        history.replaceState(null, "", `#${button.id}`);
      }
    } catch (err) {
      if (token !== loadToken) return;
      clearCurrent();
      showError(
        `Could not load "${name}". The file may be corrupt or reference missing textures. Try downloading it instead.`
      );
      console.error(err);
    }
  }

  let lastWidth = 0;
  let lastHeight = 0;
  function resize() {
    const width = root.clientWidth;
    const height = root.clientHeight;
    if (!width || !height || (width === lastWidth && height === lastHeight)) return;
    lastWidth = width;
    lastHeight = height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(root);
  resize();

  resetBtn?.addEventListener("click", () => {
    if (current) frameObject(current);
  });

  autoBtn?.addEventListener("click", () => {
    controls.autoRotate = !controls.autoRotate;
    autoBtn.setAttribute("aria-pressed", String(controls.autoRotate));
  });

  wireBtn?.addEventListener("click", () => {
    wireframe = !wireframe;
    applyWireframe();
  });

  fullBtn?.addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      root.requestFullscreen?.().catch(() => {});
    }
  });
  document.addEventListener("fullscreenchange", () => {
    lastWidth = 0;
    resize();
  });

  for (const button of assetButtons) {
    button.addEventListener("click", () => showAsset(button));
  }

  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    if (mixer) mixer.update(delta);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  const fromHash = assetButtons.find((b) => `#${b.id}` === location.hash);
  showAsset(fromHash || assetButtons[0]);
}
