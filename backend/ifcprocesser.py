import ifcopenshell
import ifcopenshell.util.placement
import json
import os

RESULTS_DIR = os.environ.get(
    "IFC_RESULTS_DIR",
    os.path.join(os.path.dirname(__file__), "results"),
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_prop_value(prop):
    if hasattr(prop, "NominalValue") and prop.NominalValue:
        if hasattr(prop.NominalValue, "wrappedValue"):
            return prop.NominalValue.wrappedValue
        try:
            return str(prop.NominalValue)
        except Exception:
            return None
    return None


def _extract_quantity_value(quantity):
    for attr, ifc_type in [
        ("LengthValue",  "IfcQuantityLength"),
        ("AreaValue",    "IfcQuantityArea"),
        ("VolumeValue",  "IfcQuantityVolume"),
        ("CountValue",   "IfcQuantityCount"),
        ("WeightValue",  "IfcQuantityWeight"),
        ("TimeValue",    "IfcQuantityTime"),
    ]:
        if quantity.is_a(ifc_type) and hasattr(quantity, attr):
            return getattr(quantity, attr)
    return None


def _read_pset(pset, prop_names_set):
    pset_props = {}
    if pset.is_a("IfcPropertySet"):
        if hasattr(pset, "HasProperties") and pset.HasProperties:
            for prop in pset.HasProperties:
                pset_props[prop.Name] = _extract_prop_value(prop)
                prop_names_set.add(prop.Name)
    elif pset.is_a("IfcElementQuantity"):
        if hasattr(pset, "Quantities") and pset.Quantities:
            for q in pset.Quantities:
                pset_props[q.Name] = _extract_quantity_value(q)
                prop_names_set.add(q.Name)
    return pset_props


def _collect_psets(obj, prop_names_set):
    """Collect all property sets and quantities from an object and its type."""
    psets = {}

    # Direct HasPropertySets (IFC 2x3 type objects)
    if hasattr(obj, "HasPropertySets") and obj.HasPropertySets:
        for pset in obj.HasPropertySets:
            props = _read_pset(pset, prop_names_set)
            if props:
                psets[pset.Name] = props

    # Via IsDefinedBy relationships
    if hasattr(obj, "IsDefinedBy"):
        for rel in obj.IsDefinedBy:
            if rel.is_a("IfcRelDefinesByType"):
                type_obj = getattr(rel, "RelatingType", None)
                if type_obj and hasattr(type_obj, "HasPropertySets") and type_obj.HasPropertySets:
                    for pset in type_obj.HasPropertySets:
                        props = _read_pset(pset, prop_names_set)
                        if props:
                            psets.setdefault(pset.Name, {}).update(props)

            elif rel.is_a("IfcRelDefinesByProperties"):
                prop_def = getattr(rel, "RelatingPropertyDefinition", None)
                if prop_def:
                    props = _read_pset(prop_def, prop_names_set)
                    if props:
                        psets.setdefault(prop_def.Name, {}).update(props)

    return psets


def _extract_prop_value_from_single(prop):
    """Extract value from IfcPropertySingleValue."""
    val = getattr(prop, "NominalValue", None)
    if val is None:
        return None
    if hasattr(val, "wrappedValue"):
        return val.wrappedValue
    try:
        return str(val)
    except Exception:
        return None


def _extract_material_properties(mat):
    """
    Extract all property sets from IfcMaterial.HasProperties.
    Returns dict keyed by pset name, each value is a dict of property name → value.
    Handles both IFC4 (IfcMaterialProperties with .Properties) and
    IFC 2x3 (IfcExtendedMaterialProperties).
    """
    psets = {}
    if not hasattr(mat, "HasProperties"):
        return psets

    for mat_pset in mat.HasProperties:
        pset_name = getattr(mat_pset, "Name", None) or mat_pset.is_a()
        props = {}

        # IFC4: IfcMaterialProperties has a .Properties list of IfcPropertySingleValue
        if mat_pset.is_a("IfcMaterialProperties"):
            prop_list = getattr(mat_pset, "Properties", None) or []
            for p in prop_list:
                val = _extract_prop_value_from_single(p)
                if val is not None:
                    props[p.Name] = val

        # IFC 2x3: IfcExtendedMaterialProperties
        elif mat_pset.is_a("IfcExtendedMaterialProperties"):
            extended = getattr(mat_pset, "ExtendedProperties", None) or []
            for prop in extended:
                val = getattr(prop, "NominalValue", None)
                if val is not None:
                    props[prop.Name] = val.wrappedValue if hasattr(val, "wrappedValue") else str(val)
                else:
                    raw = getattr(prop, "EnumerationValues", None)
                    if raw:
                        props[prop.Name] = [v.wrappedValue if hasattr(v, "wrappedValue") else str(v) for v in raw]

        # Fallback: named attribute subtypes
        else:
            try:
                attrs = mat_pset.wrapped_data.declaration().attributes()
            except Exception:
                attrs = []
            for attr in attrs:
                name = attr.name()
                if name in ("Material", "Name", "Description"):
                    continue
                try:
                    value = getattr(mat_pset, name, None)
                    if value is not None:
                        props[name] = value
                except Exception:
                    pass

        if props:
            psets[pset_name] = props

    return psets


def _extract_material(obj):
    """Return material info from IfcRelAssociatesMaterial."""
    materials = []
    if not hasattr(obj, "HasAssociations"):
        return materials

    for assoc in obj.HasAssociations:
        if not assoc.is_a("IfcRelAssociatesMaterial"):
            continue

        mat = assoc.RelatingMaterial

        if mat.is_a("IfcMaterial"):
            entry = {"type": "IfcMaterial", "name": mat.Name}
            mat_props = _extract_material_properties(mat)
            if mat_props:
                entry["properties"] = mat_props
            materials.append(entry)

        elif mat.is_a("IfcMaterialList"):
            materials.append({
                "type": "IfcMaterialList",
                "materials": [m.Name for m in mat.Materials] if mat.Materials else []
            })

        elif mat.is_a("IfcMaterialLayerSetUsage"):
            layer_set = mat.ForLayerSet
            layers = []
            if layer_set and hasattr(layer_set, "MaterialLayers") and layer_set.MaterialLayers:
                for layer in layer_set.MaterialLayers:
                    mat_props = _extract_material_properties(layer.Material) if layer.Material else {}
                    layer_entry = {
                        "material": layer.Material.Name if layer.Material else None,
                        "thickness": layer.LayerThickness,
                    }
                    if mat_props:
                        layer_entry["properties"] = mat_props
                    layers.append(layer_entry)
            materials.append({"type": "IfcMaterialLayerSetUsage", "layers": layers})

        elif mat.is_a("IfcMaterialLayerSet"):
            layers = []
            if hasattr(mat, "MaterialLayers") and mat.MaterialLayers:
                for layer in mat.MaterialLayers:
                    mat_props = _extract_material_properties(layer.Material) if layer.Material else {}
                    layer_entry = {
                        "material": layer.Material.Name if layer.Material else None,
                        "thickness": layer.LayerThickness,
                    }
                    if mat_props:
                        layer_entry["properties"] = mat_props
                    layers.append(layer_entry)
            materials.append({"type": "IfcMaterialLayerSet", "layers": layers})

        elif mat.is_a("IfcMaterialLayer"):
            mat_props = _extract_material_properties(mat.Material) if mat.Material else {}
            entry = {
                "type": "IfcMaterialLayer",
                "material": mat.Material.Name if mat.Material else None,
                "thickness": mat.LayerThickness,
            }
            if mat_props:
                entry["properties"] = mat_props
            materials.append(entry)

    return materials


def _get_world_matrix(obj):
    """Return the full 4x4 world-space placement matrix, or None."""
    if not hasattr(obj, "ObjectPlacement") or not obj.ObjectPlacement:
        return None
    try:
        return ifcopenshell.util.placement.get_local_placement(obj.ObjectPlacement)
    except Exception:
        return None



def _get_spatial_container(obj):
    """Walk up spatial containment to find the direct IfcBuildingStorey (or higher)."""
    # IfcRelContainedInSpatialStructure
    if hasattr(obj, "ContainedInStructure"):
        for rel in obj.ContainedInStructure:
            container = getattr(rel, "RelatingStructure", None)
            if container is not None:
                return container
    return None


def _walk_spatial_hierarchy(element):
    """
    Starting from a spatial element (e.g. IfcBuildingStorey), walk upward via
    Decomposes to collect the full hierarchy dict.
    Returns dict like:
      { "IfcBuildingStorey": "L1.00_PisoTerreo",
        "IfcBuilding": "Default",
        "IfcSite": "Default",
        "IfcProject": "09" }
    """
    hierarchy = {}
    current = element
    while current is not None:
        hierarchy[current.is_a()] = getattr(current, "Name", None) or getattr(current, "LongName", None) or ""
        parent = None
        if hasattr(current, "Decomposes"):
            for rel in current.Decomposes:
                parent = getattr(rel, "RelatingObject", None)
                if parent is not None:
                    break
        current = parent
    return hierarchy


def _get_all_stories_sorted(model):
    """Return all IfcBuildingStorey sorted by elevation (ascending)."""
    stories = []
    for storey in model.by_type("IfcBuildingStorey"):
        elev = getattr(storey, "Elevation", None)
        stories.append((elev if elev is not None else 0.0, storey))
    stories.sort(key=lambda t: t[0])
    return stories


def _extract_location(obj, model, stories_sorted):
    """
    Build the full location block:
      project, site, building_story,
      global_x/y/z,
      global_bottom_elevation, global_top_elevation,
      bottom_elevation (relative to storey),
      top_elevation (relative to storey),
      bottom_distance_to_next_story,
      top_distance_to_next_story
    """
    location = {}

    # --- Spatial hierarchy (Project / Site / Building Story) ---
    container = _get_spatial_container(obj)
    if container is not None:
        hierarchy = _walk_spatial_hierarchy(container)
        location["project"]        = hierarchy.get("IfcProject", "")
        location["site"]           = hierarchy.get("IfcSite", "")
        location["building_story"] = hierarchy.get("IfcBuildingStorey", "")
        storey_obj = container if container.is_a("IfcBuildingStorey") else None
    else:
        location["project"] = location["site"] = location["building_story"] = ""
        storey_obj = None

    # --- World coordinates ---
    matrix = _get_world_matrix(obj)
    if matrix is None:
        return location

    global_x = float(matrix[0][3])
    global_y  = float(matrix[1][3])
    global_z  = float(matrix[2][3])

    location["global_x"] = global_x
    location["global_y"] = global_y
    location["global_z"] = global_z

    # --- Object height (from IfcElementQuantity) ---
    obj_height = None
    if hasattr(obj, "IsDefinedBy"):
        for rel in obj.IsDefinedBy:
            if not rel.is_a("IfcRelDefinesByProperties"):
                continue
            prop_def = getattr(rel, "RelatingPropertyDefinition", None)
            if prop_def and prop_def.is_a("IfcElementQuantity") and prop_def.Quantities:
                for q in prop_def.Quantities:
                    if q.is_a("IfcQuantityLength") and "height" in q.Name.lower():
                        obj_height = q.LengthValue
                        break
                if obj_height is not None:
                    break

    global_bottom = global_z
    global_top    = (global_z + obj_height) if obj_height is not None else global_z

    location["global_bottom_elevation"] = global_bottom
    location["global_top_elevation"]    = global_top

    # --- Elevations relative to building storey ---
    if storey_obj is not None:
        storey_elev = getattr(storey_obj, "Elevation", None) or 0.0
        location["bottom_elevation"] = global_bottom - storey_elev
        location["top_elevation"]    = global_top    - storey_elev
    else:
        location["bottom_elevation"] = None
        location["top_elevation"]    = None

    # --- Distance to next / previous story ---
    if storey_obj is not None and stories_sorted:
        story_elevs = [e for e, _ in stories_sorted]
        story_objs  = [s for _, s in stories_sorted]

        try:
            idx = story_objs.index(storey_obj)
        except ValueError:
            idx = None

        if idx is not None:
            # distance from object bottom to floor of NEXT storey above
            if idx + 1 < len(story_elevs):
                next_elev = story_elevs[idx + 1]
                location["top_distance_to_next_story"]    = next_elev - global_top
                location["bottom_distance_to_next_story"] = next_elev - global_bottom
            else:
                location["top_distance_to_next_story"]    = None
                location["bottom_distance_to_next_story"] = None
        else:
            location["top_distance_to_next_story"]    = None
            location["bottom_distance_to_next_story"] = None
    else:
        location["top_distance_to_next_story"]    = None
        location["bottom_distance_to_next_story"] = None

    return location


def _extract_dimensions(obj):
    """
    Pull dimension-like quantities (Length, Width, Height, Area, Volume, etc.)
    from IfcElementQuantity sets attached to the object.
    """
    dims = {}
    dimension_keys = {
        "length", "width", "height", "depth", "area", "volume",
        "perimeter", "weight", "thickness",
    }

    if not hasattr(obj, "IsDefinedBy"):
        return dims

    for rel in obj.IsDefinedBy:
        if not rel.is_a("IfcRelDefinesByProperties"):
            continue
        prop_def = getattr(rel, "RelatingPropertyDefinition", None)
        if not prop_def or not prop_def.is_a("IfcElementQuantity"):
            continue
        if hasattr(prop_def, "Quantities") and prop_def.Quantities:
            for q in prop_def.Quantities:
                value = _extract_quantity_value(q)
                if value is not None:
                    dims[q.Name] = value
                    # Also expose flat shortcut for common names
                    key_lower = q.Name.lower()
                    for dim_key in dimension_keys:
                        if dim_key in key_lower:
                            dims.setdefault(dim_key.capitalize(), value)

    return dims or None


# ---------------------------------------------------------------------------
# Main parser
# ---------------------------------------------------------------------------

def process_ifc2x3(file_path):
    model = ifcopenshell.open(file_path)

    result = {
        "classes_found": {},
        "psets_found": {},
        "total_objects": 0
    }

    detailed_objects = {}
    processed_objects = set()
    property_counts = {}

    # Pre-compute sorted stories once for the whole model
    stories_sorted = _get_all_stories_sorted(model)

    for obj in model.by_type("IfcProduct"):
        class_name = obj.is_a()

        if obj.id() in processed_objects:
            continue
        processed_objects.add(obj.id())

        result["total_objects"] += 1
        result["classes_found"].setdefault(class_name, 0)
        result["classes_found"][class_name] += 1

        prop_names_set = set()
        psets = _collect_psets(obj, prop_names_set)

        # Track property counts for the summary
        for prop_name in prop_names_set:
            property_counts.setdefault(prop_name, 0)
            property_counts[prop_name] += 1

        # psets_found summary (list of unique prop dicts per pset name)
        for pset_name, props in psets.items():
            if pset_name not in result["psets_found"]:
                result["psets_found"][pset_name] = []
            if props not in result["psets_found"][pset_name]:
                result["psets_found"][pset_name].append(props)

        object_name = getattr(obj, "Name", None) or ""
        global_id   = getattr(obj, "GlobalId", None) or ""

        entry = {
            "class":      class_name,
            "name":       object_name,
            "globalId":   global_id,
            "location":   _extract_location(obj, model, stories_sorted),
            "dimensions": _extract_dimensions(obj),
            "materials":  _extract_material(obj),
            "psets":      psets,
        }

        detailed_objects[obj.id()] = entry

    result["psets_found"] = property_counts

    os.makedirs(RESULTS_DIR, exist_ok=True)

    model_name = os.path.splitext(os.path.basename(file_path))[0]
    json_path  = os.path.join(RESULTS_DIR, f"{model_name}.json")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(detailed_objects, f, ensure_ascii=False, indent=2, default=str)

    print(f"JSON generated at: {json_path}")
    print(f"Total objects: {result['total_objects']}")
    print(f"Classes found: {list(result['classes_found'].keys())}")
    print(f"JSON file size: {os.path.getsize(json_path)} bytes")

    return json_path, result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python ifcprocesser.py <path_to_file.ifc>")
        sys.exit(1)

    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        sys.exit(1)

    json_path, result = process_ifc2x3(file_path)
    print(f"\nJSON saved at: {json_path}")
