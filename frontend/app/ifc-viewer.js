/**
 * IFC viewport: web-ifc (WASM) + web-ifc-three IFCLoader + Three.js.
 * IFCLoader is loaded dynamically so a CDN failure does not break the rest of the app.
 * Supports multiple IFC files (disciplines) with per-model placement.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const WASM_PATH = "https://cdn.jsdelivr.net/npm/web-ifc@0.0.39/";
const IFCLoader_MODULE = "https://cdn.jsdelivr.net/npm/web-ifc-three@0.0.126/IFCLoader.js";

let ifcLoaderSingleton = null;

async function getIfcLoader() {
  if (!ifcLoaderSingleton) {
    const { IFCLoader } = await import(IFCLoader_MODULE);
    ifcLoaderSingleton = new IFCLoader();
  }
  return ifcLoaderSingleton;
}

/**
 * @typedef {object} LoadedIfcEntry
 * @property {string} id
 * @property {string} label
 * @property {string} [jsonFile]
 * @property {THREE.Group} rootGroup
 * @property {THREE.Object3D & {
 *   modelID: number,
 *   ifcManager: { removeSubset: (modelID: number, mat: THREE.Material, id: string) => void },
 *   createSubset: (opts: object) => THREE.Object3D | undefined,
 *   getExpressId: (geom: THREE.BufferGeometry, faceIndex: number) => number,
 *   getItemProperties: (id: number, recursive: boolean) => Promise<unknown>,
 *   close: (scene: THREE.Scene) => void,
 * }} ifcModel
 */

export function initIfcViewport() {
  const host = document.getElementById("viewport-3d");
  const placeholder = host?.querySelector(".viewport-placeholder");
  const selectionEl = document.getElementById("ifc-selection");
  const fileInput = document.getElementById("ifc-file-input");
  const addIfcWrap = document.getElementById("btn-ifc-open");
  const btnClearAll = document.getElementById("btn-ifc-clear-all");
  const btnFixQty = document.getElementById("btn-fix-quantities");
  const modelsListEl = document.getElementById("ifc-models-list");

  if (!fileInput) {
    console.warn("IFC: #ifc-file-input not found — Add IFC will not work.");
  }
  if (!host) {
    console.warn("IFC: #viewport-3d not found — 3D viewer will not initialize.");
    return;
  }

  host.title = "Drop .ifc file(s) here to add to the scene";

  /** Required so drop can fire; also prevents opening the file when dropped outside the viewer. */
  document.addEventListener("dragover", (e) => e.preventDefault());

  function setStatus(text, isError = false) {
    const headerIfc = document.getElementById("header-ifc-summary");
    if (headerIfc) {
      headerIfc.textContent = text;
      headerIfc.classList.toggle("err", isError);
    }
  }

  function setSelection(text) {
    if (selectionEl) selectionEl.textContent = text;
  }

  /** Highlight overlay for selected IFC elements (subset mesh, shared geometry buffers). */
  const HIGHLIGHT_CUSTOM_ID = "viewport-selection";
  /** Filtered subset (multi-material; hides main mesh via draw range). */
  const FILTER_VIS_CUSTOM_ID = "dashboard-filter-vis";
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

  /** @type {Map<string, Set<number>>} */
  let selectedByModel = new Map();
  let selectionBoxDiv = null;
  let pointerSession = null;

  let scene = null;
  let camera = null;
  let renderer = null;
  let controls = null;
  let raycaster = null;
  let pointer = null;

  /** @type {LoadedIfcEntry[]} */
  let loadedModels = [];

  /** Which model cards have their placement (X/Y/Z) section expanded. */
  /** @type {Set<string>} */
  const expandedModelIds = new Set();

  try {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0d12);

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    camera.position.set(40, 40, 40);

    // Keep drawing buffer so PDF export can capture the current 3D frame.
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
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

  function fitCameraToAllLoaded() {
    if (!camera || !controls || loadedModels.length === 0) return;
    const box = new THREE.Box3();
    let empty = true;
    for (const { rootGroup } of loadedModels) {
      const b = new THREE.Box3().setFromObject(rootGroup);
      if (b.isEmpty()) continue;
      if (empty) {
        box.copy(b);
        empty = false;
      } else {
        box.union(b);
      }
    }
    if (empty) return;
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
    for (const { ifcModel } of loadedModels) {
      if (!ifcModel?.ifcManager) continue;
      try {
        ifcModel.ifcManager.removeSubset(
          ifcModel.modelID,
          highlightMaterial,
          HIGHLIGHT_CUSTOM_ID
        );
      } catch (e) {
        console.warn(e);
      }
    }
  }

  function refreshSelectionHighlight() {
    clearSelectionHighlight();
    for (const entry of loadedModels) {
      const ids = selectedByModel.get(entry.id);
      if (!ids || ids.size === 0) continue;
      try {
        const mesh = entry.ifcModel.createSubset({
          scene: entry.ifcModel,
          ids: [...ids],
          removePrevious: true,
          material: highlightMaterial,
          customID: HIGHLIGHT_CUSTOM_ID,
        });
        if (mesh) mesh.renderOrder = 1;
      } catch (e) {
        console.warn(e);
      }
    }
  }

  function removeSelectionForEntry(entryId) {
    selectedByModel.delete(entryId);
  }

  function disposeEntryResources(entry) {
    try {
      entry.ifcModel.close(scene);
    } catch (e) {
      console.warn(e);
    }
    if (entry.rootGroup.parent) {
      entry.rootGroup.parent.remove(entry.rootGroup);
    }
    entry.rootGroup.traverse?.((child) => {
      if (child.geometry) child.geometry.dispose?.();
      if (child.material) {
        const m = child.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
        else m.dispose?.();
      }
    });
  }

  function removeOneModel(entryId) {
    const idx = loadedModels.findIndex((e) => e.id === entryId);
    if (idx < 0) return;
    const [entry] = loadedModels.splice(idx, 1);
    expandedModelIds.delete(entryId);
    removeSelectionForEntry(entryId);
    clearSelectionHighlight();
    disposeEntryResources(entry);
    try {
      window.dispatchEvent(
        new CustomEvent("dashboard:ifc-model-unloaded", { detail: { entryId } })
      );
    } catch {
      /* ignore */
    }
    refreshSelectionHighlight();
    updateSelectionSummaryFromIds();
    renderLoadedModelsList();
    if (loadedModels.length === 0) {
      setStatus("IFC — use Add IFC or drag & drop");
      setSelection("—");
    } else {
      fitCameraToAllLoaded();
      refreshStatusSummary();
    }
  }

  async function resetBackendIfcSession() {
    try {
      const res = await fetch("/api/ifc-reset", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn("[IFC] Session reset failed:", data.detail ?? res.statusText);
        return;
      }
      console.log(
        "[IFC] Cleared fix results and results JSON:",
        data.removed_fix_results?.length ?? 0,
        "fix file(s),",
        data.removed_results?.length ?? 0,
        "export(s)"
      );
    } catch (e) {
      console.warn("[IFC] Session reset — could not reach backend:", e);
    }
    try {
      window.dispatchEvent(new CustomEvent("dashboard:ifc-health-refresh"));
    } catch {
      /* ignore */
    }
  }

  async function clearAllModels() {
    selectedByModel = new Map();
    expandedModelIds.clear();
    clearSelectionHighlight();
    while (loadedModels.length) {
      const entry = loadedModels.pop();
      disposeEntryResources(entry);
    }
    setStatus("IFC — use Add IFC or drag & drop");
    setSelection("—");
    renderLoadedModelsList();
    try {
      window.dispatchEvent(new CustomEvent("dashboard:ifc-models-cleared"));
    } catch {
      /* ignore */
    }
    await resetBackendIfcSession();
  }

  function refreshStatusSummary() {
    if (loadedModels.length === 0) {
      setStatus("IFC — use Add IFC or drag & drop");
      return;
    }
    const names = loadedModels.map((e) => e.label).join(", ");
    setStatus(
      `${loadedModels.length} model(s): ${names} — click · Shift+click · Ctrl+drag box`
    );
  }

  function updateModelsCountBadge() {
    const el = document.getElementById("ifc-models-count");
    if (!el) return;
    const n = loadedModels.length;
    el.textContent = n ? ` (${n})` : "";
  }

  function renderLoadedModelsList() {
    if (btnClearAll) btnClearAll.disabled = loadedModels.length === 0;
    if (!modelsListEl) return;
    modelsListEl.replaceChildren();

    for (const entry of loadedModels) {
      const details = document.createElement("details");
      details.className = "ifc-model-card";
      details.dataset.entryId = entry.id;
      details.open = expandedModelIds.has(entry.id);
      details.addEventListener("toggle", () => {
        if (details.open) expandedModelIds.add(entry.id);
        else expandedModelIds.delete(entry.id);
      });

      const summary = document.createElement("summary");
      summary.className = "ifc-model-card-summary";

      const chev = document.createElement("span");
      chev.className = "ifc-model-card-chevron";
      chev.setAttribute("aria-hidden", "true");
      chev.textContent = "▸";

      const title = document.createElement("p");
      title.className = "ifc-model-card-title";
      title.textContent = entry.label;

      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "ifc-model-card-remove";
      rm.textContent = "Remove";
      rm.title = "Remove this model from the scene";
      const stopSummaryToggle = (ev) => ev.stopPropagation();
      rm.addEventListener("mousedown", stopSummaryToggle);
      rm.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        removeOneModel(entry.id);
      });

      summary.appendChild(chev);
      summary.appendChild(title);
      summary.appendChild(rm);
      details.appendChild(summary);

      const body = document.createElement("div");
      body.className = "ifc-model-card-body";

      const posWrap = document.createElement("div");
      posWrap.className = "ifc-model-card-pos";

      const axes = [
        { key: "x", label: "X" },
        { key: "y", label: "Y" },
        { key: "z", label: "Z" },
      ];
      for (const { key, label } of axes) {
        const lab = document.createElement("label");
        lab.htmlFor = `ifc-pos-${entry.id}-${key}`;
        lab.textContent = label;
        const inp = document.createElement("input");
        inp.type = "number";
        inp.step = "any";
        inp.id = `ifc-pos-${entry.id}-${key}`;
        inp.value = String(entry.rootGroup.position[key]);
        inp.title = `Position ${label} (scene units)`;
        inp.addEventListener("change", () => {
          const v = parseFloat(inp.value);
          if (!Number.isFinite(v)) return;
          entry.rootGroup.position[key] = v;
        });
        posWrap.appendChild(lab);
        posWrap.appendChild(inp);
      }

      body.appendChild(posWrap);
      details.appendChild(body);
      modelsListEl.appendChild(details);
    }
    updateModelsCountBadge();
  }

  /**
   * @returns {Promise<LoadedIfcEntry | null>}
   */
  async function loadFromBuffer(buffer, label) {
    if (!renderer || !scene || !camera) {
      setStatus("3D view not ready — check WebGL / console.", true);
      return null;
    }
    setStatus(`Loading ${label}…`);
    try {
      const ifcLoader = await getIfcLoader();
      await ifcLoader.ifcManager.setWasmPath(WASM_PATH);
      const model = await ifcLoader.parse(buffer);
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `ifc-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const rootGroup = new THREE.Group();
      rootGroup.name = `IFC:${label}`;
      rootGroup.userData.ifcEntryId = id;

      /** @type {LoadedIfcEntry} */
      const entry = { id, label, rootGroup, ifcModel: model };
      rootGroup.add(model);
      scene.add(rootGroup);
      loadedModels.push(entry);

      fitCameraToAllLoaded();
      refreshStatusSummary();
      setSelection("—");
      renderLoadedModelsList();
      return entry;
    } catch (e) {
      console.error(e);
      setStatus(e instanceof Error ? e.message : "IFC load failed", true);
      return null;
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
        setStatus(
          `Model loaded — ${data.total_objects} objects parsed. JSON: ${data.json_file}`
        );
        return data.json_file;
      }
      console.warn("[IFC Parser] Backend error:", data.detail ?? data);
    } catch (err) {
      console.warn("[IFC Parser] Could not reach backend:", err.message);
    }
    return null;
  }

  async function verifyJsonOnBackend() {
    try {
      setStatus("Running Fix Quantities…");
      const res = await fetch("/verify", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        console.log(
          `[Verification] Corrected: ${data.corrected_file}, defects: ${data.defects_found}`
        );
        setStatus(
          `Fix Quantities done — ${data.defects_found} defect(s) corrected. Saved to backend/fix results/`
        );
        try {
          window.dispatchEvent(new CustomEvent("dashboard:ifc-health-refresh"));
        } catch {
          /* ignore */
        }
      } else {
        setStatus(`Fix Quantities failed: ${data.detail ?? "unknown error"}`, true);
      }
    } catch (err) {
      setStatus("Fix Quantities — could not reach backend.", true);
      console.warn("[Verification]", err.message);
    }
  }

  /**
   * @param {File[]} files
   */
  async function loadIfcFiles(files) {
    const list = Array.from(files).filter((f) =>
      (f.name?.toLowerCase() ?? "").endsWith(".ifc")
    );
    if (list.length === 0) {
      setStatus("Need at least one .ifc file", true);
      return;
    }
    for (const file of list) {
      const buffer = await file.arrayBuffer();
      const entry = await loadFromBuffer(buffer, file.name);
      if (entry) {
        const jsonFile = await uploadIfcToBackend(file);
        entry.jsonFile = jsonFile ?? undefined;
        try {
          window.dispatchEvent(
            new CustomEvent("dashboard:ifc-model-json", {
              detail: { entryId: entry.id, jsonFile: jsonFile ?? null, label: entry.label },
            })
          );
        } catch {
          /* ignore */
        }
      }
    }
  }

  /** Drop on the 3D panel only (coordinates; works when target is the canvas). */
  function onDocumentDrop(e) {
    e.preventDefault();
    const dt = e.dataTransfer?.files;
    if (!dt?.length) return;
    const rect = host.getBoundingClientRect();
    const { clientX: x, clientY: y } = e;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
    host.classList.remove("viewport-3d--drop-target");
    void loadIfcFiles(dt).catch((err) => {
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

  btnClearAll?.addEventListener("click", () => {
    void clearAllModels();
  });

  async function onIfcFileInputChange() {
    if (!fileInput) return;
    /** FileList is live — clearing `value` empties it; snapshot files first. */
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = "";
    if (!files.length) return;
    try {
      await loadIfcFiles(files);
    } catch (e) {
      console.error(e);
      setStatus(e instanceof Error ? e.message : "Load failed", true);
    }
  }

  fileInput?.addEventListener("change", onIfcFileInputChange);

  /** Fallback when transparent overlay does not receive hits (some browsers / embedded WebViews). */
  addIfcWrap?.addEventListener("click", (e) => {
    if (e.target === fileInput) return;
    fileInput?.click();
  });

  btnFixQty?.addEventListener("click", async () => {
    await verifyJsonOnBackend();
  });

  /**
   * @param {import("three").Object3D} obj
   * @returns {LoadedIfcEntry | null}
   */
  function findEntryContainingObject(obj) {
    let o = obj;
    while (o) {
      const hit = loadedModels.find((e) => e.rootGroup === o);
      if (hit) return hit;
      o = o.parent;
    }
    return null;
  }

  /**
   * @returns {{ entry: LoadedIfcEntry, expressId: number } | null}
   */
  function raycastHitAtEvent(event, canvasRect) {
    pointer.x = ((event.clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
    pointer.y = -((event.clientY - canvasRect.top) / canvasRect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const roots = loadedModels.map((e) => e.rootGroup);
    if (roots.length === 0) return null;
    const hits = raycaster.intersectObjects(roots, true);
    if (!hits.length) return null;
    const hit = hits[0];
    const entry = findEntryContainingObject(hit.object);
    if (!entry) return null;
    const geom = hit.object.geometry;
    const faceIndex = hit.faceIndex;
    if (faceIndex === undefined || !geom) return null;
    try {
      const expressId = entry.ifcModel.getExpressId(geom, faceIndex);
      return { entry, expressId };
    } catch {
      return null;
    }
  }

  /**
   * @returns {Map<string, Set<number>>}
   */
  function collectExpressIdsInScreenRect(x0, y0, x1, y1, canvasRect) {
    const xMin = Math.min(x0, x1);
    const xMax = Math.max(x0, x1);
    const yMin = Math.min(y0, y1);
    const yMax = Math.max(y0, y1);
    const step = 14;
    /** @type {Map<string, Set<number>>} */
    const out = new Map();
    const roots = loadedModels.map((e) => e.rootGroup);
    if (roots.length === 0) return out;

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
        const hits = raycaster.intersectObjects(roots, true);
        if (!hits.length) continue;
        const hit = hits[0];
        const entry = findEntryContainingObject(hit.object);
        if (!entry) continue;
        const geom = hit.object.geometry;
        const fi = hit.faceIndex;
        if (fi === undefined || !geom) continue;
        try {
          const expressId = entry.ifcModel.getExpressId(geom, fi);
          if (!out.has(entry.id)) out.set(entry.id, new Set());
          out.get(entry.id).add(expressId);
        } catch {
          /* ignore */
        }
      }
    }
    return out;
  }

  function totalSelectedCount() {
    let n = 0;
    selectedByModel.forEach((s) => {
      n += s.size;
    });
    return n;
  }

  function updateSelectionSummaryFromIds() {
    if (loadedModels.length === 0) {
      setSelection("—");
      return;
    }
    if (totalSelectedCount() === 0) {
      setSelection("—");
      return;
    }
    if (totalSelectedCount() === 1) {
      let expressID = 0;
      /** @type {LoadedIfcEntry | null} */
      let onlyEntry = null;
      selectedByModel.forEach((set, entryId) => {
        if (set.size === 1) {
          onlyEntry = loadedModels.find((e) => e.id === entryId) ?? null;
          expressID = [...set][0];
        }
      });
      if (!onlyEntry) {
        setSelection("—");
        return;
      }
      setSelection(
        `${onlyEntry.label} · expressID ${expressID} — loading properties…`
      );
      onlyEntry.ifcModel
        .getItemProperties(expressID, true)
        .then((props) => {
          if (totalSelectedCount() !== 1 || !selectedByModel.get(onlyEntry.id)?.has(expressID)) {
            return;
          }
          const name = props?.Name?.value ?? props?.name ?? "";
          const type = props?.type ?? "";
          const summary = [
            `${onlyEntry.label} · expressID: ${expressID}`,
            name && `Name: ${name}`,
            type && `Type: ${type}`,
          ]
            .filter(Boolean)
            .join(" · ");
          setSelection(summary);
        })
        .catch(() => {
          if (selectedByModel.get(onlyEntry.id)?.has(expressID)) {
            setSelection(`${onlyEntry.label} · expressID: ${expressID}`);
          }
        });
      return;
    }
    const parts = [];
    selectedByModel.forEach((set, entryId) => {
      const entry = loadedModels.find((e) => e.id === entryId);
      const lab = entry?.label ?? entryId;
      [...set]
        .sort((a, b) => a - b)
        .forEach((eid) => parts.push(`${lab} · ${eid}`));
    });
    parts.sort();
    const preview = parts.slice(0, 12).join(", ");
    const more = parts.length > 12 ? ` (+${parts.length - 12} more)` : "";
    setSelection(`${parts.length} parts · ${preview}${more}`);
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

  /**
   * @typedef {object} PointerHit
   * @property {LoadedIfcEntry} entry
   * @property {number} expressId
   */

  function endPointerSession(event) {
    if (!pointerSession) {
      hideSelectionBox();
      if (controls) controls.enabled = true;
      return;
    }
    if (loadedModels.length === 0 || !renderer) {
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
      const idMap = collectExpressIdsInScreenRect(
        sess.startX,
        sess.startY,
        event.clientX,
        event.clientY,
        canvasRect
      );
      if (event.shiftKey) {
        idMap.forEach((set, eid) => {
          if (!selectedByModel.has(eid)) selectedByModel.set(eid, new Set());
          const target = selectedByModel.get(eid);
          set.forEach((x) => target.add(x));
        });
      } else {
        selectedByModel = idMap;
      }
      refreshSelectionHighlight();
      updateSelectionSummaryFromIds();
    } else if (!sess.boxModifier && !moved && sess.hit) {
      const { entry, expressId } = sess.hit;
      if (sess.shiftKey) {
        if (!selectedByModel.has(entry.id)) selectedByModel.set(entry.id, new Set());
        const set = selectedByModel.get(entry.id);
        if (set.has(expressId)) set.delete(expressId);
        else set.add(expressId);
        if (set.size === 0) selectedByModel.delete(entry.id);
      } else {
        selectedByModel = new Map([[entry.id, new Set([expressId])]]);
      }
      refreshSelectionHighlight();
      updateSelectionSummaryFromIds();
    } else if (!sess.boxModifier && !moved && !sess.hit) {
      selectedByModel = new Map();
      clearSelectionHighlight();
      updateSelectionSummaryFromIds();
    }

    hideSelectionBox();
    if (controls) controls.enabled = true;
  }

  function onPointerDown(event) {
    if (loadedModels.length === 0 || !raycaster || !camera || !renderer || event.button !== 0) {
      return;
    }
    const canvasRect = renderer.domElement.getBoundingClientRect();
    const hit = raycastHitAtEvent(event, canvasRect);
    const boxModifier = event.ctrlKey || event.metaKey;
    pointerSession = {
      startX: event.clientX,
      startY: event.clientY,
      boxModifier,
      shiftKey: event.shiftKey,
      hit,
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
    if (e.key !== "Escape" || loadedModels.length === 0 || totalSelectedCount() === 0) {
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
    selectedByModel = new Map();
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

  /**
   * @param {LoadedIfcEntry} entry
   * @param {number[] | null | undefined} ids
   */
  function applyFilterVisibilityToEntry(entry, ids) {
    const model = entry.ifcModel;
    if (!model?.geometry?.index || !model.ifcManager) return;
    const geo = model.geometry;
    const fullCount = geo.index.count;
    try {
      model.ifcManager.removeSubset(model.modelID, undefined, FILTER_VIS_CUSTOM_ID);
    } catch {
      /* ignore */
    }
    if (ids === null || ids === undefined) {
      geo.setDrawRange(0, fullCount);
      return;
    }
    geo.setDrawRange(0, 0);
    if (ids.length === 0) return;
    try {
      model.createSubset({
        scene: model,
        ids,
        removePrevious: true,
        customID: FILTER_VIS_CUSTOM_ID,
        applyBVH: true,
      });
    } catch (e) {
      console.warn("IFC filter visibility:", e);
      geo.setDrawRange(0, fullCount);
    }
  }

  window.addEventListener("dashboard:ifc-filter-visibility", (ev) => {
    const vis = /** @type {CustomEvent<{ visibility?: Record<string, number[] | null> }>} */ (ev)
      .detail?.visibility;
    if (!vis || typeof vis !== "object") return;
    for (const entry of loadedModels) {
      const id = String(entry.id);
      if (Object.prototype.hasOwnProperty.call(vis, id)) {
        applyFilterVisibilityToEntry(entry, vis[id]);
      } else {
        applyFilterVisibilityToEntry(entry, null);
      }
    }
  });

  window.addEventListener("dashboard:ifc-filter-sync-request", () => {
    import("./ifc-element-filters.js")
      .then((mod) => {
        const reg = mod.registerIfcModelFromViewer;
        if (typeof reg !== "function") return;
        for (const entry of loadedModels) {
          try {
            window.dispatchEvent(
              new CustomEvent("dashboard:ifc-model-json", {
                detail: { entryId: entry.id, jsonFile: entry.jsonFile ?? null, label: entry.label },
              })
            );
          } catch {
            /* ignore */
          }
          reg(entry.id, entry.jsonFile ?? null, entry.label);
        }
      })
      .catch(() => {});
  });

  window.addEventListener("dashboard:ifc-select-expressids", (ev) => {
    const detail =
      /** @type {CustomEvent<{ selectionByEntry?: Record<string, number[]> }>} */ (ev).detail;
    const byEntry = detail?.selectionByEntry;
    if (!byEntry || typeof byEntry !== "object") return;
    const next = new Map();
    for (const [entryId, ids] of Object.entries(byEntry)) {
      if (!Array.isArray(ids) || ids.length === 0) continue;
      const entry = loadedModels.find((x) => String(x.id) === String(entryId));
      if (!entry) continue;
      const clean = ids.map((x) => Number(x)).filter((x) => Number.isFinite(x));
      if (clean.length > 0) next.set(entry.id, new Set(clean));
    }
    selectedByModel = next;
    refreshSelectionHighlight();
    updateSelectionSummaryFromIds();
  });

  updateModelsCountBadge();
  setStatus("IFC — use Add IFC or drag & drop");

  function tick() {
    requestAnimationFrame(tick);
    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
  }
  tick();
}
