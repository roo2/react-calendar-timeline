from __future__ import annotations

from typing import TypedDict, Literal, List


class InkSeedRow(TypedDict):
    ink_code: str
    name: str
    printer_type: Literal["inline", "uteco", "both"]


INKS: List[InkSeedRow] = [
    # --- OUT OF LINE (Uteco) ---
    {"ink_code": "EC1", "name": "ECOPAC WHITE", "printer_type": "uteco"},
    {"ink_code": "EC2", "name": "ECOPAC PROCESS YELLOW", "printer_type": "uteco"},
    {"ink_code": "EC3", "name": "ECOPAC 021 ORANGE", "printer_type": "uteco"},
    {"ink_code": "EC4", "name": "ECOPAC WARM RED", "printer_type": "uteco"},
    {"ink_code": "EC5", "name": "ECOPAC 032 RED", "printer_type": "uteco"},
    {"ink_code": "EC6", "name": "ECOPAC RUBINE RED", "printer_type": "uteco"},
    {"ink_code": "EC8", "name": "ECOPAC PANTONE PURPLE", "printer_type": "uteco"},
    {"ink_code": "EC9", "name": "ECOPAC GREEN", "printer_type": "uteco"},
    {"ink_code": "EC11", "name": "ECOPAC PROCESS BLUE", "printer_type": "uteco"},
    {"ink_code": "EC12", "name": "ECOPAC REFLEX BLUE", "printer_type": "uteco"},
    {"ink_code": "EC14", "name": "ECOPAC HI BLACK", "printer_type": "uteco"},
    {"ink_code": "EC17", "name": "ECOPAC PMS 072 BLUE", "printer_type": "uteco"},
    {"ink_code": "EC18", "name": "ECOPAC PMS 485 L/F RED", "printer_type": "uteco"},
    {"ink_code": "EC19", "name": "ECOPAC MEGENTA", "printer_type": "uteco"},
    {"ink_code": "EC20", "name": "ECOPAC L/F ORANGE 172", "printer_type": "uteco"},
    {"ink_code": "EC26", "name": "ECOPACK BAKELS MAROON", "printer_type": "uteco"},
    {"ink_code": "NP500", "name": "NITROPAC WHITE", "printer_type": "uteco"},
    {"ink_code": "EC145", "name": "ECOPAC REDUCER", "printer_type": "uteco"},
    {"ink_code": "EP2", "name": "ECOPAC RETARDER", "printer_type": "uteco"},
    {"ink_code": "EP3", "name": "ECOPAC ACCELERATOR", "printer_type": "uteco"},
    {"ink_code": "HRV01", "name": "HIGH GLOSS HEAT RESISTANT OVER PAINT VARNISH", "printer_type": "uteco"},
    {"ink_code": "NP528", "name": "L/F FIRE EXTINGUISHER RED", "printer_type": "uteco"},
    {"ink_code": "NP563", "name": "NITROPAC HR YELLOW - 107", "printer_type": "uteco"},
    {"ink_code": "PE583", "name": "L/F ORANGE - 166", "printer_type": "uteco"},
    {"ink_code": "EC21", "name": "ECO PAC LIGHT FAST - 202 MAROON", "printer_type": "uteco"},

    # Shared across lists
    {"ink_code": "PR49", "name": "ETHOXY PROPANOL", "printer_type": "both"},

    # --- IN LINE (Inline) ---
    {"ink_code": "PE244X", "name": "POLYPAC IN-LINE PROCESS BLUE", "printer_type": "inline"},
    {"ink_code": "PE257X", "name": "POLYPAC IN-LINE 032 RED", "printer_type": "inline"},
    {"ink_code": "PE260X", "name": "POLYPAC IN-LINE PROCESS YELLOW", "printer_type": "inline"},
    {"ink_code": "PE271X", "name": "POLYPAC IN-LINE REFLEX BLUE", "printer_type": "inline"},
    {"ink_code": "PE274X", "name": "POLYPAC IN-LINE PMS 348 GREEN", "printer_type": "inline"},
    {"ink_code": "PE321", "name": "POLYPAC IN-LINE GREEN", "printer_type": "inline"},
    {"ink_code": "PE582", "name": "POLYPAC IN-LINE 329 GREEN LIGHT FAST", "printer_type": "inline"},
    {"ink_code": "PE513", "name": "POLYPAC IN-LINE WHITE", "printer_type": "inline"},
    {"ink_code": "PE344", "name": "POLYPAC IN-LINE HI BLACK", "printer_type": "inline"},
    {"ink_code": "PE384", "name": "POLYPAC IN-LINE 349 GREEN", "printer_type": "inline"},
    {"ink_code": "PE485", "name": "POLYPAC IN-LINE 021 ORANGE", "printer_type": "inline"},
    {"ink_code": "PE490", "name": "POLYPAC IN-LINE PMS 376 GREEN", "printer_type": "inline"},
    {"ink_code": "PE533X", "name": "POLYPAC IN-LINE ASBESTOS RED", "printer_type": "inline"},
    {"ink_code": "PE542", "name": "POLYPAC IN-LINE PMS 151 ORANGE", "printer_type": "inline"},
    {"ink_code": "PE353", "name": "POLYPAC IN-LINE BANANA SILVER", "printer_type": "inline"},
    {"ink_code": "PE353X", "name": "POLYPAC SILVER SLOW DRY", "printer_type": "inline"},
    {"ink_code": "PE287X", "name": "POLYPAC IN-LINE 485 RED L/F", "printer_type": "inline"},
    {"ink_code": "PR144", "name": "POLYPAC IN-LINE REDUCER", "printer_type": "inline"},
    {"ink_code": "PR145", "name": "POLYPAC IN-LINE REDUCER", "printer_type": "inline"},
    {"ink_code": "PR2", "name": "POLYPAC RETARDER", "printer_type": "inline"},
    {"ink_code": "PR3", "name": "POLYPAC ACCELERATOR", "printer_type": "inline"},
    {"ink_code": "PE347", "name": "HB WHITE", "printer_type": "inline"},
]

