"""
assembly.py
-----------
Step C: the complete assembled wall (frame + panels) checked against
DIN 18202 as a single finished building element - the capstone check
combining what Steps A and B already computed, plus one genuinely new
check: the visible step at a panel-to-panel butt joint caused by panel
thickness tolerance, evaluated as a flatness deviation.

Modeling assumptions (continuing A1-A8, B1-B4 numbering as C1, C2...):

  C1. PANEL-TO-PANEL THICKNESS STEP: two adjacent sheets of the same
      nominal thickness can each independently land anywhere within their
      published thickness tolerance. The worst-case visible step at the
      joint is modeled as one sheet at its +tolerance extreme and the
      other at its -tolerance extreme simultaneously:
          worst_case_step = plus_tol + minus_tol
      RSS combines the same two contributions as independent sources:
          rss_step = sqrt(plus_tol^2 + minus_tol^2)
      This reuses the app's established WC/RSS convention, but note the
      two "sources" here are really the same underlying tolerance spec
      sampled twice (both panels cut from the same published range), not
      two physically distinct tolerance mechanisms - a slightly different
      use of RSS than elsewhere in the app, flagged explicitly rather than
      silently presented as equivalent.
  C2. This step is compared against DIN 18202's flatness deviation at its
      SMALLEST published measuring distance (<0.1m) - modeling a step
      directly at a joint line as the tightest-spacing flatness case DIN
      18202 defines, since DIN 18202 has no dedicated "panel joint step"
      tolerance. Same style of proxy as Step A's squareness check
      (angular deviation table standing in for a purpose-built
      frame-squareness spec) - a defensible choice, not a certainty.
  C3. ALL SIX sheeting materials are supported (matching Step B - see its
      B3 for the full breakdown). MDF-family and Gypsum's Types A-R have
      real gaps of their own even so: MDF's thickness data doesn't
      distinguish sanded/unsanded (the 'variant' parameter is simply
      unused for it), and Gypsum's Types A-R has no published thickness
      tolerance at all - both surfaced as explicit unavailable/warning
      states rather than silently defaulting to a number.
  C4. The overall pass/fail is RSS-based only (the more realistic
      combination per Step A's methodology discussion) - worst-case
      figures are still reported per-check for reference, but are not
      rolled into the single overall verdict, to avoid one overly
      conservative check dominating a summary meant to represent typical
      as-built performance.
"""
import math
from geometry import lookup_din18202_flatness


def get_sheeting_thickness_tolerance(materials, material_key, target_thickness_mm, variant=None, subtype=None):
    """Returns (plus_mm, minus_mm, verified, note) for a sheeting panel's
    thickness at a given nominal thickness. Handles all six data shapes
    present across the supported materials."""
    m = materials["sheeting"][material_key]

    if material_key == "clt":
        spec = m["product"]["thickness"]
        val = max(spec["option_a_mm"], target_thickness_mm * spec["option_b_percent_of_nominal"] / 100.0)
        return val, val, spec.get("verified", False), spec.get("note")

    if material_key == "plywood":
        spec = m["dimensions"]["thickness"]  # type: plywood_thickness_table
        band = None
        for b in spec["bands"]:
            if b["max"] is None or target_thickness_mm <= b["max"]:
                band = b
                break
        if band is None:
            band = spec["bands"][-1]
        key_prefix = "sanded" if variant == "sanded" else "unsanded"
        on_nominal = band[f"{key_prefix}_on_nominal"]
        plus = on_nominal["plus_base"] + on_nominal["plus_coef"] * target_thickness_mm
        minus = on_nominal["minus_base"] + on_nominal["minus_coef"] * target_thickness_mm
        return plus, minus, spec.get("verified", False), spec.get("note")

    if material_key == "mdf_family":
        if subtype not in m["boards"]:
            return None, None, False, f"unknown mdf_family subtype '{subtype}'"
        board = m["boards"][subtype]
        band = None
        for b in board["thickness_bands_mm"]:
            if b["max"] is None or target_thickness_mm <= b["max"]:
                band = b
                break
        if band is None:
            band = board["thickness_bands_mm"][-1]
        return band["plus"], band["minus"], board.get("verified", False), None

    if material_key == "gfb_gpb":
        if subtype not in ("type_p", "types_ahdefir"):
            return None, None, False, "gfb_gpb requires a subtype ('type_p' or 'types_ahdefir')"
        spec = m[subtype]["thickness"]
        if spec.get("type") == "unknown":
            return None, None, False, spec.get("note", f"thickness not published for '{subtype}'")
        return spec["plus"], spec["minus"], spec.get("verified", False), spec.get("note")

    # osb, particleboard: {"type":"variant","variants":{"sanded":{...},"unsanded":{...}}}
    spec = m["dimensions"]["thickness"]
    if spec.get("type") == "variant":
        v = spec["variants"].get(variant or "sanded")
        if v is None:
            return None, None, False, f"variant '{variant}' not found for '{material_key}'"
        return v["plus"], v["minus"], v.get("verified", False), v.get("note")

    return None, None, False, "unsupported thickness spec"


def build_assembly_check(config, materials, din, frame_result, panel_result):
    """
    config: {
      "panel_thickness_mm": float,
      "panel_thickness_variant": "sanded"|"unsanded"|null,
      "finish_class": "unfinished_wall"|"finished_wall"|"finished_wall_stringent",
    }
    """
    warnings = []
    material = panel_result["config"]["panel_material"]
    subtype = panel_result["config"].get("panel_subtype")
    thickness_mm = float(config.get("panel_thickness_mm", 15))
    variant = config.get("panel_thickness_variant")
    finish_class = config.get("finish_class", "unfinished_wall")

    plus_mm, minus_mm, verified, note = get_sheeting_thickness_tolerance(
        materials, material, thickness_mm, variant, subtype)

    if plus_mm is None:
        warnings.append(f"Panel thickness tolerance unavailable for '{material}'{f'/{subtype}' if subtype else ''}: {note}")
    elif not verified:
        warnings.append(f"Panel thickness tolerance for '{material}'{f'/{subtype}' if subtype else ''} is unverified: {note}")

    step_wc = None if plus_mm is None else round(plus_mm + minus_mm, 3)
    step_rss = None if plus_mm is None else round(math.sqrt(plus_mm ** 2 + minus_mm ** 2), 3)

    flatness_limit_mm, flatness_label = lookup_din18202_flatness(din, finish_class, 0.1)

    step_check = {
        "panel_thickness_mm": thickness_mm,
        "thickness_tolerance_plus_mm": plus_mm,
        "thickness_tolerance_minus_mm": minus_mm,
        "worst_case_step_mm": step_wc,
        "rss_step_mm": step_rss,
        "flatness_limit_mm": flatness_limit_mm,
        "flatness_label": flatness_label,
        "pass_worst_case": (step_wc <= flatness_limit_mm) if step_wc is not None else None,
        "pass_rss": (step_rss <= flatness_limit_mm) if step_rss is not None else None,
    }

    # --- consolidated summary across everything computed in A, B, C ------
    ftol = frame_result["tolerances"]
    jc = panel_result["joint_check"]
    summary = [
        {
            "check": "Wall length (DIN 18202) - informational, not a pass/fail",
            "value": f"±{ftol['length']['worst_case_mm']:.1f}mm WC / ±{ftol['length']['rss_mm']:.1f}mm RSS",
            "status_wc": None,
            "status_rss": None,
        },
        {
            "check": "Wall height (DIN 18202) - informational, not a pass/fail",
            "value": f"±{ftol['height']['worst_case_mm']:.1f}mm WC / ±{ftol['height']['rss_mm']:.1f}mm RSS",
            "status_wc": None,
            "status_rss": None,
        },
        {
            "check": f"Frame squareness (limit {ftol['squareness']['limit_mm']}mm)",
            "value": f"{ftol['diagonal']['worst_case_mm']:.1f}mm WC / {ftol['diagonal']['rss_mm']:.1f}mm RSS",
            "status_wc": ftol["squareness"]["pass_worst_case"],
            "status_rss": ftol["squareness"]["pass_rss"],
        },
        {
            "check": "Panel joint interface margin",
            "value": (f"{jc['combined_worst_case_mm']:.1f}mm WC / {jc['combined_rss_mm']:.1f}mm RSS"
                      if jc["combined_rss_mm"] is not None else "unavailable"),
            "status_wc": jc["pass_worst_case"],
            "status_rss": jc["pass_rss"],
        },
        {
            "check": f"Panel-to-panel thickness step vs. flatness ({flatness_label})",
            "value": (f"{step_wc:.2f}mm WC / {step_rss:.2f}mm RSS vs. {flatness_limit_mm}mm limit"
                      if step_rss is not None else "unavailable"),
            "status_wc": step_check["pass_worst_case"],
            "status_rss": step_check["pass_rss"],
        },
    ]
    statuses_rss = [s["status_rss"] for s in summary if s["status_rss"] is not None]
    overall_pass_rss = all(statuses_rss) if statuses_rss else None
    statuses_wc = [s["status_wc"] for s in summary if s["status_wc"] is not None]
    overall_pass_worst_case = all(statuses_wc) if statuses_wc else None

    return {
        "config": {
            "panel_thickness_mm": thickness_mm,
            "panel_thickness_variant": variant,
            "finish_class": finish_class,
        },
        "step_check": step_check,
        "summary": summary,
        "overall_pass_rss": overall_pass_rss,
        "overall_pass_worst_case": overall_pass_worst_case,
        "warnings": warnings,
    }
