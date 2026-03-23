const viewport3d = document.getElementById("viewport-3d");
const apiStatus = document.getElementById("api-status");
const LAYOUT_KEY = "dashboard-workspace-layout";
const LAYOUT_LABELS = ["IFC Health", "BOQ", "WBS"];

function dispatchViewport3dResize(rect, element) {
  window.dispatchEvent(
    new CustomEvent("dashboard:viewport3d", {
      detail: {
        width: rect.width,
        height: rect.height,
        element: element ?? viewport3d,
      },
    })
  );
}

/** Notifies the IFC viewer when the 3D panel size changes (Three.js setSize + pixel ratio). */
const ro = new ResizeObserver((entries) => {
  for (const entry of entries) {
    dispatchViewport3dResize(entry.contentRect, entry.target);
  }
});

if (viewport3d) {
  ro.observe(viewport3d);
  dispatchViewport3dResize(viewport3d.getBoundingClientRect());
}

const workspaceShell = document.getElementById("workspace-shell");
const layoutLabelEl = document.getElementById("layout-label");
const btnLayoutPrev = document.getElementById("btn-layout-prev");
const btnLayoutNext = document.getElementById("btn-layout-next");

function setWorkspaceLayout(index) {
  const n = ((index % LAYOUT_LABELS.length) + LAYOUT_LABELS.length) % LAYOUT_LABELS.length;
  const layout = n + 1;
  if (workspaceShell) {
    workspaceShell.dataset.layout = String(layout);
  }
  try {
    localStorage.setItem(LAYOUT_KEY, String(layout));
  } catch {
    /* ignore */
  }
  if (layoutLabelEl) {
    layoutLabelEl.textContent = LAYOUT_LABELS[n];
  }
  document.querySelectorAll("[data-layout-panel]").forEach((el) => {
    const panel = el.dataset.layoutPanel;
    const active = panel === String(layout);
    el.setAttribute("aria-hidden", active ? "false" : "true");
  });
  if (viewport3d) {
    requestAnimationFrame(() => {
      dispatchViewport3dResize(viewport3d.getBoundingClientRect());
    });
  }

  try {
    window.dispatchEvent(new CustomEvent("dashboard:layout-changed", { detail: { layout: String(layout) } }));
  } catch {
    /* ignore */
  }
}

function currentLayoutIndex() {
  const v = workspaceShell?.dataset.layout;
  const parsed = Number(v);
  const layout = Number.isFinite(parsed) && parsed >= 1 && parsed <= LAYOUT_LABELS.length ? parsed : 1;
  return layout - 1;
}

function initWorkspaceLayout() {
  let initial = 0;
  try {
    const stored = localStorage.getItem(LAYOUT_KEY);
    if (stored === "1" || stored === "2" || stored === "3") {
      initial = Number(stored) - 1;
    }
  } catch {
    /* ignore */
  }
  setWorkspaceLayout(initial);
}

btnLayoutPrev?.addEventListener("click", () => {
  setWorkspaceLayout(currentLayoutIndex() - 1);
});

btnLayoutNext?.addEventListener("click", () => {
  setWorkspaceLayout(currentLayoutIndex() + 1);
});

initWorkspaceLayout();

function initBoqSplitterResizer() {
  const splitter = document.getElementById("boq-splitter");
  const viewer = document.getElementById("viewer-region");
  const main = splitter?.closest(".workspace-main");
  if (!splitter || !viewer || !main) return;

  const MIN_VIEWER_PX = 160;
  const MIN_BOQ_PX = 240;

  const STORAGE_KEY = "boq-viewer-h-px";

  const getAvailable = () => {
    const mainRect = main.getBoundingClientRect();
    const available = Math.max(0, mainRect.height);
    const splitterRect = splitter.getBoundingClientRect();
    const splitterH = splitterRect.height || 10;
    return { available, splitterH };
  };

  const setViewerHeightPx = (px) => {
    const clamped = Math.max(MIN_VIEWER_PX, px);
    viewer.style.flexBasis = `${clamped}px`;
    viewer.style.height = `${clamped}px`;
    main.style.setProperty("--boq-viewer-h", `${clamped}px`);
  };

  const applySavedSize = () => {
    let saved = 0;
    try {
      saved = Number(localStorage.getItem(STORAGE_KEY));
    } catch {
      /* ignore */
    }
    if (!Number.isFinite(saved) || saved <= 0) return;
    const { available, splitterH } = getAvailable();
    const maxViewer = Math.max(MIN_VIEWER_PX, available - splitterH - MIN_BOQ_PX);
    setViewerHeightPx(Math.min(saved, maxViewer));
  };

  let dragging = false;
  let startY = 0;
  let startViewerH = 0;

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    if (workspaceShell?.dataset.layout !== "2" && workspaceShell?.dataset.layout !== "3") return;
    dragging = true;
    startY = e.clientY;
    startViewerH = viewer.getBoundingClientRect().height;
    try {
      splitter.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    const { available, splitterH } = getAvailable();
    const maxViewer = Math.max(MIN_VIEWER_PX, available - splitterH - MIN_BOQ_PX);
    // Flip direction: dragging divider up should shrink the viewer (grow BOQ),
    // dragging down should grow the viewer (shrink BOQ).
    const nextViewerH = startViewerH + dy;
    setViewerHeightPx(Math.min(maxViewer, nextViewerH));
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    try {
      const saved = Math.round(viewer.getBoundingClientRect().height);
      localStorage.setItem(STORAGE_KEY, String(saved));
    } catch {
      /* ignore */
    }
  };

  splitter.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  window.addEventListener("dashboard:layout-changed", (ev) => {
    if (ev?.detail?.layout !== "2" && ev?.detail?.layout !== "3") return;
    applySavedSize();
  });

  // Initial apply.
  if (workspaceShell?.dataset.layout === "2" || workspaceShell?.dataset.layout === "3") applySavedSize();
}

initBoqSplitterResizer();

function fillTable(tbodyId, rows, badgeCol) {
  const tb = document.getElementById(tbodyId);
  if (!tb) return;
  tb.innerHTML = rows
    .map((cells) => {
      const tds = cells.map((c, i) => {
        if (i === badgeCol) {
          const cls = c === "ok" ? "ok" : c === "warn" ? "warn" : "";
          const label = c === "ok" ? "OK" : c === "warn" ? "Warning" : c;
          return `<td><span class="badge-cell ${cls}">${label}</span></td>`;
        }
        return `<td>${escapeHtml(String(c))}</td>`;
      });
      return `<tr>${tds.join("")}</tr>`;
    })
    .join("");
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

/** @type {Map<string, { label: string, jsonFile: string | null }>} */
const boqModelRegistry = new Map();
/** @type {Map<string, Record<string, unknown>>} */
const boqJsonByFile = new Map();
/** @type {Map<string, Promise<void>>} */
const boqJsonLoadPromises = new Map();
/** @type {Map<string, Set<number>>} */
let boqVisibleByFile = new Map();

const BOQ_DEFAULT_GROUP_BY = ["name", "class", "material", "unit"];
/** @type {Array<"name" | "class" | "material" | "unit">} */
let boqGroupBy = [...BOQ_DEFAULT_GROUP_BY];
let boqBaseDirty = true;
/** @type {Array<{
 *   baseKey: string,
 *   class: string,
 *   name: string,
 *   material: string,
 *   unit: string,
 *   qty: number,
 *   weightKg: number,
 *   expressIds: Set<number>
 * }>} */
let boqBaseGroups = [];

/** @type {Array<"name" | "class" | "material" | "qty" | "unit" | "weight">} */
const BOQ_FILTER_COLS = ["name", "class", "material", "qty", "unit", "weight"];
/** @type {Record<string, string>} */
let boqFilters = {
  name: "",
  class: "",
  material: "",
  qty: "",
  unit: "",
  weight: "",
};
let boqFilterPopoverEl = null;
let boqFilterPopoverInputEl = null;
let boqFilterActiveBtn = null;
/** @type {Map<string, { b: string, e: string }>} */
const wbsMappingsByBaseKey = new Map();
let wbsOptionsB = [];
/** @type {Map<string, string[]>} */
let wbsEByB = new Map();
let wbsHeaderB = "WBS B";
let wbsHeaderE = "WBS E";
let wbsCombinedHeader = "WBS";
const WBS_MERGE_SEPARATOR = " || ";
/** @type {Array<{ value: string, b: string, e: string }>} */
let wbsCombinedOptions = [];
/** @type {Map<string, { b: string, e: string }>} */
let wbsCombinedLookup = new Map();
const WBS_DEFAULT_GROUP_BY = ["name", "class", "material"];
/** @type {Array<"name" | "class" | "material">} */
let wbsGroupBy = [...WBS_DEFAULT_GROUP_BY];

const NO_STORY = "(Unassigned storey)";
const NO_MATERIAL = "(No material)";

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
 * Pick a main quantity for first BOQ population.
 * Priority: Volume (m3), Area (m2), Length (m), else Count (pcs).
 * @param {Record<string, unknown> | null} dims
 */
function quantityFromDimensions(dims) {
  if (!dims || typeof dims !== "object") return { qty: 1, unit: "pcs" };
  const qOrder = [
    { keys: ["NetVolume", "GrossVolume", "Volume"], unit: "m3" },
    { keys: ["NetArea", "GrossArea", "Area"], unit: "m2" },
    { keys: ["Length", "NetLength", "GrossLength"], unit: "m" },
  ];
  for (const { keys, unit } of qOrder) {
    for (const k of keys) {
      const v = Number(dims[k]);
      if (Number.isFinite(v) && v > 0) return { qty: v, unit };
    }
  }
  return { qty: 1, unit: "pcs" };
}

/**
 * @param {number} value
 */
function fmtQty(value) {
  const rounded3 = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded3) ? String(rounded3) : rounded3.toFixed(3).replace(/\.?0+$/, "");
}

/**
 * @param {Record<string, unknown> | null} dims
 */
function weightFromDimensions(dims) {
  if (!dims || typeof dims !== "object") return null;
  const keys = ["NetWeight", "GrossWeight", "Weight", "Mass"];
  for (const k of keys) {
    const v = Number(dims[k]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

/**
 * @param {Record<string, unknown> | null} psets
 */
function weightFromPsets(psets) {
  if (!psets || typeof psets !== "object") return null;
  for (const pset of Object.values(psets)) {
    if (!pset || typeof pset !== "object") continue;
    const pObj = /** @type {Record<string, unknown>} */ (pset);
    for (const [k, raw] of Object.entries(pObj)) {
      if (/massdensity/i.test(k)) continue;
      if (!/(^|_)(netweight|grossweight|weight|mass)$/i.test(k)) continue;
      const v = Number(raw);
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown>} obj
 */
function weightFromObject(obj) {
  const dims = obj.dimensions && typeof obj.dimensions === "object"
    ? /** @type {Record<string, unknown>} */ (obj.dimensions)
    : null;
  const fromDims = weightFromDimensions(dims);
  if (fromDims != null) return fromDims;
  const psets = obj.psets && typeof obj.psets === "object"
    ? /** @type {Record<string, unknown>} */ (obj.psets)
    : null;
  return weightFromPsets(psets);
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function normalizeFilter(s) {
  return String(s ?? "").trim().toLowerCase();
}

function baseGroupMatchesFilters(g) {
  const f = boqFilters;
  const nameF = normalizeFilter(f.name);
  const classF = normalizeFilter(f.class);
  const matF = normalizeFilter(f.material);
  const qtyF = normalizeFilter(f.qty);
  const unitF = normalizeFilter(f.unit);
  const weightF = normalizeFilter(f.weight);

  if (nameF && !String(g.name ?? "").toLowerCase().includes(nameF)) return false;
  if (classF && !String(g.class ?? "").toLowerCase().includes(classF)) return false;
  if (matF && !String(g.material ?? "").toLowerCase().includes(matF)) return false;
  if (unitF && !String(g.unit ?? "").toLowerCase().includes(unitF)) return false;
  if (qtyF && !fmtQty(g.qty).toLowerCase().includes(qtyF)) return false;
  if (weightF && !fmtQty(g.weightKg).toLowerCase().includes(weightF)) return false;
  return true;
}

/**
 * Builds base aggregation from currently visible expressIDs.
 * We aggregate at the smallest “stable” level: (class, name, material, unit).
 */
function rebuildBoqBaseGroups() {
  /** @type {Map<string, {
   *   baseKey: string,
   *   class: string,
   *   name: string,
   *   material: string,
   *   unit: string,
   *   qty: number,
   *   weightKg: number,
   *   expressIds: Set<number>
   * }>} */
  const baseMap = new Map();

  for (const [, meta] of boqModelRegistry) {
    const jf = meta.jsonFile;
    if (!jf) continue;
    const data = boqJsonByFile.get(jf);
    if (!data) continue;
    const visibleIds = boqVisibleByFile.get(jf);

    for (const [expressId, raw] of Object.entries(data)) {
      const expressIdNum = Number(expressId);
      if (visibleIds && !visibleIds.has(expressIdNum)) continue;
      if (!raw || typeof raw !== "object") continue;

      const obj = /** @type {Record<string, unknown>} */ (raw);
      const cls = typeof obj.class === "string" && obj.class ? obj.class : "IfcElement";
      const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : cls;
      const mats = materialNamesFromEntry(obj.materials);
      const material = mats.length ? mats.join(", ") : NO_MATERIAL;

      const q = quantityFromDimensions(
        obj.dimensions && typeof obj.dimensions === "object"
          ? /** @type {Record<string, unknown>} */ (obj.dimensions)
          : null
      );
      const weightKg = weightFromObject(obj) ?? 0;

      const baseKey = [cls, name, material, q.unit].join("|");
      const existing = baseMap.get(baseKey);
      if (existing) {
        existing.qty += q.qty;
        existing.weightKg += weightKg;
        existing.expressIds.add(expressIdNum);
      } else {
        const group = {
          baseKey,
          class: cls,
          name,
          material,
          unit: q.unit,
          qty: q.qty,
          weightKg,
          expressIds: new Set([expressIdNum]),
        };
        baseMap.set(baseKey, group);
      }
    }
  }

  boqBaseGroups = [...baseMap.values()].sort((a, b) => {
    const k1 = `${a.class}|${a.name}|${a.material}|${a.unit}`;
    const k2 = `${b.class}|${b.name}|${b.material}|${b.unit}`;
    return k1.localeCompare(k2);
  });
  boqBaseDirty = false;
}

/**
 * Build the display rows based on current groupBy columns.
 * Output columns: Name, Class, Material, Qty, Unit, Weight(kg)
 * @returns {Array<[string, string, string, string, string, string]>}
 */
function buildBoqDisplayRows() {
  if (boqBaseDirty) rebuildBoqBaseGroups();

  /** @type {Map<string, { name: string, class: string, material: string, unit: string, qty: number, weightKg: number }>} */
  const grouped = new Map();

  const groupIncludes = (col) => boqGroupBy.includes(col);
  const nonIncludedFallback = "All";
  const nameVal = (g) => (groupIncludes("name") ? g.name : nonIncludedFallback);
  const classVal = (g) => (groupIncludes("class") ? g.class : nonIncludedFallback);
  const materialVal = (g) => (groupIncludes("material") ? g.material : nonIncludedFallback);

  const baseGroupsFiltered = boqBaseGroups.filter(baseGroupMatchesFilters);

  for (const g of baseGroupsFiltered) {
    // Ensure unit never “mixes” across groups.
    const unit = g.unit;
    const key = [nameVal(g), classVal(g), materialVal(g), unit].join("|");
    const existing = grouped.get(key);
    if (existing) {
      existing.qty += g.qty;
      existing.weightKg += g.weightKg;
    } else {
      grouped.set(key, {
        name: nameVal(g),
        class: classVal(g),
        material: materialVal(g),
        unit,
        qty: g.qty,
        weightKg: g.weightKg,
      });
    }
  }

  const rows = [...grouped.values()]
    .sort((a, b) => {
      const k1 = `${a.class}|${a.name}|${a.material}|${a.unit}`;
      const k2 = `${b.class}|${b.name}|${b.material}|${b.unit}`;
      return k1.localeCompare(k2);
    })
    .map((g) => [
      g.name,
      g.class,
      g.material,
      fmtQty(g.qty),
      g.unit,
      g.weightKg > 0 ? fmtQty(g.weightKg) : "—",
    ]);

  if (rows.length === 0) {
    return [[
      "Load IFC model(s) to populate the BOQ table",
      "—",
      "—",
      "—",
      "—",
      "—",
    ]];
  }

  return rows;
}

function syncBoqHeaderActiveState() {
  const tbody = document.getElementById("table-boq");
  const table = tbody?.closest("table");
  if (!table) return;
  const ths = table.querySelectorAll("thead th[data-boq-group-col]");
  ths.forEach((th) => {
    const col = th.dataset.boqGroupCol;
    th.classList.toggle("boq-group-active", boqGroupBy.includes(col));
  });
}

function syncBoqHeaderFilterState() {
  const tbody = document.getElementById("table-boq");
  const table = tbody?.closest("table");
  if (!table) return;
  const btns = table.querySelectorAll(".boq-filter-btn[data-boq-filter-col]");
  btns.forEach((b) => {
    const btn = /** @type {HTMLElement} */ (b);
    const col = btn.dataset.boqFilterCol;
    if (!col) return;
    const active = normalizeFilter(boqFilters[col]) !== "";
    btn.classList.toggle("boq-filter-active", active);
  });
}

function renderBoqTable() {
  syncBoqHeaderActiveState();
  syncBoqHeaderFilterState();
  fillTable("table-boq", buildBoqDisplayRows(), -1);
  renderWbsTable();
}

function setBoqGroupBy(col) {
  const defaultMode = [...BOQ_DEFAULT_GROUP_BY];
  const next = col === "unit" ? ["unit"] : [col, "unit"];
  boqGroupBy = arraysEqual(boqGroupBy, next) ? defaultMode : next;
  renderBoqTable();
}

async function ensureBoqJsonLoaded(jsonFile) {
  if (!jsonFile || boqJsonByFile.has(jsonFile)) return;
  let p = boqJsonLoadPromises.get(jsonFile);
  if (!p) {
    p = fetch(`/download/${encodeURIComponent(jsonFile)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data && typeof data === "object") boqJsonByFile.set(jsonFile, data);
      })
      .catch((e) => {
        console.warn("[BOQ] Could not load JSON:", jsonFile, e);
      })
      .finally(() => {
        boqJsonLoadPromises.delete(jsonFile);
      });
    boqJsonLoadPromises.set(jsonFile, p);
  }
  await p;
}

window.addEventListener("dashboard:ifc-model-json", (ev) => {
  const d = /** @type {CustomEvent<{ entryId?: unknown; jsonFile?: unknown; label?: unknown }>} */ (ev).detail;
  if (!d) return;
  const entryId = d.entryId != null && d.entryId !== "" ? String(d.entryId) : "";
  if (!entryId) return;
  const jsonFile = d.jsonFile != null && d.jsonFile !== "" ? String(d.jsonFile) : null;
  const label = typeof d.label === "string" && d.label ? d.label : entryId;
  boqModelRegistry.set(entryId, { label, jsonFile });
  void (async () => {
    if (jsonFile) await ensureBoqJsonLoaded(jsonFile);
    boqBaseDirty = true;
    renderBoqTable();
  })();
});

window.addEventListener("dashboard:ifc-model-unloaded", (ev) => {
  const d = /** @type {CustomEvent<{ entryId?: unknown }>} */ (ev).detail;
  const id = d?.entryId != null && d.entryId !== "" ? String(d.entryId) : "";
  if (!id) return;
  boqModelRegistry.delete(id);

  const usedFiles = new Set(
    [...boqModelRegistry.values()].map((x) => x.jsonFile).filter((x) => typeof x === "string" && x.length > 0)
  );
  for (const f of [...boqJsonByFile.keys()]) {
    if (!usedFiles.has(f)) boqJsonByFile.delete(f);
  }
  boqBaseDirty = true;
  renderBoqTable();
});

window.addEventListener("dashboard:ifc-models-cleared", () => {
  boqModelRegistry.clear();
  boqJsonByFile.clear();
  boqVisibleByFile = new Map();
  boqBaseGroups = [];
  boqBaseDirty = true;
  renderBoqTable();
});

window.addEventListener("dashboard:ifc-health-visibility", (ev) => {
  const detail = /** @type {CustomEvent<{ visibleByFile?: Record<string, number[]> }>} */ (ev).detail;
  const byFile = detail?.visibleByFile;
  if (!byFile || typeof byFile !== "object") return;
  const next = new Map();
  for (const [jsonFile, ids] of Object.entries(byFile)) {
    if (!Array.isArray(ids)) continue;
    next.set(
      jsonFile,
      new Set(ids.map((x) => Number(x)).filter((x) => Number.isFinite(x)))
    );
  }
  boqVisibleByFile = next;
  boqBaseDirty = true;
  renderBoqTable();
});

(function initBoqGroupingByColumns() {
  const tbody = document.getElementById("table-boq");
  const table = tbody?.closest("table");
  const thead = table?.querySelector("thead");
  if (!thead) return;

  thead.addEventListener("click", (ev) => {
    const target = ev.target;
    if (target instanceof Element && target.closest(".boq-filter-btn")) return;
    const th = target instanceof Element ? target.closest("th[data-boq-group-col]") : null;
    if (!th) return;
    const col = th instanceof HTMLElement ? th.dataset.boqGroupCol : null;
    if (!col) return;
    setBoqGroupBy(col);
  });
})();

function closeBoqFilterPopover() {
  if (boqFilterPopoverEl) boqFilterPopoverEl.remove();
  boqFilterPopoverEl = null;
  boqFilterPopoverInputEl = null;
  boqFilterActiveBtn = null;
}

function openBoqFilterPopover(btn) {
  const col = btn.dataset.boqFilterCol;
  if (!col) return;

  if (boqFilterActiveBtn === btn && boqFilterPopoverEl) {
    closeBoqFilterPopover();
    return;
  }

  closeBoqFilterPopover();

  const rect = btn.getBoundingClientRect();
  const pop = document.createElement("div");
  pop.className = "boq-filter-popover";

  const title = col === "qty" ? "Qty" : col === "weight" ? "Weight" : col[0].toUpperCase() + col.slice(1);
  pop.innerHTML = `
    <div class="boq-filter-popover-title">Filter: ${escapeHtml(title)}</div>
    <input type="text" aria-label="Filter input" placeholder="Type to filter..." />
    <div class="boq-filter-popover-actions">
      <button type="button" class="boq-filter-clear-btn">Clear</button>
    </div>
  `;

  document.body.appendChild(pop);
  pop.style.left = `${Math.max(8, rect.left)}px`;
  pop.style.top = `${Math.min(window.innerHeight - 10, rect.bottom + 6)}px`;

  // Clamp horizontally to avoid going off-screen.
  const popRect = pop.getBoundingClientRect();
  const maxLeft = window.innerWidth - popRect.width - 8;
  pop.style.left = `${Math.max(8, Math.min(maxLeft, rect.left))}px`;

  const input = pop.querySelector("input");
  const clearBtn = pop.querySelector(".boq-filter-clear-btn");

  if (input instanceof HTMLInputElement) {
    boqFilterPopoverInputEl = input;
    boqFilterActiveBtn = btn;
    boqFilterPopoverEl = pop;
    input.value = boqFilters[col] ?? "";
    input.focus();
    input.select?.();
    input.addEventListener("input", () => {
      boqFilters[col] = input.value;
      syncBoqHeaderFilterState();
      renderBoqTable();
    });
  }

  if (clearBtn instanceof HTMLButtonElement) {
    clearBtn.addEventListener("click", () => {
      boqFilters[col] = "";
      syncBoqHeaderFilterState();
      renderBoqTable();
      if (boqFilterPopoverInputEl) boqFilterPopoverInputEl.value = "";
    });
  }
}

function getWbsRows() {
  if (boqBaseDirty) rebuildBoqBaseGroups();
  return boqBaseGroups.map((g) => ({
    baseKey: g.baseKey,
    name: g.name,
    class: g.class,
    material: g.material,
  }));
}

function syncWbsHeaderActiveState() {
  const tbody = document.getElementById("table-wbs");
  const table = tbody?.closest("table");
  if (!table) return;
  const ths = table.querySelectorAll("thead th[data-wbs-group-col]");
  ths.forEach((th) => {
    const col = th.dataset.wbsGroupCol;
    th.classList.toggle("boq-group-active", wbsGroupBy.includes(col));
  });
}

function setWbsGroupBy(col) {
  const defaultMode = [...WBS_DEFAULT_GROUP_BY];
  const next = [col];
  wbsGroupBy = arraysEqual(wbsGroupBy, next) ? defaultMode : next;
  renderWbsTable();
}

function buildWbsDisplayRows() {
  const rawRows = getWbsRows();
  /** @type {Map<string, { name: string, class: string, material: string, memberBaseKeys: string[] }>} */
  const grouped = new Map();
  const includes = (col) => wbsGroupBy.includes(col);
  const fallback = "All";

  for (const row of rawRows) {
    const name = includes("name") ? row.name : fallback;
    const cls = includes("class") ? row.class : fallback;
    const material = includes("material") ? row.material : fallback;
    const key = `${name}|${cls}|${material}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.memberBaseKeys.push(row.baseKey);
    } else {
      grouped.set(key, {
        name,
        class: cls,
        material,
        memberBaseKeys: [row.baseKey],
      });
    }
  }

  return [...grouped.values()].sort((a, b) =>
    `${a.class}|${a.name}|${a.material}`.localeCompare(`${b.class}|${b.name}|${b.material}`)
  );
}

function firstDescriptionForCode(code) {
  if (!code) return "";
  const values = wbsEByB.get(code) ?? [];
  return values.length > 0 ? values[0] : "";
}

function formatWbsCombinedValue(b, e) {
  if (!b) return "";
  if (!e) return b;
  return `${b}${WBS_MERGE_SEPARATOR}${e}`;
}

function buildWbsCombinedSelectHtml(selectedValue) {
  const optionsHtml = wbsCombinedOptions
    .map((opt) => {
      const selected = opt.value === selectedValue ? ' selected="selected"' : "";
      return `<option value="${escapeHtml(opt.value)}"${selected}>${escapeHtml(opt.value)}</option>`;
    })
    .join("");
  return `
    <select class="wbs-select" data-wbs-axis="combined">
      <option value="">Select ${escapeHtml(wbsCombinedHeader)}</option>
      ${optionsHtml}
    </select>
  `;
}

function renderWbsTable() {
  const tb = document.getElementById("table-wbs");
  if (!tb) return;
  syncWbsHeaderActiveState();
  const combinedTitle = document.getElementById("wbs-col-combined-title");
  if (combinedTitle) combinedTitle.textContent = wbsCombinedHeader;
  const rows = buildWbsDisplayRows();
  if (rows.length === 0) {
    tb.innerHTML = `
      <tr>
        <td>Load IFC model(s) to populate the WBS mapping table</td>
        <td>—</td>
        <td>—</td>
        <td>—</td>
      </tr>
    `;
    return;
  }
  tb.innerHTML = rows
    .map((row) => {
      const memberMappings = row.memberBaseKeys.map((k) => wbsMappingsByBaseKey.get(k) ?? { b: "", e: "" });
      const firstB = memberMappings[0]?.b ?? "";
      const firstE = memberMappings[0]?.e ?? "";
      const hasUniformPair = memberMappings.every((m) => (m.b ?? "") === firstB && (m.e ?? "") === firstE);
      const combinedValue = hasUniformPair ? formatWbsCombinedValue(firstB, firstE) : "";

      if (hasUniformPair) {
        for (const baseKey of row.memberBaseKeys) {
          wbsMappingsByBaseKey.set(baseKey, { b: firstB, e: firstE });
        }
      }
      return `
        <tr data-base-keys="${escapeHtml(row.memberBaseKeys.join(","))}">
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.class)}</td>
          <td>${escapeHtml(row.material)}</td>
          <td title="${hasUniformPair ? "" : "Multiple values in group; setting a value will apply to all items in this group."}">
            ${buildWbsCombinedSelectHtml(combinedValue)}
          </td>
        </tr>
      `;
    })
    .join("");
}

function getWorksheetCellString(worksheet, address) {
  const cell = worksheet[address];
  if (!cell || cell.v == null) return "";
  return String(cell.v).trim();
}

function readWbsOptionsFromWorksheet(worksheet) {
  const setB = new Set();
  /** @type {Map<string, Set<string>>} */
  const eByB = new Map();
  /** @type {Map<string, { b: string, e: string }>} */
  const pairLookup = new Map();
  const ref = worksheet["!ref"];
  if (!ref || !window.XLSX) {
    return {
      b: [],
      eByB: new Map(),
      headerB: "WBS B",
      headerE: "WBS E",
      combinedHeader: "WBS",
      combinedOptions: [],
    };
  }
  const range = window.XLSX.utils.decode_range(ref);
  const firstDataRow = 4;
  const headerRow = 3;
  const headerB = getWorksheetCellString(worksheet, `B${headerRow}`) || "WBS B";
  const headerE = getWorksheetCellString(worksheet, `E${headerRow}`) || "WBS E";
  const combinedHeader = `${headerB} + ${headerE}`;
  for (let row = firstDataRow; row <= range.e.r + 1; row++) {
    const b = getWorksheetCellString(worksheet, `B${row}`);
    const e = getWorksheetCellString(worksheet, `E${row}`);
    if (b) setB.add(b);
    if (b && e) {
      const existing = eByB.get(b) ?? new Set();
      existing.add(e);
      eByB.set(b, existing);
      const combined = formatWbsCombinedValue(b, e);
      pairLookup.set(combined, { b, e });
    }
  }
  const eByBArray = new Map();
  for (const [b, eSet] of eByB.entries()) {
    eByBArray.set(b, [...eSet]);
  }
  const combinedOptions = [...pairLookup.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ value, ...(pairLookup.get(value) ?? { b: "", e: "" }) }));
  return { b: [...setB], eByB: eByBArray, headerB, headerE, combinedHeader, combinedOptions };
}

async function loadWbsFromFile(file) {
  if (!file || !window.XLSX) return;
  const buffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  if (!worksheet) return;
  const opts = readWbsOptionsFromWorksheet(worksheet);
  wbsOptionsB = opts.b;
  wbsEByB = opts.eByB;
  wbsHeaderB = opts.headerB;
  wbsHeaderE = opts.headerE;
  wbsCombinedHeader = opts.combinedHeader;
  wbsCombinedOptions = opts.combinedOptions;
  wbsCombinedLookup = new Map(wbsCombinedOptions.map((x) => [x.value, { b: x.b, e: x.e }]));
  renderWbsTable();
  const fileSummary = document.getElementById("wbs-file-summary");
  if (fileSummary) {
    fileSummary.textContent = `${file.name} · ${wbsCombinedHeader}:${wbsCombinedOptions.length}`;
  }
}

(function initBoqHeaderFilters() {
  const tbody = document.getElementById("table-boq");
  const table = tbody?.closest("table");
  if (!table) return;

  table.addEventListener("click", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest(".boq-filter-btn[data-boq-filter-col]");
    if (!btn) return;
    ev.stopPropagation();
    ev.preventDefault();
    openBoqFilterPopover(/** @type {HTMLElement} */ (btn));
  });

  window.addEventListener(
    "pointerdown",
    (ev) => {
      if (!boqFilterPopoverEl || !boqFilterActiveBtn) return;
      const t = ev.target;
      if (!(t instanceof Node)) return;
      const inside = boqFilterPopoverEl.contains(t) || boqFilterActiveBtn.contains(t);
      if (!inside) closeBoqFilterPopover();
    },
    true
  );

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!boqFilterPopoverEl) return;
    closeBoqFilterPopover();
  });
})();

const wbsFileInput = document.getElementById("wbs-file-input");
if (wbsFileInput instanceof HTMLInputElement) {
  wbsFileInput.addEventListener("change", async () => {
    const file = wbsFileInput.files?.[0];
    if (!file) return;
    try {
      await loadWbsFromFile(file);
    } catch (err) {
      console.warn("[WBS] Failed to parse file", err);
      const fileSummary = document.getElementById("wbs-file-summary");
      if (fileSummary) fileSummary.textContent = "Failed to read WBS file";
    } finally {
      wbsFileInput.value = "";
    }
  });
}

const wbsTableBody = document.getElementById("table-wbs");
if (wbsTableBody) {
  wbsTableBody.addEventListener("change", (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const axis = target.dataset.wbsAxis;
    if (axis !== "combined") return;
    const tr = target.closest("tr[data-base-keys]");
    if (!(tr instanceof HTMLElement)) return;
    const baseKeysRaw = tr.dataset.baseKeys;
    if (!baseKeysRaw) return;
    const baseKeys = baseKeysRaw
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
    const selectedCombined = target.value || "";
    const pair = wbsCombinedLookup.get(selectedCombined) ?? { b: "", e: "" };
    for (const baseKey of baseKeys) {
      wbsMappingsByBaseKey.set(baseKey, { b: pair.b, e: pair.e });
    }
  });
}

(function initWbsGroupingByColumns() {
  const tbody = document.getElementById("table-wbs");
  const table = tbody?.closest("table");
  const thead = table?.querySelector("thead");
  if (!thead) return;
  thead.addEventListener("click", (ev) => {
    const target = ev.target;
    const th = target instanceof Element ? target.closest("th[data-wbs-group-col]") : null;
    if (!th) return;
    const col = th instanceof HTMLElement ? th.dataset.wbsGroupCol : null;
    if (!col) return;
    setWbsGroupBy(col);
  });
})();

renderBoqTable();

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

document.getElementById("btn-health")?.addEventListener("click", async () => {
  apiStatus.textContent = "API …";
  apiStatus.classList.remove("ok", "err");
  try {
    await fetchJson("/api/health");
    apiStatus.textContent = "API healthy";
    apiStatus.classList.add("ok");
  } catch {
    apiStatus.textContent = "API error";
    apiStatus.classList.add("err");
  }
});

import("./ifc-health.js")
  .then((m) => m.initIfcHealth())
  .catch((err) => console.error("IFC health charts failed to load:", err));

document.getElementById("btn-wbs-apply")?.addEventListener("click", async () => {
  const displayRows = buildWbsDisplayRows();
  const rules = [];
  for (const row of displayRows) {
    const memberMappings = row.memberBaseKeys.map((k) => wbsMappingsByBaseKey.get(k) ?? { b: "", e: "" });
    const firstB = memberMappings[0]?.b ?? "";
    const firstE = memberMappings[0]?.e ?? "";
    if (!firstB && !firstE) continue;
    rules.push({
      name: row.name,
      class: row.class,
      material: row.material,
      wbs_b: firstB,
      wbs_e: firstE,
    });
  }
  if (rules.length === 0) {
    const headerIfc = document.getElementById("header-ifc-summary");
    if (headerIfc) headerIfc.textContent = "WBS Apply — no mappings assigned. Select WBS values in the table first.";
    return;
  }
  const headerIfc = document.getElementById("header-ifc-summary");
  if (headerIfc) headerIfc.textContent = "Applying WBS…";
  try {
    const res = await fetch("/api/wbs-apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "WBS apply failed");
    if (headerIfc) {
      headerIfc.textContent = `WBS applied — ${data.matched_objects} object(s) updated in ${data.corrected_file}`;
    }
  } catch (e) {
    console.error("[WBS Apply]", e);
    if (headerIfc) {
      headerIfc.textContent = `WBS Apply failed: ${e.message}`;
      headerIfc.classList.add("err");
    }
  }
});

Promise.all([
  import("./ifc-element-filters.js").then((m) => m.initIfcElementFilters()),
  /** Dynamic import so a blocked CDN / failed IFC bundle does not stop the rest of this script. */
  import("./ifc-viewer.js").then((m) => m.initIfcViewport()),
])
  .then(() => {
    window.dispatchEvent(new CustomEvent("dashboard:ifc-filter-sync-request"));
  })
  .catch((err) => console.error("IFC viewer or filters failed to load:", err));
