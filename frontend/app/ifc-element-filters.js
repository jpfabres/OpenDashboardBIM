/**
 * Element filters: Loaded IFC (per-model on/off), plus cascading building story → IFC class → material
 * (from export JSON). Story/class/material universes merge all loaded models; IFC only affects visibility.
 * Drives 3D visibility (via dashboard:ifc-filter-visibility) and IFC Health charts.
 */

const NO_STORY = "(Unassigned storey)";
const NO_MATERIAL = "(No material)";

/** @type {Map<string, { jsonFile: string | null, label: string }>} */
const registry = new Map();

/** @type {Map<string, Record<string, unknown>>} */
const jsonByFile = new Map();

/** @type {Set<string>} */
let selectedStories = new Set();
/** @type {Set<string>} */
let selectedClasses = new Set();
/** @type {Set<string>} */
let selectedMaterials = new Set();

/** @type {Set<string>} */
let selectedEntryIds = new Set();

/** Full universes (for “all selected” detection) */
let universeStories = new Set();
let universeClasses = new Set();
let universeMaterials = new Set();

let dataLoaded = false;

/**
 * @param {unknown} materials
 * @returns {string[]}
 */
function materialNamesFromEntry(materials) {
  if (!Array.isArray(materials)) return [];
  const out = [];
  for (const m of materials) {
    if (!m || typeof m !== "object") continue;
    const o = /** @type {Record<string, unknown>} */ (m);
    if (o.type === "IfcMaterial" && typeof o.name === "string" && o.name) {
      out.push(o.name);
    } else if (o.type === "IfcMaterialList" && Array.isArray(o.materials)) {
      for (const n of o.materials) {
        if (typeof n === "string" && n) out.push(n);
      }
    } else if (Array.isArray(o.layers)) {
      for (const layer of o.layers) {
        if (layer && typeof layer === "object" && typeof layer.material === "string" && layer.material) {
          out.push(layer.material);
        }
      }
    } else if (typeof o.material === "string" && o.material) {
      out.push(o.material);
    }
  }
  return [...new Set(out)];
}

/**
 * @param {Record<string, unknown>} obj
 */
function rowFromObject(obj) {
  const loc = obj.location && typeof obj.location === "object" ? /** @type {Record<string, unknown>} */ (obj.location) : {};
  const rawStory = typeof loc.building_story === "string" ? loc.building_story.trim() : "";
  const story = rawStory || NO_STORY;
  const cls = typeof obj.class === "string" ? obj.class : "";
  const mats = materialNamesFromEntry(obj.materials);
  return { story, class: cls, materialNames: mats.length ? mats : [NO_MATERIAL] };
}

/**
 * @param {Record<string, unknown>} data
 * @returns {{ story: string, class: string, materialNames: string[] }[]}
 */
function rowsFromJson(data) {
  const rows = [];
  for (const v of Object.values(data)) {
    if (!v || typeof v !== "object") continue;
    rows.push(rowFromObject(/** @type {Record<string, unknown>} */ (v)));
  }
  return rows;
}

/**
 * @param {Set<string>} sel
 * @param {Set<string>} universe
 */
function selectionActive(sel, universe) {
  return sel.size > 0 && sel.size < universe.size;
}

/**
 * @param {string} v
 * @param {Set<string>} sel
 * @param {Set<string>} universe
 */
function passesDimension(v, sel, universe) {
  if (!selectionActive(sel, universe)) return true;
  return sel.has(v);
}

/**
 * @param {string[]} materialNames — already expanded with NO_MATERIAL if empty
 * @param {Set<string>} sel
 * @param {Set<string>} universe
 */
function passesMaterials(materialNames, sel, universe) {
  if (!selectionActive(sel, universe)) return true;
  return materialNames.some((m) => sel.has(m));
}

function universeEntryIdSet() {
  return new Set(registry.keys());
}

/**
 * Map any string form of an id to the key object actually stored in `registry` (Set.has is
 * sensitive to subtle mismatches vs checkbox getAttribute with 2+ models).
 * @param {unknown} raw
 * @returns {string | null}
 */
function canonicalRegistryEntryId(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  for (const k of registry.keys()) {
    if (String(k) === s) return k;
  }
  return null;
}

/** @param {string} entryKey */
function selectedEntryIdsContains(entryKey) {
  const need = String(entryKey);
  for (const x of selectedEntryIds) {
    if (String(x) === need) return true;
  }
  return false;
}

/**
 * True when every loaded model id is checked (do not use size-only heuristics — with 2+ models
 * `selectedEntryIds.size === universe.size` can still be the wrong set).
 */
function allIfcModelsSelected() {
  const universe = universeEntryIdSet();
  if (universe.size === 0) return true;
  return [...universe].every((id) => selectedEntryIdsContains(id));
}

function sanitizeSelectedEntryIds() {
  const universe = universeEntryIdSet();
  const next = new Set();
  for (const raw of selectedEntryIds) {
    const c = canonicalRegistryEntryId(raw);
    if (c && universe.has(c)) next.add(c);
  }
  selectedEntryIds.clear();
  for (const id of next) selectedEntryIds.add(id);
}

/**
 * Models whose JSON feeds story / class / material universes and `mergedObjects()`.
 * Intentionally ignores Loaded IFC checkboxes so those filters behave like before the IFC
 * section existed; IFC only gates per-model visibility in `emitVisibility` / `passesEntry`.
 */
function registryEntryIdsForFilterData() {
  if (registry.size === 0) return [];
  return [...registry.keys()];
}

/**
 * Whether elements from this model are included (IFC checkbox dimension).
 * @param {string} entryId
 */
function passesEntry(entryId) {
  const universe = universeEntryIdSet();
  const eid = String(entryId);
  if (universe.size === 0) return true;
  if (selectedEntryIds.size === 0) return false;
  if (allIfcModelsSelected()) return true;
  return selectedEntryIdsContains(eid);
}

function recomputeUniverses() {
  universeStories = new Set();
  universeClasses = new Set();
  universeMaterials = new Set();
  for (const id of registryEntryIdsForFilterData()) {
    const meta = registry.get(id);
    if (!meta) continue;
    const data = jsonByFile.get(meta.jsonFile);
    if (!data) continue;
    for (const row of rowsFromJson(data)) {
      universeStories.add(row.story);
      if (row.class) universeClasses.add(row.class);
      for (const m of row.materialNames) universeMaterials.add(m);
    }
  }
}

function pruneSelections() {
  for (const s of [...selectedStories]) {
    if (!universeStories.has(s)) selectedStories.delete(s);
  }
  for (const c of [...selectedClasses]) {
    if (!universeClasses.has(c)) selectedClasses.delete(c);
  }
  for (const m of [...selectedMaterials]) {
    if (!universeMaterials.has(m)) selectedMaterials.delete(m);
  }
}

function mergedObjects() {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const id of registryEntryIdsForFilterData()) {
    const meta = registry.get(id);
    if (!meta) continue;
    const data = jsonByFile.get(meta.jsonFile);
    if (data) Object.assign(out, data);
  }
  return out;
}

/**
 * @param {Record<string, unknown>} data
 * @returns {Set<number>}
 */
function visibleExpressIdsForData(data) {
  const vis = new Set();
  for (const [k, v] of Object.entries(data)) {
    const id = Number(k);
    if (!Number.isFinite(id) || !v || typeof v !== "object") continue;
    const row = rowFromObject(/** @type {Record<string, unknown>} */ (v));
    if (!passesDimension(row.story, selectedStories, universeStories)) continue;
    if (!passesDimension(row.class, selectedClasses, universeClasses)) continue;
    if (!passesMaterials(row.materialNames, selectedMaterials, universeMaterials)) continue;
    vis.add(id);
  }
  return vis;
}

function emitVisibility() {
  /** @type {Record<string, number[] | null>} */
  const visibility = {};
  if (!dataLoaded || registry.size === 0) {
    window.dispatchEvent(
      new CustomEvent("dashboard:ifc-filter-visibility", { detail: { visibility: {} } })
    );
    window.dispatchEvent(
      new CustomEvent("dashboard:ifc-health-visibility", { detail: { visibleByFile: {} } })
    );
    return;
  }

  const lowerFiltersActive =
    selectionActive(selectedStories, universeStories) ||
    selectionActive(selectedClasses, universeClasses) ||
    selectionActive(selectedMaterials, universeMaterials);

  for (const [entryId, meta] of registry) {
    const key = String(entryId);
    const jf = meta.jsonFile;
    const data = jf ? jsonByFile.get(jf) : undefined;
    if (!data) {
      visibility[key] = passesEntry(key) ? null : [];
      continue;
    }
    if (!passesEntry(key)) {
      visibility[key] = [];
      continue;
    }
    if (!lowerFiltersActive) {
      visibility[key] = null;
      continue;
    }
    const vis = visibleExpressIdsForData(data);
    visibility[key] = [...vis];
  }

  window.dispatchEvent(new CustomEvent("dashboard:ifc-filter-visibility", { detail: { visibility } }));

  /** @type {Record<string, number[]>} */
  const visibleByFile = {};
  for (const f of new Set(
    [...registry.values()].map((x) => x.jsonFile).filter((jf) => typeof jf === "string" && jf.length > 0)
  )) {
    const data = jsonByFile.get(f);
    if (!data) continue;
    const entriesForFile = [...registry.entries()].filter(([, m]) => m.jsonFile === f);
    const anyPass = entriesForFile.some(([eid]) => passesEntry(eid));
    if (!anyPass) {
      visibleByFile[f] = [];
      continue;
    }
    visibleByFile[f] = [...visibleExpressIdsForData(data)];
  }
  window.dispatchEvent(new CustomEvent("dashboard:ifc-health-visibility", { detail: { visibleByFile } }));
}

function renderFilterLists() {
  const hint = document.getElementById("element-filters-hint");
  const listIfc = document.getElementById("filter-list-ifc");
  const listStory = document.getElementById("filter-list-story");
  const listClass = document.getElementById("filter-list-class");
  const listMat = document.getElementById("filter-list-material");
  const cIfc = document.getElementById("filter-count-ifc");
  const cStory = document.getElementById("filter-count-story");
  const cClass = document.getElementById("filter-count-class");
  const cMat = document.getElementById("filter-count-material");

  if (!listStory || !listClass || !listMat) return;

  if (!dataLoaded || registry.size === 0) {
    if (hint) hint.hidden = false;
    if (listIfc) listIfc.replaceChildren();
    listStory.replaceChildren();
    listClass.replaceChildren();
    listMat.replaceChildren();
    if (cIfc) cIfc.textContent = "";
    if (cStory) cStory.textContent = "";
    if (cClass) cClass.textContent = "";
    if (cMat) cMat.textContent = "";
    return;
  }

  if (hint) hint.hidden = jsonByFile.size > 0;

  const universeEntries = universeEntryIdSet();
  const entryIdsSorted = [...universeEntries].sort((a, b) => {
    const la = registry.get(a)?.label ?? a;
    const lb = registry.get(b)?.label ?? b;
    return la.localeCompare(lb);
  });

  if (listIfc) {
    listIfc.replaceChildren();
    for (const entryId of entryIdsSorted) {
      const meta = registry.get(entryId);
      const text = meta?.label ?? entryId;
      const lab = document.createElement("label");
      lab.className = "filter-option";
      const inp = document.createElement("input");
      inp.type = "checkbox";
      inp.checked = selectedEntryIdsContains(entryId);
      inp.setAttribute("data-filter-dim", "entry");
      inp.setAttribute("data-filter-val", String(entryId));
      const span = document.createElement("span");
      span.textContent = text;
      lab.appendChild(inp);
      lab.appendChild(span);
      listIfc.appendChild(lab);
    }
  }
  if (cIfc) {
    cIfc.textContent =
      entryIdsSorted.length > 0 ? `(${selectedEntryIds.size}/${entryIdsSorted.length})` : "";
  }

  const allRows = rowsFromJson(mergedObjects());

  const storyOptions = [...universeStories].sort((a, b) => a.localeCompare(b));
  const classOptions = new Set();
  const matOptions = new Set();

  for (const row of allRows) {
    if (passesDimension(row.story, selectedStories, universeStories)) {
      if (row.class) classOptions.add(row.class);
    }
  }
  for (const row of allRows) {
    if (!passesDimension(row.story, selectedStories, universeStories)) continue;
    if (!passesDimension(row.class, selectedClasses, universeClasses)) continue;
    for (const m of row.materialNames) matOptions.add(m);
  }

  const classList = [...classOptions].sort((a, b) => a.localeCompare(b));
  const matList = [...matOptions].sort((a, b) => a.localeCompare(b));

  if (cStory) cStory.textContent = storyOptions.length ? `(${selectedStories.size}/${storyOptions.length})` : "";
  if (cClass) cClass.textContent = classList.length ? `(${selectedClasses.size}/${classList.length})` : "";
  if (cMat) cMat.textContent = matList.length ? `(${selectedMaterials.size}/${matList.length})` : "";

  function fillList(el, options, sel, universe, namePrefix) {
    el.replaceChildren();
    for (const opt of options) {
      const valStr = String(opt);
      const id = `${namePrefix}-${encodeURIComponent(valStr).slice(0, 80)}`;
      const label = document.createElement("label");
      label.className = "filter-option";
      const inp = document.createElement("input");
      inp.type = "checkbox";
      inp.checked = sel.has(valStr) || sel.has(opt);
      inp.setAttribute("data-filter-dim", namePrefix);
      inp.setAttribute("data-filter-val", valStr);
      const span = document.createElement("span");
      span.textContent = valStr;
      label.appendChild(inp);
      label.appendChild(span);
      el.appendChild(label);
    }
  }

  fillList(listStory, storyOptions, selectedStories, universeStories, "story");
  fillList(listClass, classList, selectedClasses, universeClasses, "class");
  fillList(listMat, matList, selectedMaterials, universeMaterials, "material");
}

function collapseFilterDetails() {
  for (const id of [
    "filter-details-ifc",
    "filter-details-story",
    "filter-details-class",
    "filter-details-material",
  ]) {
    const det = document.getElementById(id);
    if (det instanceof HTMLDetailsElement) det.open = false;
  }
}

function onCheckboxChange(ev) {
  const t = ev.target;
  if (!(t instanceof HTMLInputElement) || t.type !== "checkbox") return;
  const dim = t.getAttribute("data-filter-dim");
  const valRaw = t.getAttribute("data-filter-val");
  if (!dim) return;

  if (dim === "entry") {
    const canon = canonicalRegistryEntryId(valRaw);
    if (!canon) return;
    if (t.checked) selectedEntryIds.add(canon);
    else selectedEntryIds.delete(canon);
    sanitizeSelectedEntryIds();
  } else {
    if (valRaw === null) return;
    const v = String(valRaw);
    /** @type {Set<string> | undefined} */
    let set;
    if (dim === "story") set = selectedStories;
    else if (dim === "class") set = selectedClasses;
    else if (dim === "material") set = selectedMaterials;
    else return;
    if (t.checked) set.add(v);
    else set.delete(v);
  }
  recomputeUniverses();
  pruneSelections();
  renderFilterLists();
  emitVisibility();
}

async function fetchJsonForFile(jsonFile) {
  const res = await fetch(`/download/${encodeURIComponent(jsonFile)}`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** Same JSON can be requested from sync + event; share one fetch. */
const jsonLoadPromises = new Map();

async function ensureJsonLoaded(jsonFile) {
  if (!jsonFile || jsonByFile.has(jsonFile)) return;
  let p = jsonLoadPromises.get(jsonFile);
  if (!p) {
    p = fetchJsonForFile(jsonFile)
      .then((data) => {
        if (data && typeof data === "object") jsonByFile.set(jsonFile, data);
      })
      .catch((e) => {
        console.warn("[IFC filters] Could not load JSON:", jsonFile, e);
      })
      .finally(() => {
        jsonLoadPromises.delete(jsonFile);
      });
    jsonLoadPromises.set(jsonFile, p);
  }
  await p;
}

async function registerModel(entryId, jsonFile, _label) {
  const alreadyRegistered = registry.has(entryId);
  registry.set(entryId, { jsonFile: jsonFile || null, label: _label });
  if (jsonFile) await ensureJsonLoaded(jsonFile);

  if (!alreadyRegistered) {
    selectedEntryIds = new Set(registry.keys());
  } else {
    sanitizeSelectedEntryIds();
  }

  recomputeUniverses();
  if (!alreadyRegistered) {
    selectedStories = new Set(universeStories);
    selectedClasses = new Set(universeClasses);
    selectedMaterials = new Set(universeMaterials);
  } else {
    pruneSelections();
  }
  dataLoaded = true;
  renderFilterLists();
  collapseFilterDetails();
  emitVisibility();
}

function unregisterModel(entryId) {
  registry.delete(entryId);
  selectedEntryIds.delete(entryId);
  const used = new Set(
    [...registry.values()].map((x) => x.jsonFile).filter((f) => f != null && String(f).length > 0)
  );
  for (const f of [...jsonByFile.keys()]) {
    if (!used.has(f)) jsonByFile.delete(f);
  }
  recomputeUniverses();
  if (registry.size === 0) {
    dataLoaded = false;
    selectedEntryIds.clear();
    selectedStories.clear();
    selectedClasses.clear();
    selectedMaterials.clear();
  } else {
    selectedStories = new Set([...selectedStories].filter((x) => universeStories.has(x)));
    selectedClasses = new Set([...selectedClasses].filter((x) => universeClasses.has(x)));
    selectedMaterials = new Set([...selectedMaterials].filter((x) => universeMaterials.has(x)));
    pruneSelections();
  }
  renderFilterLists();
  emitVisibility();
}

function clearAllModels() {
  registry.clear();
  jsonByFile.clear();
  dataLoaded = false;
  selectedEntryIds.clear();
  selectedStories.clear();
  selectedClasses.clear();
  selectedMaterials.clear();
  universeStories = new Set();
  universeClasses = new Set();
  universeMaterials = new Set();
  renderFilterLists();
  emitVisibility();
}

export function initIfcElementFilters() {
  document.addEventListener(
    "change",
    (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLInputElement) || t.type !== "checkbox") return;
      const root = document.getElementById("element-filters-root");
      if (!root || !root.contains(t)) return;
      onCheckboxChange(ev);
    },
    true
  );

  window.addEventListener("dashboard:ifc-model-json", (ev) => {
    const d = /** @type {CustomEvent<{ entryId?: unknown; jsonFile?: unknown; label?: unknown }>} */ (ev).detail;
    if (d == null) return;
    const rawId = d.entryId;
    const entryId = rawId != null && rawId !== "" ? String(rawId) : "";
    if (!entryId) return;
    const jf = d.jsonFile != null && d.jsonFile !== "" ? String(d.jsonFile) : null;
    const label = typeof d.label === "string" && d.label.length > 0 ? d.label : entryId;
    void registerModel(entryId, jf, label);
  });

  window.addEventListener("dashboard:ifc-model-unloaded", (ev) => {
    const d = /** @type {CustomEvent<{ entryId?: unknown }>} */ (ev).detail;
    const id = d?.entryId != null && d.entryId !== "" ? String(d.entryId) : "";
    if (id) unregisterModel(id);
  });

  window.addEventListener("dashboard:ifc-models-cleared", () => {
    clearAllModels();
  });
}

/**
 * Called by the IFC viewer after a model is registered so filters stay in sync even if a
 * `dashboard:ifc-model-json` event was missed (load order / timing).
 * @param {string} entryId
 * @param {string | null | undefined} jsonFile
 * @param {string} label
 */
export function registerIfcModelFromViewer(entryId, jsonFile, label) {
  const jf = jsonFile != null && String(jsonFile).length > 0 ? String(jsonFile) : null;
  const lab = typeof label === "string" && label.length > 0 ? label : String(entryId);
  void registerModel(String(entryId), jf, lab);
}
