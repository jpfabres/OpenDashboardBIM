import json
import os
import ifcopenshell
import ifcopenshell.api

def _find_first_properties(material_entry):
    """Recursively find the first non-empty 'properties' mapping in a material entry."""
    if not isinstance(material_entry, dict):
        return None
    props = material_entry.get("properties")
    if isinstance(props, dict) and props:
        return props
    for key in ("layers", "materials"):
        nested = material_entry.get(key)
        if isinstance(nested, list):
            for item in nested:
                nested_props = _find_first_properties(item)
                if nested_props:
                    return nested_props
    return None


def _get_material_properties(v):
    materials = v.get("materials")
    if not isinstance(materials, list):
        return None
    for entry in materials:
        props = _find_first_properties(entry)
        if props:
            return props
    return None

def _check_if_IfcBeam_IfcColumn_dimension_fixable(v):
    deflect = None
    corrected_v = None
    count_para = [0,0,0]
    values = ["Length", "CrossSectionArea", "Volume"]
    for n, para in enumerate(values):
        if para in v["dimensions"]:
            count_para[n] = 1
    if count_para.count(1) <= 1:
        fixable = False
        return(fixable, None)
    elif count_para.count(1) == 2:
        fixable = True
    else:
        fixable = None
    if fixable == True:
        if count_para[0] == 0:
            v["dimensions"]["Length"] = v["dimensions"]["Volume"] / v["dimensions"]["CrossSectionArea"]
            corrected_v = v["dimensions"]["Length"]
            deflect = "Length"
        elif count_para[1] == 0:
            v["dimensions"]["CrossSectionArea"] = v["dimensions"]["Volume"] / v["dimensions"]["Length"]
            deflect = "CrossSectionArea"
            corrected_v = v["dimensions"]["CrossSectionArea"]
        elif count_para[2] == 0:
            v["dimensions"]["Volume"] = v["dimensions"]["Length"] * v["dimensions"]["CrossSectionArea"]
            deflect = "Volume"
            corrected_v = v["dimensions"]["Volume"]
    return(fixable, deflect, corrected_v)

def _calc_material_attributes(v):
    mat_v = _get_material_properties(v)
    if not mat_v:
        return (False, None, None)
    try:
        material_type = mat_v["Materials and Finishes"]["Material Type"]
        if material_type == "Steel" or material_type == "Wood":
            v["dimensions"]["Weight"] = (mat_v["Pset_MaterialCommon"]["MassDensity"] * v["dimensions"]["Volume"] * 9.81)
            corrected_v = v["dimensions"]["Weight"]
        elif material_type == "Concrete":
            v["dimensions"]["Weight"] = v["dimensions"]["Volume"]
            corrected_v = v["dimensions"]["Weight"]
        return(True, "Weight", corrected_v)
    except KeyError as ex:
        return (False, None, None)

def run_verification(input_json_path: str, input_ifc_path: str, output_dir: str) -> dict:
    """
    Reads the IFC JSON at *input_json_path*, corrects missing Length values for
    IfcBeam / IfcColumn elements, then writes:
      - <same_name>_corrected.json  (corrected data)
      - verification_log.json       (defects found)
    Both files are placed in *output_dir*.
    Returns a dict with the output filenames and defect count.
    """
    model = ifcopenshell.open(input_ifc_path)

    with open(input_json_path, "r", encoding="utf-8") as f:
        ifc_json_data = json.load(f)
    defect_dict_class = {}
    for value in ifc_json_data.values():
        dim_fixable = None
        mat_calcuable = None
        defect_list = []
        defect_value_list = []
        if value["class"] == "IfcBeam" or value["class"] == "IfcColumn":
                dim_fixable, dim_defect, corrected_value = _check_if_IfcBeam_IfcColumn_dimension_fixable(value)
                if dim_defect is not None:
                    defect_list.append(dim_defect)
                    defect_value_list.append(corrected_value)
                mat_calcuable, mat_defect, corrected_value = _calc_material_attributes(value)
                if mat_defect is not None:
                    defect_list.append(mat_defect)
                    defect_value_list.append(corrected_value)
        if defect_list:
            element = model.by_guid(value["globalId"])
            for property, property_value in zip(defect_list, defect_value_list):
                qto = None
                for rel in element.IsDefinedBy:
                    if rel.is_a("IfcRelDefinesByProperties"):
                        prop_def = rel.RelatingPropertyDefinition
                        if prop_def.is_a("IfcElementQuantity") and prop_def.Name == "Qto_BeamBaseQuantities":
                            qto = prop_def
                            break
                    if not qto:
                        qto = ifcopenshell.api.run("pset.add_qto", model, product=element, name="Qto_BeamBaseQuantities")
                if property == "Length":
                        ifcopenshell.api.run("pset.edit_qto", model, qto=qto, properties={
                            "Length": property_value
                        })
                elif property == "Weight":
                        ifcopenshell.api.run("pset.edit_qto", model, qto=qto, properties={
                            "Weight": property_value
                        })

        cls = value["class"]
        gid = value["globalId"]
        defect_dict_class.setdefault(cls, []).append({gid: {"Dimension Fixable": dim_fixable, "Material Calcuable": mat_calcuable, "Attributes":defect_list}})
            
    basename = os.path.basename(input_json_path)
    name_stem = os.path.splitext(basename)[0]
    corrected_ifc_filename = f"{name_stem}_corrected.ifc"
    corrected_ifc_path = os.path.join(output_dir, corrected_ifc_filename)
    model.write(corrected_ifc_path)
    corrected_json_filename = f"{name_stem}_corrected.json"
    corrected_path = os.path.join(output_dir, corrected_json_filename)
    log_filename = f"{name_stem}_verification_log.json"
    log_path = os.path.join(output_dir, log_filename)

    with open(corrected_path, "w", encoding="utf-8") as f:
        json.dump(ifc_json_data, f, indent=4)

    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(defect_dict_class, f, indent=4)
    

    defects_found = sum(len(v) for v in defect_dict_class.values())
    return {
        "corrected_ifc_file": corrected_ifc_path,
        "corrected_json_file": corrected_json_filename,
        "log_file": log_filename,
        "defects_found": defects_found,
    }