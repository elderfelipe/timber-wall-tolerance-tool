"""
material_estimate.py
---------------------
Material waste and cost estimate from Step B's already-computed panel
layout. Additive - takes panel_result as input, doesn't touch panel.py's
own calculation at all.

Modeling assumptions (continuing the lettered scope-note convention):

  E1. ONE RAW SHEET PER CUT PANEL PIECE, no nesting/optimization across
      multiple panels. A real fabricator can sometimes nest two narrow
      offcuts from different panels onto one raw sheet to cut waste
      further - that optimization is NOT modeled here. This is a
      deliberately conservative (upper-bound-on-waste) simplification,
      not a claim of optimal cutting layout.
  E2. Each cut panel piece must fit within ONE raw sheet in both
      dimensions (actual_width_cm <= raw_sheet_width_cm AND
      wall_height_cm <= raw_sheet_length_cm). If a piece doesn't fit,
      that's flagged as an error rather than silently guessing a
      multi-sheet splice.
  E3. Waste = total raw sheet area purchased minus total cut-piece area
      actually used - the offcut fraction, not a claim about resale
      value of the offcuts.
"""


def estimate_material(panel_result, config):
    """
    config: {
      "raw_sheet_width_cm": float,
      "raw_sheet_length_cm": float,
      "price_per_sheet": float,
    }
    """
    raw_w = float(config.get("raw_sheet_width_cm", 122))
    raw_l = float(config.get("raw_sheet_length_cm", 250))
    price = float(config.get("price_per_sheet", 0))

    panels = panel_result["panels"]
    if not panels:
        return {"error": "No panels to estimate - build the panel layout first."}

    wall_height_cm = None
    # wall height isn't stored on the panel dict itself; recovered from the
    # bay geometry via the caller (main.js passes it through explicitly)
    wall_height_cm = float(config.get("wall_height_cm"))

    oversized = [p for p in panels if p["actual_width_cm"] > raw_w or wall_height_cm > raw_l]
    if oversized:
        return {"error": (
            f"{len(oversized)} panel(s) don't fit within a single "
            f"{raw_w:.0f}x{raw_l:.0f}cm raw sheet (E2) - increase the raw "
            f"sheet size or reduce the target sheet width / wall height."
        )}

    sheets_needed = len(panels)  # E1: one raw sheet per cut piece
    raw_area_m2 = sheets_needed * (raw_w * raw_l) / 10000.0
    used_area_m2 = sum(p["actual_width_cm"] * wall_height_cm for p in panels) / 10000.0
    waste_area_m2 = raw_area_m2 - used_area_m2
    waste_percent = round(100 * waste_area_m2 / raw_area_m2, 1) if raw_area_m2 else None
    total_cost = round(sheets_needed * price, 2)

    return {
        "config": {"raw_sheet_width_cm": raw_w, "raw_sheet_length_cm": raw_l, "price_per_sheet": price},
        "sheets_needed": sheets_needed,
        "raw_area_m2": round(raw_area_m2, 3),
        "used_area_m2": round(used_area_m2, 3),
        "waste_area_m2": round(waste_area_m2, 3),
        "waste_percent": waste_percent,
        "total_cost": total_cost,
        "cost_per_m2_used": round(total_cost / used_area_m2, 2) if used_area_m2 else None,
        "scope_note": (
            "Assumes one raw sheet per cut panel piece (E1) - no nesting/optimization "
            "across panels, so this is a conservative upper bound on waste, not an "
            "optimal cutting layout."
        ),
    }
