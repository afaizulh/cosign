const cards = Array.from(document.querySelectorAll("[data-model-preview]"));
if (cards.length > 0) start();

function start() {
  loadThree()
    .then((lib) => watchCards(lib))
    .catch((err) => {
      console.error(err);
      for (const card of cards) setFallbackText(card, "3D preview unavailable");
    });
}

async function loadThree() {
  const [THREE, gltf, draco, meshopt, obj, stl, fbx, usdz] = await Promise.all([
    import("three"),
    import("three/addons/loaders/GLTFLoader.js"),
    import("three/addons/loaders/DRACOLoader.js"),
    import("three/addons/libs/meshopt_decoder.module.js"),
    import("three/addons/loaders/OBJLoader.js"),
    import("three/addons/loaders/STLLoader.js"),
    import("three/addons/loaders/FBXLoader.js"),
    import("three/addons/loaders/USDZLoader.js"),
  ]);

  const gltfLoader = new gltf.GLTFLoader();
  const dracoLoader = new draco.DRACOLoader();
  dracoLoader.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/");
  gltfLoader.setDRACOLoader(dracoLoader);
  gltfLoader.setMeshoptDecoder(meshopt.MeshoptDecoder);

  return {
    THREE,
    loaders: {
      glb: gltfLoader,
      gltf: gltfLoader,
      obj: new obj.OBJLoader(),
      stl: new stl.STLLoader(),
      fbx: new fbx.FBXLoader(),
      usdz: new usdz.USDZLoader(),
    },
  };
}

function watchCards(lib) {
  const queue = [];
  let running = false;

  function pump() {
    if (running) return;
    const card = queue.shift();
    if (!card) return;
    running = true;
    renderCard(lib, card).finally(() => {
      running = false;
      pump();
    });
  }

  function enqueue(card) {
    if (card.dataset.previewDone === "1" || queue.includes(card)) return;
    queue.push(card);
    pump();
  }

  if (!("IntersectionObserver" in window)) {
    cards.forEach(enqueue);
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        enqueue(entry.target);
      }
    },
    { rootMargin: "300px" }
  );
  for (const card of cards) io.observe(card);
}

async function renderCard({ THREE, loaders }, card) {
  const src = card.dataset.src;
  const ext = (card.dataset.ext || "").toLowerCase();
  const loader = loaders[ext];
  if (!src || !loader) {
    setFallbackText(card, "Format not supported");
    card.dataset.previewDone = "1";
    return;
  }

  const WIDTH = 480;
  const HEIGHT = 600;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, WIDTH / HEIGHT, 0.01, 1000);
  let renderer = null;
  let object = null;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(WIDTH, HEIGHT, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x475569, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(4, 8, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.9);
    fill.position.set(-5, 2, -4);
    scene.add(fill);

    object = await loadModel(loader, src, ext, THREE);
    scene.add(object);
    frameObject(THREE, camera, object);
    renderer.render(scene, camera);

    const url = renderer.domElement.toDataURL("image/png");
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.className =
      "absolute inset-0 w-full h-full object-contain p-2 drop-shadow-xl transition duration-500 group-hover:scale-[1.04]";
    card.appendChild(img);
    card.querySelector("[data-preview-fallback]")?.classList.add("hidden");
    card.dataset.previewDone = "1";
  } catch (err) {
    console.error(`3D preview failed for ${src}`, err);
    setFallbackText(card, "Preview unavailable");
    card.dataset.previewDone = "1";
  } finally {
    if (object) {
      scene.remove(object);
      disposeObject(object);
    }
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
    }
  }
}

async function loadModel(loader, src, ext, THREE) {
  if (ext === "glb" || ext === "gltf") {
    const gltf = await loader.loadAsync(src);
    return gltf.scene;
  }
  if (ext === "stl") {
    const geometry = await loader.loadAsync(src);
    geometry.computeVertexNormals();
    return new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.1, roughness: 0.7 })
    );
  }
  return await loader.loadAsync(src);
}

function frameObject(THREE, camera, object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
  const fov = (camera.fov * Math.PI) / 180;
  const distance = (radius / Math.sin(fov / 2)) * 1.15;
  const direction = new THREE.Vector3(1, 0.55, 1.2).normalize();

  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = Math.max(radius / 100, 0.001);
  camera.far = radius * 100;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
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

function setFallbackText(card, text) {
  const label = card.querySelector("[data-preview-fallback] span");
  if (label) label.textContent = text;
}
