const viewport3d = document.getElementById("viewport-3d");
const apiStatus = document.getElementById("api-status");
const LAYOUT_KEY = "dashboard-workspace-layout";
const LAYOUT_LABELS = ["Stack + viewer", "Grid + viewer + BOQ"];

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
  const n = ((index % 2) + 2) % 2;
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
}

function currentLayoutIndex() {
  const v = workspaceShell?.dataset.layout;
  const layout = v === "2" ? 2 : 1;
  return layout - 1;
}

function initWorkspaceLayout() {
  let initial = 0;
  try {
    const stored = localStorage.getItem(LAYOUT_KEY);
    if (stored === "1" || stored === "2") {
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

const boqRows = [
  ["W-001", "Concrete wall type A", "124", "m²"],
  ["S-014", "Steel beam HEA 200", "18", "m"],
  ["F-003", "Floor finish", "420", "m²"],
  ["C-102", "Ceiling tiles", "380", "m²"],
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

fillTable("table-boq", boqRows, -1);

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

Promise.all([
  import("./ifc-element-filters.js").then((m) => m.initIfcElementFilters()),
  /** Dynamic import so a blocked CDN / failed IFC bundle does not stop the rest of this script. */
  import("./ifc-viewer.js").then((m) => m.initIfcViewport()),
])
  .then(() => {
    window.dispatchEvent(new CustomEvent("dashboard:ifc-filter-sync-request"));
  })
  .catch((err) => console.error("IFC viewer or filters failed to load:", err));
