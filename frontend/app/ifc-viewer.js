/**
 * IFC viewport: web-ifc (WASM) + web-ifc-three IFCLoader + Three.js.
 * IFCLoader is loaded dynamically so a CDN failure does not break the rest of the app.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const WASM_PATH = "https://cdn.jsdelivr.net/npm/web-ifc@0.0.39/";
const IFCLoader_MODULE = "https://cdn.jsdelivr.net/npm/web-ifc-three@0.0.126/IFCLoader.js";

/** Public sample (CORS must allow your origin). */
const SAMPLE_IFC_URL =
  "https://thatopen.github.io/engine_components/resources/ifc/school_str.ifc";

let ifcLoaderSingleton = null;

async function getIfcLoader() {
  if (!ifcLoaderSingleton) {
    const { IFCLoader } = await import(IFCLoader_MODULE);
    ifcLoaderSingleton = new IFCLoader();
  }
  return ifcLoaderSingleton;
}

export function initIfcViewport() {
  const host = document.getElementById("viewport-3d");
  const placeholder = host?.querySelector(".viewport-placeholder");
  const statusEl = document.getElementById("ifc-viewer-status");
  const selectionEl = document.getElementById("ifc-selection");
  const fileInput = document.getElementById("ifc-file-input");
  const btnOpen = document.getElementById("btn-ifc-open");
  const btnSample = document.getElementById("btn-ifc-sample");

  if (!host) return;

  host.title = "Drop an .ifc file here to load";

  /** Required so drop can fire; also prevents opening the file when dropped outside the viewer. */
  document.addEventListener("dragover", (e) => e.preventDefault());

  function setStatus(text, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle("err", isError);
  }

  function setSelection(text) {
    if (selectionEl) selectionEl.textContent = text;
  }

  let scene = null;
  let camera = null;
  let renderer = null;
  let controls = null;
  let raycaster = null;
  let pointer = null;
  let currentModel = null;

  try {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0d12);

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    camera.position.set(40, 40, 40);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if ("outputColorSpace" in renderer) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    const inner = document.getElementById("viewport-inner");
    (inner ?? host).appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 0.85);
    dir.position.set(60, 100, 40);
    scene.add(dir);
    const fill = new THREE.DirectionalLight(0xaaccff, 0.25);
    fill.position.set(-40, 20, -30);
    scene.add(fill);

    const grid = new THREE.GridHelper(200, 40, 0x334155, 0x1e293b);
    grid.position.y = -0.01;
    scene.add(grid);

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
  } catch (e) {
    console.error("IFC viewport WebGL init failed:", e);
    setStatus("3D view failed — WebGL or scripts blocked?", true);
  }

  function fitCameraToObject(object) {
    if (!camera || !controls) return;
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const dist = maxDim * 1.8;
    camera.near = maxDim / 200;
    camera.far = maxDim * 200;
    camera.updateProjectionMatrix();
    camera.position.set(center.x + dist * 0.6, center.y + dist * 0.45, center.z + dist * 0.6);
    controls.target.copy(center);
    controls.update();
  }

  function resize(w, h) {
    if (!renderer || !camera) return;
    const width = w || host.clientWidth;
    const height = h || host.clientHeight;
    if (width < 2 || height < 2) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  resize(host.clientWidth, host.clientHeight);
  window.addEventListener("dashboard:viewport3d", (ev) => {
    const { width, height } = ev.detail;
    resize(width, height);
  });

  function disposeCurrent() {
    if (!currentModel || !scene) return;
    try {
      currentModel.close(scene);
    } catch (e) {
      console.warn(e);
      scene.remove(currentModel);
      currentModel.traverse?.((child) => {
        if (child.geometry) child.geometry.dispose?.();
        if (child.material) {
          const m = child.material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
          else m.dispose?.();
        }
      });
    }
    currentModel = null;
  }

  async function loadFromBuffer(buffer, label) {
    if (!renderer || !scene || !camera) {
      setStatus("3D view not ready — check WebGL / console.", true);
      return;
    }
    disposeCurrent();
    setStatus(`Loading ${label}…`);
    try {
      const ifcLoader = await getIfcLoader();
      await ifcLoader.ifcManager.setWasmPath(WASM_PATH);
      const model = await ifcLoader.parse(buffer);
      currentModel = model;
      scene.add(model);
      fitCameraToObject(model);
      setStatus(`${label} — click a surface to inspect`);
      setSelection("—");
    } catch (e) {
      console.error(e);
      setStatus(e instanceof Error ? e.message : "IFC load failed", true);
    }
  }

  async function loadFromUrl(url, label) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const buffer = await res.arrayBuffer();
    await loadFromBuffer(buffer, label);
  }

  async function loadIfcFile(file) {
    const name = file.name?.toLowerCase() ?? "";
    if (!name.endsWith(".ifc")) {
      setStatus("Drop a file with a .ifc extension", true);
      return;
    }
    const buffer = await file.arrayBuffer();
    await loadFromBuffer(buffer, file.name);
  }

  /** Drop on the 3D panel only (coordinates; works when target is the canvas). */
  function onDocumentDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.name.toLowerCase().endsWith(".ifc")) return;
    const rect = host.getBoundingClientRect();
    const { clientX: x, clientY: y } = e;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
    host.classList.remove("viewport-3d--drop-target");
    void loadIfcFile(file).catch((err) => {
      console.error(err);
      setStatus(err instanceof Error ? err.message : "Load failed", true);
    });
  }

  document.addEventListener("drop", onDocumentDrop);

  function onDragEnterHost(e) {
    e.preventDefault();
    host.classList.add("viewport-3d--drop-target");
  }
  function onDragLeaveHost(e) {
    const next = e.relatedTarget;
    if (next && host.contains(next)) return;
    host.classList.remove("viewport-3d--drop-target");
  }
  function onDragOverHost(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  host.addEventListener("dragenter", onDragEnterHost);
  host.addEventListener("dragleave", onDragLeaveHost);
  host.addEventListener("dragover", onDragOverHost);

  btnOpen?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    try {
      await loadIfcFile(file);
    } catch (e) {
      console.error(e);
      setStatus(e instanceof Error ? e.message : "Load failed", true);
    }
  });

  btnSample?.addEventListener("click", async () => {
    try {
      await loadFromUrl(SAMPLE_IFC_URL, "sample IFC");
    } catch (e) {
      console.error(e);
      setStatus(
        "Sample fetch blocked or failed — use Open IFC with a local .ifc file.",
        true
      );
    }
  });

  function onPointerDown(event) {
    if (!currentModel || !raycaster || !camera || !renderer || event.button !== 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(currentModel, true);
    if (!hits.length) {
      setSelection("—");
      return;
    }
    const hit = hits[0];
    const geom = hit.object.geometry;
    const faceIndex = hit.faceIndex;
    if (faceIndex === undefined || !geom) {
      setSelection("Hit has no face index");
      return;
    }
    try {
      const expressID = currentModel.getExpressId(geom, faceIndex);
      setSelection(`expressID ${expressID} — loading properties…`);
      currentModel
        .getItemProperties(expressID, true)
        .then((props) => {
          const name = props?.Name?.value ?? props?.name ?? "";
          const type = props?.type ?? "";
          const summary = [
            `expressID: ${expressID}`,
            name && `Name: ${name}`,
            type && `Type: ${type}`,
          ]
            .filter(Boolean)
            .join(" · ");
          setSelection(summary);
        })
        .catch(() => setSelection(`expressID: ${expressID}`));
    } catch (err) {
      console.warn(err);
      setSelection("Could not resolve expressID for this hit");
    }
  }

  if (renderer) {
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
  }

  if (placeholder) placeholder.hidden = true;

  function tick() {
    requestAnimationFrame(tick);
    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
  }
  tick();
}
