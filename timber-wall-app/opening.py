"""
opening.py
----------
Step D: window/door openings cut into the Step A frame, with rough-opening
dimensional tolerance checked against DIN 18202's Table 1 "Openings" rows
(previously in din18202.json but never wired into any calculation).

This module is ADDITIVE, not a modification of geometry.build_frame(): it
takes Step A's already-computed frame_result and overlays opening framing
on top of it. Steps A/B/C's own routes, geometry, and results are
completely untouched by this module - reusing the "don't damage what we
already have" approach already established for the 3D view-mode work.

Modeling assumptions (continuing A/B/C's lettered numbering as D1, D2...):

  D1. JACK STUDS + KING STUDS, NO CRIPPLES (yet). Each opening gets a jack
      stud (supports the header, height = opening top down to the bottom
      plate) immediately flanking each side, and a king stud (full wall
      height) immediately outside that. Cripple studs (short studs above
      the header and, for windows, below the sill) are NOT modeled in
      this version - they don't affect the opening's own tolerance check,
      only the load path above/below it, so they're deferred rather than
      guessed at. Flagged explicitly, not silently omitted.
  D2. JACK/KING STUD cross-sections reuse the frame's own stud_width_mm/
      stud_depth_mm. HEADER/SILL reuse stud_depth_mm for their front-to-
      back depth (so they sit flush with the jack/king stud faces) and
      beam_depth_mm for their vertical thickness - Step A's config has no
      separate "header size" input, so reusing existing, already-input
      dimensions is the honest default rather than inventing a new,
      unvalidated number. Header/sill span ONLY the clear opening width,
      fitted INTERNAL to (flush between) the jack studs, rather than
      resting on top and spanning out to the king studs - a valid
      alternative real framing convention, chosen here to keep the
      header/sill entirely within the jack-stud span with no edge ever
      touching the king studs at all.
  D3. ORIGINAL STUDS INSIDE THE OPENING SPAN ARE REMOVED (replaced by the
      opening's own jack/king studs). An opening cannot be placed so that
      its span would remove an ORIGINAL end stud (the wall's outer studs)
      - that's rejected as invalid input, not silently allowed.
  D4. ROUGH-OPENING TOLERANCE combines the SAME datum-referenced DIN 18202
      alignment figure Step A/B already use for stud/joint positional
      tolerance - applied here to the jack studs (for width) and to the
      header/sill (for height) - via worst-case and RSS, exactly
      mirroring Step A's squareness methodology. This is compared against
      DIN 18202 Table 1's "Openings" row, or "Openings with finished-
      surface jambs" if the user selects that (tighter) option - both are
      genuine DIN 18202 rows that existed in the dataset but were never
      previously used anywhere in this app.
  D5. OPENINGS MAY NOT OVERLAP each other (including their jack/king stud
      framing footprint, not just the clear opening itself), and must fit
      within the wall with room for that framing on each side - validated,
      not just assumed.
"""
import math
from geometry import lookup_din18202_alignment, lookup_din18202_linear


def _validate_openings(openings, wall_length_cm, wall_height_cm, stud_width_mm):
    """Returns a list of error strings (empty = all valid)."""
    errors = []
    stud_w_cm = stud_width_mm / 10.0
    # Framing footprint now extends stud_w_cm*2 beyond each side of the
    # clear opening (jack stud + king stud), not just half a stud width -
    # see the corrected convention in build_openings.
    margin = stud_w_cm * 2
    spans = []
    for i, o in enumerate(openings):
        label = f"Opening {i + 1}"
        x0 = o["x_position_cm"]
        w = o["width_cm"]
        h = o["height_cm"]
        sill = 0.0 if o["type"] == "door" else o.get("sill_height_cm", 90.0)
        x1 = x0 + w
        top = sill + h
        if x0 - margin < 0:
            errors.append(f"{label}: too close to the wall's left end - needs room for jack + king studs outside the opening.")
        if x1 + margin > wall_length_cm:
            errors.append(f"{label}: too close to the wall's right end - needs room for jack + king studs outside the opening.")
        if top > wall_height_cm:
            errors.append(f"{label}: opening top ({top:.1f}cm) exceeds the wall height ({wall_height_cm:.1f}cm).")
        if w <= 0 or h <= 0:
            errors.append(f"{label}: width and height must both be positive.")
        spans.append((x0 - margin, x1 + margin, label))
    spans.sort()
    for i in range(len(spans) - 1):
        if spans[i][1] > spans[i + 1][0]:
            errors.append(f"{spans[i][2]} and {spans[i + 1][2]} overlap - openings' jack/king stud framing would collide.")
    return errors


def build_openings(config, materials, din, frame_result):
    """
    config: {
      "openings": [
        {"type": "window"|"door", "width_cm": float, "height_cm": float,
         "sill_height_cm": float (windows only, ignored for doors),
         "x_position_cm": float (left edge of rough opening from wall start)},
        ...
      ],
      "finished_jambs": bool,
    }
    frame_result: Step A's build_frame() output for the same wall.
    """
    warnings = []
    geo = frame_result["geometry"]
    L = geo["wall_length_cm"]
    H = geo["wall_height_cm"]
    D = geo["wall_depth_cm"]
    stud_w = frame_result["config"]["stud_width_mm"]
    stud_d = frame_result["config"]["stud_depth_mm"]
    beam_w = frame_result["config"]["beam_width_mm"]
    beam_d = frame_result["config"]["beam_depth_mm"]
    finished_jambs = bool(config.get("finished_jambs", False))
    row_key = "openings_finished_jambs" if finished_jambs else "openings"

    openings_in = config.get("openings", [])
    if not openings_in:
        return {"error": "Add at least one opening to analyse."}

    errors = _validate_openings(openings_in, L, H, stud_w)
    if errors:
        return {"error": " / ".join(errors)}

    half_stud_cm = (stud_w / 10.0) / 2.0
    beam_d_cm = beam_d / 10.0
    stud_d_cm = stud_d / 10.0
    datum_align_mm = lookup_din18202_alignment(din, H / 100.0)

    # start from Step A's original studs, then remove any that fall inside
    # an opening span (D3) and add this step's own framing members
    original_studs = [s for s in geo["studs"]]
    opening_results = []
    new_members = []  # jack/king studs + header/sill, for 3D rendering

    for i, o in enumerate(openings_in):
        otype = o["type"]
        w_cm = float(o["width_cm"])
        h_cm = float(o["height_cm"])
        sill_cm = 0.0 if otype == "door" else float(o.get("sill_height_cm", 90.0))
        x0 = float(o["x_position_cm"])
        x1 = x0 + w_cm
        top_cm = sill_cm + h_cm

        # (x0, x1) is the CLEAR/ROUGH OPENING - the actual hole in the wall
        # where a window or door unit installs, matching how "width"/
        # "height" are checked against DIN 18202's opening rows below and
        # how the overlay outline is drawn. Jack studs sit OUTSIDE this
        # boundary (their inner faces flush with x0/x1), king studs
        # outside the jack studs, and the header/sill span between the
        # jack studs' OUTER faces (resting on top of them) - not the
        # other way around. Getting this backwards was the previous bug:
        # it made the header/overlay line match one boundary while the
        # actual clear opening between jack-stud faces ended up narrower,
        # visibly offset from the outline by about a stud-width.
        jack_x0 = x0 - half_stud_cm         # left jack stud centerline (inner face at x0)
        jack_x1 = x1 + half_stud_cm         # right jack stud centerline (inner face at x1)
        king_x0 = jack_x0 - stud_w / 10.0   # immediately outside the left jack stud
        king_x1 = jack_x1 + stud_w / 10.0   # immediately outside the right jack stud

        # remove original studs that fall anywhere within the new framing's
        # full footprint (king-stud outer face to king-stud outer face) -
        # not just the clear-opening span, since jack/king studs now sit
        # outside that span rather than within it
        removal_x0 = king_x0 - half_stud_cm
        removal_x1 = king_x1 + half_stud_cm
        original_studs = [s for s in original_studs if not (removal_x0 < s["x_cm"] < removal_x1)]

        header_bottom_cm = top_cm
        # Jack/king studs fit BETWEEN the top/bottom beams, matching the
        # original frame studs' own convention (geometry.build_frame) -
        # NOT spanning the full raw wall height from y=0, which would
        # overlap the beams and cause visible z-fighting where they cross.
        new_members.append({"role": "jack_stud", "x_cm": jack_x0, "y_cm": beam_d_cm, "height_cm": header_bottom_cm - beam_d_cm, "width_cm": stud_w / 10.0, "depth_cm": stud_d_cm})
        new_members.append({"role": "jack_stud", "x_cm": jack_x1, "y_cm": beam_d_cm, "height_cm": header_bottom_cm - beam_d_cm, "width_cm": stud_w / 10.0, "depth_cm": stud_d_cm})
        new_members.append({"role": "king_stud", "x_cm": king_x0, "y_cm": beam_d_cm, "height_cm": H - 2 * beam_d_cm, "width_cm": stud_w / 10.0, "depth_cm": stud_d_cm})
        new_members.append({"role": "king_stud", "x_cm": king_x1, "y_cm": beam_d_cm, "height_cm": H - 2 * beam_d_cm, "width_cm": stud_w / 10.0, "depth_cm": stud_d_cm})
        # Header/sill depth (front-to-back) matches the STUD depth, not the
        # beam width - so they sit flush with the jack/king stud faces
        # instead of appearing as a thin mismatched sliver. Their height
        # (vertical thickness) reuses the beam depth, same as before (D2).
        #
        # Header/sill span the CLEAR OPENING WIDTH ONLY (x0 to x1), fitted
        # INTERNAL to the jack studs - flush against their inner faces,
        # like a rung between two verticals - rather than resting on top
        # and spanning out to the king studs. Both are valid real framing
        # conventions; this one keeps the header/sill entirely within the
        # jack-stud span, with no edge ever touching the king studs at all.
        # Header's TOP (not bottom) aligns with the jack studs' top - so
        # the header sits flush with the top of the jack studs rather than
        # stacked above them starting where the jack studs end. This means
        # the header occupies the top slice of the nominal opening height,
        # not extra space added on top of it.
        new_members.append({"role": "header", "x_cm": x0, "y_cm": header_bottom_cm - beam_d_cm,
                             "width_cm": w_cm, "height_cm": beam_d_cm, "depth_cm": stud_d_cm})
        if otype == "window":
            new_members.append({"role": "sill", "x_cm": x0, "y_cm": max(beam_d_cm, sill_cm - beam_d_cm),
                                 "width_cm": w_cm, "height_cm": beam_d_cm, "depth_cm": stud_d_cm})

        # --- D4: rough-opening tolerance vs DIN 18202 -----------------------
        width_wc = datum_align_mm * 2  # both jack studs independently positioned
        width_rss = math.sqrt(datum_align_mm ** 2 + datum_align_mm ** 2)
        height_wc = datum_align_mm * 2  # header positional tolerance + sill/floor-line tolerance
        height_rss = math.sqrt(datum_align_mm ** 2 + datum_align_mm ** 2)

        width_limit_mm, width_label = lookup_din18202_linear(din, row_key, w_cm / 100.0)
        height_limit_mm, height_label = lookup_din18202_linear(din, row_key, h_cm / 100.0)

        opening_results.append({
            "index": i,
            "type": otype,
            "width_cm": w_cm,
            "height_cm": h_cm,
            "sill_height_cm": sill_cm,
            "x_position_cm": x0,
            "width_tolerance": {
                "worst_case_mm": round(width_wc, 3),
                "rss_mm": round(width_rss, 3),
                "din_limit_mm": width_limit_mm,
                "din_label": width_label,
                "pass_worst_case": width_wc <= width_limit_mm,
                "pass_rss": width_rss <= width_limit_mm,
            },
            "height_tolerance": {
                "worst_case_mm": round(height_wc, 3),
                "rss_mm": round(height_rss, 3),
                "din_limit_mm": height_limit_mm,
                "din_label": height_label,
                "pass_worst_case": height_wc <= height_limit_mm,
                "pass_rss": height_rss <= height_limit_mm,
            },
        })

    return {
        "config": {"openings": openings_in, "finished_jambs": finished_jambs},
        "geometry": {
            "wall_length_cm": L, "wall_height_cm": H, "wall_depth_cm": D,
            "remaining_original_studs": original_studs,
            "new_members": new_members,
            "beams": geo["beams"],
        },
        "openings": opening_results,
        "warnings": warnings,
        "scope_note": (
            "Cripple studs above headers / below sills are not modeled (D1) - "
            "they don't affect the rough-opening tolerance check itself. Jack/"
            "king studs and headers/sills reuse the frame's own stud and beam "
            "cross-sections (D2), since Step A has no separate header-size input."
        ),
    }
