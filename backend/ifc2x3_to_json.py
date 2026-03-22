import ifcopenshell
import json
import os

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "uploads")

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
    object_properties = {}

    for obj in model.by_type("IfcProduct"):
        class_name = obj.is_a()

        if obj.id() in processed_objects:
            continue
        processed_objects.add(obj.id())

        result["total_objects"] += 1
        result["classes_found"].setdefault(class_name, 0)
        result["classes_found"][class_name] += 1

        psets = {}
        object_properties[obj.id()] = set()

        if hasattr(obj, "HasPropertySets") and obj.HasPropertySets:
            for pset in obj.HasPropertySets:
                if pset.is_a("IfcPropertySet"):
                    pset_props = {}
                    if hasattr(pset, "HasProperties") and pset.HasProperties:
                        for prop in pset.HasProperties:
                            value = None
                            if hasattr(prop, "NominalValue") and prop.NominalValue:
                                if hasattr(prop.NominalValue, "wrappedValue"):
                                    value = prop.NominalValue.wrappedValue
                                else:
                                    try:
                                        value = str(prop.NominalValue)
                                    except:
                                        value = None
                            pset_props[prop.Name] = value
                            object_properties[obj.id()].add(prop.Name)
                    psets[pset.Name] = pset_props

        if hasattr(obj, "IsDefinedBy"):
            for rel in obj.IsDefinedBy:
                if rel.is_a("IfcRelDefinesByType"):
                    if hasattr(rel, "RelatingType") and rel.RelatingType:
                        type_obj = rel.RelatingType
                        if hasattr(type_obj, "HasPropertySets") and type_obj.HasPropertySets:
                            for pset in type_obj.HasPropertySets:
                                if pset.is_a("IfcPropertySet"):
                                    pset_props = {}
                                    if hasattr(pset, "HasProperties") and pset.HasProperties:
                                        for prop in pset.HasProperties:
                                            value = None
                                            if hasattr(prop, "NominalValue") and prop.NominalValue:
                                                if hasattr(prop.NominalValue, "wrappedValue"):
                                                    value = prop.NominalValue.wrappedValue
                                                else:
                                                    try:
                                                        value = str(prop.NominalValue)
                                                    except:
                                                        value = None
                                            pset_props[prop.Name] = value
                                            object_properties[obj.id()].add(prop.Name)
                                    psets[pset.Name] = pset_props

                if rel.is_a("IfcRelDefinesByProperties"):
                    if hasattr(rel, "RelatingPropertyDefinition") and rel.RelatingPropertyDefinition:
                        prop_def = rel.RelatingPropertyDefinition
                        if prop_def.is_a("IfcPropertySet"):
                            pset_props = {}
                            if hasattr(prop_def, "HasProperties") and prop_def.HasProperties:
                                for prop in prop_def.HasProperties:
                                    value = None
                                    if hasattr(prop, "NominalValue") and prop.NominalValue:
                                        if hasattr(prop.NominalValue, "wrappedValue"):
                                            value = prop.NominalValue.wrappedValue
                                        else:
                                            try:
                                                value = str(prop.NominalValue)
                                            except:
                                                value = None
                                    pset_props[prop.Name] = value
                                    object_properties[obj.id()].add(prop.Name)
                            psets[prop_def.Name] = pset_props
                        elif prop_def.is_a("IfcElementQuantity"):
                            quantity_props = {}
                            if hasattr(prop_def, "Quantities") and prop_def.Quantities:
                                for quantity in prop_def.Quantities:
                                    value = None
                                    if quantity.is_a("IfcQuantityLength") and hasattr(quantity, "LengthValue"):
                                        value = quantity.LengthValue
                                    elif quantity.is_a("IfcQuantityArea") and hasattr(quantity, "AreaValue"):
                                        value = quantity.AreaValue
                                    elif quantity.is_a("IfcQuantityVolume") and hasattr(quantity, "VolumeValue"):
                                        value = quantity.VolumeValue
                                    elif quantity.is_a("IfcQuantityCount") and hasattr(quantity, "CountValue"):
                                        value = quantity.CountValue
                                    elif quantity.is_a("IfcQuantityWeight") and hasattr(quantity, "WeightValue"):
                                        value = quantity.WeightValue
                                    elif quantity.is_a("IfcQuantityTime") and hasattr(quantity, "TimeValue"):
                                        value = quantity.TimeValue
                                    quantity_props[quantity.Name] = value
                                    object_properties[obj.id()].add(quantity.Name)
                            psets[prop_def.Name] = quantity_props

        for pset_name, props in psets.items():
            if pset_name not in result["psets_found"]:
                result["psets_found"][pset_name] = []
            if props not in result["psets_found"][pset_name]:
                result["psets_found"][pset_name].append(props)

        object_name = ""
        global_id = ""

        if hasattr(obj, "Name") and obj.Name:
            object_name = obj.Name
        if hasattr(obj, "GlobalId") and obj.GlobalId:
            global_id = obj.GlobalId

        detailed_objects[obj.id()] = {
            "class": class_name,
            "name": object_name,
            "globalId": global_id,
            "psets": psets
        }

    for obj_id, props in object_properties.items():
        for prop_name in props:
            property_counts.setdefault(prop_name, 0)
            property_counts[prop_name] += 1

    result["psets_found"] = property_counts

    os.makedirs(UPLOAD_DIR, exist_ok=True)

    model_name = os.path.splitext(os.path.basename(file_path))[0]
    json_path = os.path.join(UPLOAD_DIR, f"{model_name}_ifc2x3.json")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(detailed_objects, f, ensure_ascii=False, indent=2)

    print(f"JSON generated at: {json_path}")
    print(f"Total objects: {result['total_objects']}")
    print(f"Classes found: {list(result['classes_found'].keys())}")

    return json_path, result


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python ifc2x3_to_json.py <path_to_file.ifc>")
        sys.exit(1)

    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        sys.exit(1)

    json_path, result = process_ifc2x3(file_path)
    print(f"\nJSON saved at: {json_path}")
