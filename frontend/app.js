const viewport3d = document.getElementById("viewport-3d");
const viewportSize = document.getElementById("viewport-size");
const viewportDimReadout = document.getElementById("viewport-dim-readout");
const apiStatus = document.getElementById("api-status");

function formatViewportRect(rect) {
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  viewportSize.textContent = `${w} × ${h}px`;
  viewportDimReadout.textContent = `ResizeObserver: ${w}×${h} — use for camera / renderer sizing`;
}

/** Fires when the 3D panel size changes (replace with Three.js setSize + setPixelRatio). */
const ro = new ResizeObserver((entries) => {
  for (const entry of entries) {
    formatViewportRect(entry.contentRect);
    window.dispatchEvent(
      new CustomEvent("dashboard:viewport3d", {
        detail: {
          width: entry.contentRect.width,
          height: entry.contentRect.height,
          element: entry.target,
        },
      })
    );
  }
});

if (viewport3d) {
  ro.observe(viewport3d);
  formatViewportRect(viewport3d.getBoundingClientRect());
}

// Sample bar chart (placeholder data)
const throughputEl = document.getElementById("chart-throughput");
if (throughputEl) {
  const values = [42, 68, 55, 80, 48, 72, 61];
  const max = Math.max(...values);
  values.forEach((v) => {
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = `${(v / max) * 100}%`;
    bar.title = String(v);
    throughputEl.appendChild(bar);
  });
}

// Sparkline SVG
const latencyEl = document.getElementById("chart-latency");
if (latencyEl) {
  const pts = [12, 18, 14, 22, 16, 19, 15, 24, 20, 17];
  const w = 280;
  const h = 72;
  const pad = 4;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const path = pts
    .map((p, i) => {
      const x = pad + (i / (pts.length - 1)) * (w - pad * 2);
      const y = h - pad - ((p - min) / span) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  latencyEl.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4d9fff" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#4d9fff" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${path} L ${w - pad},${h} L ${pad},${h} Z" fill="url(#lg)" />
      <path d="${path}" fill="none" stroke="#4d9fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
}

// Donut chart (SVG)
const donutEl = document.getElementById("chart-donut");
const legendEl = document.getElementById("donut-legend");
if (donutEl && legendEl) {
  const segments = [
    { label: "Primary", value: 45, color: "#4d9fff" },
    { label: "Secondary", value: 30, color: "#7c5cff" },
    { label: "Other", value: 25, color: "#f0b429" },
  ];
  const total = segments.reduce((s, x) => s + x.value, 0);
  let angle = -90;
  const cx = 44;
  const cy = 44;
  const r = 32;
  const inner = 22;
  const paths = [];
  segments.forEach((seg) => {
    const sweep = (seg.value / total) * 360;
    const start = (angle * Math.PI) / 180;
    const end = ((angle + sweep) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const x3 = cx + inner * Math.cos(end);
    const y3 = cy + inner * Math.sin(end);
    const x4 = cx + inner * Math.cos(start);
    const y4 = cy + inner * Math.sin(start);
    const large = sweep > 180 ? 1 : 0;
    const d = `M ${x1},${y1} A ${r},${r} 0 ${large},1 ${x2},${y2} L ${x3},${y3} A ${inner},${inner} 0 ${large},0 ${x4},${y4} Z`;
    paths.push(`<path d="${d}" fill="${seg.color}" />`);
    angle += sweep;
  });
  donutEl.innerHTML = `<svg viewBox="0 0 88 88" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${paths.join("")}</svg>`;
  legendEl.innerHTML = segments
    .map((s, i) => `<li class="c${i + 1}">${s.label} · ${s.value}%</li>`)
    .join("");
}

// Sample tables
const activityRows = [
  ["10:02", "Sync completed", "ok"],
  ["09:58", "Import queued", "ok"],
  ["09:41", "Validation warning", "warn"],
  ["09:15", "Model loaded", "ok"],
];

const itemsRows = [
  ["Zone A", "128", "—"],
  ["Zone B", "94", "Review"],
  ["Shared", "56", "—"],
];

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

fillTable("table-activity", activityRows, 2);
fillTable("table-items", itemsRows, -1);

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

/** Dynamic import so a blocked CDN / failed IFC bundle does not stop the rest of this script. */
import("./ifc-viewer.js")
  .then((m) => m.initIfcViewport())
  .catch((err) => console.error("IFC viewer failed to load:", err));
