"""
as_built.py
-----------
DIN 18202 Section 6 ("Compliance control") is entirely about comparing
an ACTUAL, site-measured dimension against the PERMITTED deviation this
app already computes in Steps A/D - a workflow this app never touched
until now. This module doesn't recompute any tolerance; it takes a
measured value and the already-computed frame_result/opening_result and
reports whether the measured deviation falls inside what was permitted.

Modeling assumptions:

  F1. Squareness-on-site is checked via a SINGLE measured diagonal
      compared to the nominal diagonal Step A already computed - not by
      measuring both diagonals and comparing them to each other (a
      simpler, equally valid site method, but a different one). If both
      diagonals are supplied, the average of their deviations is used
      and a note is added, rather than silently picking one.
  F2. Each measured value is compared against BOTH the worst-case and
      RSS permitted deviation already computed for that dimension -
      matching Step C's "show both, don't pick one for you" convention -
      rather than this module deciding which one counts as "the" limit.
"""


def _check_dimension(label, measured_cm, nominal_cm, wc_mm, rss_mm):
    deviation_mm = round(abs(measured_cm - nominal_cm) * 10, 2)
    return {
        "label": label,
        "measured_cm": measured_cm,
        "nominal_cm": nominal_cm,
        "deviation_mm": deviation_mm,
        "permitted_worst_case_mm": wc_mm,
        "permitted_rss_mm": rss_mm,
        "pass_worst_case": deviation_mm <= wc_mm,
        "pass_rss": deviation_mm <= rss_mm,
    }


def compute_as_built_check(measured, frame_result, opening_result=None):
    """
    measured: {
      "length_cm": float | None,
      "height_cm": float | None,
      "diagonal_cm": float | None,
      "diagonal2_cm": float | None (optional second diagonal, F1),
      "openings": [{"index": int, "width_cm": float|None, "height_cm": float|None}, ...]
    }
    """
    warnings = []
    tol = frame_result["tolerances"]
    geo = frame_result["geometry"]
    checks = []

    if measured.get("length_cm") is not None:
        checks.append(_check_dimension(
            "Wall length", float(measured["length_cm"]), geo["wall_length_cm"],
            tol["length"]["worst_case_mm"], tol["length"]["rss_mm"]))

    if measured.get("height_cm") is not None:
        checks.append(_check_dimension(
            "Wall height", float(measured["height_cm"]), geo["wall_height_cm"],
            tol["height"]["worst_case_mm"], tol["height"]["rss_mm"]))

    d1 = measured.get("diagonal_cm")
    d2 = measured.get("diagonal2_cm")
    if d1 is not None:
        nominal_diag = tol["diagonal"]["nominal_cm"]
        if d2 is not None:
            check1 = _check_dimension("Diagonal 1", float(d1), nominal_diag,
                                       tol["diagonal"]["worst_case_mm"], tol["diagonal"]["rss_mm"])
            check2 = _check_dimension("Diagonal 2", float(d2), nominal_diag,
                                       tol["diagonal"]["worst_case_mm"], tol["diagonal"]["rss_mm"])
            checks.append(check1)
            checks.append(check2)
            warnings.append(
                "Two diagonal measurements were given (F1) - each is checked independently "
                "against the nominal diagonal, since DIN 18202's own deviation table is defined "
                "per-dimension against a target size, not as a diagonal-vs-diagonal comparison."
            )
        else:
            checks.append(_check_dimension("Diagonal", float(d1), nominal_diag,
                                            tol["diagonal"]["worst_case_mm"], tol["diagonal"]["rss_mm"]))

    if opening_result and not opening_result.get("error"):
        for m in measured.get("openings", []):
            idx = m.get("index")
            matching = next((o for o in opening_result["openings"] if o["index"] == idx), None)
            if matching is None:
                continue
            if m.get("width_cm") is not None:
                wt = matching["width_tolerance"]
                checks.append(_check_dimension(
                    f"Opening {idx + 1} width", float(m["width_cm"]), matching["width_cm"],
                    wt["worst_case_mm"], wt["rss_mm"]))
            if m.get("height_cm") is not None:
                ht = matching["height_tolerance"]
                checks.append(_check_dimension(
                    f"Opening {idx + 1} height", float(m["height_cm"]), matching["height_cm"],
                    ht["worst_case_mm"], ht["rss_mm"]))

    if not checks:
        return {"error": "Enter at least one measured value to check."}

    overall_pass_rss = all(c["pass_rss"] for c in checks)
    overall_pass_worst_case = all(c["pass_worst_case"] for c in checks)

    return {
        "checks": checks,
        "overall_pass_rss": overall_pass_rss,
        "overall_pass_worst_case": overall_pass_worst_case,
        "warnings": warnings,
    }
