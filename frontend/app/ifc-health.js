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
  if (verificationLog && typeof verificationLog === "object") {
    for (const [cls, entries] of Object.entries(verificationLog)) {
      if (!Array.isArray(entries)) continue;
      let n = 0;
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        for (const [gid] of Object.entries(entry)) {
          if (visibleGids.has(gid)) n++;
        }
      }
      if (n > 0) fixedPerClass[cls] = n;
    }
  }

  /** @type {Record<string, number>} */
  const attrCounts = {};
  if (verificationLog && typeof verificationLog === "object") {
    for (const entries of Object.values(verificationLog)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        for (const [gid, attrs] of Object.entries(entry)) {
          if (!visibleGids.has(gid)) continue;
          if (!Array.isArray(attrs)) continue;
          for (const a of attrs) {
            if (typeof a === "string" && a) attrCounts[a] = (attrCounts[a] || 0) + 1;
          }
        }
      }
    }
  }

  /** @type {{ class: string, total: number, fixed: number, pct_fixed: number }[]} */
  const by_class = [];
  for (const [cls, total] of Object.entries(classTotals).sort((a, b) => b[1] - a[1])) {
    const rawFixed = fixedPerClass[cls] ?? 0;
    const fixed = Math.min(rawFixed, total);
    const pct = total ? Math.round((1000 * fixed) / total) / 10 : 0;
    by_class.push({ class: cls, total, fixed, pct_fixed: pct });
  }

  const total_fixed_objects = by_class.reduce((s, x) => s + x.fixed, 0);

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

  /** Charts only after Fix Quantities produced a verification log (and we have class data). */
  const showCharts = ok && hasLog && hasJson;

  if (!showCharts) {
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
    drawPie(canvasClass, [], PIE_BASE_SIZE);
    fillLegendPlaceholder(legClass, "No class had a logged correction — nothing to show here.");
  } else {
    const classForPie = capSlices(rawClassProblems, (x) => x.fixed, mergeClassProblemSlices);
    const classSlices = classForPie.map((x) => ({
      value: x.fixed,
      label: x.class,
      sub: `${x.fixed} correction(s) · ${x.total} object(s) of this class in model`,
    }));
    drawPie(canvasClass, classSlices, PIE_BASE_SIZE);
    fillLegend(legClass, classSlices);
  }

  /* 2 — By attribute (only attributes with defects; unchanged idea). */
  const rawAttr = work.by_attribute?.filter((x) => x.count > 0) ?? [];
  if (rawAttr.length === 0) {
    drawPie(canvasAttr, [], PIE_BASE_SIZE);
    fillLegendPlaceholder(
      legAttr,
      "No attribute-level defects in the verification log for this run (or log is empty)."
    );
  } else {
    const attrForPie = capSlices(rawAttr, (x) => x.count, mergeAttrSlices);
    const totalAttr = attrForPie.reduce((s, x) => s + x.count, 0);
    const attrSlices = attrForPie.map((x) => ({
      value: x.count,
      label: x.attribute,
      sub:
        totalAttr > 0
          ? `${Math.round((1000 * x.count) / totalAttr) / 10}% of all fixes`
          : "0% of fixes",
    }));
    drawPie(canvasAttr, attrSlices, PIE_BASE_SIZE);
    fillLegend(legAttr, attrSlices);
  }

  /* 3 — Objects: corrected vs no correction needed. */
  const nObj = totals.objects ?? 0;
  const nFixed = totals.fixed_objects ?? 0;
  const nClean = Math.max(0, nObj - nFixed);
  if (nObj <= 0) {
    drawPie(canvasObjects, [], PIE_BASE_SIZE);
    fillLegendPlaceholder(legObjects, "No objects in export.");
  } else {
    const objectSlices = [];
    if (nFixed > 0) {
      objectSlices.push({
        value: nFixed,
        label: "Objects corrected",
        sub: `${Math.round((1000 * nFixed) / nObj) / 10}% of all objects`,
      });
    }
    if (nClean > 0) {
      objectSlices.push({
        value: nClean,
        label: "No correction needed",
        sub: `${Math.round((1000 * nClean) / nObj) / 10}% of all objects`,
      });
    }
    drawPie(canvasObjects, objectSlices, PIE_BASE_SIZE);
    fillLegend(legObjects, objectSlices);
  }

  /* 4 — Class types: IFC class names with ≥1 problem vs types with zero problems in this model. */
  const nTypes = byClassArr.length;
  const nTypesWithProblems = byClassArr.filter((x) => x.fixed > 0).length;
  const nTypesClean = Math.max(0, nTypes - nTypesWithProblems);
  if (nTypes <= 0) {
    drawPie(canvasClassTypes, [], PIE_BASE_SIZE);
    fillLegendPlaceholder(legClassTypes, "No class breakdown.");
  } else {
    const typeSlices = [];
    if (nTypesWithProblems > 0) {
      typeSlices.push({
        value: nTypesWithProblems,
        label: "Class types with issues",
        sub: `${Math.round((1000 * nTypesWithProblems) / nTypes) / 10}% of class types in model`,
      });
    }
    if (nTypesClean > 0) {
      typeSlices.push({
        value: nTypesClean,
        label: "Class types with no issues",
        sub: `${Math.round((1000 * nTypesClean) / nTypes) / 10}% of class types in model`,
      });
    }
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
    meta.textContent = parts.join(" · ");
  }
}

async function fetchStats() {
  const res = await fetch("/api/ifc-health-stats");
  return res.json();
}

export async function refreshIfcHealth() {
  try {
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
