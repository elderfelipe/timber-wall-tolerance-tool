"""
provenance.py
-------------
Scans the actual live data (materials.json, din18202.json) for every
'verified' flag and reports real counts - not a static claim. Also holds
a reference list of every standard the app draws from, with edition,
scope, and where it's used - built up from the documents actually
uploaded and read over the course of this project (see each entry's
'source_confirmed' field for whether the underlying standard document
itself was read directly, vs. inherited from an earlier compiled table).
"""


def _walk(obj, path, results):
    """Recursively find every dict that has a 'verified' key, recording
    its path, the flag, and any 'note' explaining why."""
    if isinstance(obj, dict):
        if "verified" in obj and isinstance(obj["verified"], bool):
            results.append({
                "path": ".".join(path),
                "verified": obj["verified"],
                "note": obj.get("note"),
            })
        for k, v in obj.items():
            _walk(v, path + [str(k)], results)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _walk(v, path + [f"[{i}]"], results)


def compute_verification_stats(materials, din18202):
    results = []
    _walk(materials, ["materials"], results)
    _walk(din18202, ["din18202"], results)

    total = len(results)
    verified = sum(1 for r in results if r["verified"])
    unverified_items = [r for r in results if not r["verified"]]

    return {
        "total_flagged_fields": total,
        "verified_count": verified,
        "unverified_count": total - verified,
        "verified_percent": round(100 * verified / total, 1) if total else None,
        "unverified_items": sorted(unverified_items, key=lambda r: r["path"]),
    }


# Standards reference list. 'source_confirmed' = True means the actual
# standard document was uploaded and read directly at some point in this
# project (not just inherited from the original compiled Excel/PDF).
STANDARDS = [
    {"ref": "EN 336:2013", "title": "Structural timber - Sizes, permitted deviations",
     "scope": "Dimensional tolerances for sawn structural timber (KVH), both tolerance classes 1 and 2, both softwood and hardwood.",
     "used_in": "Step A - KVH cross-section tolerance", "source_confirmed": True},
    {"ref": "DIN 4074-1:2026-05", "title": "Strength grading of timber - Part 1: Coniferous sawn timber",
     "scope": "Visual strength grading (softwood/S7/S10/S13) for softwood - knots, grain, and the 'DIN EN 336 applies' dimensional-accuracy deferral. Table 2 confirms Bow (8mm) and Twist (1mm/25mm height) are IDENTICAL across S7/S10/S13 for Kantholz (squared timber) - not graduated by grade - and that no separate crook criterion exists for this product category.",
     "used_in": "Step A - KVH warping (Bow/Twist), softwood/S7/S10/S13 grades", "source_confirmed": True},
    {"ref": "DIN 4074-5:2026-05", "title": "Strength grading of timber - Part 5: Hardwood sawn timber",
     "scope": "Hardwood grading (LS7/LS10/LS13) - referenced here only to correctly distinguish its 'LS' prefix from DIN 4074-1's own S7/S10/S13. Not currently implemented as a selectable grade anywhere in this app: an earlier revision's 'Hardwood LS7/LS10/LS13' dropdown option was actually mislabeled DIN 4074-1 data (values pulled from its Table 3, a different product category), not genuine DIN 4074-5 data - corrected by renaming those grades to S7/S10/S13 rather than by adding real hardwood data this app has not verified.",
     "used_in": "Not currently used - referenced for terminology only", "source_confirmed": False},
    {"ref": "DIN EN 14080:2013-09", "title": "Timber structures - Glued laminated timber and glued solid timber",
     "scope": "Length/width/thickness/depth tolerance and angle-of-cross-section for Glulam/GLT.",
     "used_in": "Step A - Glulam framing material", "source_confirmed": True},
    {"ref": "EN 14374:2005", "title": "Timber structures - Laminated veneer lumber (LVL)",
     "scope": "Length, width, the asymmetric thickness formula, and angle-of-cross-section for LVL (e.g. Kerto).",
     "used_in": "Step A - LVL framing material", "source_confirmed": True},
    {"ref": "EN 15497:2014", "title": "Finger jointed structural timber",
     "scope": "SS5.8 confirms width/thickness defer entirely to EN 336, same as KVH; no separate warping data is defined.",
     "used_in": "Step A - Finger-jointed reference (not yet a selectable material)", "source_confirmed": True},
    {"ref": "DIN 18203-3:2008-08", "title": "Tolerances in building - Part 3: Components of timber and wood-based panel products",
     "scope": "Assembly-level tolerance for beams/trusses/columns and wall/floor/roof panels (Tables 1-2), plus flatness (SS4.5: longitudinal bow and transverse bow/cup - no separate crook criterion exists).",
     "used_in": "Step A chart reference; Glulam section warping data", "source_confirmed": True},
    {"ref": "EN 300:2006", "title": "Oriented Strand Boards (OSB) - Definitions, classification and specifications",
     "scope": "Length/width/thickness tolerance, edge straightness, squareness, and moisture content for OSB.",
     "used_in": "Steps B/C - OSB panel material", "source_confirmed": True},
    {"ref": "DIN EN 315:2000", "title": "Plywood - Tolerances for dimensions",
     "scope": "Length/width (flat) and a detailed thickness table (within-panel and on-nominal, sanded/unsanded) for plywood.",
     "used_in": "Steps B/C - Plywood panel material", "source_confirmed": True},
    {"ref": "EN 312:2010", "title": "Particleboards - Specifications",
     "scope": "Length/width/thickness tolerance, edge straightness, squareness, and moisture content for particleboard.",
     "used_in": "Steps B/C - Particleboard panel material", "source_confirmed": True},
    {"ref": "EN 16351:2021", "title": "Timber structures - Cross laminated timber (CLT)",
     "scope": "Product-level thickness formula (±2mm or 2% of nominal, whichever greater). No overall panel length/width tolerance exists in this standard - checked directly, not found.",
     "used_in": "Steps B/C - CLT panel material", "source_confirmed": True},
    {"ref": "EN 622 (parts 1-5)", "title": "Fibreboards - Specifications",
     "scope": "Part 1: shared length/width formula, squareness, edge straightness. Parts 2-5: thickness bands for Hardboard/Mediumboard/Softboard/Dry-process board.",
     "used_in": "Steps B/C - MDF-family panel material", "source_confirmed": True},
    {"ref": "DIN EN 520:2009", "title": "Gypsum plasterboards - Definitions, requirements and test methods",
     "scope": "Length/width/thickness for Gypsum Type P and Types A/H/D/E/F/I/R, plus squareness for Types A-R.",
     "used_in": "Steps B/C - Gypsum panel material", "source_confirmed": True},
    {"ref": "DIN 18202:2019-07", "title": "Tolerances in building construction - Buildings",
     "scope": "Linear, angular, flatness, and column-alignment deviations for the finished building/assembly - the standard the whole app checks the final wall against.",
     "used_in": "Steps A/B/C - squareness, joint tolerance, warping-vs-flatness, and the overall Step C verdict", "source_confirmed": True},
]
