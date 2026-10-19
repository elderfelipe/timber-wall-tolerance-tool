"""
geometry.py
-----------
Parametric model of a timber stick-frame wall (Step A of the tool).

Modeling assumptions made explicit here (flag these in your thesis methods
chapter - they are defensible engineering choices, not arbitrary code):

  A1. Wall LENGTH is governed by the top/bottom BEAM as a single continuous
      member -> its tolerance comes from the framing material's "length"
      dimension, evaluated at the wall length.
  A2. Wall HEIGHT is governed by the STUD as a single continuous member ->
      same idea, evaluated at the wall height.
  A3. Both are also subject to the DIN 18202 assembly-level linear deviation
      for "dimensions in plan" (length) and "dimensions in elevation"
      (height) at the same target size - the assembled wall can be worse
      than a single perfect component even if every component is in spec.
      Row choice is not arbitrary: DIN 18202 names its own examples for
      each row - "dimensions in plan" lists length, width, modular sizes;
      "dimensions in elevation" lists storey heights explicitly. A wall's
      length maps directly to the first, a wall's height to the second.
  A4. DIAGONAL tolerance is not looked up - it is *derived* from the length
      and height tolerances via linearized error propagation:
          D = sqrt(L^2 + H^2)
          dD/dL = L/D ,  dD/dH = H/D
          delta_D (RSS)  = sqrt( (L/D * delta_L)^2 + (H/D * delta_H)^2 )
          delta_D (worst-case) = (L/D)*delta_L + (H/D)*delta_H
      This is the standard linearized (first-order Taylor) approach for
      propagating independent tolerances through a derived nonlinear
      quantity - appropriate here because delta_L, delta_H << L, H.
  A5. SQUARENESS limit (max permitted |diagonal1 - diagonal2|) is modeled
      as the DIN 18202 *angular* deviation value evaluated at the wall's
      diagonal length. This is an approximation - DIN 18202 does not
      publish a dedicated frame-squareness rate table, unlike some panel
      standards (e.g. OSB's 2.0 mm/m squareness in EN 300). State this
      assumption explicitly if you keep it; an alternative is to adopt the
      panel-squareness-style mm/m rate directly instead.
  A6. STUD POSITIONAL tolerance (how far an individual stud's centerline
      can drift from its nominal layout position) is modeled two ways for
      comparison:
        - "datum-referenced": every stud is independently marked/cut from
          a single master datum (e.g. a jig or laser line) -> tolerance
          stays constant regardless of stud count/position, taken as the
          DIN 18202 "alignment deviation for columns" value. This is a
          MODELING ANALOGY, not a literal citation - DIN 18202 doesn't
          mention studs; treating a stud like a column for this purpose is
          a judgment call, flag it as such if used in the thesis.
        - "chained": each stud is marked relative to the previous one
          (tape-measured stud-to-stud) -> tolerance accumulates linearly,
          worst case, with stud index.
      This produces the fabrication-method sensitivity chart.
  A7. BOW/TWIST/CROOK (warping) are per-member manufacturing properties
      tied to the material's grade/class - they do NOT change with stud
      count, so they are no longer shown on the stud-count sensitivity
      chart (removed per request - they added little there beyond
      confirming they're flat). See A8 for where they're used instead.
  A8. WARPING VS. FLATNESS CHECK: EN 336/DIN 4074 (bow/twist) and DIN EN
      14080 (longitudinal warping) both define their limits "relative to
      a measurement length of 2000mm" per the source footnotes - the
      4/8/12mm figures are specifically "permitted curve over a 2m span",
      not a scale-independent absolute limit. Rather than guess how these
      should rescale for a stud whose actual height differs from 2m, they
      are compared against DIN 18202's flatness table AT THE SAME 2m
      reference distance - DIN 18202's flatness deviation is also banded
      by "distance between measuring points", and 2m falls inside its own
      bands. Both figures are evaluated at the distance each was actually
      defined at.
      IMPORTANT: DIN 18202's flatness table is NOT a step function - its
      own footnote states intermediate values (like 2m, which falls
      between the published "1m" and "4m" columns) should be read from
      Figures 6/7's curves. lookup_din18202_flatness() LINEARLY
      INTERPOLATES between the two bracketing tabulated columns as a
      disclosed approximation of those curves (no digitized curve data or
      formula is available - only the five tabulated points). This was a
      real bug in earlier revisions, which used a step-function lookup
      (rounding up to the next column) - that produced a MORE LENIENT,
      overestimated limit at every intermediate distance (e.g. 15mm at
      2m instead of the correct ~11.67mm interpolated value), making the
      warping check too easy to pass. Fixed here.
      EXPLICIT SCOPE LIMIT, not an oversight: bow_mm and crook_mm are used
      AS-IS from the source, regardless of the wall's actual stud height.
      NO extrapolation to other stud heights is applied, because the
      source standards do not define one. A constant-curvature (sagitta)
      rescaling was considered and deliberately rejected - it would
      require assuming a curvature SHAPE (e.g. constant-radius arc) that
      is not stated anywhere in EN 336, DIN 4074, or DIN EN 14080. Adding
      it would be inventing physics not present in the source documents,
      which this tool does not do. Practical consequence: this check is
      only strictly valid for a 2m span within the stud, not for the
      stud's full height if that height differs from 2m. It is reported
      to the user as such (see 'scope_note' in the returned check) rather
      than silently implied to cover the whole stud.
      TWIST is different and is NOT subject to this limitation: it is
      explicitly published as a RATE ("1mm per 25mm height"), so scaling
      it by actual stud height applies the standard's own stated unit
      rather than inventing a new relationship. (Twist is currently not
      surfaced in the UI after the Step 6 chart simplification, but the
      lookup remains available via get_warping_mm if reintroduced.)
"""
import math

# ---------------------------------------------------------------------------
# Generic band lookup helpers
# ---------------------------------------------------------------------------

def _band_index(target, uppers):
    for i, upper in enumerate(uppers):
        if upper is None or target <= upper:
            return i
    return len(uppers) - 1


def lookup_size_band(spec, target, class_key=None, target_mm=None):
    """spec['bands'] entries may be {'plus','minus'} or {'percent'} or
    class-keyed {'class1':{...},'class2':{...}}.

    `target` is used for band SELECTION, in the unit the bands are defined
    in (spec['unit'], e.g. 'm' for length bands, 'mm' for width/thickness
    bands). `target_mm` is the same target converted to millimetres, used
    for computing percent-based VALUES so the result is always returned in
    mm regardless of which unit the bands were selected in. If target_mm is
    not given, target is assumed to already be in mm.
    """
    if target_mm is None:
        target_mm = target
    bands = spec["bands"]
    uppers = [b["max"] for b in bands]
    b = bands[_band_index(target, uppers)]
    if class_key and class_key in b:
        b = b[class_key]
    if "percent" in b:
        val = target_mm * b["percent"] / 100.0
        return val, val
    if "plus_percent" in b:
        plus = target_mm * b["plus_percent"] / 100.0
        minus = target_mm * b.get("minus_percent", b["plus_percent"]) / 100.0
        return plus, minus
    return b.get("plus", 0), b.get("minus", 0)


def lookup_material_length(materials, material_key, target_size_m, class_key=None):
    """Returns (plus_mm, minus_mm, verified, note) for a framing member's
    'length' dimension. target_size_m in meters."""
    spec = materials["framing"][material_key]["dimensions"].get("length")
    if spec is None or spec.get("type") == "unknown":
        return None, None, False, (spec.get("note") if spec else "no length data")
    if spec["type"] == "fixed":
        return spec["plus"], spec["minus"], spec.get("verified", False), spec.get("note")
    if spec["type"] == "size_band":
        # bands for length are defined in metres; convert target to mm for
        # percent-based value computation (see docstring above)
        plus, minus = lookup_size_band(spec, target_size_m, class_key, target_mm=target_size_m * 1000.0)
        return plus, minus, spec.get("verified", False), spec.get("note")
    return None, None, False, "unsupported spec type"


def lookup_din18202_linear(din, row_key, target_size_m):
    row = din["linear"]["rows"][row_key]
    idx = _band_index(target_size_m, din["linear"]["bands"])
    return row["values"][idx], row["label"]


def lookup_din18202_angular(din, target_size_m):
    idx = _band_index(target_size_m, din["angular"]["bands"])
    return din["angular"]["values"][idx]


def lookup_din18202_alignment(din, target_size_m):
    idx = _band_index(target_size_m, din["alignment_columns"]["bands"])
    return din["alignment_columns"]["values"][idx]


def lookup_din18202_flatness(din, row_key, distance_m):
    """DIN 18202's flatness table footnote states: 'Intermediate values shall
    be taken from Figure 6 and Figure 7' - i.e. the table's five columns are
    points on a published CURVE, not a step function. Values between
    columns must be interpolated, not rounded up to the next column.

    This uses LINEAR interpolation between the two bracketing tabulated
    columns. That is an explicit, disclosed APPROXIMATION of the actual
    curve, not a digitization of Figures 6/7 - the source curves are
    visibly not perfectly straight between points, but no formula or
    digitized curve data is available, only the five tabulated points.
    Linear interpolation between known points is the standard, defensible
    numerical technique when only discrete table values are available;
    it is not a guess at the curve's shape, but it is also not exact.
    Below the first column (0.1m) or at/above the last (15m), the nearest
    tabulated value is used flat - the footnote itself states the 15m
    column's values also apply beyond 15m, and no data exists below 0.1m."""
    row = din["flatness"]["rows"][row_key]
    bands = din["flatness"]["bands"]
    values = row["values"]
    if distance_m <= bands[0]:
        return values[0], row["label"]
    if distance_m >= bands[-1]:
        return values[-1], row["label"]
    for i in range(len(bands) - 1):
        lo, hi = bands[i], bands[i + 1]
        if lo <= distance_m <= hi:
            frac = (distance_m - lo) / (hi - lo)
            interpolated = values[i] + frac * (values[i + 1] - values[i])
            return round(interpolated), row["label"]
    return values[-1], row["label"]  # unreachable, safety fallback


# Maps (material, axis) -> which key in materials.json 'dimensions' holds
# the relevant cross-section tolerance. Naming is inconsistent across the
# source standards (KVH uses width/thickness, Glulam uses width/depth) so this mapping is explicit rather
# than assumed.
_CROSS_SECTION_KEY = {
    ("kvh", "width"): "width", ("kvh", "depth"): "thickness",
    ("glulam", "width"): "width", ("glulam", "depth"): "depth",
}


def lookup_cross_section_tolerance(materials, material_key, axis, target_mm, class_key=None):
    """Returns (plus_mm, minus_mm, verified, note) for a stud/beam's width or
    depth (axis in {'width','depth'})."""
    dim_key = _CROSS_SECTION_KEY.get((material_key, axis))
    if dim_key is None:
        return None, None, False, f"No {axis} tolerance published for {material_key} in source table"
    spec = materials["framing"][material_key]["dimensions"].get(dim_key)
    if spec is None or spec.get("type") == "unknown":
        return None, None, False, (spec.get("note") if spec else f"no {dim_key} data")
    if spec["type"] == "fixed":
        return spec["plus"], spec["minus"], spec.get("verified", False), spec.get("note")
    if spec["type"] == "size_band":
        plus, minus = lookup_size_band(spec, target_mm, class_key, target_mm=target_mm)
        return plus, minus, spec.get("verified", False), spec.get("note")
    if spec["type"] == "formula":
        # asymmetric formula support:
        # plus = plus_base + plus_coef*t , minus = minus_base + minus_coef*t
        plus = spec.get("plus_base", 0) + spec.get("plus_coef", 0) * target_mm
        minus = spec.get("minus_base", spec.get("plus_base", 0)) + spec.get("minus_coef", spec.get("plus_coef", 0)) * target_mm
        return plus, minus, spec.get("verified", False), spec.get("note")
    return None, None, False, "unsupported spec type"


def lookup_rate_capped(spec, target_size_m):
    """For tolerances given as 'X mm per metre, capped at Y mm' (e.g. the
    MDF-family length/width tolerance: ±2mm/m, max ±5mm). Not yet wired
    into any Step A calculation (Step A only uses framing materials) but
    kept here so Step B (sheeting) can reuse the same lookup pattern."""
    val = min(target_size_m * spec["rate_mm_per_m"], spec["cap_mm"])
    return val, val


# ---------------------------------------------------------------------------
# Frame geometry
# ---------------------------------------------------------------------------

def compute_stud_positions(wall_length_cm, stud_count, stud_width_mm):
    """Evenly distribute `stud_count` studs (centerlines) from one end of the
    wall to the other, including the two end studs. Returns list of x
    positions (cm, centerline) for each stud."""
    stud_count = max(2, int(stud_count))
    half_w_cm = (stud_width_mm / 10.0) / 2.0
    usable_length = wall_length_cm  # end studs' outer faces align with wall ends
    if stud_count == 2:
        return [half_w_cm, wall_length_cm - half_w_cm]
    positions = []
    for i in range(stud_count):
        t = i / (stud_count - 1)
        x = half_w_cm + t * (usable_length - 2 * half_w_cm)
        positions.append(round(x, 3))
    return positions


def get_warping_mm(materials, material_key, class_key, prop, kvh_grade=None):
    """Returns (value_mm, note) for a warping property ('bow_mm',
    'twist_mm_per_25mm_height' - NOT 'crook_mm': DIN 4074-1's Kantholz
    table has no crook criterion at all, see the note below) on a framing
    material. Returns (None, note) if not available - not every material
    publishes every property.

    KVH is a special case: EN 336's tolerance classes 1/2 (EN 336 clause
    4.3 - dimensional sizing) and DIN 4074-1's strength grades (softwood,
    S7/S7K, S10/S10K, S13/S13K) are two SEPARATE, independent
    classification systems for the same physical timber - the source
    table's Bow/Twist values are attached to the strength-grade axis, not
    the EN 336 tolerance-class axis. So for material_key=='kvh', this
    looks up 'sawn_timber_grades' (keyed by kvh_grade) instead of 'kvh'
    itself, which correctly has no warping data of its own.

    Confirmed by direct read of DIN 4074-1:2026-05 Table 2 ('Sortier­
    kriterien fuer Kantholz'): Laengskruemmung (bow, 8mm) and Verdrehung
    (twist, 1mm/25mm height) are IDENTICAL across S7/S10/S13 for this
    product category - not graduated by grade. Note 'Querkruemmung'
    (if it appeared here) would mean CUP, not crook - but no such
    criterion exists for Kantholz at all: DIN 4074-1 covers curvature in
    both directions with the one Laengskruemmung (longitudinal
    curvature) value; a distinct Querkruemmung/cup concept only appears
    in Table 3 for Bretter und Bohlen (boards and planks), a different
    product category that studs/beams don't belong to. These limits are
    given in DIN 4074-1 clause 5.7.2 at a 2000mm measuring length,
    within the ceilings set by EN 14081-1 Table A.2; EN 14081-1 allows
    pro-rata adjustment of these limits for other measuring lengths,
    which this tool does not apply."""
    if material_key == "kvh":
        grades = materials["framing"].get("sawn_timber_grades", {})
        w = grades.get("warping", {})
        val = w.get(prop)
        if val is None:
            if prop == "crook_mm":
                return None, ("'Querkruemmung' means cup, not crook - and DIN 4074-1:2026-05 Table 2 "
                               "defines no separate cup criterion for Kantholz (squared timber) either: "
                               "it covers curvature in both directions with the one Laengskruemmung "
                               "(longitudinal curvature) value; only that and Verdrehung (twist) exist "
                               "for this product category. Confirmed absent, not an unresolved data gap.")
            return None, f"'{prop}' not specified for sawn timber strength grades"
        if not kvh_grade:
            return None, "No strength grade selected - Bow/Twist are indexed by DIN 4074-1 strength grade (softwood/S7/S10/S13), not by EN 336 tolerance class 1/2"
        if isinstance(val, dict) and kvh_grade in val:
            return val[kvh_grade], None
        return None, f"'{prop}' not specified for grade '{kvh_grade}'"

    w = materials["framing"].get(material_key, {}).get("warping")
    if not w:
        return None, f"No warping data published for '{material_key}' in source table"
    val = w.get(prop)
    if val is None:
        return None, f"'{prop}' not specified for '{material_key}'"
    if isinstance(val, (int, float)):
        return val, None
    if isinstance(val, dict):
        if val.get("type") == "unknown":
            return None, val.get("note", f"'{prop}' unspecified for '{material_key}'")
        if class_key and class_key in val:
            v = val[class_key]
            if isinstance(v, (int, float)):
                return v, None
        return None, f"'{prop}' format not resolvable for '{material_key}'"
    return None, "unsupported format"


def build_frame(config, materials, din):
    """
    config: {
      wall_length_cm, wall_height_cm,
      framing_material ('kvh'|'glulam'),
      kvh_class ('class1'|'class2', only used if framing_material=='kvh'),
      stud_width_mm, stud_depth_mm,
      beam_width_mm, beam_depth_mm,
      stud_count
    }
    Returns a dict with geometry (for 3D rendering), tolerances, chart data,
    and warnings about unverified/missing source data actually used.
    """
    L = float(config["wall_length_cm"])
    H = float(config["wall_height_cm"])
    material = config.get("framing_material", "kvh")
    kvh_class = config.get("kvh_class", "class1")
    stud_w = float(config.get("stud_width_mm", 60))
    stud_d = float(config.get("stud_depth_mm", 120))
    beam_w = float(config.get("beam_width_mm", 60))
    beam_d = float(config.get("beam_depth_mm", 120))
    stud_count = int(config.get("stud_count", 5))

    warnings = []

    # --- geometry -----------------------------------------------------
    stud_x_positions = compute_stud_positions(L, stud_count, stud_w)
    beam_h_cm = beam_d / 10.0  # beam installed flat: its "depth" dim is vertical thickness

    studs = []
    for i, x in enumerate(stud_x_positions):
        studs.append({
            "id": i,
            "x_cm": x,
            "y_cm": beam_h_cm,                       # sits on top of bottom beam
            "width_cm": stud_w / 10.0,
            "height_cm": max(0.0, H - 2 * beam_h_cm),  # between the two beams
            "depth_cm": stud_d / 10.0,
        })

    beams = [
        {"role": "bottom", "x_cm": 0, "y_cm": 0, "width_cm": L, "height_cm": beam_h_cm, "depth_cm": beam_d / 10.0},
        {"role": "top",    "x_cm": 0, "y_cm": H - beam_h_cm, "width_cm": L, "height_cm": beam_h_cm, "depth_cm": beam_d / 10.0},
    ]

    corners = {"bl": [0, 0], "br": [L, 0], "tl": [0, H], "tr": [L, H]}
    diagonal_nominal_cm = math.hypot(L, H)

    # --- component-level tolerances (length = wall length via beam, ------
    #     height = wall height via stud) ------------------------------
    class_key = "class1" if material == "kvh" and kvh_class == "class1" else ("class2" if material == "kvh" else None)

    mat_len_plus, mat_len_minus, len_verified, len_note = lookup_material_length(
        materials, material, L / 100.0, class_key)
    mat_h_plus, mat_h_minus, h_verified, h_note = lookup_material_length(
        materials, material, H / 100.0, class_key)

    if mat_len_plus is None:
        warnings.append(f"No material-level length tolerance available for '{material}' "
                         f"({len_note}) - wall LENGTH tolerance uses DIN 18202 assembly limit only.")
        mat_len_plus = mat_len_minus = 0.0
    elif not len_verified:
        warnings.append(f"Material length tolerance for '{material}' is flagged unverified in the "
                         f"source data ({len_note}).")

    if mat_h_plus is None:
        warnings.append(f"No material-level length tolerance available for '{material}' "
                         f"({h_note}) - wall HEIGHT tolerance uses DIN 18202 assembly limit only.")
        mat_h_plus = mat_h_minus = 0.0
    elif not h_verified:
        warnings.append(f"Material length tolerance for '{material}' is flagged unverified in the "
                         f"source data ({h_note}).")

    # --- cross-section tolerances (stud & beam width/depth) ------------
    def cross_section_block(width_mm, depth_mm, label):
        w_plus, w_minus, w_ok, w_note = lookup_cross_section_tolerance(
            materials, material, "width", width_mm, class_key)
        d_plus, d_minus, d_ok, d_note = lookup_cross_section_tolerance(
            materials, material, "depth", depth_mm, class_key)
        if w_plus is None:
            warnings.append(f"{label} width tolerance unavailable for '{material}' ({w_note}).")
        elif not w_ok:
            warnings.append(f"{label} width tolerance for '{material}' is unverified ({w_note}).")
        if d_plus is None:
            warnings.append(f"{label} depth tolerance unavailable for '{material}' ({d_note}).")
        elif not d_ok:
            warnings.append(f"{label} depth tolerance for '{material}' is unverified ({d_note}).")
        return {
            "width_mm": width_mm, "depth_mm": depth_mm,
            "width_plus_mm": w_plus, "width_minus_mm": w_minus,
            "depth_plus_mm": d_plus, "depth_minus_mm": d_minus,
        }

    stud_cross_section = cross_section_block(stud_w, stud_d, "Stud")
    beam_cross_section = cross_section_block(beam_w, beam_d, "Beam")

    # --- DIN 18202 assembly-level tolerances --------------------------
    din_len_mm, din_len_label = lookup_din18202_linear(din, "plan_dimensions", L / 100.0)
    din_h_mm, din_h_label = lookup_din18202_linear(din, "elevation_dimensions", H / 100.0)

    # --- combine (worst case + RSS) ------------------------------------
    # A9. ASYMMETRIC LIMITS: a limit such as -1/+3 mm is NOT reduced to one
    #     symmetric number. The plus side and the minus side are combined with
    #     the (symmetric) DIN 18202 allowance separately. The headline value
    #     is the side that gives the larger result (the "governing" side), so
    #     a pass means that BOTH sides pass. No value is assumed: every number
    #     comes from the standards.
    def _sides(mat_plus, mat_minus, din_mm):
        out = {}
        for side, m in (("plus", mat_plus), ("minus", mat_minus)):
            out[side] = {"material_mm": m, "worst_case_mm": m + din_mm,
                         "rss_mm": math.sqrt(m ** 2 + din_mm ** 2)}
        gov = "plus" if out["plus"]["rss_mm"] >= out["minus"]["rss_mm"] else "minus"
        out["governing"] = gov
        return out

    length_sides = _sides(mat_len_plus, mat_len_minus, din_len_mm)
    height_sides = _sides(mat_h_plus, mat_h_minus, din_h_mm)
    mat_len_gov = length_sides[length_sides["governing"]]["material_mm"]
    mat_h_gov = height_sides[height_sides["governing"]]["material_mm"]
    length_wc = length_sides[length_sides["governing"]]["worst_case_mm"]
    length_rss = length_sides[length_sides["governing"]]["rss_mm"]
    height_wc = height_sides[height_sides["governing"]]["worst_case_mm"]
    height_rss = height_sides[height_sides["governing"]]["rss_mm"]

    # --- diagonal via linearized error propagation (A4) ----------------
    D = diagonal_nominal_cm * 10.0  # mm
    L_mm, H_mm = L * 10.0, H * 10.0
    dDdL = L_mm / D
    dDdH = H_mm / D
    diagonal_wc = dDdL * length_wc + dDdH * height_wc
    diagonal_rss = math.sqrt((dDdL * length_rss) ** 2 + (dDdH * height_rss) ** 2)

    # --- squareness limit (A5) -----------------------------------------
    squareness_limit_mm = lookup_din18202_angular(din, diagonal_nominal_cm / 100.0)
    # A value exactly equal to the limit passes (limit is "not more than").
    # Floating-point arithmetic can return 16.000000000000004 for a value that
    # is mathematically 16, so the comparison uses a 1e-9 mm tolerance. This
    # is not an assumption about the standard: it only removes arithmetic noise.
    squareness_pass_wc = diagonal_wc <= squareness_limit_mm + 1e-9
    squareness_pass_rss = diagonal_rss <= squareness_limit_mm + 1e-9

    tolerances = {
        "length": {
            "target_cm": L,
            "material_plus_mm": round(mat_len_plus, 3), "material_minus_mm": round(mat_len_minus, 3),
            "material_governing_mm": round(mat_len_gov, 3), "governing_side": length_sides["governing"],
            "din_mm": din_len_mm, "din_label": din_len_label,
            "worst_case_mm": round(length_wc, 3), "rss_mm": round(length_rss, 3),
        },
        "height": {
            "target_cm": H,
            "material_plus_mm": round(mat_h_plus, 3), "material_minus_mm": round(mat_h_minus, 3),
            "material_governing_mm": round(mat_h_gov, 3), "governing_side": height_sides["governing"],
            "din_mm": din_h_mm, "din_label": din_h_label,
            "worst_case_mm": round(height_wc, 3), "rss_mm": round(height_rss, 3),
        },
        "diagonal": {
            "nominal_cm": round(diagonal_nominal_cm, 3),
            "worst_case_mm": round(diagonal_wc, 3), "rss_mm": round(diagonal_rss, 3),
        },
        "squareness": {
            "limit_mm": squareness_limit_mm,
            "evaluated_at_m": round(diagonal_nominal_cm / 100.0, 3),
            "pass_worst_case": squareness_pass_wc,
            "pass_rss": squareness_pass_rss,
        },
        "stud_cross_section": stud_cross_section,
        "beam_cross_section": beam_cross_section,
    }

    # --- chart 1: deviation budget by source ----------------------------
    deviation_budget = {
        "labels": ["Length (wall)", "Height (wall)", "Diagonal (derived)"],
        "material_mm": [round(mat_len_gov, 3), round(mat_h_gov, 3), None],
        "din_mm": [din_len_mm, din_h_mm, None],
        "worst_case_mm": [round(length_wc, 3), round(height_wc, 3), round(diagonal_wc, 3)],
        "rss_mm": [round(length_rss, 3), round(height_rss, 3), round(diagonal_rss, 3)],
    }

    # --- chart 2: permitted deviation vs target size --------------------
    sizes_m = [0.5, 1, 2, 3, 4, 6, 8, 10, 15, 20, 25, 30]
    plan_curve = [lookup_din18202_linear(din, "plan_dimensions", s)[0] for s in sizes_m]
    elevation_curve = [lookup_din18202_linear(din, "elevation_dimensions", s)[0] for s in sizes_m]
    material_len_curve = []
    for s in sizes_m:
        p, _, _, _ = lookup_material_length(materials, material, s, class_key)
        material_len_curve.append(p if p is not None else None)
    permitted_vs_size = {
        "sizes_m": sizes_m,
        "din_plan_mm": plan_curve,
        "din_elevation_mm": elevation_curve,
        "material_length_mm": material_len_curve,
        "current_length_m": round(L / 100.0, 3),
        "current_height_m": round(H / 100.0, 3),
    }

    # --- chart 3: stud positional tolerance accumulation (A6) -----------
    n = len(stud_x_positions)
    datum_align_mm = lookup_din18202_alignment(din, H / 100.0)
    stud_indices = list(range(1, n + 1))
    datum_series = [datum_align_mm for _ in stud_indices]
    chained_series = [round(datum_align_mm * i, 3) for i in stud_indices]
    stud_accumulation = {
        "stud_index": stud_indices,
        "datum_referenced_mm": datum_series,
        "chained_mm": chained_series,
    }

    # --- chart 4: stud-count sensitivity (A7) ---------------------------
    # Bay spacing and chained positional tolerance genuinely vary with stud
    # count. Bow/crook/twist do NOT change with stud count (they are
    # per-member material properties) - previously shown here as flat
    # reference lines, now removed per request; see warping_flatness_check
    # below instead, which is a more meaningful place for that data.
    count_range = list(range(2, 13))
    bay_spacing_cm = [round(L / (c - 1), 3) for c in count_range]
    chained_at_last_stud_mm = [round(datum_align_mm * c, 3) for c in count_range]

    stud_count_sensitivity = {
        "stud_counts": count_range,
        "bay_spacing_cm": bay_spacing_cm,
        "chained_tolerance_at_last_stud_mm": chained_at_last_stud_mm,
        "current_stud_count": stud_count,
    }

    # --- warping vs. flatness check (A8) --------------------------------
    # Both EN 336/DIN 4074 (bow/twist) and DIN EN 14080 (longitudinal
    # warping) define their limits "relative to a measurement length of
    # 2000mm" per the source footnotes - i.e. the 4/8/12mm figures are
    # specifically "how much curve is allowed over a 2m span", not an
    # absolute limit independent of scale. DIN 18202's flatness table is
    # ALSO defined by "distance between measuring points" - and 2m falls
    # within its own banded distances. Comparing bow (and crook, for any
    # material whose source data defines one) against the flatness limit
    # AT THE SAME 2m reference distance avoids having to guess how they'd
    # rescale for a stud whose actual height differs from 2m - both
    # figures are compared at the distance each was actually defined at,
    # rather than forcing one to reinterpret the other's basis.
    REFERENCE_DISTANCE_M = 2.0
    flatness_context = config.get("flatness_context", "unfinished_wall")
    flatness_limit_mm, flatness_label = lookup_din18202_flatness(din, flatness_context, REFERENCE_DISTANCE_M)

    kvh_grade = config.get("kvh_grade")
    bow_mm, bow_note = get_warping_mm(materials, material, class_key, "bow_mm", kvh_grade)
    crook_mm, crook_note = get_warping_mm(materials, material, class_key, "crook_mm", kvh_grade)

    if bow_mm is None:
        warnings.append(f"Bow vs. flatness check skipped: {bow_note}")

    warping_flatness_check = {
        "reference_distance_m": REFERENCE_DISTANCE_M,
        "flatness_context": flatness_context,
        "flatness_label": flatness_label,
        "flatness_limit_mm": flatness_limit_mm,
        "bow_mm": bow_mm,
        "bow_pass": (bow_mm <= flatness_limit_mm) if bow_mm is not None else None,
        "crook_mm": crook_mm,
        "crook_pass": (crook_mm <= flatness_limit_mm) if crook_mm is not None else None,
        "scope_note": (
            "This check is valid only for a 2m span within the stud - the distance bow "
            "(DIN 4074-1 clause 5.7.2 and DIN EN 14080, within the ceilings of EN 14081-1 "
            "Table A.2) and this flatness limit (DIN 18202) are actually defined at. It is "
            "NOT the stud's full-height deflection if the wall height differs from 2m: "
            "EN 14081-1 (Table A.2, note a) allows pro-rata adjustment to other lengths, "
            "which this tool does not apply - the 2000mm figures are used as-is "
            "regardless of actual stud height. Twist is not checked here. The flatness "
            "limit shown is linearly interpolated between DIN 18202's tabulated 1m and 4m "
            "columns (per its own footnote: intermediate values come from a published "
            "curve, not a step function) - an explicit approximation of that curve using "
            "only the source's actual data points, not a digitization of the curve "
            "itself."
        ),
    }

    return {
        "config": {
            "wall_length_cm": L, "wall_height_cm": H,
            "framing_material": material, "kvh_class": kvh_class, "kvh_grade": kvh_grade,
            "stud_width_mm": stud_w, "stud_depth_mm": stud_d,
            "beam_width_mm": beam_w, "beam_depth_mm": beam_d,
            "stud_count": stud_count, "flatness_context": flatness_context,
        },
        "geometry": {
            "studs": studs, "beams": beams, "corners": corners,
            "wall_length_cm": L, "wall_height_cm": H,
            "wall_depth_cm": max(stud_d, beam_d) / 10.0,
        },
        "tolerances": tolerances,
        "warping_flatness_check": warping_flatness_check,
        "charts": {
            "deviation_budget": deviation_budget,
            "permitted_vs_size": permitted_vs_size,
            "stud_accumulation": stud_accumulation,
            "stud_count_sensitivity": stud_count_sensitivity,
        },
        "warnings": warnings,
    }
