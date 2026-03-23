import json
import os

def _check_if_IfcBeam_IfcColumn_dimension_fixable(v):
    deflect = None
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
            deflect = "Length"
        elif count_para[1] == 0:
            v["dimensions"]["CrossSectionArea"] = v["dimensions"]["Volume"] / v["dimensions"]["Length"]
            deflect = "CrossSectionArea"
        elif count_para[2] == 0:
            v["dimensions"]["Volume"] = v["dimensions"]["Length"] * v["dimensions"]["CrossSectionArea"]
            deflect = "Volume"
    return(fixable, deflect)

def _calc_material_attributes(v):
    #print(v["materials"][0]['properties']['Materials and Finishes])
    mat_v = v["materials"][0]['properties']
    material_type = mat_v["Materials and Finishes"]["Material Type"]
    try:
        if material_type == "Steel" or material_type == "Wood":
            mat_v["Pset_MaterialCommon"]["Weight"] = (mat_v["Pset_MaterialCommon"]["MassDensity"] * v["dimensions"]["Volume"] * 9.81)
        elif material_type == "Concrete":
            mat_v["Pset_MaterialCommon"]["Weight"] = v["dimensions"]["Volume"]
        return(True, "Weight")
    except KeyError as ex:
        return (False, None)

def run_verification(input_json_path: str, output_dir: str) -> dict:
    """
    Reads the IFC JSON at *input_json_path*, corrects missing Length values for
    IfcBeam / IfcColumn elements, then writes:
      - <same_name>_corrected.json  (corrected data)
      - verification_log.json       (defects found)
    Both files are placed in *output_dir*.
    Returns a dict with the output filenames and defect count.
    """
    with open(input_json_path, "r", encoding="utf-8") as f:
        ifc_json_data = json.load(f)
    defect_dict_class = {}
    for value in ifc_json_data.values():
        defect_list = []
        if value["class"] == "IfcBeam" or value["class"] == "IfcColumn":
                dim_fixable, dim_defect = _check_if_IfcBeam_IfcColumn_dimension_fixable(value)
                if dim_defect is not None:
                    defect_list.append(dim_defect)
                mat_calcuable, mat_defect = _calc_material_attributes(value)
                if mat_defect is not None:
                    defect_list.append(mat_defect)
        
        cls = value["class"]
        gid = value["globalId"]
        defect_dict_class.setdefault(cls, []).append({gid: {"Dimension Fixable": dim_fixable, "Material Calcuable": mat_calcuable, "Attributes":defect_list}})
            
    basename = os.path.basename(input_json_path)
    name_stem = os.path.splitext(basename)[0]
    corrected_filename = f"{name_stem}_corrected.json"
    corrected_path = os.path.join(output_dir, corrected_filename)
    log_filename = f"{name_stem}_verification_log.json"
    log_path = os.path.join(output_dir, log_filename)

    with open(corrected_path, "w", encoding="utf-8") as f:
        json.dump(ifc_json_data, f, indent=4)

    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(defect_dict_class, f, indent=4)
    # Keep a canonical filename for consumers that read a fixed path.
    canonical_log_path = os.path.join(output_dir, "verification_log.json")
    with open(canonical_log_path, "w", encoding="utf-8") as f:
        json.dump(defect_dict_class, f, indent=4)

    defects_found = sum(len(v) for v in defect_dict_class.values())
    return {
        "corrected_file": corrected_filename,
        "log_file": log_filename,
        "defects_found": defects_found,
    }