const viewport3d = document.getElementById("viewport-3d");
const apiStatus = document.getElementById("api-status");
const reportBtn = document.getElementById("btn-generate-report");
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

function initIfcHealthSplitterResizer() {
  const grid = document.getElementById("ifc-health-grid");
  const splitter = document.getElementById("ifc-health-splitter");
  if (!grid || !splitter) return;

  const MIN_LEFT_PX = 220;
  const MIN_RIGHT_PX = 220;
  const STORAGE_KEY = "ifc-health-left-col-w-px";

  const getAvailable = () => {
    const gridRect = grid.getBoundingClientRect();
    const available = Math.max(0, gridRect.width);
    const splitterRect = splitter.getBoundingClientRect();
    const splitterW = splitterRect.width || 10;
    return { available, splitterW };
  };

  const setLeftWidthPx = (px) => {
    const clamped = Math.max(MIN_LEFT_PX, px);
    grid.style.setProperty("--ifc-health-left-col-w", `${clamped}px`);
  };

  const applySavedSize = () => {
    if (workspaceShell?.dataset.layout !== "1") return;
    let saved = 0;
    try {
      saved = Number(localStorage.getItem(STORAGE_KEY));
    } catch {
      /* ignore */
    }
    if (!Number.isFinite(saved) || saved <= 0) return;
    const { available, splitterW } = getAvailable();
    const maxLeft = Math.max(MIN_LEFT_PX, available - splitterW - MIN_RIGHT_PX);
    setLeftWidthPx(Math.min(saved, maxLeft));
  };

  let dragging = false;
  let startX = 0;
  let startLeftW = 0;

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    if (workspaceShell?.dataset.layout !== "1") return;
    dragging = true;
    startX = e.clientX;
    const computedLeft = parseFloat(getComputedStyle(grid).getPropertyValue("--ifc-health-left-col-w"));
    if (Number.isFinite(computedLeft) && computedLeft > 0) {
      startLeftW = computedLeft;
    } else {
      const leftCard = grid.querySelector(".ifc-health-graph-card--left");
      startLeftW = leftCard instanceof HTMLElement ? leftCard.getBoundingClientRect().width : grid.getBoundingClientRect().width / 2;
    }
    try {
      splitter.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const { available, splitterW } = getAvailable();
    const maxLeft = Math.max(MIN_LEFT_PX, available - splitterW - MIN_RIGHT_PX);
    const nextLeft = startLeftW + dx;
    setLeftWidthPx(Math.min(maxLeft, nextLeft));
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    const current = parseFloat(getComputedStyle(grid).getPropertyValue("--ifc-health-left-col-w"));
    if (!Number.isFinite(current) || current <= 0) return;
    try {
      localStorage.setItem(STORAGE_KEY, String(Math.round(current)));
    } catch {
      /* ignore */
    }
  };

  splitter.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  window.addEventListener("dashboard:layout-changed", (ev) => {
    if (ev?.detail?.layout !== "1") return;
    applySavedSize();
  });

  window.addEventListener("resize", () => {
    if (workspaceShell?.dataset.layout !== "1") return;
    applySavedSize();
  });

  if (workspaceShell?.dataset.layout === "1") applySavedSize();
}

initIfcHealthSplitterResizer();

function initLayout1MainSplitterResizer() {
  const splitter = document.getElementById("layout1-splitter");
  const main = splitter?.closest(".workspace-main");
  if (!splitter || !main) return;

  const MIN_LEFT_PX = 320;
  const MIN_RIGHT_PX = 220;
  const STORAGE_KEY = "layout1-left-col-w-px";

  const getAvailable = () => {
    const mainRect = main.getBoundingClientRect();
    const available = Math.max(0, mainRect.width);
    const splitterRect = splitter.getBoundingClientRect();
    const splitterW = splitterRect.width || 10;
    return { available, splitterW };
  };

  const setLeftWidthPx = (px) => {
    const clamped = Math.max(MIN_LEFT_PX, px);
    main.style.setProperty("--layout1-left-w", `${clamped}px`);
  };

  const applySavedSize = () => {
    if (workspaceShell?.dataset.layout !== "1") return;
    let saved = 0;
    try {
      saved = Number(localStorage.getItem(STORAGE_KEY));
    } catch {
      /* ignore */
    }
    if (!Number.isFinite(saved) || saved <= 0) return;
    const { available, splitterW } = getAvailable();
    const maxLeft = Math.max(MIN_LEFT_PX, available - splitterW - MIN_RIGHT_PX);
    setLeftWidthPx(Math.min(saved, maxLeft));
  };

  let dragging = false;
  let startX = 0;
  let startLeftW = 0;

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    if (workspaceShell?.dataset.layout !== "1") return;
    dragging = true;
    startX = e.clientX;
    const computedLeft = parseFloat(getComputedStyle(main).getPropertyValue("--layout1-left-w"));
    if (Number.isFinite(computedLeft) && computedLeft > 0) {
      startLeftW = computedLeft;
    } else {
      const leftPanel = document.querySelector('.workspace-shell[data-layout="1"] .visual-stack');
      startLeftW = leftPanel instanceof HTMLElement ? leftPanel.getBoundingClientRect().width : main.getBoundingClientRect().width / 2;
    }
    try {
      splitter.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const { available, splitterW } = getAvailable();
    const maxLeft = Math.max(MIN_LEFT_PX, available - splitterW - MIN_RIGHT_PX);
    const nextLeft = startLeftW + dx;
    setLeftWidthPx(Math.min(maxLeft, nextLeft));
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    const current = parseFloat(getComputedStyle(main).getPropertyValue("--layout1-left-w"));
    if (!Number.isFinite(current) || current <= 0) return;
    try {
      localStorage.setItem(STORAGE_KEY, String(Math.round(current)));
    } catch {
      /* ignore */
    }
  };

  splitter.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  window.addEventListener("dashboard:layout-changed", (ev) => {
    if (ev?.detail?.layout !== "1") return;
    applySavedSize();
  });

  window.addEventListener("resize", () => {
    if (workspaceShell?.dataset.layout !== "1") return;
    applySavedSize();
  });

  if (workspaceShell?.dataset.layout === "1") applySavedSize();
}

initLayout1MainSplitterResizer();

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

/**
 * Converts selected express IDs into per-entry selection payload for the 3D viewport.
 * @param {Set<number>} expressIds
 * @returns {Record<string, number[]>}
 */
function buildSelectionByEntry(expressIds) {
  /** @type {Record<string, number[]>} */
  const out = {};
  if (!(expressIds instanceof Set) || expressIds.size === 0) return out;
  for (const [entryId, meta] of boqModelRegistry) {
    const jf = meta.jsonFile;
    if (!jf) continue;
    const data = boqJsonByFile.get(jf);
    if (!data) continue;
    const ids = [];
    for (const key of Object.keys(data)) {
      const n = Number(key);
      if (Number.isFinite(n) && expressIds.has(n)) ids.push(n);
    }
    if (ids.length > 0) out[entryId] = ids;
  }
  return out;
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
/** @type {Map<string, Record<string, unknown>>} */
const boqCorrectedJsonByFile = new Map();
/** @type {Map<string, Promise<void>>} */
const boqJsonLoadPromises = new Map();
/** @type {Map<string, Promise<void>>} */
const boqCorrectedJsonLoadPromises = new Map();
/** @type {Map<string, Set<number>>} */
let boqVisibleByFile = new Map();
let boqUseCorrectedData = false;

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
/** @type {Array<{ cells: [string, string, string, string, string, string, string], expressIds: Set<number>, globalIds: Set<string> }>} */
let boqRenderedRows = [];
/** @type {Array<{ memberBaseKeys: string[] }>} */
let wbsRenderedRows = [];

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
const WBS_UNIT_OPTIONS = ["UN", "KG", "M2", "M3", "M"];
/** @type {Array<{ value: string, b: string, e: string }>} */
let wbsCombinedOptions = [];
/** @type {Map<string, { b: string, e: string }>} */
let wbsCombinedLookup = new Map();
/** @type {Map<string, string>} */
const wbsUnitsByBaseKey = new Map();
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

/**
 * Remove unstable name suffixes so grouping by name is stable.
 * @param {unknown} rawName
 * @param {string} fallback
 */
function normalizeElementName(rawName, fallback) {
  const base = typeof rawName === "string" && rawName.trim() ? rawName.trim() : fallback;
  // Some exports append an express/element ID at the end of the name, e.g. "...:2357346".
  const withoutTrailingId = base.replace(/:\s*\d+\s*$/, "");
  const compact = withoutTrailingId.replace(/\s{2,}/g, " ").trim();
  return compact || fallback;
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
   *   wbs: string,
   *   class: string,
   *   name: string,
   *   material: string,
   *   unit: string,
   *   qty: number,
   *   weightKg: number,
   *   expressIds: Set<number>,
   *   globalIds: Set<string>
   * }>} */
  const baseMap = new Map();

  for (const [, meta] of boqModelRegistry) {
    const jf = meta.jsonFile;
    if (!jf) continue;
    const originalData = boqJsonByFile.get(jf);
    const correctedData = boqCorrectedJsonByFile.get(jf);
    const data = boqUseCorrectedData ? (correctedData ?? originalData) : originalData;
    if (!data) continue;
    const visibleIds = boqVisibleByFile.get(jf);
    /** @type {Set<string> | null} */
    let visibleGlobalIds = null;
    if (
      boqUseCorrectedData &&
      correctedData &&
      originalData &&
      visibleIds &&
      visibleIds.size > 0
    ) {
      visibleGlobalIds = new Set();
      for (const [origId, raw] of Object.entries(originalData)) {
        const origIdNum = Number(origId);
        if (!Number.isFinite(origIdNum) || !visibleIds.has(origIdNum)) continue;
        if (!raw || typeof raw !== "object") continue;
        const gid = /** @type {{ globalId?: unknown }} */ (raw).globalId;
        if (typeof gid === "string" && gid.trim()) visibleGlobalIds.add(gid.trim());
      }
    }

    for (const [expressId, raw] of Object.entries(data)) {
      const expressIdNum = Number(expressId);
      if (visibleGlobalIds) {
        if (!raw || typeof raw !== "object") continue;
        const gid = /** @type {{ globalId?: unknown }} */ (raw).globalId;
        const gidStr = typeof gid === "string" ? gid.trim() : "";
        if (!gidStr || !visibleGlobalIds.has(gidStr)) continue;
      } else if (visibleIds && !visibleIds.has(expressIdNum)) {
        continue;
      }
      if (!raw || typeof raw !== "object") continue;

      const obj = /** @type {Record<string, unknown>} */ (raw);
      const cls = typeof obj.class === "string" && obj.class ? obj.class : "IfcElement";
      const name = normalizeElementName(obj.name, cls);
      const mats = materialNamesFromEntry(obj.materials);
      const material = mats.length ? mats.join(", ") : NO_MATERIAL;
      const globalId = typeof obj.globalId === "string" ? obj.globalId : "";
      const wbsObj = obj.wbs && typeof obj.wbs === "object" ? /** @type {{ b?: unknown, e?: unknown }} */ (obj.wbs) : null;
      const wbsB = typeof wbsObj?.b === "string" ? wbsObj.b.trim() : "";
      const wbsE = typeof wbsObj?.e === "string" ? wbsObj.e.trim() : "";
      const wbs = wbsB && wbsE ? `${wbsB} - ${wbsE}` : (wbsB || wbsE || "");

      const q = quantityFromDimensions(
        obj.dimensions && typeof obj.dimensions === "object"
          ? /** @type {Record<string, unknown>} */ (obj.dimensions)
          : null
      );
      const correctedUnit = typeof obj.unit === "string" && obj.unit.trim() ? obj.unit.trim() : "";
      if (correctedUnit) q.unit = correctedUnit;
      const weightKg = weightFromObject(obj) ?? 0;

      const baseKey = [cls, name, material, q.unit, wbs].join("|");
      const existing = baseMap.get(baseKey);
      if (existing) {
        existing.qty += q.qty;
        existing.weightKg += weightKg;
        existing.expressIds.add(expressIdNum);
        if (globalId) existing.globalIds.add(globalId);
      } else {
        const group = {
          baseKey,
          wbs,
          class: cls,
          name,
          material,
          unit: q.unit,
          qty: q.qty,
          weightKg,
          expressIds: new Set([expressIdNum]),
          globalIds: globalId ? new Set([globalId]) : new Set(),
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
 * Output columns: WBS, Name, Class, Material, Qty, Unit, Weight(kg)
 * @returns {Array<{ cells: [string, string, string, string, string, string, string], expressIds: Set<number>, globalIds: Set<string> }>}
 */
function buildBoqDisplayRows() {
  if (boqBaseDirty) rebuildBoqBaseGroups();

  /** @type {Map<string, { wbs: string, name: string, class: string, material: string, unit: string, qty: number, weightKg: number, expressIds: Set<number>, globalIds: Set<string> }>} */
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
    const key = [g.wbs, nameVal(g), classVal(g), materialVal(g), unit].join("|");
    const existing = grouped.get(key);
    if (existing) {
      existing.qty += g.qty;
      existing.weightKg += g.weightKg;
      for (const x of g.expressIds) existing.expressIds.add(x);
      for (const gid of g.globalIds) existing.globalIds.add(gid);
    } else {
      grouped.set(key, {
        wbs: g.wbs,
        name: nameVal(g),
        class: classVal(g),
        material: materialVal(g),
        unit,
        qty: g.qty,
        weightKg: g.weightKg,
        expressIds: new Set(g.expressIds),
        globalIds: new Set(g.globalIds),
      });
    }
  }

  const rows = [...grouped.values()]
    .sort((a, b) => {
      const k1 = `${a.class}|${a.name}|${a.material}|${a.unit}`;
      const k2 = `${b.class}|${b.name}|${b.material}|${b.unit}`;
      return k1.localeCompare(k2);
    })
    .map((g) => ({
      cells: [
        g.wbs || "",
        g.name,
        g.class,
        g.material,
        fmtQty(g.qty),
        g.unit,
        g.weightKg > 0 ? fmtQty(g.weightKg) : "—",
      ],
      expressIds: g.expressIds,
      globalIds: g.globalIds,
    }));

  if (rows.length === 0) {
    return [{
      cells: [
        "",
        "Load IFC model(s) to populate the BOQ table",
        "—",
        "—",
        "—",
        "—",
        "—",
      ],
      expressIds: new Set(),
      globalIds: new Set(),
    }];
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
  boqRenderedRows = buildBoqDisplayRows();
  fillTable(
    "table-boq",
    boqRenderedRows.map((x) => x.cells),
    -1
  );
  const tb = document.getElementById("table-boq");
  if (tb) {
    [...tb.querySelectorAll("tr")].forEach((tr, idx) => {
      tr.setAttribute("data-row-index", String(idx));
    });
  }
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

async function ensureBoqCorrectedJsonLoaded(jsonFile) {
  if (!jsonFile || boqCorrectedJsonByFile.has(jsonFile)) return;
  const correctedFile = jsonFile.endsWith(".json")
    ? `${jsonFile.slice(0, -5)}_corrected.json`
    : `${jsonFile}_corrected.json`;
  let p = boqCorrectedJsonLoadPromises.get(correctedFile);
  if (!p) {
    p = fetch(`/api/fix-quantities-corrected-json/${encodeURIComponent(correctedFile)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data && typeof data === "object") boqCorrectedJsonByFile.set(jsonFile, data);
      })
      .catch(() => {
        /* ignore: corrected file may not exist for this model */
      })
      .finally(() => {
        boqCorrectedJsonLoadPromises.delete(correctedFile);
      });
    boqCorrectedJsonLoadPromises.set(correctedFile, p);
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
    if (boqUseCorrectedData && jsonFile) await ensureBoqCorrectedJsonLoaded(jsonFile);
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
  for (const f of [...boqCorrectedJsonByFile.keys()]) {
    if (!usedFiles.has(f)) boqCorrectedJsonByFile.delete(f);
  }
  boqBaseDirty = true;
  renderBoqTable();
});

window.addEventListener("dashboard:ifc-models-cleared", () => {
  boqModelRegistry.clear();
  boqJsonByFile.clear();
  boqCorrectedJsonByFile.clear();
  boqUseCorrectedData = false;
  boqVisibleByFile = new Map();
  boqBaseGroups = [];
  boqBaseDirty = true;
  renderBoqTable();
});

window.addEventListener("dashboard:ifc-corrected-json-ready", () => {
  void (async () => {
    boqUseCorrectedData = true;
    const loads = [];
    for (const [, meta] of boqModelRegistry) {
      if (meta.jsonFile) loads.push(ensureBoqCorrectedJsonLoaded(meta.jsonFile));
    }
    await Promise.all(loads);
    boqBaseDirty = true;
    renderBoqTable();
  })();
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

function buildWbsUnitSelectHtml(selectedValue) {
  const optionsHtml = WBS_UNIT_OPTIONS
    .map((unit) => {
      const selected = unit === selectedValue ? ' selected="selected"' : "";
      return `<option value="${escapeHtml(unit)}"${selected}>${escapeHtml(unit)}</option>`;
    })
    .join("");
  return `
    <select class="wbs-select" data-wbs-axis="unit">
      <option value="">Select Unit</option>
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
  wbsRenderedRows = rows.map((r) => ({ memberBaseKeys: [...r.memberBaseKeys] }));
  if (rows.length === 0) {
    wbsRenderedRows = [];
    tb.innerHTML = `
      <tr>
        <td>Load IFC model(s) to populate the WBS mapping table</td>
        <td>—</td>
        <td>—</td>
        <td>—</td>
        <td>—</td>
      </tr>
    `;
    return;
  }
  tb.innerHTML = rows
    .map((row, idx) => {
      const memberMappings = row.memberBaseKeys.map((k) => wbsMappingsByBaseKey.get(k) ?? { b: "", e: "" });
      const firstB = memberMappings[0]?.b ?? "";
      const firstE = memberMappings[0]?.e ?? "";
      const hasUniformPair = memberMappings.every((m) => (m.b ?? "") === firstB && (m.e ?? "") === firstE);
      const combinedValue = hasUniformPair ? formatWbsCombinedValue(firstB, firstE) : "";
      const memberUnits = row.memberBaseKeys.map((k) => wbsUnitsByBaseKey.get(k) ?? "");
      const firstUnit = memberUnits[0] ?? "";
      const hasUniformUnit = memberUnits.every((u) => u === firstUnit);
      const unitValue = hasUniformUnit ? firstUnit : "";

      if (hasUniformPair) {
        for (const baseKey of row.memberBaseKeys) {
          wbsMappingsByBaseKey.set(baseKey, { b: firstB, e: firstE });
        }
      }
      if (hasUniformUnit) {
        for (const baseKey of row.memberBaseKeys) {
          if (unitValue) wbsUnitsByBaseKey.set(baseKey, unitValue);
          else wbsUnitsByBaseKey.delete(baseKey);
        }
      }
      return `
        <tr data-row-index="${idx}" data-base-keys="${escapeHtml(row.memberBaseKeys.join(","))}">
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.class)}</td>
          <td>${escapeHtml(row.material)}</td>
          <td title="${hasUniformPair ? "" : "Multiple values in group; setting a value will apply to all items in this group."}">
            ${buildWbsCombinedSelectHtml(combinedValue)}
          </td>
          <td title="${hasUniformUnit ? "" : "Multiple values in group; setting a value will apply to all items in this group."}">
            ${buildWbsUnitSelectHtml(unitValue)}
          </td>
        </tr>
      `;
    })
    .join("");
}

/**
 * @param {string[]} baseKeys
 * @returns {Set<number>}
 */
function collectExpressIdsForBaseKeys(baseKeys) {
  const keys = new Set(baseKeys);
  const ids = new Set();
  if (keys.size === 0) return ids;
  if (boqBaseDirty) rebuildBoqBaseGroups();
  for (const g of boqBaseGroups) {
    if (!keys.has(g.baseKey)) continue;
    for (const id of g.expressIds) ids.add(id);
  }
  return ids;
}

function initTableToViewportSelection() {
  const tbodyBoq = document.getElementById("table-boq");
  const tbodyWbs = document.getElementById("table-wbs");

  /**
   * @param {"boq"|"wbs"} tableKey
   * @param {HTMLElement} tbody
   * @param {HTMLElement} row
   * @param {Set<number>} ids
   */
  function applyTableSelection(tableKey, tbody, row, ids) {
    const idx = row.getAttribute("data-row-index") ?? "";
    const already = row.classList.contains("table-row-selected");
    const sameSelected = already && tbody.getAttribute("data-selected-row-index") === idx;
    tbody.querySelectorAll("tr.table-row-selected").forEach((x) => x.classList.remove("table-row-selected"));
    tbody.removeAttribute("data-selected-row-index");
    if (sameSelected || ids.size === 0) {
      window.dispatchEvent(
        new CustomEvent("dashboard:ifc-select-expressids", {
          detail: { selectionByEntry: {} },
        })
      );
      return;
    }
    row.classList.add("table-row-selected");
    tbody.setAttribute("data-selected-row-index", idx);
    const selectionByEntry = buildSelectionByEntry(ids);
    window.dispatchEvent(
      new CustomEvent("dashboard:ifc-select-expressids", {
        detail: { selectionByEntry, sourceTable: tableKey },
      })
    );
  }

  tbodyBoq?.addEventListener("click", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const tr = target.closest("tr[data-row-index]");
    if (!(tr instanceof HTMLElement) || !tbodyBoq.contains(tr)) return;
    const idx = Number(tr.getAttribute("data-row-index"));
    const row = Number.isFinite(idx) ? boqRenderedRows[idx] : null;
    if (!row) return;
    applyTableSelection("boq", tbodyBoq, tr, row.expressIds);
  });

  tbodyWbs?.addEventListener("click", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    if (target.closest("select, button, input, option")) return;
    const tr = target.closest("tr[data-row-index]");
    if (!(tr instanceof HTMLElement) || !tbodyWbs.contains(tr)) return;
    const idx = Number(tr.getAttribute("data-row-index"));
    const row = Number.isFinite(idx) ? wbsRenderedRows[idx] : null;
    if (!row) return;
    const ids = collectExpressIdsForBaseKeys(row.memberBaseKeys);
    applyTableSelection("wbs", tbodyWbs, tr, ids);
  });
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
  const headerE = getWorksheetCellString(worksheet, `D${headerRow}`) || "WBS D";
  const combinedHeader = `${headerB} + ${headerE}`;
  for (let row = firstDataRow; row <= range.e.r + 1; row++) {
    const b = getWorksheetCellString(worksheet, `B${row}`);
    const e = getWorksheetCellString(worksheet, `D${row}`);
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
    if (axis !== "combined" && axis !== "unit") return;
    const tr = target.closest("tr[data-base-keys]");
    if (!(tr instanceof HTMLElement)) return;
    const baseKeysRaw = tr.dataset.baseKeys;
    if (!baseKeysRaw) return;
    const baseKeys = baseKeysRaw
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
    if (axis === "combined") {
      const selectedCombined = target.value || "";
      const pair = wbsCombinedLookup.get(selectedCombined) ?? { b: "", e: "" };
      for (const baseKey of baseKeys) {
        wbsMappingsByBaseKey.set(baseKey, { b: pair.b, e: pair.e });
      }
      return;
    }
    const selectedUnit = target.value || "";
    for (const baseKey of baseKeys) {
      if (selectedUnit) wbsUnitsByBaseKey.set(baseKey, selectedUnit);
      else wbsUnitsByBaseKey.delete(baseKey);
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
initTableToViewportSelection();

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

function canvasToJpegDataUrl(canvas, quality = 0.92) {
  if (!(canvas instanceof HTMLCanvasElement)) return null;
  try {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    return typeof dataUrl === "string" && dataUrl.startsWith("data:image/") ? dataUrl : null;
  } catch {
    return null;
  }
}

function formatNow() {
  try {
    return new Date().toLocaleString();
  } catch {
    return String(new Date());
  }
}

function readLegendRows(legendId) {
  const root = document.getElementById(legendId);
  if (!(root instanceof HTMLElement)) return [];
  const rows = [];
  root.querySelectorAll(".ifc-health-legend-item").forEach((item) => {
    const label =
      item.querySelector(".ifc-health-legend-text strong")?.textContent?.trim() ||
      item.querySelector(".ifc-health-legend-text")?.textContent?.trim() ||
      "";
    const pct =
      item.querySelector(".ifc-health-legend-pct")?.textContent?.trim() || "";
    const sub = item.querySelector(".ifc-health-legend-sub")?.textContent?.trim() || "";
    if (!label && !pct && !sub) return;
    rows.push({ label, pct, sub });
  });
  return rows;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCsvCell(value) {
  const s = String(value ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsvText(headers, rows) {
  const lines = [];
  lines.push(headers.map(toCsvCell).join(","));
  for (const row of rows) {
    lines.push(row.map(toCsvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function buildExcelBlobFromRows(headers, rows, columnWidths) {
  if (!window.XLSX) {
    throw new Error("Excel library not available in browser.");
  }
  const ws = window.XLSX.utils.aoa_to_sheet([headers, ...rows]);
  if (Array.isArray(columnWidths) && columnWidths.length > 0) {
    ws["!cols"] = columnWidths.map((wch) => ({ wch }));
  }
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Report");
  const wbArray = window.XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob(
    [wbArray],
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
  );
}

async function exportFilesAsZip(zipFilename, files) {
  const JsZipCtor = window.JSZip;
  if (!JsZipCtor) {
    throw new Error("ZIP library not available in browser.");
  }
  const zip = new JsZipCtor();
  for (const f of files) {
    zip.file(f.name, f.blob);
  }
  const zipBlob = await zip.generateAsync({ type: "blob" });
  downloadBlob(zipBlob, zipFilename);
}

async function fetchBlob(path) {
  const res = await fetch(path);
  if (!res.ok) {
    const maybeJson = await res.json().catch(() => null);
    const detail = maybeJson && typeof maybeJson.detail === "string" ? maybeJson.detail : `${res.status} ${res.statusText}`;
    throw new Error(detail);
  }
  return res.blob();
}

async function generateHealthPdfReport() {
  const jspdfNs = window.jspdf;
  const JsPdfCtor = jspdfNs?.jsPDF;
  if (!JsPdfCtor) {
    throw new Error("PDF library not available in browser.");
  }

  const doc = new JsPdfCtor({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 28;
  const contentW = pageW - margin * 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("IFC Health Report", margin, 32);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 100, 118);
  doc.text(`Generated: ${formatNow()}`, margin, 48);

  const healthMeta = document.getElementById("ifc-health-meta")?.textContent?.trim();
  if (healthMeta) {
    const wrapped = doc.splitTextToSize(healthMeta, contentW);
    doc.text(wrapped, margin, 63);
  }

  const viewerCanvas = document.querySelector("#viewport-inner canvas");
  const viewerImg = canvasToJpegDataUrl(viewerCanvas instanceof HTMLCanvasElement ? viewerCanvas : null, 0.9);
  const viewerTop = 80;
  const viewerH = 260;
  if (viewerImg) {
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(11);
    doc.text("IFC viewport snapshot", margin, viewerTop - 8);
    doc.addImage(viewerImg, "JPEG", margin, viewerTop, contentW, viewerH, undefined, "FAST");
  } else {
    doc.setDrawColor(160, 170, 185);
    doc.rect(margin, viewerTop, contentW, viewerH);
    doc.setTextColor(120, 128, 140);
    doc.text("No IFC viewport image available.", margin + 10, viewerTop + 20);
  }

  const pieCharts = [
    { id: "canvas-ifc-health-objects", label: "Objects", legendId: "legend-ifc-health-objects" },
    { id: "canvas-ifc-health-classtypes", label: "Class types", legendId: "legend-ifc-health-classtypes" },
    { id: "canvas-ifc-health-attr", label: "By corrected attribute", legendId: "legend-ifc-health-attr" },
    { id: "canvas-ifc-health-class", label: "By class (with problems)", legendId: "legend-ifc-health-class" },
  ];

  const gridTop = viewerTop + viewerH + 34;
  const gap = 16;
  const cardW = (contentW - gap) / 2;
  const cardH = 190;
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(11);
  doc.text("Health charts (2D)", margin, gridTop - 9);

  pieCharts.forEach((chart, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = margin + col * (cardW + gap);
    const y = gridTop + row * (cardH + gap);
    const canvas = document.getElementById(chart.id);
    const img = canvasToJpegDataUrl(canvas instanceof HTMLCanvasElement ? canvas : null, 0.92);
    const legendRows = readLegendRows(chart.legendId);

    doc.setDrawColor(210, 216, 224);
    doc.rect(x, y, cardW, cardH);
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(10);
    doc.text(chart.label, x + 8, y + 14);

    const pieSize = Math.min(cardW - 16, 90);
    const pieX = x + (cardW - pieSize) / 2;
    const pieY = y + 20;
    if (img) {
      // Keep width==height so pies stay visually round (2D donut, not stretched).
      doc.addImage(img, "JPEG", pieX, pieY, pieSize, pieSize, undefined, "FAST");
    } else {
      doc.setTextColor(120, 128, 140);
      doc.text("Chart unavailable", x + 8, y + 34);
    }

    const legendStartY = pieY + pieSize + 10;
    const legendMaxY = y + cardH - 8;
    const legendMaxLines = Math.max(1, Math.floor((legendMaxY - legendStartY) / 10));
    let lineY = legendStartY;
    if (!legendRows.length) {
      doc.setTextColor(120, 128, 140);
      doc.setFontSize(8.5);
      doc.text("- No legend values", x + 8, lineY);
      return;
    }

    const visibleRows = legendRows.slice(0, legendMaxLines);
    visibleRows.forEach((row) => {
      const text = `- ${row.label || "(Unnamed)"}${row.pct ? `: ${row.pct}` : ""}`;
      doc.setTextColor(51, 65, 85);
      doc.setFontSize(8.5);
      doc.text(text, x + 8, lineY);
      lineY += 10;
    });
    if (legendRows.length > visibleRows.length && lineY <= legendMaxY) {
      doc.setTextColor(120, 128, 140);
      doc.setFontSize(8.2);
      doc.text(`... +${legendRows.length - visibleRows.length} more`, x + 8, lineY);
    }
  });

  doc.setFontSize(8.5);
  doc.setTextColor(130, 138, 150);
  doc.text(
    "Note: pie charts are exported as 2D graphics; interactive 3D PDF embedding for IFC is not available in this frontend export yet.",
    margin,
    pageH - 16
  );
  return doc.output("blob");
}

async function fetchHealthStatsForExport() {
  try {
    const data = await fetchJson("/api/ifc-health-stats");
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

async function generateHealthExcelBlob() {
  const stats = await fetchHealthStatsForExport();
  const rows = [];
  const totals = stats?.totals && typeof stats.totals === "object" ? stats.totals : {};
  rows.push(["Totals", "Objects", String(totals.objects ?? 0), ""]);
  rows.push(["Totals", "Corrected objects", String(totals.fixed_objects ?? 0), ""]);
  rows.push(["Totals", "Clean objects", String(totals.clean_objects ?? 0), ""]);
  rows.push(["Totals", "Not fixable objects", String(totals.not_fixable_objects ?? 0), ""]);
  rows.push(["", "", "", ""]);
  rows.push(["By Class", "Class", "Corrected", "Total"]);
  if (Array.isArray(stats?.by_class)) {
    for (const row of stats.by_class) {
      rows.push([
        "By Class",
        String(row.class ?? ""),
        String(row.fixed ?? 0),
        String(row.total ?? 0),
      ]);
    }
  }
  rows.push(["", "", "", ""]);
  rows.push(["By Attribute", "Attribute", "Count", ""]);
  if (Array.isArray(stats?.by_attribute)) {
    for (const row of stats.by_attribute) {
      rows.push(["By Attribute", String(row.attribute ?? ""), String(row.count ?? 0), ""]);
    }
  }
  return buildExcelBlobFromRows(
    ["Section", "Label", "Value", "Extra"],
    rows,
    [18, 36, 14, 18]
  );
}

async function generateHealthCsvBlob() {
  const stats = await fetchHealthStatsForExport();
  const rows = [];
  const totals = stats?.totals && typeof stats.totals === "object" ? stats.totals : {};
  rows.push(["Totals", "Objects", String(totals.objects ?? 0), ""]);
  rows.push(["Totals", "Corrected objects", String(totals.fixed_objects ?? 0), ""]);
  rows.push(["Totals", "Clean objects", String(totals.clean_objects ?? 0), ""]);
  rows.push(["Totals", "Not fixable objects", String(totals.not_fixable_objects ?? 0), ""]);
  rows.push(["", "", "", ""]);
  rows.push(["By Class", "Class", "Corrected", "Total"]);
  if (Array.isArray(stats?.by_class)) {
    for (const row of stats.by_class) {
      rows.push([
        "By Class",
        String(row.class ?? ""),
        String(row.fixed ?? 0),
        String(row.total ?? 0),
      ]);
    }
  }
  rows.push(["", "", "", ""]);
  rows.push(["By Attribute", "Attribute", "Count", ""]);
  if (Array.isArray(stats?.by_attribute)) {
    for (const row of stats.by_attribute) {
      rows.push(["By Attribute", String(row.attribute ?? ""), String(row.count ?? 0), ""]);
    }
  }
  const csv = buildCsvText(["Section", "Label", "Value", "Extra"], rows);
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
}

function collectBoqTableRowsForReport() {
  const rows = [];
  if (!Array.isArray(boqRenderedRows)) return rows;
  for (const row of boqRenderedRows) {
    if (!row || !Array.isArray(row.cells)) continue;
    if (row.cells[1] === "Load IFC model(s) to populate the BOQ table") continue;
    rows.push([
      String(row.cells[0] ?? ""),
      String(row.cells[1] ?? ""),
      String(row.cells[2] ?? ""),
      String(row.cells[3] ?? ""),
      String(row.cells[4] ?? ""),
      String(row.cells[5] ?? ""),
      String(row.cells[6] ?? ""),
      [...(row.globalIds ?? new Set())].sort().join(", "),
    ]);
  }
  return rows;
}

async function generateBoqPdfReport() {
  const jspdfNs = window.jspdf;
  const JsPdfCtor = jspdfNs?.jsPDF;
  if (!JsPdfCtor) {
    throw new Error("PDF library not available in browser.");
  }

  const doc = new JsPdfCtor({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 26;
  const contentW = pageW - margin * 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("BOQ Report", margin, 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 100, 118);
  doc.text(`Generated: ${formatNow()}`, margin, 45);

  const statusText = document.getElementById("header-ifc-summary")?.textContent?.trim() || "";
  if (statusText) {
    const wrapped = doc.splitTextToSize(statusText, contentW);
    doc.text(wrapped, margin, 59);
  }

  const viewerCanvas = document.querySelector("#viewport-inner canvas");
  const viewerImg = canvasToJpegDataUrl(viewerCanvas instanceof HTMLCanvasElement ? viewerCanvas : null, 0.92);
  const snapshotTop = 74;
  const snapshotH = 230;
  if (viewerImg) {
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(11);
    doc.text("IFC viewport snapshot", margin, snapshotTop - 8);
    doc.addImage(viewerImg, "JPEG", margin, snapshotTop, contentW, snapshotH, undefined, "FAST");
  } else {
    doc.setDrawColor(160, 170, 185);
    doc.rect(margin, snapshotTop, contentW, snapshotH);
    doc.setTextColor(120, 128, 140);
    doc.text("No IFC viewport image available.", margin + 10, snapshotTop + 20);
  }

  const headers = ["WBS", "Name", "Class", "Material", "Qty", "Unit", "Weight (kg)", "GUID(s)"];
  const rows = collectBoqTableRowsForReport();
  let y = snapshotTop + snapshotH + 26;

  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`BOQ quantities (${rows.length} row${rows.length === 1 ? "" : "s"})`, margin, y);
  y += 10;

  const colWidths = [130, 230, 120, 180, 60, 55, 75, 270];
  const rowH = 18;
  const drawHeader = () => {
    doc.setFillColor(235, 240, 248);
    doc.rect(margin, y, contentW, rowH, "F");
    doc.setTextColor(30, 41, 59);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    let x = margin + 6;
    headers.forEach((h, i) => {
      doc.text(h, x, y + 12);
      x += colWidths[i];
    });
    y += rowH;
  };

  const ensureSpace = (neededHeight) => {
    if (y + neededHeight <= pageH - margin) return;
    doc.addPage("a4", "landscape");
    y = margin;
    drawHeader();
  };

  drawHeader();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.6);
  doc.setTextColor(42, 52, 66);

  if (rows.length === 0) {
    doc.text("No BOQ rows available. Load IFC models to populate the grid.", margin + 6, y + 12);
    y += rowH;
  } else {
    for (const row of rows) {
      const wbsLines = doc.splitTextToSize(row[0] || "—", colWidths[0] - 10);
      const nameLines = doc.splitTextToSize(row[1] || "—", colWidths[1] - 10);
      const classLines = doc.splitTextToSize(row[2] || "—", colWidths[2] - 10);
      const materialLines = doc.splitTextToSize(row[3] || "—", colWidths[3] - 10);
      const qtyLines = doc.splitTextToSize(row[4] || "—", colWidths[4] - 10);
      const unitLines = doc.splitTextToSize(row[5] || "—", colWidths[5] - 10);
      const weightLines = doc.splitTextToSize(row[6] || "—", colWidths[6] - 10);
      const guidLines = doc.splitTextToSize(row[7] || "—", colWidths[7] - 10);
      const lineCount = Math.max(
        1,
        wbsLines.length,
        nameLines.length,
        classLines.length,
        materialLines.length,
        qtyLines.length,
        unitLines.length,
        weightLines.length,
        guidLines.length
      );
      const dynamicRowH = Math.max(rowH, 11 + lineCount * 9);
      ensureSpace(dynamicRowH + 2);

      doc.setDrawColor(223, 228, 236);
      doc.rect(margin, y, contentW, dynamicRowH);

      let x = margin + 6;
      const cells = [wbsLines, nameLines, classLines, materialLines, qtyLines, unitLines, weightLines, guidLines];
      cells.forEach((lines, idx) => {
        const textY = y + 12;
        doc.text(lines, x, textY);
        x += colWidths[idx];
      });
      y += dynamicRowH;
    }
  }

  doc.setFontSize(8.3);
  doc.setTextColor(120, 128, 140);
  doc.text("Columns match the BOQ grid in the app.", margin, pageH - 12);
  return doc.output("blob");
}

function generateBoqExcelBlob() {
  const headers = ["WBS", "Name", "Class", "Material", "Qty", "Unit", "Weight (kg)", "GUID(s)"];
  const rows = collectBoqTableRowsForReport();
  return buildExcelBlobFromRows(headers, rows, [18, 42, 22, 32, 12, 10, 14, 60]);
}

function generateBoqCsvBlob() {
  const headers = ["WBS", "Name", "Class", "Material", "Qty", "Unit", "Weight (kg)", "GUID(s)"];
  const rows = collectBoqTableRowsForReport();
  const csv = buildCsvText(headers, rows);
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
}

async function generateBoqExportZip() {
  const dateStamp = new Date().toISOString().slice(0, 10);
  const base = `boq-report-${dateStamp}`;
  const pdfBlob = await generateBoqPdfReport();
  const xlsxBlob = generateBoqExcelBlob();
  const csvBlob = generateBoqCsvBlob();
  await exportFilesAsZip(`${base}.zip`, [
    { name: `${base}.pdf`, blob: pdfBlob },
    { name: `${base}.xlsx`, blob: xlsxBlob },
    { name: `${base}.csv`, blob: csvBlob },
  ]);
}

function collectWbsTableRowsForReport() {
  const rows = [];
  const displayRows = buildWbsDisplayRows();
  if (!Array.isArray(displayRows) || displayRows.length === 0) return rows;
  for (const row of displayRows) {
    const memberMappings = row.memberBaseKeys.map((k) => wbsMappingsByBaseKey.get(k) ?? { b: "", e: "" });
    const firstB = memberMappings[0]?.b ?? "";
    const firstE = memberMappings[0]?.e ?? "";
    const hasUniformPair = memberMappings.every((m) => (m.b ?? "") === firstB && (m.e ?? "") === firstE);
    const combinedValue = hasUniformPair ? formatWbsCombinedValue(firstB, firstE) : "—";
    const memberUnits = row.memberBaseKeys.map((k) => wbsUnitsByBaseKey.get(k) ?? "");
    const firstUnit = memberUnits[0] ?? "";
    const hasUniformUnit = memberUnits.every((u) => u === firstUnit);
    const unitValue = hasUniformUnit ? (firstUnit || "—") : "—";
    rows.push([
      String(row.name ?? ""),
      String(row.class ?? ""),
      String(row.material ?? ""),
      String(combinedValue ?? "—"),
      String(unitValue ?? "—"),
    ]);
  }
  return rows;
}

async function generateWbsPdfReport() {
  const jspdfNs = window.jspdf;
  const JsPdfCtor = jspdfNs?.jsPDF;
  if (!JsPdfCtor) {
    throw new Error("PDF library not available in browser.");
  }

  const doc = new JsPdfCtor({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 26;
  const contentW = pageW - margin * 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("WBS Report", margin, 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 100, 118);
  doc.text(`Generated: ${formatNow()}`, margin, 45);

  const statusText = document.getElementById("header-ifc-summary")?.textContent?.trim() || "";
  if (statusText) {
    const wrapped = doc.splitTextToSize(statusText, contentW);
    doc.text(wrapped, margin, 59);
  }

  const viewerCanvas = document.querySelector("#viewport-inner canvas");
  const viewerImg = canvasToJpegDataUrl(viewerCanvas instanceof HTMLCanvasElement ? viewerCanvas : null, 0.92);
  const snapshotTop = 74;
  const snapshotH = 230;
  if (viewerImg) {
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(11);
    doc.text("IFC viewport snapshot", margin, snapshotTop - 8);
    doc.addImage(viewerImg, "JPEG", margin, snapshotTop, contentW, snapshotH, undefined, "FAST");
  } else {
    doc.setDrawColor(160, 170, 185);
    doc.rect(margin, snapshotTop, contentW, snapshotH);
    doc.setTextColor(120, 128, 140);
    doc.text("No IFC viewport image available.", margin + 10, snapshotTop + 20);
  }

  const wbsHeader = wbsCombinedHeader || "WBS";
  const headers = ["Name", "Class", "Material", wbsHeader, "Units"];
  const rows = collectWbsTableRowsForReport();
  let y = snapshotTop + snapshotH + 26;

  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`WBS mapping (${rows.length} row${rows.length === 1 ? "" : "s"})`, margin, y);
  y += 10;

  const colWidths = [270, 170, 250, 170, 80];
  const rowH = 18;
  const drawHeader = () => {
    doc.setFillColor(235, 240, 248);
    doc.rect(margin, y, contentW, rowH, "F");
    doc.setTextColor(30, 41, 59);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    let x = margin + 6;
    headers.forEach((h, i) => {
      doc.text(h, x, y + 12);
      x += colWidths[i];
    });
    y += rowH;
  };

  const ensureSpace = (neededHeight) => {
    if (y + neededHeight <= pageH - margin) return;
    doc.addPage("a4", "landscape");
    y = margin;
    drawHeader();
  };

  drawHeader();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.6);
  doc.setTextColor(42, 52, 66);

  if (rows.length === 0) {
    doc.text("No WBS rows available. Load IFC models to populate the grid.", margin + 6, y + 12);
    y += rowH;
  } else {
    for (const row of rows) {
      const nameLines = doc.splitTextToSize(row[0] || "—", colWidths[0] - 10);
      const classLines = doc.splitTextToSize(row[1] || "—", colWidths[1] - 10);
      const materialLines = doc.splitTextToSize(row[2] || "—", colWidths[2] - 10);
      const wbsLines = doc.splitTextToSize(row[3] || "—", colWidths[3] - 10);
      const unitLines = doc.splitTextToSize(row[4] || "—", colWidths[4] - 10);
      const lineCount = Math.max(1, nameLines.length, classLines.length, materialLines.length, wbsLines.length, unitLines.length);
      const dynamicRowH = Math.max(rowH, 11 + lineCount * 9);
      ensureSpace(dynamicRowH + 2);

      doc.setDrawColor(223, 228, 236);
      doc.rect(margin, y, contentW, dynamicRowH);

      let x = margin + 6;
      const cells = [nameLines, classLines, materialLines, wbsLines, unitLines];
      cells.forEach((lines, idx) => {
        const textY = y + 12;
        doc.text(lines, x, textY);
        x += colWidths[idx];
      });
      y += dynamicRowH;
    }
  }

  doc.setFontSize(8.3);
  doc.setTextColor(120, 128, 140);
  doc.text("Columns match the WBS grid in the app.", margin, pageH - 12);
  return doc.output("blob");
}

function generateWbsExcelBlob() {
  const wbsHeader = wbsCombinedHeader || "WBS";
  const headers = ["Name", "Class", "Material", wbsHeader, "Units"];
  const rows = collectWbsTableRowsForReport();
  return buildExcelBlobFromRows(headers, rows, [48, 26, 42, 26, 12]);
}

function generateWbsCsvBlob() {
  const wbsHeader = wbsCombinedHeader || "WBS";
  const headers = ["Name", "Class", "Material", wbsHeader, "Units"];
  const rows = collectWbsTableRowsForReport();
  const csv = buildCsvText(headers, rows);
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
}

async function generateWbsExportZip() {
  const dateStamp = new Date().toISOString().slice(0, 10);
  const base = `wbs-report-${dateStamp}`;
  const pdfBlob = await generateWbsPdfReport();
  const xlsxBlob = generateWbsExcelBlob();
  const csvBlob = generateWbsCsvBlob();
  await exportFilesAsZip(`${base}.zip`, [
    { name: `${base}.pdf`, blob: pdfBlob },
    { name: `${base}.xlsx`, blob: xlsxBlob },
    { name: `${base}.csv`, blob: csvBlob },
  ]);
}

async function generateFixedPackageZip() {
  const dateStamp = new Date().toISOString().slice(0, 10);
  const base = `fixed-package-${dateStamp}`;
  const files = [];

  const healthPdfBlob = await generateHealthPdfReport();
  const healthXlsxBlob = await generateHealthExcelBlob();
  const healthCsvBlob = await generateHealthCsvBlob();
  files.push({ name: `ifc-health-report-${dateStamp}.pdf`, blob: healthPdfBlob });
  files.push({ name: `ifc-health-report-${dateStamp}.xlsx`, blob: healthXlsxBlob });
  files.push({ name: `ifc-health-report-${dateStamp}.csv`, blob: healthCsvBlob });

  const boqPdfBlob = await generateBoqPdfReport();
  const boqXlsxBlob = generateBoqExcelBlob();
  const boqCsvBlob = generateBoqCsvBlob();
  files.push({ name: `boq-report-${dateStamp}.pdf`, blob: boqPdfBlob });
  files.push({ name: `boq-report-${dateStamp}.xlsx`, blob: boqXlsxBlob });
  files.push({ name: `boq-report-${dateStamp}.csv`, blob: boqCsvBlob });

  const wbsPdfBlob = await generateWbsPdfReport();
  const wbsXlsxBlob = generateWbsExcelBlob();
  const wbsCsvBlob = generateWbsCsvBlob();
  files.push({ name: `wbs-report-${dateStamp}.pdf`, blob: wbsPdfBlob });
  files.push({ name: `wbs-report-${dateStamp}.xlsx`, blob: wbsXlsxBlob });
  files.push({ name: `wbs-report-${dateStamp}.csv`, blob: wbsCsvBlob });

  try {
    const fixedIfcBlob = await fetchBlob("/api/fix-quantities-ifc");
    files.push({ name: `fix-quantities-corrected-${dateStamp}.ifc`, blob: fixedIfcBlob });
  } catch {
    // Keep package generation working even if fix IFC is not available yet.
  }

  await exportFilesAsZip(`${base}.zip`, files);
}

async function handleGenerateReportClick() {
  if (!(reportBtn instanceof HTMLButtonElement)) return;
  reportBtn.disabled = true;
  const baseLabel = reportBtn.textContent;
  reportBtn.textContent = "Generating…";

  try {
    await generateFixedPackageZip();
    const headerIfc = document.getElementById("header-ifc-summary");
    if (headerIfc) {
      headerIfc.textContent = "Fixed package generated — ZIP includes IFC Health, BOQ, WBS (PDF/XLSX/CSV) and corrected IFC when available.";
      headerIfc.classList.remove("err");
    }
  } finally {
    reportBtn.disabled = false;
    reportBtn.textContent = baseLabel || "Generate fixed package";
  }
}

reportBtn?.addEventListener("click", () => {
  void handleGenerateReportClick().catch((err) => {
    const message = err instanceof Error ? err.message : "Could not generate report.";
    const headerIfc = document.getElementById("header-ifc-summary");
    if (headerIfc) {
      headerIfc.textContent = `Report error: ${message}`;
      headerIfc.classList.add("err");
    }
  });
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
      unit: wbsUnitsByBaseKey.get(row.memberBaseKeys[0]) ?? "",
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
    try {
      window.dispatchEvent(
        new CustomEvent("dashboard:ifc-corrected-json-ready", {
          detail: { correctedJsonFile: data.corrected_file ?? "" },
        })
      );
    } catch {
      /* ignore */
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
