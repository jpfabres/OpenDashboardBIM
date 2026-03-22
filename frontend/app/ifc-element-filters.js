/**
 * Cascading element filters: building story → IFC class → material name (from export JSON).
 * Drives 3D visibility (via dashboard:ifc-filter-visibility) and IFC Health charts.
 */

const NO_STORY = "(Unassigned storey)";
const NO_MATERIAL = "(No material)";

/** @type {Map<string, { jsonFile: string, label: string }>} */
const registry = new Map();

/** @type {Map<string, Record<string, unknown>>} */
const jsonByFile = new Map();

/** @type {Set<string>} */
let selectedStories = new Set();
/** @type {Set<string>} */
let selectedClasses = new Set();
/** @type {Set<string>} */
let selectedMaterials = new Set();

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

function recomputeUniverses() {
  universeStories = new Set();
  universeClasses = new Set();
  universeMaterials = new Set();
  for (const data of jsonByFile.values()) {
    for (const row of rowsFromJson(data)) {
      universeStories.add(row.story);
      if (row.class) universeClasses.add(row.class);
      for (const m of row.materialNames) universeMaterials.add(m);
    }
  }
}

function pruneSelections() {
  const storyRows = rowsFromJson(mergedObjects());
  const classesFromStories = new Set();
  const matsFromStoriesClasses = new Set();

  for (const row of storyRows) {
    if (passesDimension(row.story, selectedStories, universeStories)) {
      if (row.class) classesFromStories.add(row.class);
    }
  }

  for (const row of storyRows) {
    if (!passesDimension(row.story, selectedStories, universeStories)) continue;
    if (!passesDimension(row.class, selectedClasses, universeClasses)) continue;
    for (const m of row.materialNames) matsFromStoriesClasses.add(m);
  }

  for (const c of [...selectedClasses]) {
    if (!classesFromStories.has(c)) selectedClasses.delete(c);
  }
  for (const m of [...selectedMaterials]) {
    if (!matsFromStoriesClasses.has(m)) selectedMaterials.delete(m);
  }
}

function mergedObjects() {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const data of jsonByFile.values()) {
    Object.assign(out, data);
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

  for (const [entryId, meta] of registry) {
    const data = jsonByFile.get(meta.jsonFile);
    if (!data) {
      visibility[entryId] = null;
      continue;
    }
    const vis = visibleExpressIdsForData(data);
    visibility[entryId] = [...vis];
  }

  window.dispatchEvent(new CustomEvent("dashboard:ifc-filter-visibility", { detail: { visibility } }));

  /** @type {Record<string, number[]>} */
  const visibleByFile = {};
  for (const f of new Set([...registry.values()].map((x) => x.jsonFile))) {
    const data = jsonByFile.get(f);
    if (!data) continue;
    visibleByFile[f] = [...visibleExpressIdsForData(data)];
  }
  window.dispatchEvent(new CustomEvent("dashboard:ifc-health-visibility", { detail: { visibleByFile } }));
}

function renderFilterLists() {
  const hint = document.getElementById("element-filters-hint");
  const listStory = document.getElementById("filter-list-story");
  const listClass = document.getElementById("filter-list-class");
  const listMat = document.getElementById("filter-list-material");
  const cStory = document.getElementById("filter-count-story");
  const cClass = document.getElementById("filter-count-class");
  const cMat = document.getElementById("filter-count-material");

  if (!listStory || !listClass || !listMat) return;

  if (!dataLoaded || jsonByFile.size === 0) {
    if (hint) hint.hidden = false;
    listStory.replaceChildren();
    listClass.replaceChildren();
    listMat.replaceChildren();
    if (cStory) cStory.textContent = "";
    if (cClass) cClass.textContent = "";
    if (cMat) cMat.textContent = "";
    return;
  }

  if (hint) hint.hidden = true;

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
      const id = `${namePrefix}-${encodeURIComponent(opt).slice(0, 80)}`;
      const label = document.createElement("label");
      label.className = "filter-option";
      const inp = document.createElement("input");
      inp.type = "checkbox";
      inp.checked = sel.has(opt);
      inp.dataset.dim = namePrefix;
      inp.dataset.value = opt;
      const span = document.createElement("span");
      span.textContent = opt;
      label.appendChild(inp);
      label.appendChild(span);
      el.appendChild(label);
    }
  }

  fillList(listStory, storyOptions, selectedStories, universeStories, "story");
  fillList(listClass, classList, selectedClasses, universeClasses, "class");
  fillList(listMat, matList, selectedMaterials, universeMaterials, "material");
}

function onCheckboxChange(ev) {
  const t = ev.target;
  if (!(t instanceof HTMLInputElement) || t.type !== "checkbox") return;
  const dim = t.dataset.dim;
  const val = t.dataset.value;
  if (!dim || val === undefined) return;
  /** @type {Set<string> | undefined} */
  let set;
  if (dim === "story") set = selectedStories;
  else if (dim === "class") set = selectedClasses;
  else if (dim === "material") set = selectedMaterials;
  else return;
  if (t.checked) set.add(val);
  else set.delete(val);
  pruneSelections();
  renderFilterLists();
  emitVisibility();
}

async function fetchJsonForFile(jsonFile) {
  const res = await fetch(`/download/${encodeURIComponent(jsonFile)}`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function registerModel(entryId, jsonFile, _label) {
  if (!jsonFile) return;
  registry.set(entryId, { jsonFile, label: _label });
  if (!jsonByFile.has(jsonFile)) {
    try {
      const data = await fetchJsonForFile(jsonFile);
      if (data && typeof data === "object") jsonByFile.set(jsonFile, data);
    } catch (e) {
      console.warn("[IFC filters] Could not load JSON:", jsonFile, e);
    }
  }
  recomputeUniverses();
  selectedStories = new Set(universeStories);
  selectedClasses = new Set(universeClasses);
  selectedMaterials = new Set(universeMaterials);
  dataLoaded = true;
  renderFilterLists();
  emitVisibility();
}

function unregisterModel(entryId) {
  registry.delete(entryId);
  const used = new Set([...registry.values()].map((x) => x.jsonFile));
  for (const f of [...jsonByFile.keys()]) {
    if (!used.has(f)) jsonByFile.delete(f);
  }
  recomputeUniverses();
  if (registry.size === 0) {
    dataLoaded = false;
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
  const root = document.getElementById("element-filters-root");
  root?.addEventListener("change", onCheckboxChange);

  window.addEventListener("dashboard:ifc-model-json", (ev) => {
    const d = /** @type {CustomEvent<{ entryId: string; jsonFile: string | null; label: string }>} */ (ev).detail;
    if (d?.entryId && d.jsonFile) void registerModel(d.entryId, d.jsonFile, d.label);
  });

  window.addEventListener("dashboard:ifc-model-unloaded", (ev) => {
    const d = /** @type {CustomEvent<{ entryId: string }>} */ (ev).detail;
    if (d?.entryId) unregisterModel(d.entryId);
  });

  window.addEventListener("dashboard:ifc-models-cleared", () => {
    clearAllModels();
  });
}
