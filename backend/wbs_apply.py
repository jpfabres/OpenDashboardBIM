"""
Apply WBS codes to objects in the latest _corrected.json.

Each rule:
  { "name": str|"All", "class": str|"All", "material": str|"All",
    "wbs_b": str, "wbs_e": str, "unit": str }

Objects that match a rule get a top-level "wbs" field and a top-level "unit" field:
  { "b": <wbs_b>, "e": <wbs_e> }
  "unit": <unit>

Matching is done with "All" as wildcard (same logic as the frontend WBS table).
The first matching rule wins (rules are tested in order).
"""

import json
from pathlib import Path

ALL = "All"


def _material_names(materials) -> list[str]:
    """Replicate frontend materialNamesFromEntry logic."""
    if not isinstance(materials, list):
        return []
    out: list[str] = []
    for m in materials:
        if not isinstance(m, dict):
            continue
        if m.get("type") == "IfcMaterial" and isinstance(m.get("name"), str) and m["name"]:
            out.append(m["name"])
        elif m.get("type") == "IfcMaterialList" and isinstance(m.get("materials"), list):
            for n in m["materials"]:
                if isinstance(n, str) and n:
                    out.append(n)
        elif isinstance(m.get("layers"), list):
            for layer in m["layers"]:
                if isinstance(layer, dict) and isinstance(layer.get("material"), str) and layer["material"]:
                    out.append(layer["material"])
        elif isinstance(m.get("material"), str) and m["material"]:
            out.append(m["material"])
    # deduplicate, preserve order
    seen: set[str] = set()
    return [x for x in out if not (x in seen or seen.add(x))]  # type: ignore[func-returns-value]


def _matches(obj: dict, rule: dict) -> bool:
    """Return True if obj satisfies all non-All conditions in rule."""
    r_class = rule.get("class", ALL)
    r_name = rule.get("name", ALL)
    r_material = rule.get("material", ALL)

    if r_class != ALL and obj.get("class") != r_class:
        return False

    if r_name != ALL:
        obj_name = (obj.get("name") or "").strip()
        if obj_name != r_name:
            return False

    if r_material != ALL:
        mat_names = _material_names(obj.get("materials", []))
        material_str = ", ".join(mat_names) if mat_names else ""
        if material_str != r_material:
            return False

    return True


def apply_wbs(fix_results_dir: str, rules: list[dict]) -> dict:
    """
    Find the latest *_corrected.json in fix_results_dir, apply WBS rules in-place.

    Returns:
        { "corrected_file": str, "matched_objects": int, "total_objects": int }
    """
    fix_dir = Path(fix_results_dir)
    corrected_files = sorted(
        [f for f in fix_dir.iterdir() if f.is_file() and f.name.endswith("_corrected.json")],
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )
    if not corrected_files:
        raise FileNotFoundError("No _corrected.json found in fix results directory.")

    corrected_path = corrected_files[0]

    with open(corrected_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Only process rules that have at least one WBS value or unit set
    active_rules = [r for r in rules if r.get("wbs_b") or r.get("wbs_e") or r.get("unit")]

    matched = 0
    total = 0
    for value in data.values():
        if not isinstance(value, dict):
            continue
        total += 1
        for rule in active_rules:
            if _matches(value, rule):
                value["wbs"] = {
                    "b": rule.get("wbs_b", ""),
                    "e": rule.get("wbs_e", ""),
                }
                if rule.get("unit"):
                    value["unit"] = rule["unit"]
                matched += 1
                break  # first matching rule wins

    with open(corrected_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)

    return {
        "corrected_file": corrected_path.name,
        "matched_objects": matched,
        "total_objects": total,
    }
