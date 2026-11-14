"""
Открытые наборы с Roboflow Universe, отобранные под классы ТЗ.

Каждый источник: проект, версия, лимит изображений и правила перевода его
классов в наши (регулярное выражение по имени класса -> наш класс или None).
Классы, которые не подошли ни под одно правило, выбрасываются из разметки.
Изображения без единой нашей рамки не берутся. Дополнительно:
repeat=N дублирует изображения редких классов в train N раз (балансировка),
negatives=N берёт до N изображений, где все рамки явно помечены «не дефект»
(clean, Normal, затянутый болт): они учат модель не срабатывать на чистом металле.

Сведения о проектах (число изображений, лицензия, классы) проверены через
Roboflow API 13.11.2026. Все наборы под CC BY 4.0 или MIT: при показе
результатов нужно указать авторов, список собирается в ATTRIBUTION.md.
"""

# Порядок задаёт номера классов в модели. Только классы, под которые есть данные.
CLASSES = [
    "surface_corrosion",
    "pipe_leak_pitting",
    "pipe_crack",
    "shaft_seal_leak",
    "stem_packing_leak",
    "seal_overheat",
    "salt_deposits",
    "frame_corrosion_loose_bolts",
    "cable_insulation_damage",
]

SOURCES = [
    # --- коррозия -------------------------------------------------------
    dict(project="mavromati/rust-corrosion-detection-rd8mo", version=2, cap=1800,
         rules=[(r"corrosion", "surface_corrosion")]),
    dict(project="icdt-xht79/corrosion-v1cb1", version=1, cap=1200, negatives=400,
         rules=[(r"^(0|clean|non-corrosion)$", None),
                (r"corro|rust", "surface_corrosion")]),
    dict(project="psm-lzkq8/corrosion-rsbnq", version=1, cap=600,
         rules=[(r"corrosion", "surface_corrosion")]),
    dict(project="001-wu5b8/infrastructure-corrosion", version=10, cap=500,
         rules=[(r"^no corrosion$", None), (r"severe|modest|protection failure", "surface_corrosion")]),
    dict(project="sae-nxyhx/pipe-segmentation-rust", version=1, cap=500,
         rules=[(r"deterioration", "surface_corrosion")]),
    dict(project="pipe-corrosion-detection/pipe-corrosion-detection-aern8", version=2, cap=200,
         rules=[(r"pitting|general|cui", "surface_corrosion")]),
    dict(project="myinspectionai/pipe-rust-inspection", version=3, cap=200,
         rules=[(r"coating_breakdown|blister|scale", "surface_corrosion")]),
    # --- течи и дефекты труб ------------------------------------------------
    dict(project="roboflow1-rz9go/pipe-leak-sptsu", version=1, cap=1300,
         rules=[(r"leak", "pipe_leak_pitting")]),
    dict(project="hk-hsse/kebocoran-1", version=2, cap=900,
         rules=[(r"leak", "pipe_leak_pitting")]),
    dict(project="projects-gzqta/leak-k2xv1", version=2, cap=800,
         rules=[(r"^leak$", "pipe_leak_pitting"), (r"^crack$", "pipe_crack")]),
    dict(project="krum-dala/pipe-defects-ybzjr", version=5, cap=200,
         rules=[(r"hole|rupture", "pipe_leak_pitting"), (r"crack", "pipe_crack"),
                (r"rust|corrosion", "surface_corrosion")]),
    dict(project="amsyar-mnuwm/pipe-crack-detection-u5qeo", version=8, cap=1100, negatives=200,
         rules=[(r"^normal$", None), (r"^crack$", "pipe_crack")]),
    dict(project="abzs-workspace/pipe-crack-final", version=1, cap=600,
         rules=[(r"^crack$", "pipe_crack")]),
    dict(project="gazxard/pipe-crack-detection", version=1, cap=400,
         rules=[(r"pipe crack", "pipe_crack")]),
    dict(project="work-rwmly/welding-defect-final0-bdnbe", version=1, cap=400,
         rules=[(r"^crack$", "pipe_crack")]),
    # --- течи масла (у вала) и арматуры ---------------------------------
    dict(project="chiranjeevi-p2jmx/oil-leak-detection-axcq4", version=1, cap=400, repeat=2,
         rules=[(r"oil", "shaft_seal_leak")]),
    dict(project="custom-yolov5-1lqs1/oil-leak-discovery", version=1, cap=200, repeat=2,
         rules=[(r"oil", "shaft_seal_leak")]),
    dict(project="gui-9ur92/oil-leaks-detection", version=1, cap=100, repeat=2,
         rules=[(r"oil", "shaft_seal_leak")]),
    dict(project="hamza-bashir-nzrcf/oil-and-coolant-leak-drzbm", version=1, cap=150, repeat=2,
         rules=[(r"leak", "shaft_seal_leak")]),
    dict(project="valve-leak-trials/leak-valve-detection", version=5, cap=150, repeat=5,
         rules=[(r"^no leak$", None), (r"leak", "stem_packing_leak")]),
    # --- дым и пар --------------------------------------------------------
    dict(project="what-gddlr/smoke-detection-dpyjo", version=5, cap=350, repeat=2,
         rules=[(r"smoke|steam", "seal_overheat")]),
    dict(project="yiz/steam-yolov8", version=1, cap=200, repeat=2,
         rules=[(r"steam", "seal_overheat")]),
    # --- солевые отложения --------------------------------------------------
    dict(project="efflorescence-p9mrh/efflorescence-zgjh7", version=1, cap=300, repeat=3,
         rules=[(r"efflor", "salt_deposits")]),
    dict(project="project-zvxig/efflorence", version=2, cap=100, repeat=3,
         rules=[(r"efflor", "salt_deposits")]),
    # --- крепёж ---------------------------------------------------------------
    dict(project="steel-defects-sdxqu/steel-loose-bolt", version=2, cap=700, negatives=200,
         rules=[(r"_tight$", None), (r"loose|no_nut|no_bolt", "frame_corrosion_loose_bolts")]),
    dict(project="meee-aegk9/nut-and-bolt-corrosion", version=1, cap=300, negatives=100,
         rules=[(r"non", None), (r"^corroded", "frame_corrosion_loose_bolts")]),
    # --- кабели ---------------------------------------------------------------
    dict(project="meine-arbeit/damage-wires", version=1, cap=430, repeat=2,
         rules=[(r"damage", "cable_insulation_damage")]),
    dict(project="ankit-0ksck/wire-knawi", version=2, cap=600,
         rules=[(r"damage", "cable_insulation_damage")]),
]

# Чего нет в открытых данных (остаётся мультимодальной модели):
NOT_COVERED = [
    "flange_corrosion", "cooling_fins_damage", "overheat_discoloration", "grounding_missing",
    "handwheel_damage", "indicator_mismatch", "casing_crack", "terminal_overheat",
    "insulation_damage",
]
