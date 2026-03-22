import json
import os


def _calc_length(volume, cross_section_area):
    if cross_section_area != 0:
        return volume / cross_section_area
    return None


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
        if value["class"] in ("IfcBeam", "IfcColumn"):
            if "Length" not in value["dimensions"]:
                defect_list.append("Length")
                value["dimensions"]["Length"] = _calc_length(
                    value["dimensions"]["Volume"],
                    value["dimensions"]["CrossSectionArea"],
                )
        if defect_list:
            cls = value["class"]
            gid = value["globalId"]
            defect_dict_class.setdefault(cls, []).append({gid: defect_list})

    basename = os.path.basename(input_json_path)
    name_stem = os.path.splitext(basename)[0]
    corrected_filename = f"{name_stem}_corrected.json"
    corrected_path = os.path.join(output_dir, corrected_filename)
    log_path = os.path.join(output_dir, "verification_log.json")

    with open(corrected_path, "w", encoding="utf-8") as f:
        json.dump(ifc_json_data, f, indent=4)

    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(defect_dict_class, f, indent=4)

    defects_found = sum(len(v) for v in defect_dict_class.values())
    return {
        "corrected_file": corrected_filename,
        "log_file": "verification_log.json",
        "defects_found": defects_found,
    }
