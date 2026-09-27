"""
sensitivity.py
---------------
One-at-a-time (OAT) sensitivity analysis: for each RSS-combined metric
the app computes (squareness diagonal, panel joint margin, panel-to-panel
thickness step), zero out each contributing tolerance source individually
and report how much the RSS result would drop. The source with the
largest drop is the one actually driving that result - this is what lets
you answer "does a better panel grade matter more than straighter studs?"
directly from the numbers, rather than guessing.

This reuses the ALREADY-COMPUTED component values sitting in frame_result/
panel_result/assembly_result (material_plus_mm, din_mm, etc.) and re-runs
just the combination formula with one term zeroed at a time - it does not
re-invoke build_frame/build_panels, so there's no risk of side effects on
the real computation.
"""
import math


def compute_sensitivity(frame_result, panel_result, assembly_result):
    tol = frame_result["tolerances"]
    L_mat = tol["length"]["material_plus_mm"]
    L_din = tol["length"]["din_mm"]
    H_mat = tol["height"]["material_plus_mm"]
    H_din = tol["height"]["din_mm"]
    D_mm = tol["diagonal"]["nominal_cm"] * 10.0
    L_mm = tol["length"]["target_cm"] * 10.0
    H_mm = tol["height"]["target_cm"] * 10.0
    dDdL = L_mm / D_mm
    dDdH = H_mm / D_mm

    def diag_rss(Lm, Ld, Hm, Hd):
        Lrss = math.sqrt(Lm ** 2 + Ld ** 2)
        Hrss = math.sqrt(Hm ** 2 + Hd ** 2)
        return math.sqrt((dDdL * Lrss) ** 2 + (dDdH * Hrss) ** 2)

    baseline_diag = diag_rss(L_mat, L_din, H_mat, H_din)
    squareness_sources = [
        {"label": "Frame length - material tolerance",
         "impact_mm": round(baseline_diag - diag_rss(0, L_din, H_mat, H_din), 3)},
        {"label": "Frame length - DIN 18202 assembly allowance",
         "impact_mm": round(baseline_diag - diag_rss(L_mat, 0, H_mat, H_din), 3)},
        {"label": "Frame height - material tolerance",
         "impact_mm": round(baseline_diag - diag_rss(L_mat, L_din, 0, H_din), 3)},
        {"label": "Frame height - DIN 18202 assembly allowance",
         "impact_mm": round(baseline_diag - diag_rss(L_mat, L_din, H_mat, 0), 3)},
    ]
    squareness_sources.sort(key=lambda s: -s["impact_mm"])

    jc = panel_result["joint_check"]
    joint_sources = []
    baseline_joint = jc["combined_rss_mm"]
    if baseline_joint is not None:
        w = jc["panel_width_tolerance_mm"]
        s_ = jc["stud_positional_tolerance_mm"]
        joint_sources = [
            {"label": "Panel width tolerance",
             "impact_mm": round(baseline_joint - math.sqrt(0 ** 2 + s_ ** 2), 3)},
            {"label": "Stud positional tolerance (DIN 18202 alignment)",
             "impact_mm": round(baseline_joint - math.sqrt(w ** 2 + 0 ** 2), 3)},
        ]
        joint_sources.sort(key=lambda s: -s["impact_mm"])

    sc = assembly_result["step_check"]
    step_sources = []
    baseline_step = sc["rss_step_mm"]
    if baseline_step is not None:
        p = sc["thickness_tolerance_plus_mm"]
        m = sc["thickness_tolerance_minus_mm"]
        step_sources = [
            {"label": "Panel thickness tolerance (+ side)",
             "impact_mm": round(baseline_step - math.sqrt(0 ** 2 + m ** 2), 3)},
            {"label": "Panel thickness tolerance (- side)",
             "impact_mm": round(baseline_step - math.sqrt(p ** 2 + 0 ** 2), 3)},
        ]
        step_sources.sort(key=lambda s: -s["impact_mm"])

    return {
        "squareness": {"baseline_rss_mm": round(baseline_diag, 3), "sources": squareness_sources},
        "joint": {"baseline_rss_mm": round(baseline_joint, 3) if baseline_joint is not None else None, "sources": joint_sources},
        "thickness_step": {"baseline_rss_mm": round(baseline_step, 3) if baseline_step is not None else None, "sources": step_sources},
    }
