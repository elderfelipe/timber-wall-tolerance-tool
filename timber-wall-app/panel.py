"""
panel.py
--------
Step B: sheeting panels installed on the Step A frame.

Modeling assumptions (same style as geometry.py's A1-A8, continuing the
numbering as B1, B2... since this builds directly on Step A's frame):

  B1. PANEL JOINTS LAND ON STUD CENTERLINES. This is standard construction
      practice (panels are fastened to studs, so a joint needs a stud to
      land on). Rather than tiling panels at a fixed width independent of
      the frame, this module computes how many stud bays each panel
      should span to best match the user's target sheet width, then sets
      the panel's ACTUAL width to the real distance between those two
      stud centerlines (taken from Step A's already-computed stud
      positions). Panel widths you see are therefore real stud-spacing
      distances, not the raw nominal sheet size - by construction, joints
      always land exactly on a stud.
  B2. SINGLE ROW ONLY (full wall height per sheet) in this version.
      Multi-row stacking requires horizontal blocking between studs to
      support the horizontal joint, which Step A's frame model does not
      include (studs + top/bottom beams only, no intermediate horizontal
      members). Rather than silently assume blocking exists, multi-row
      layouts are not offered - if the target sheet height is less than
      the wall height, this is flagged as a limitation, not solved.
  B3. ALL SIX sheeting materials from the source tables are supported:
      OSB, Plywood, Particleboard, CLT (flat 'fixed' tolerances), plus
      MDF-family (4 board sub-types: Hardboard/Mediumboard/Softboard/
      Dry-process, sharing one rate-based ±2mm/m-capped length/width
      formula but each with their own thickness bands) and Gypsum
      (2 board-type families: Type P vs. Types A/H/D/E/F/I/R, each with
      their own fixed values - Types A-R has no published thickness
      tolerance at all, surfaced as an honest "unavailable" rather than
      guessed). MDF-family and Gypsum need a subtype selection (mirroring
      KVH's strength-grade selector in Step A) since their tolerances
      aren't indexed the same way as the other four materials.
  B4. JOINT INTERFACE TOLERANCE combines the panel's own width tolerance
      with the frame's stud positional tolerance (reusing Step A's
      datum-referenced DIN 18202 alignment-deviation figure) via both
      worst-case and RSS. This is compared against HALF the stud's width
      as a purely geometric margin check: can the joint's worst-case
      position uncertainty still land within the stud face at all? This
      is NOT a fastener-edge-distance requirement from any standard
      (no such figure was found in the source documents) - it is a
      minimal "does the joint physically land on the stud" sanity check,
      and is reported as such.
"""
import math
from geometry import (
    lookup_din18202_alignment, compute_stud_positions, lookup_rate_capped,
)


def get_material_label(materials, material_key, subtype=None):
    """Human-readable label + standard for any supported sheeting material,
    including the two families that need a subtype (mdf_family, gfb_gpb)."""
    m = materials["sheeting"][material_key]
    if material_key == "mdf_family":
        board = m["boards"][subtype]
        return f"{board['label']} ({board['standard_part']})"
    if material_key == "gfb_gpb":
        sub = m[subtype]
        return f"{sub['label']} ({m['standard']})"
    return f"{m['label']} ({m['standard']})"


def get_sheeting_dimension_tolerance(materials, material_key, dimension, target_size_m=None, subtype=None):
    """Returns (plus_mm, minus_mm, verified, note) for a sheeting panel's
    'length' or 'width'.
    - CLT stores these under a 'product' sub-key.
    - MDF-family shares one RATE-based formula (±2mm/m, capped) across all
      four board types, so it needs target_size_m (the panel's own actual
      length/width in meters) rather than a flat value.
    - Gypsum (gfb_gpb) is split into two board-type families (Type P vs.
      Types A/H/D/E/F/I/R), each with their own fixed values - needs a
      subtype, and Types A-R has no thickness value at all (handled by
      the caller via the returned None + note).
    - All other supported materials store fixed values directly under
      'dimensions'.
    """
    m = materials["sheeting"][material_key]

    if material_key == "mdf_family":
        rc = m.get("length_width_rate_capped")
        if rc is None:
            return None, None, False, "no length/width rate spec for mdf_family"
        if target_size_m is None:
            return None, None, False, "target size (m) required for mdf_family's rate-based length/width"
        val = round(min(target_size_m * rc["rate_mm_per_m"], rc["cap_mm"]), 3)
        return val, val, rc.get("verified", False), None

    if material_key == "gfb_gpb":
        if subtype not in ("type_p", "types_ahdefir"):
            return None, None, False, "gfb_gpb requires a subtype ('type_p' or 'types_ahdefir')"
        spec = m.get(subtype, {}).get(dimension)
    elif material_key == "clt":
        spec = m.get("product", {}).get(dimension)
    else:
        spec = m.get("dimensions", {}).get(dimension)

    if spec is None or spec.get("type") == "unknown":
        return None, None, False, (spec.get("note") if spec else f"no {dimension} data")
    if spec["type"] == "fixed":
        return spec["plus"], spec["minus"], spec.get("verified", False), spec.get("note")
    return None, None, False, f"unsupported spec type for panel {dimension} ('{spec.get('type')}')"


def build_panels(config, materials, din, frame_result):
    """
    config: {
      "panel_material": "osb"|"plywood"|"particleboard"|"clt"|"mdf_family"|"gfb_gpb",
      "panel_subtype": null | "hardboard"|"mediumboard"|"softboard"|"dry_process" (mdf_family)
                             | "type_p"|"types_ahdefir" (gfb_gpb),
      "target_sheet_width_cm": float,
    }
    frame_result: the dict returned by geometry.build_frame() for the same
    wall - reused so panel joints align to the SAME stud positions already
    computed and rendered in Step A, not a freshly recomputed frame.
    """
    warnings = []
    material = config["panel_material"]
    subtype = config.get("panel_subtype")
    target_width_cm = float(config["target_sheet_width_cm"])

    geo = frame_result["geometry"]
    wall_length_cm = geo["wall_length_cm"]
    wall_height_cm = geo["wall_height_cm"]
    stud_positions = [s["x_cm"] for s in geo["studs"]]  # centerlines, already sorted
    n_studs = len(stud_positions)

    # --- B2: single-row scope check -------------------------------------
    # No sheet-height input in this version; sheets are assumed full wall
    # height. We only warn if that assumption is likely to be physically
    # unrealistic (arbitrary threshold noted as such, not a standard).
    if wall_height_cm > 300:
        warnings.append(
            f"Wall height ({wall_height_cm/100:.2f}m) exceeds common full-sheet panel "
            f"heights (~3.0m or less depending on product). This tool assumes single-row, "
            f"full-height sheets (B2) - for taller walls, real construction would need "
            f"horizontal joints on blocking not modeled here. Treat this layout as "
            f"illustrative, not a construction-ready sheet count for this wall height."
        )

    # --- B1: compute panel-to-stud-aligned column boundaries ------------
    if n_studs < 2:
        return {"error": "Frame needs at least 2 studs to place panel joints."}

    bay_spacing_cm = stud_positions[1] - stud_positions[0]  # real spacing between adjacent stud centerlines (Step A's compute_stud_positions accounts for stud half-width at the wall ends, so this is NOT simply wall_length_cm/(n_studs-1))
    bays_per_panel = max(1, round(target_width_cm / bay_spacing_cm))
    panels = []
    start_idx = 0
    while start_idx < n_studs - 1:
        end_idx = min(start_idx + bays_per_panel, n_studs - 1)
        x0 = stud_positions[start_idx]
        x1 = stud_positions[end_idx]
        panels.append({
            "start_stud_index": start_idx,
            "end_stud_index": end_idx,
            "x0_cm": x0,
            "x1_cm": x1,
            "actual_width_cm": x1 - x0,
        })
        start_idx = end_idx

    # --- material tolerance lookup ---------------------------------------
    width_plus_mm, width_minus_mm, verified, note = get_sheeting_dimension_tolerance(
        materials, material, "width", target_size_m=target_width_cm / 100.0, subtype=subtype)
    if width_plus_mm is None:
        warnings.append(f"Panel width tolerance unavailable for '{material}'{f'/{subtype}' if subtype else ''}: {note}")
    elif not verified:
        warnings.append(f"Panel width tolerance for '{material}'{f'/{subtype}' if subtype else ''} is unverified: {note}")

    # --- B4: joint interface tolerance (per joint, i.e. per interior stud)
    datum_align_mm = lookup_din18202_alignment(din, wall_height_cm / 100.0)
    stud_width_mm = frame_result["config"]["stud_width_mm"]

    joint_wc = None if width_plus_mm is None else (width_plus_mm + datum_align_mm)
    joint_rss = None if width_plus_mm is None else math.sqrt(width_plus_mm ** 2 + datum_align_mm ** 2)
    half_stud_mm = stud_width_mm / 2.0

    joint_check = {
        "panel_width_tolerance_mm": width_plus_mm,
        "stud_positional_tolerance_mm": datum_align_mm,
        "combined_worst_case_mm": joint_wc,
        "combined_rss_mm": joint_rss,
        "half_stud_width_mm": half_stud_mm,
        "pass_worst_case": (joint_wc <= half_stud_mm) if joint_wc is not None else None,
        "pass_rss": (joint_rss <= half_stud_mm) if joint_rss is not None else None,
        "note": (
            "Combines the panel's own width tolerance with the frame's stud "
            "positional tolerance (same DIN 18202 alignment-deviation figure "
            "used in Step A's Chart 3), then checks whether that combined "
            "uncertainty could still exceed half the stud's width - i.e. "
            "whether the joint could miss the stud face entirely in the "
            "worst case. This is a geometric sanity check only, not a "
            "fastener-edge-distance requirement from any source standard - "
            "none was found for that specific figure."
        ),
    }

    # --- chart: joint margin vs number of panels (sheet width sensitivity)
    chart_widths_cm = [w for w in range(30, 301, 10)]
    chart_bays = []
    chart_panel_count = []
    for w in chart_widths_cm:
        bpp = max(1, round(w / bay_spacing_cm))
        count = math.ceil((n_studs - 1) / bpp)
        chart_bays.append(bpp)
        chart_panel_count.append(count)

    return {
        "config": {"panel_material": material, "panel_subtype": subtype, "target_sheet_width_cm": target_width_cm},
        "panels": panels,
        "bay_spacing_cm": round(bay_spacing_cm, 3),
        "bays_per_panel": bays_per_panel,
        "material_source": get_material_label(materials, material, subtype),
        "joint_check": joint_check,
        "chart_sheet_width_sensitivity": {
            "widths_cm": chart_widths_cm,
            "panel_count": chart_panel_count,
            "current_width_cm": target_width_cm,
        },
        "warnings": warnings,
    }
