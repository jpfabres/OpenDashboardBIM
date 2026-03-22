import json

# Generate a new Json file from the original IFC JSON file with corrected information
# Record differences between the original and new Json files for verification log

ifc_json_path = "C:\\Users\\kachun.cho\\OneDrive - Arup\\Desktop\\porto-hack\\tmp_47a1cfe_bSH_OD_STR_01.json"
with open(ifc_json_path, 'r', encoding='utf-8') as file:
    ifc_json_data = json.load(file)

defect_dict_class = {}

def calculate_length_from_volume_and_cross_section_area(volume, cross_section_area):
    #Rectify the missing Length information by calculating it from Volume and CrossSectionArea
    if cross_section_area != 0:
        return volume / cross_section_area
    else:
        return None  # Handle the case where cross-section area is zero to avoid division by zero

for key, value in ifc_json_data.items():
    defect_globalId = 0
    defect_list = []
    if value['class'] == 'IfcBeam':
        if 'Length' not in value['dimensions']:
            # Record the missing information in the verification log
            defect_list.append('Length')
            value['dimensions']["Length"] = calculate_length_from_volume_and_cross_section_area(value['dimensions']['Volume'], value['dimensions']['CrossSectionArea'])
    elif value['class'] == 'IfcColumn':
        if 'Length' not in value['dimensions']:
            # Record the missing information in the verification log
            defect_list.append('Length')
            value['dimensions']["Length"] = calculate_length_from_volume_and_cross_section_area(value['dimensions']['Volume'], value['dimensions']['CrossSectionArea'])
    if len(defect_list) > 0:
        defect_globalId = value['globalId']
        print(value['class'] in defect_dict_class)
        if value['class'] not in defect_dict_class:
            defect_dict_class[value['class']] = [{defect_globalId: defect_list}]
        else:
            print(defect_dict_class[value['class']])
            defect_dict_class[value['class']].append({defect_globalId: defect_list})

# Export the new Json file with corrected information
def export_json_file(new_ifc_json_data, new_ifc_json_path):
    with open(new_ifc_json_path, 'w', encoding='utf-8') as file:
        json.dump(new_ifc_json_data, file, indent=4)

export_json_file(ifc_json_data, "C:\\Users\\kachun.cho\\OneDrive - Arup\\Desktop\\porto-hack\\tmp_47a1cfe_bSH_OD_STR_01_corrected.json")
export_json_file(defect_dict_class, "C:\\Users\\kachun.cho\\OneDrive - Arup\\Desktop\\porto-hack\\verification_log.json")