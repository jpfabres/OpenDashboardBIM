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
  const btnFixQty = document.getElementById("btn-fix-quantities");

  function setLastJsonFile(_filename) {
    // reserved for future use
  }

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

  /** Highlight overlay for selected IFC elements (subset mesh, shared geometry buffers). */
  const HIGHLIGHT_CUSTOM_ID = "viewport-selection";
  const highlightMaterial = new THREE.MeshStandardMaterial({
    color: 0x2563eb,
    emissive: 0x1e3a8a,
    emissiveIntensity: 0.45,
    opacity: 0.9,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    metalness: 0.12,
    roughness: 0.5,
  });

  /** @type {Set<number>} */
  let selectedExpressIds = new Set();
  let selectionBoxDiv = null;
  let pointerSession = null;

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

    selectionBoxDiv = document.createElement("div");
    selectionBoxDiv.className = "viewport-selection-box";
    selectionBoxDiv.setAttribute("aria-hidden", "true");
    (inner ?? host).appendChild(selectionBoxDiv);

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

  function clearSelectionHighlight() {
    if (!currentModel?.ifcManager) return;
    try {
      currentModel.ifcManager.removeSubset(
        currentModel.modelID,
        highlightMaterial,
        HIGHLIGHT_CUSTOM_ID
      );
    } catch (e) {
      console.warn(e);
    }
  }

  function refreshSelectionHighlight() {
    clearSelectionHighlight();
    if (!currentModel || selectedExpressIds.size === 0) return;
    try {
      const mesh = currentModel.createSubset({
        scene: currentModel,
        ids: [...selectedExpressIds],
        removePrevious: true,
        material: highlightMaterial,
        customID: HIGHLIGHT_CUSTOM_ID,
      });
      if (mesh) mesh.renderOrder = 1;
    } catch (e) {
      console.warn(e);
    }
  }

  function disposeCurrent() {
    selectedExpressIds.clear();
    clearSelectionHighlight();
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
      setStatus(
        `${label} — click a part · Shift+click add/toggle · Ctrl+drag box-select`
      );
      setSelection("—");
    } catch (e) {
      console.error(e);
      setStatus(e instanceof Error ? e.message : "IFC load failed", true);
    }
  }

  async function uploadIfcToBackend(file) {
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        console.log(`[IFC Parser] JSON generated: ${data.json_file}`);
        console.log(`[IFC Parser] Total objects: ${data.total_objects}`);
        setStatus(`Model loaded — ${data.total_objects} objects parsed. JSON: ${data.json_file}`);
        setLastJsonFile(data.json_file);
        return data.json_file;
      } else {
        console.warn("[IFC Parser] Backend error:", data.detail ?? data);
      }
    } catch (err) {
      console.warn("[IFC Parser] Could not reach backend:", err.message);
    }
    return null;
  }

  async function verifyJsonOnBackend() {
    try {
      const res = await fetch("/verify", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        console.log(`[Verification] Corrected: ${data.corrected_file}, defects: ${data.defects_found}`);
        setStatus(`Fix Quantities done — ${data.defects_found} defect(s) corrected. Saved to backend/fix results/`);
      } else {
        setStatus(`Fix Quantities failed: ${data.detail ?? "unknown error"}`, true);
      }
    } catch (err) {
      setStatus("Fix Quantities — could not reach backend.", true);
      console.warn("[Verification]", err.message);
    }
  }

  async function loadIfcFile(file) {
    const name = file.name?.toLowerCase() ?? "";
    if (!name.endsWith(".ifc")) {
      setStatus("Drop a file with a .ifc extension", true);
      return;
    }
    const buffer = await file.arrayBuffer();
    // Run 3D load and backend upload in parallel
    await Promise.all([
      loadFromBuffer(buffer, file.name),
      uploadIfcToBackend(file),
    ]);
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
      setStatus("Fetching sample IFC…");
      const res = await fetch(SAMPLE_IFC_URL);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const buffer = await res.arrayBuffer();
      const sampleFilename = SAMPLE_IFC_URL.split("/").pop() || "sample.ifc";
      const file = new File([buffer], sampleFilename, { type: "application/octet-stream" });
      await Promise.all([
        loadFromBuffer(buffer, sampleFilename),
        uploadIfcToBackend(file),
      ]);
    } catch (e) {
      console.error(e);
      setStatus(
        "Sample fetch blocked or failed — use Open IFC with a local .ifc file.",
        true
      );
    }
  });

  btnFixQty?.addEventListener("click", async () => {
    setStatus("Running Fix Quantities…");
    await verifyJsonOnBackend();
  });

  function raycastExpressIdAtEvent(event, canvasRect) {
    pointer.x = ((event.clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
    pointer.y = -((event.clientY - canvasRect.top) / canvasRect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(currentModel, true);
    if (!hits.length) return null;
    const hit = hits[0];
    const geom = hit.object.geometry;
    const faceIndex = hit.faceIndex;
    if (faceIndex === undefined || !geom) return null;
    try {
      return currentModel.getExpressId(geom, faceIndex);
    } catch {
      return null;
    }
  }

  function collectExpressIdsInScreenRect(x0, y0, x1, y1, canvasRect) {
    const xMin = Math.min(x0, x1);
    const xMax = Math.max(x0, x1);
    const yMin = Math.min(y0, y1);
    const yMax = Math.max(y0, y1);
    const step = 14;
    const ids = new Set();
    for (let i = 0; i <= step; i++) {
      for (let j = 0; j <= step; j++) {
        const px = xMin + ((xMax - xMin) * i) / step;
        const py = yMin + ((yMax - yMin) * j) / step;
        if (
          px < canvasRect.left ||
          px > canvasRect.right ||
          py < canvasRect.top ||
          py > canvasRect.bottom
        ) {
          continue;
        }
        pointer.x = ((px - canvasRect.left) / canvasRect.width) * 2 - 1;
        pointer.y = -((py - canvasRect.top) / canvasRect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObject(currentModel, true);
        if (!hits.length) continue;
        const hit = hits[0];
        const geom = hit.object.geometry;
        const fi = hit.faceIndex;
        if (fi === undefined || !geom) continue;
        try {
          ids.add(currentModel.getExpressId(geom, fi));
        } catch {
          /* ignore */
        }
      }
    }
    return [...ids];
  }

  function updateSelectionSummaryFromIds() {
    if (!currentModel) {
      setSelection("—");
      return;
    }
    if (selectedExpressIds.size === 0) {
      setSelection("—");
      return;
    }
    if (selectedExpressIds.size === 1) {
      const expressID = [...selectedExpressIds][0];
      setSelection(`expressID ${expressID} — loading properties…`);
      currentModel
        .getItemProperties(expressID, true)
        .then((props) => {
          if (!selectedExpressIds.has(expressID)) return;
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
        .catch(() => {
          if (selectedExpressIds.has(expressID)) {
            setSelection(`expressID: ${expressID}`);
          }
        });
      return;
    }
    const sorted = [...selectedExpressIds].sort((a, b) => a - b);
    const preview = sorted.slice(0, 14).join(", ");
    const more =
      sorted.length > 14 ? ` (+${sorted.length - 14} more)` : "";
    setSelection(
      `${sorted.length} parts selected · expressIDs: ${preview}${more}`
    );
  }

  function positionSelectionBox(x0, y0, x1, y1) {
    if (!selectionBoxDiv) return;
    const innerEl = document.getElementById("viewport-inner");
    if (!innerEl) return;
    const innerRect = innerEl.getBoundingClientRect();
    const left = Math.min(x0, x1) - innerRect.left;
    const top = Math.min(y0, y1) - innerRect.top;
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    selectionBoxDiv.style.display = "block";
    selectionBoxDiv.style.left = `${left}px`;
    selectionBoxDiv.style.top = `${top}px`;
    selectionBoxDiv.style.width = `${w}px`;
    selectionBoxDiv.style.height = `${h}px`;
  }

  function hideSelectionBox() {
    if (!selectionBoxDiv) return;
    selectionBoxDiv.style.display = "none";
  }

  function endPointerSession(event) {
    if (!pointerSession) {
      hideSelectionBox();
      if (controls) controls.enabled = true;
      return;
    }
    if (!currentModel || !renderer) {
      pointerSession = null;
      hideSelectionBox();
      if (controls) controls.enabled = true;
      return;
    }
    const sess = pointerSession;
    pointerSession = null;
    if (sess.boxModifier) {
      try {
        renderer.domElement.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    }
    const dx = event.clientX - sess.startX;
    const dy = event.clientY - sess.startY;
    const moved = Math.hypot(dx, dy) >= 5;
    const canvasRect = renderer.domElement.getBoundingClientRect();

    if (sess.boxModifier && sess.boxActive && moved) {
      const ids = collectExpressIdsInScreenRect(
        sess.startX,
        sess.startY,
        event.clientX,
        event.clientY,
        canvasRect
      );
      if (event.shiftKey) {
        ids.forEach((id) => selectedExpressIds.add(id));
      } else {
        selectedExpressIds = new Set(ids);
      }
      refreshSelectionHighlight();
      updateSelectionSummaryFromIds();
    } else if (!sess.boxModifier && !moved && sess.hitId !== null) {
      if (sess.shiftKey) {
        if (selectedExpressIds.has(sess.hitId)) {
          selectedExpressIds.delete(sess.hitId);
        } else {
          selectedExpressIds.add(sess.hitId);
        }
      } else {
        selectedExpressIds = new Set([sess.hitId]);
      }
      refreshSelectionHighlight();
      updateSelectionSummaryFromIds();
    } else if (!sess.boxModifier && !moved && sess.hitId === null) {
      selectedExpressIds.clear();
      clearSelectionHighlight();
      updateSelectionSummaryFromIds();
    }

    hideSelectionBox();
    if (controls) controls.enabled = true;
  }

  function onPointerDown(event) {
    if (!currentModel || !raycaster || !camera || !renderer || event.button !== 0) {
      return;
    }
    const canvasRect = renderer.domElement.getBoundingClientRect();
    const hitId = raycastExpressIdAtEvent(event, canvasRect);
    const boxModifier = event.ctrlKey || event.metaKey;
    pointerSession = {
      startX: event.clientX,
      startY: event.clientY,
      boxModifier,
      shiftKey: event.shiftKey,
      hitId,
      boxActive: false,
    };
    if (boxModifier) {
      try {
        renderer.domElement.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    }
  }

  function onPointerMove(event) {
    if (!pointerSession || !renderer || !controls) return;
    const dx = event.clientX - pointerSession.startX;
    const dy = event.clientY - pointerSession.startY;
    if (Math.hypot(dx, dy) < 5) return;
    if (pointerSession.boxModifier) {
      if (!pointerSession.boxActive) {
        pointerSession.boxActive = true;
        controls.enabled = false;
      }
      positionSelectionBox(
        pointerSession.startX,
        pointerSession.startY,
        event.clientX,
        event.clientY
      );
    }
  }

  function onPointerUp(event) {
    if (!pointerSession || event.button !== 0) return;
    endPointerSession(event);
  }

  function onPointerCancel(event) {
    if (!pointerSession) return;
    endPointerSession(event);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !currentModel || selectedExpressIds.size === 0) {
      return;
    }
    const t = document.activeElement;
    if (
      t &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable)
    ) {
      return;
    }
    selectedExpressIds.clear();
    clearSelectionHighlight();
    updateSelectionSummaryFromIds();
  });

  if (renderer) {
    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
  }

  if (placeholder) placeholder.hidden = true;

  function tick() {
    requestAnimationFrame(tick);
    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
  }
  tick();
}
