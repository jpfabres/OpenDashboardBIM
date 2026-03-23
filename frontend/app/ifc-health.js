/**
 * IFC Health: pie charts only after Fix Quantities (verification_log.json).
 * Data: backend/results JSON + fix results/verification_log.json.
 */

const PIE_COLORS = [
  "#4d9fff",
  "#6ee7b7",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
  "#38bdf8",
  "#fb923c",
  "#94a3b8",
  "#34d399",
  "#e879f9",
  "#f87171",
  "#22d3ee",
];

const MAX_SLICES = 10;

/** Canvas draw size — stacked layout; scales with `.ifc-health-pie-inner`. */
const PIE_BASE_SIZE = 242;

/** @type {Record<string, unknown> | null} */
let cachedPayload = null;

/** Latest element-filter visibility per export filename (express IDs). */
let lastVisibleByFile = /** @type {Record<string, number[]> | null} */ (null);

/** Cached IFC JSON (same object as /download/{json_file}) for client-side filtering. */
let cachedModelJson = /** @type {Record<string, unknown> | null} */ (null);
let cachedModelJsonFile = /** @type {string | null} */ (null);

/** Cached verification log from /api/ifc-verification-log */
let cachedVerificationLog = /** @type {Record<string, unknown> | null} */ (null);

/** Latest full sidebar-driven visibility (entry id → express ids); not updated by pie-drill events. */
let lastSidebarVisibility = /** @type {Record<string, number[] | null> | null} */ (null);

/** json_file basename → viewer entry id (from dashboard:ifc-model-json). */
const entryIdByJsonFile = /** @type {Map<string, string>} */ (new Map());

/**
 * @typedef {{
 *   kind: "class" | "attr" | "objects" | "classtypes",
 *   className?: string,
 *   classes?: string[],
 *   attribute?: string,
 *   attributes?: string[],
 *   objectsMode?: "corrected" | "clean" | "notfixable",
 *   classtypesMode?: "issues" | "clean",
 * }} PieDrillSpec
 */

/** Active pie drill (filters 3D on top of sidebar selection). */
let activePieDrill = /** @type {PieDrillSpec | null} */ (null);

/** Per-chart drill metadata aligned with drawn slices (same order as drawPie). */
const pieSliceDrillByChart = {
  class: /** @type {PieDrillSpec[]} */ ([]),
  attr: /** @type {PieDrillSpec[]} */ ([]),
  objects: /** @type {PieDrillSpec[]} */ ([]),
  classtypes: /** @type {PieDrillSpec[]} */ ([]),
};

/** `work.by_class` from last chart render (sidebar-filtered); used for class-types pie drill. */
let cachedWorkByClass = /** @type {{ class: string; fixed: number }[]} */ ([]);

/** Slice value arrays for hit-testing (aligned with `pieSliceDrillByChart`). */
const lastPieSlices = {
  class: /** @type {{ value: number; label: string; sub?: string }[]} */ ([]),
  attr: /** @type {{ value: number; label: string; sub?: string }[]} */ ([]),
  objects: /** @type {{ value: number; label: string; sub?: string }[]} */ ([]),
  classtypes: /** @type {{ value: number; label: string; sub?: string }[]} */ ([]),
};

const PIE_CHART_BY_CANVAS_ID = {
  "canvas-ifc-health-class": "class",
  "canvas-ifc-health-attr": "attr",
  "canvas-ifc-health-objects": "objects",
  "canvas-ifc-health-classtypes": "classtypes",
};

/** @param {Record<string, number[] | null | undefined>} vis */
function cloneVisibility(vis) {
  /** @type {Record<string, number[] | null>} */
  const out = {};
  for (const [k, v] of Object.entries(vis)) {
    out[k] = v === null || v === undefined ? null : [...v];
  }
  return out;
}

/**
 * @param {Record<string, unknown>} modelJson
 * @returns {number[]}
 */
function allExpressIds(modelJson) {
  const out = [];
  for (const k of Object.keys(modelJson)) {
    const id = Number(k);
    if (Number.isFinite(id)) out.push(id);
  }
  return out;
}

/**
 * @param {Record<string, unknown>} modelJson
 * @param {Set<string>} gids
 * @returns {number[]}
 */
function expressIdsForGlobalIds(modelJson, gids) {
  const out = [];
  for (const [k, v] of Object.entries(modelJson)) {
    const id = Number(k);
    if (!v || typeof v !== "object") continue;
    const gid = /** @type {{ globalId?: string }} */ (v).globalId;
    if (typeof gid === "string" && gid && gids.has(gid)) out.push(id);
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns {{ dimensionFixable: true | false | null | undefined, attributes: string[] }}
 */
function parseVerificationRecord(raw) {
  if (Array.isArray(raw)) {
    return {
      // Legacy format: array meant "fixed attributes for this object".
      dimensionFixable: true,
      attributes: raw.filter((x) => typeof x === "string" && x.length > 0),
    };
  }
  if (!raw || typeof raw !== "object") {
    return { dimensionFixable: undefined, attributes: [] };
  }
  const obj = /** @type {Record<string, unknown>} */ (raw);
  const fixVal = obj["Dimension Fixable"];
  const dimensionFixable = fixVal === true ? true : fixVal === false ? false : fixVal === null ? null : undefined;
  const attrsRaw = obj.Attributes;
  const attributes = Array.isArray(attrsRaw)
    ? attrsRaw.filter((x) => typeof x === "string" && x.length > 0)
    : [];
  return { dimensionFixable, attributes };
}

/**
 * @param {Record<string, unknown>} verificationLog
 * @param {(rec: { className: string, gid: string, dimensionFixable: true | false | null | undefined, attributes: string[] }) => void} visit
 */
function forEachVerificationRecord(verificationLog, visit) {
  if (!verificationLog || typeof verificationLog !== "object") return;
  for (const [className, entries] of Object.entries(verificationLog)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      for (const [gid, raw] of Object.entries(entry)) {
        if (!gid) continue;
        const parsed = parseVerificationRecord(raw);
        visit({ className, gid, ...parsed });
      }
    }
  }
}

/**
 * @param {Record<string, unknown>} verificationLog
 * @returns {Set<string>}
 */
function allCorrectedGlobalIds(verificationLog) {
  const gids = new Set();
  forEachVerificationRecord(verificationLog, ({ gid, dimensionFixable }) => {
    if (dimensionFixable === true) gids.add(gid);
  });
  return gids;
}

/**
 * @param {Record<string, unknown>} verificationLog
 * @param {string} className
 * @returns {Set<string>}
 */
function globalIdsFixedForClass(verificationLog, className) {
  const gids = new Set();
  forEachVerificationRecord(verificationLog, (rec) => {
    if (rec.className === className && rec.dimensionFixable === true) gids.add(rec.gid);
  });
  return gids;
}

/**
 * @param {Record<string, unknown>} modelJson
 * @param {Record<string, unknown>} verificationLog
 * @param {string} className
 * @returns {number[]}
 */
function expressIdsForClassFixSlice(modelJson, verificationLog, className) {
  const gids = globalIdsFixedForClass(verificationLog, className);
  return expressIdsForGlobalIds(modelJson, gids);
}

/**
 * @param {Record<string, unknown>} modelJson
 * @param {Record<string, unknown>} verificationLog
 * @param {string[]} classNames
 * @returns {number[]}
 */
function expressIdsForMergedClassFixSlices(modelJson, verificationLog, classNames) {
  const merged = new Set();
  for (const cn of classNames) {
    for (const id of expressIdsForClassFixSlice(modelJson, verificationLog, cn)) {
      merged.add(id);
    }
  }
  return [...merged];
}

/**
 * @param {Record<string, unknown>} verificationLog
 * @param {string} attrName
 * @returns {Set<string>}
 */
function globalIdsWithAttributeFix(verificationLog, attrName) {
  const gids = new Set();
  forEachVerificationRecord(verificationLog, ({ gid, dimensionFixable, attributes }) => {
    if (dimensionFixable === true && attributes.includes(attrName)) gids.add(gid);
  });
  return gids;
}

/**
 * @param {Record<string, unknown>} verificationLog
 * @param {string[]} attrNames
 * @returns {Set<string>}
 */
function globalIdsWithAnyAttributeFix(verificationLog, attrNames) {
  const gids = new Set();
  const set = new Set(attrNames);
  forEachVerificationRecord(verificationLog, ({ gid, dimensionFixable, attributes }) => {
    if (dimensionFixable !== true) return;
    for (const a of attributes) {
      if (set.has(a)) {
        gids.add(gid);
        break;
      }
    }
  });
  return gids;
}

/**
 * @param {Record<string, unknown>} verificationLog
 * @param {true | false | null} state
 * @returns {Set<string>}
 */
function globalIdsForDimensionFixable(verificationLog, state) {
  const gids = new Set();
  forEachVerificationRecord(verificationLog, ({ gid, dimensionFixable }) => {
    if (dimensionFixable === state) gids.add(gid);
  });
  return gids;
}

/**
 * @param {PieDrillSpec} spec
 * @param {Record<string, unknown>} modelJson
 * @param {Record<string, unknown>} verificationLog
 * @param {{ byClassRows: { class: string; fixed: number }[] }} ctx
 * @returns {number[]}
 */
function expressIdsForPieDrill(spec, modelJson, verificationLog, ctx) {
  switch (spec.kind) {
    case "class": {
      if (spec.classes?.length) {
        return expressIdsForMergedClassFixSlices(modelJson, verificationLog, spec.classes);
      }
      if (spec.className) {
        return expressIdsForClassFixSlice(modelJson, verificationLog, spec.className);
      }
      return [];
    }
    case "attr": {
      if (spec.attributes?.length) {
        const g = globalIdsWithAnyAttributeFix(verificationLog, spec.attributes);
        return expressIdsForGlobalIds(modelJson, g);
      }
      if (spec.attribute) {
        const g = globalIdsWithAttributeFix(verificationLog, spec.attribute);
        return expressIdsForGlobalIds(modelJson, g);
      }
      return [];
    }
    case "objects": {
      const corrected = globalIdsForDimensionFixable(verificationLog, true);
      const clean = globalIdsForDimensionFixable(verificationLog, null);
      const notFixable = globalIdsForDimensionFixable(verificationLog, false);
      if (spec.objectsMode === "corrected") {
        return expressIdsForGlobalIds(modelJson, corrected);
      }
      if (spec.objectsMode === "clean") {
        return expressIdsForGlobalIds(modelJson, clean);
      }
      if (spec.objectsMode === "notfixable") {
        return expressIdsForGlobalIds(modelJson, notFixable);
      }
      return [];
    }
    case "classtypes": {
      const rows = ctx.byClassRows;
      const withIssues = new Set(rows.filter((x) => x.fixed > 0).map((x) => x.class));
      const noIssues = new Set(rows.filter((x) => x.fixed === 0).map((x) => x.class));
      const target = spec.classtypesMode === "issues" ? withIssues : noIssues;
      const out = [];
      for (const [k, v] of Object.entries(modelJson)) {
        const id = Number(k);
        if (!v || typeof v !== "object") continue;
        const cls = /** @type {{ class?: string }} */ (v).class;
        if (typeof cls === "string" && cls && target.has(cls)) out.push(id);
      }
      return out;
    }
    default:
      return [];
  }
}

/**
 * @param {number[]} sliceIds
 * @param {Set<number>} base
 * @returns {number[]}
 */
function intersectIds(sliceIds, base) {
  return sliceIds.filter((id) => base.has(id));
}

/**
 * @param {string | null} jsonFile
 * @param {Record<string, unknown>} modelJson
 * @returns {Set<number>}
 */
function baseVisibleIdSet(jsonFile, modelJson) {
  if (
    jsonFile &&
    lastVisibleByFile &&
    Object.prototype.hasOwnProperty.call(lastVisibleByFile, jsonFile) &&
    Array.isArray(lastVisibleByFile[jsonFile])
  ) {
    return new Set(/** @type {number[]} */ (lastVisibleByFile[jsonFile]));
  }
  return new Set(allExpressIds(modelJson));
}

function emitPieDrillToViewport() {
  if (!activePieDrill || !cachedModelJson || !cachedVerificationLog) return;
  const jf = typeof cachedPayload?.json_file === "string" ? cachedPayload.json_file : null;
  if (!jf) return;
  const entryId = entryIdByJsonFile.get(jf);
  if (!entryId) return;

  if (!lastSidebarVisibility) {
    const base = baseVisibleIdSet(jf, cachedModelJson);
    lastSidebarVisibility = { [entryId]: [...base] };
  }

  const work = /** @type {Record<string, unknown>} */ (cachedVerificationLog);
  const sliceIds = expressIdsForPieDrill(activePieDrill, cachedModelJson, work, {
    byClassRows: cachedWorkByClass,
  });
  const base = baseVisibleIdSet(jf, cachedModelJson);
  const filtered = intersectIds(sliceIds, base);

  const vis = cloneVisibility(lastSidebarVisibility);
  vis[entryId] = filtered;
  window.dispatchEvent(
    new CustomEvent("dashboard:ifc-filter-visibility", {
      detail: { visibility: vis, source: "pie-drill" },
    })
  );
}

function clearPieDrill() {
  if (!activePieDrill) return;
  activePieDrill = null;
  if (lastSidebarVisibility) {
    window.dispatchEvent(
      new CustomEvent("dashboard:ifc-filter-visibility", {
        detail: { visibility: cloneVisibility(lastSidebarVisibility) },
      })
    );
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} clientX
 * @param {number} clientY
 * @param {{ value: number; label: string; sub?: string }[]} slices
 * @param {number} [baseSize]
 * @returns {number | null}
 */
function pieHitSliceIndex(canvas, clientX, clientY, slices, baseSize = PIE_BASE_SIZE) {
  const sum = slices.reduce((s, x) => s + x.value, 0);
  if (sum <= 0 || slices.length === 0) return null;

  const w = measurePieSize(canvas, baseSize);
  const h = w;
  const rect = canvas.getBoundingClientRect();
  const scaleX = w / rect.width;
  const scaleY = h / rect.height;
  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;
  const cx = w / 2;
  const cy = h / 2;
  const r = w * 0.38;
  const rIn = r * 0.52;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.hypot(dx, dy);
  if (dist < rIn || dist > r) return null;

  const clickAngle = Math.atan2(dy, dx);
  let start = -Math.PI / 2;
  for (let i = 0; i < slices.length; i++) {
    const sweep = (slices[i].value / sum) * Math.PI * 2;
    let delta = clickAngle - start;
    const twoPi = Math.PI * 2;
    delta = ((delta % twoPi) + twoPi) % twoPi;
    if (delta >= 0 && delta < sweep) return i;
    start += sweep;
  }
  return null;
}

/**
 * Rebuild IFC Health aggregates for a subset of express IDs (matches sidebar filters).
 * @param {Record<string, unknown>} data
 * @param {Record<string, unknown>} modelJson
 * @param {number[]} visibleIds
 * @param {Record<string, unknown>} verificationLog
 */
function applyVisibilityToPayload(data, modelJson, visibleIds, verificationLog) {
  const vis = new Set(visibleIds);
  /** @type {Record<string, number>} */
  const classTotals = {};
  let totalObjects = 0;
  for (const [k, v] of Object.entries(modelJson)) {
    const id = Number(k);
    if (!vis.has(id)) continue;
    if (!v || typeof v !== "object") continue;
    const cls = /** @type {{ class?: string }} */ (v).class;
    if (typeof cls === "string" && cls) {
      classTotals[cls] = (classTotals[cls] || 0) + 1;
      totalObjects++;
    }
  }

  const visibleGids = new Set();
  for (const [k, v] of Object.entries(modelJson)) {
    const id = Number(k);
    if (!vis.has(id)) continue;
    if (v && typeof v === "object") {
      const gid = /** @type {{ globalId?: string }} */ (v).globalId;
      if (typeof gid === "string" && gid) visibleGids.add(gid);
    }
  }

  /** @type {Record<string, number>} */
  const fixedPerClass = {};
  /** @type {Record<string, number>} */
  const unfixablePerClass = {};
  let fixedObjects = 0;
  let cleanObjects = 0;
  let notFixableObjects = 0;
  if (verificationLog && typeof verificationLog === "object") {
    forEachVerificationRecord(verificationLog, ({ className, gid, dimensionFixable }) => {
      if (!visibleGids.has(gid)) return;
      if (dimensionFixable === true) {
        fixedPerClass[className] = (fixedPerClass[className] || 0) + 1;
        fixedObjects += 1;
      } else if (dimensionFixable === null) {
        cleanObjects += 1;
      } else if (dimensionFixable === false) {
        unfixablePerClass[className] = (unfixablePerClass[className] || 0) + 1;
        notFixableObjects += 1;
      }
    });
  }

  /** @type {Record<string, number>} */
  const attrCounts = {};
  if (verificationLog && typeof verificationLog === "object") {
    forEachVerificationRecord(verificationLog, ({ gid, dimensionFixable, attributes }) => {
      if (!visibleGids.has(gid) || dimensionFixable !== true) return;
      for (const a of attributes) {
        attrCounts[a] = (attrCounts[a] || 0) + 1;
      }
    });
  }

  /** @type {{ class: string, total: number, fixed: number, unfixable: number, issue_count: number, pct_fixed: number }[]} */
  const by_class = [];
  for (const [cls, total] of Object.entries(classTotals).sort((a, b) => b[1] - a[1])) {
    const rawFixed = fixedPerClass[cls] ?? 0;
    const rawUnfixable = unfixablePerClass[cls] ?? 0;
    const fixed = Math.min(rawFixed, total);
    const unfixable = Math.min(rawUnfixable, Math.max(0, total - fixed));
    const issue_count = fixed + unfixable;
    const pct = total ? Math.round((1000 * fixed) / total) / 10 : 0;
    by_class.push({ class: cls, total, fixed, unfixable, issue_count, pct_fixed: pct });
  }

  const total_fixed_objects = fixedObjects;

  const totalAttrDefects = Object.values(attrCounts).reduce((s, x) => s + x, 0);
  /** @type {{ attribute: string, count: number, pct_of_fixes: number }[]} */
  const by_attribute = Object.entries(attrCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({
      attribute: name,
      count,
      pct_of_fixes: totalAttrDefects ? Math.round((1000 * count) / totalAttrDefects) / 10 : 0,
    }));

  const baseTotals = /** @type {Record<string, unknown>} */ (data.totals ?? {});
  return {
    ...data,
    totals: {
      ...baseTotals,
      objects: totalObjects,
      fixed_objects: total_fixed_objects,
      clean_objects: cleanObjects,
      not_fixable_objects: notFixableObjects,
    },
    by_class,
    by_attribute,
  };
}

async function ensureModelJsonForHealth(jsonFile) {
  if (!jsonFile) return null;
  if (cachedModelJsonFile === jsonFile && cachedModelJson) return cachedModelJson;
  const res = await fetch(`/download/${encodeURIComponent(jsonFile)}`);
  if (!res.ok) {
    cachedModelJson = null;
    cachedModelJsonFile = null;
    return null;
  }
  const data = await res.json();
  if (data && typeof data === "object") {
    cachedModelJson = data;
    cachedModelJsonFile = jsonFile;
    return cachedModelJson;
  }
  return null;
}

async function ensureVerificationLog() {
  if (cachedVerificationLog) return cachedVerificationLog;
  try {
    const res = await fetch("/api/ifc-verification-log");
    const data = await res.json();
    cachedVerificationLog = data && typeof data === "object" ? data : {};
  } catch {
    cachedVerificationLog = {};
  }
  return cachedVerificationLog;
}

/**
 * @template T
 * @param {T[]} items
 * @param {(x: T) => number} getValue
 * @param {(a: T[]) => T} mergeRest
 */
function capSlices(items, getValue, mergeRest) {
  if (items.length <= MAX_SLICES) return items;
  const head = items.slice(0, MAX_SLICES - 1);
  const tail = items.slice(MAX_SLICES - 1);
  return [...head, mergeRest(tail)];
}

/** Merge tail classes for "by class (with problems)" — slice size = fixed count. */
function mergeClassProblemSlices(rest) {
  const fixed = rest.reduce((s, x) => s + x.fixed, 0);
  const total = rest.reduce((s, x) => s + x.total, 0);
  const pct = total ? Math.round((1000 * fixed) / total) / 10 : 0;
  return {
    class: `Other (${rest.length} types)`,
    total,
    fixed,
    pct_fixed: pct,
  };
}

function mergeAttrSlices(rest) {
  const count = rest.reduce((s, x) => s + x.count, 0);
  return {
    attribute: `Other (${rest.length} names)`,
    count,
    pct_of_fixes: 0,
  };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} size
 */
function measurePieSize(canvas, size) {
  const wrap = canvas.closest(".ifc-health-pie-inner");
  if (wrap) {
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w > 0 && h > 0) {
      const m = Math.floor(Math.min(w, h, 339) - 9);
      return Math.max(145, Math.min(290, m));
    }
  }
  return size;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ value: number, label: string, sub?: string }[]} slices
 * @param {number} [baseSize]
 */
function drawPie(canvas, slices, baseSize = PIE_BASE_SIZE) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = measurePieSize(canvas, baseSize);
  const h = w;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const r = w * 0.38;
  const sum = slices.reduce((s, x) => s + x.value, 0);
  if (sum <= 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
    ctx.fill();
    return;
  }

  let angle = -Math.PI / 2;
  slices.forEach((sl, i) => {
    const sweep = (sl.value / sum) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + sweep);
    ctx.closePath();
    ctx.fillStyle = PIE_COLORS[i % PIE_COLORS.length];
    ctx.fill();
    angle += sweep;
  });

  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.52, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
  ctx.fill();
}

/**
 * @param {HTMLElement} ul
 * @param {{ value: number, label: string, sub?: string }[]} slices
 */
function fillLegend(ul, slices) {
  const sum = slices.reduce((s, x) => s + x.value, 0);
  ul.innerHTML = "";
  slices.forEach((sl, i) => {
    const li = document.createElement("li");
    li.className = "ifc-health-legend-item";

    const top = document.createElement("div");
    top.className = "ifc-health-legend-top";

    const dot = document.createElement("span");
    dot.className = "ifc-health-legend-dot";
    dot.style.background = PIE_COLORS[i % PIE_COLORS.length];

    const text = document.createElement("span");
    text.className = "ifc-health-legend-text";
    const strong = document.createElement("strong");
    strong.textContent = sl.label;
    text.appendChild(strong);

    const share = document.createElement("span");
    share.className = "ifc-health-legend-pct";
    const pct = sum > 0 ? Math.round((1000 * sl.value) / sum) / 10 : 0;
    share.textContent = `${pct}%`;

    top.appendChild(dot);
    top.appendChild(text);
    top.appendChild(share);
    li.appendChild(top);

    if (sl.sub) {
      const sub = document.createElement("div");
      sub.className = "ifc-health-legend-sub";
      sub.textContent = sl.sub;
      li.appendChild(sub);
    }

    ul.appendChild(li);
  });
}

/**
 * @param {HTMLElement} ul
 * @param {string} message
 */
function fillLegendPlaceholder(ul, message) {
  ul.innerHTML = "";
  const li = document.createElement("li");
  li.className = "ifc-health-legend-item ifc-health-legend-placeholder";
  const p = document.createElement("p");
  p.className = "ifc-health-placeholder-text";
  p.textContent = message;
  li.appendChild(p);
  ul.appendChild(li);
}

/** @param {Record<string, unknown>} data */
function renderCharts(data) {
  cachedPayload = data;

  let work = data;
  const jf = typeof data.json_file === "string" ? data.json_file : null;
  if (
    jf &&
    lastVisibleByFile &&
    Object.prototype.hasOwnProperty.call(lastVisibleByFile, jf) &&
    cachedModelJson &&
    cachedModelJsonFile === jf
  ) {
    const ids = lastVisibleByFile[jf];
    const log = cachedVerificationLog ?? {};
    work = applyVisibilityToPayload(data, cachedModelJson, Array.isArray(ids) ? ids : [], log);
  }

  const canvasClass = document.getElementById("canvas-ifc-health-class");
  const canvasAttr = document.getElementById("canvas-ifc-health-attr");
  const canvasObjects = document.getElementById("canvas-ifc-health-objects");
  const canvasClassTypes = document.getElementById("canvas-ifc-health-classtypes");
  const legClass = document.getElementById("legend-ifc-health-class");
  const legAttr = document.getElementById("legend-ifc-health-attr");
  const legObjects = document.getElementById("legend-ifc-health-objects");
  const legClassTypes = document.getElementById("legend-ifc-health-classtypes");
  const meta = document.getElementById("ifc-health-meta");

  if (!canvasClass || !canvasAttr || !canvasObjects || !canvasClassTypes || !legClass || !legAttr || !legObjects || !legClassTypes) {
    return;
  }

  const ok = work.ok !== false;
  const totals = /** @type {{ objects?: number, fixed_objects?: number, has_verification_log?: boolean }} */ (
    work.totals ?? {}
  );
  const hasLog = totals.has_verification_log === true;
  const baseByClass = Array.isArray(data.by_class) ? data.by_class : [];
  const hasJson = baseByClass.length > 0;
  const byClassArr = Array.isArray(work.by_class) ? work.by_class : [];
  cachedWorkByClass = byClassArr;

  /** Charts only after Fix Quantities produced a verification log (and we have class data). */
  const showCharts = ok && hasLog && hasJson;

  if (!showCharts) {
    if (activePieDrill) clearPieDrill();
    pieSliceDrillByChart.class = [];
    pieSliceDrillByChart.attr = [];
    pieSliceDrillByChart.objects = [];
    pieSliceDrillByChart.classtypes = [];
    lastPieSlices.class = [];
    lastPieSlices.attr = [];
    lastPieSlices.objects = [];
    lastPieSlices.classtypes = [];
    drawPie(canvasClass, [], PIE_BASE_SIZE);
    drawPie(canvasAttr, [], PIE_BASE_SIZE);
    drawPie(canvasObjects, [], PIE_BASE_SIZE);
    drawPie(canvasClassTypes, [], PIE_BASE_SIZE);
    legClass.innerHTML = "";
    legAttr.innerHTML = "";
    legObjects.innerHTML = "";
    legClassTypes.innerHTML = "";
    if (meta) {
      if (!ok) {
        meta.textContent =
          (typeof work.detail === "string" && work.detail) ||
          "Load an IFC (Add IFC or drag and drop) so the backend can export JSON. Charts stay empty until you run Fix Quantities.";
      } else if (!hasJson) {
        meta.textContent =
          "No IFC export in backend/results yet. Load an IFC to create model data. Charts stay empty until you run Fix Quantities.";
      } else {
        meta.textContent =
          "Run Fix Quantities after loading an IFC to fill IFC Health — class mix, % fixed per class, and attribute fixes.";
      }
    }
    return;
  }

  /* 1 — By class: only classes with fixed > 0; slice size = correction count (like attributes). */
  const rawClassProblems = byClassArr.filter((x) => x.fixed > 0);
  if (rawClassProblems.length === 0) {
    pieSliceDrillByChart.class = [];
    lastPieSlices.class = [];
    drawPie(canvasClass, [], PIE_BASE_SIZE);
    fillLegendPlaceholder(legClass, "No class had a logged correction — nothing to show here.");
  } else {
    const classForPie = capSlices(rawClassProblems, (x) => x.fixed, mergeClassProblemSlices);
    pieSliceDrillByChart.class = classForPie.map((x, idx) => {
      if (rawClassProblems.length > MAX_SLICES && idx === classForPie.length - 1) {
        const tail = rawClassProblems.slice(MAX_SLICES - 1);
        return /** @type {PieDrillSpec} */ ({ kind: "class", classes: tail.map((t) => t.class) });
      }
      return /** @type {PieDrillSpec} */ ({ kind: "class", className: x.class });
    });
    const classSlices = classForPie.map((x) => ({
      value: x.fixed,
      label: x.class,
      sub: `${x.fixed} correction(s) · ${x.total} object(s) of this class in model`,
    }));
    lastPieSlices.class = classSlices;
    drawPie(canvasClass, classSlices, PIE_BASE_SIZE);
    fillLegend(legClass, classSlices);
  }

  /* 2 — By attribute (only attributes with defects; unchanged idea). */
  const rawAttr = work.by_attribute?.filter((x) => x.count > 0) ?? [];
  if (rawAttr.length === 0) {
    pieSliceDrillByChart.attr = [];
    lastPieSlices.attr = [];
    drawPie(canvasAttr, [], PIE_BASE_SIZE);
    fillLegendPlaceholder(
      legAttr,
      "No attribute-level defects in the verification log for this run (or log is empty)."
    );
  } else {
    const attrForPie = capSlices(rawAttr, (x) => x.count, mergeAttrSlices);
    pieSliceDrillByChart.attr = attrForPie.map((x, idx) => {
      if (rawAttr.length > MAX_SLICES && idx === attrForPie.length - 1) {
        const tail = rawAttr.slice(MAX_SLICES - 1);
        return /** @type {PieDrillSpec} */ ({ kind: "attr", attributes: tail.map((t) => t.attribute) });
      }
      return /** @type {PieDrillSpec} */ ({ kind: "attr", attribute: x.attribute });
    });
    const totalAttr = attrForPie.reduce((s, x) => s + x.count, 0);
    const attrSlices = attrForPie.map((x) => ({
      value: x.count,
      label: x.attribute,
      sub:
        totalAttr > 0
          ? `${Math.round((1000 * x.count) / totalAttr) / 10}% of all fixes`
          : "0% of fixes",
    }));
    lastPieSlices.attr = attrSlices;
    drawPie(canvasAttr, attrSlices, PIE_BASE_SIZE);
    fillLegend(legAttr, attrSlices);
  }

  /* 3 — Objects: corrected vs no correction needed. */
  const nObj = totals.objects ?? 0;
  const nFixed = totals.fixed_objects ?? 0;
  const nNotFixable = totals.not_fixable_objects ?? 0;
  const nClean = Math.max(0, totals.clean_objects ?? (nObj - nFixed - nNotFixable));
  if (nObj <= 0) {
    pieSliceDrillByChart.objects = [];
    lastPieSlices.objects = [];
    drawPie(canvasObjects, [], PIE_BASE_SIZE);
    fillLegendPlaceholder(legObjects, "No objects in export.");
  } else {
    const objectSlices = [];
    pieSliceDrillByChart.objects = [];
    if (nFixed > 0) {
      objectSlices.push({
        value: nFixed,
        label: "Objects corrected",
        sub: `${Math.round((1000 * nFixed) / nObj) / 10}% of all objects`,
      });
      pieSliceDrillByChart.objects.push({ kind: "objects", objectsMode: "corrected" });
    }
    if (nClean > 0) {
      objectSlices.push({
        value: nClean,
        label: "No correction needed",
        sub: `${Math.round((1000 * nClean) / nObj) / 10}% of all objects`,
      });
      pieSliceDrillByChart.objects.push({ kind: "objects", objectsMode: "clean" });
    }
    if (nNotFixable > 0) {
      objectSlices.push({
        value: nNotFixable,
        label: "Not fixable",
        sub: `${Math.round((1000 * nNotFixable) / nObj) / 10}% of all objects`,
      });
      pieSliceDrillByChart.objects.push({ kind: "objects", objectsMode: "notfixable" });
    }
    lastPieSlices.objects = objectSlices;
    drawPie(canvasObjects, objectSlices, PIE_BASE_SIZE);
    fillLegend(legObjects, objectSlices);
  }

  /* 4 — Class types: IFC class names with ≥1 problem vs types with zero problems in this model. */
  const nTypes = byClassArr.length;
  const nTypesWithProblems = byClassArr.filter((x) => (Number(x.issue_count) || Number(x.fixed) || 0) > 0).length;
  const nTypesClean = Math.max(0, nTypes - nTypesWithProblems);
  if (nTypes <= 0) {
    pieSliceDrillByChart.classtypes = [];
    lastPieSlices.classtypes = [];
    drawPie(canvasClassTypes, [], PIE_BASE_SIZE);
    fillLegendPlaceholder(legClassTypes, "No class breakdown.");
  } else {
    const typeSlices = [];
    pieSliceDrillByChart.classtypes = [];
    if (nTypesWithProblems > 0) {
      typeSlices.push({
        value: nTypesWithProblems,
        label: "Class types with issues",
        sub: `${Math.round((1000 * nTypesWithProblems) / nTypes) / 10}% of class types in model`,
      });
      pieSliceDrillByChart.classtypes.push({ kind: "classtypes", classtypesMode: "issues" });
    }
    if (nTypesClean > 0) {
      typeSlices.push({
        value: nTypesClean,
        label: "Class types with no issues",
        sub: `${Math.round((1000 * nTypesClean) / nTypes) / 10}% of class types in model`,
      });
      pieSliceDrillByChart.classtypes.push({ kind: "classtypes", classtypesMode: "clean" });
    }
    lastPieSlices.classtypes = typeSlices;
    drawPie(canvasClassTypes, typeSlices, PIE_BASE_SIZE);
    fillLegend(legClassTypes, typeSlices);
  }

  if (meta) {
    const filtered =
      jf &&
      lastVisibleByFile &&
      Object.prototype.hasOwnProperty.call(lastVisibleByFile, jf) &&
      cachedModelJsonFile === jf;
    const parts = [
      `${(totals.objects ?? 0).toLocaleString()} objects · ${work.json_file ?? "results"}`,
      `${(totals.fixed_objects ?? 0).toLocaleString()} correction(s) logged`,
    ];
    if (filtered) parts.push("Filtered to match sidebar selection");
    if (activePieDrill) parts.push("3D filtered by pie slice");
    meta.textContent = parts.join(" · ");
  }

  if (activePieDrill) {
    emitPieDrillToViewport();
  }
}

async function fetchStats() {
  const res = await fetch("/api/ifc-health-stats");
  return res.json();
}

export async function refreshIfcHealth() {
  try {
    if (activePieDrill) clearPieDrill();
    cachedVerificationLog = null;
    const data = await fetchStats();
    const jf = typeof data.json_file === "string" ? data.json_file : null;
    if (jf && jf !== cachedModelJsonFile) {
      cachedModelJson = null;
      cachedModelJsonFile = null;
    }
    if (jf) {
      await ensureModelJsonForHealth(jf);
    }
    await ensureVerificationLog();
    renderCharts(data);
  } catch (e) {
    console.warn("[IFC Health]", e);
    renderCharts({
      ok: false,
      detail: "Could not load /api/ifc-health-stats",
      by_class: [],
      by_attribute: [],
    });
  }
}

function resizeRedraw() {
  if (cachedPayload) renderCharts(cachedPayload);
}

export function initIfcHealth() {
  const grid = document.getElementById("ifc-health-grid");
  const panel = document.getElementById("ifc-health-panel");

  void refreshIfcHealth();

  window.addEventListener("dashboard:ifc-filter-visibility", (ev) => {
    const d = /** @type {CustomEvent<{ visibility?: Record<string, number[] | null>; source?: string }>} */ (ev).detail;
    if (!d?.visibility || typeof d.visibility !== "object") return;
    if (d.source === "pie-drill") return;
    lastSidebarVisibility = cloneVisibility(d.visibility);
  });

  window.addEventListener("dashboard:ifc-model-json", (ev) => {
    const d = /** @type {CustomEvent<{ entryId?: string; jsonFile?: string }>} */ (ev).detail;
    if (d?.jsonFile && d?.entryId) entryIdByJsonFile.set(d.jsonFile, d.entryId);
  });

  window.addEventListener("dashboard:ifc-model-unloaded", (ev) => {
    const id = /** @type {CustomEvent<{ entryId?: string }>} */ (ev).detail?.entryId;
    if (!id) return;
    for (const [jf, eid] of [...entryIdByJsonFile.entries()]) {
      if (eid === id) entryIdByJsonFile.delete(jf);
    }
  });

  window.addEventListener("dashboard:ifc-models-cleared", () => {
    entryIdByJsonFile.clear();
  });

  grid?.addEventListener("pointerdown", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLCanvasElement)) return;
    const key = PIE_CHART_BY_CANVAS_ID[/** @type {keyof typeof PIE_CHART_BY_CANVAS_ID} */ (t.id)];
    if (!key) return;
    const slices = lastPieSlices[key];
    const drills = pieSliceDrillByChart[key];
    if (!slices.length || !drills.length) return;
    const idx = pieHitSliceIndex(t, ev.clientX, ev.clientY, slices);
    if (idx === null) {
      clearPieDrill();
      if (cachedPayload) renderCharts(cachedPayload);
      return;
    }
    const spec = drills[idx];
    if (!spec) return;
    activePieDrill = spec;
    emitPieDrillToViewport();
    if (cachedPayload) renderCharts(cachedPayload);
  });

  document.addEventListener("pointerdown", (ev) => {
    const t = ev.target;
    if (t instanceof HTMLCanvasElement && /^canvas-ifc-health-/.test(t.id)) return;
    if (activePieDrill) {
      clearPieDrill();
      if (cachedPayload) renderCharts(cachedPayload);
    }
  });

  window.addEventListener("dashboard:ifc-health-visibility", (ev) => {
    const d = /** @type {CustomEvent<{ visibleByFile?: Record<string, number[]> }>} */ (ev).detail;
    lastVisibleByFile = d?.visibleByFile ?? {};
    if (cachedPayload) {
      void (async () => {
        const jf = typeof cachedPayload.json_file === "string" ? cachedPayload.json_file : null;
        if (jf) {
          await ensureModelJsonForHealth(jf);
          await ensureVerificationLog();
        }
        if (cachedPayload) renderCharts(cachedPayload);
      })();
    }
  });

  window.addEventListener("dashboard:ifc-health-refresh", () => {
    void refreshIfcHealth();
  });

  const ro =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          requestAnimationFrame(resizeRedraw);
        })
      : null;
  ro?.observe(grid ?? panel ?? document.body);
}
