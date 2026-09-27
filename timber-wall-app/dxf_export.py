"""
dxf_export.py
--------------
Hand-written minimal DXF (R12 ASCII format) export - deliberately not
using a library like ezdxf, so the app keeps its one dependency (Flask)
rather than asking users to install anything extra. DXF's LINE-entity
format is simple and well-documented enough to write directly; this
covers exactly what this app needs (rectangular member outlines, on
named layers) and nothing more.

Units: DXF has no inherent unit; we write coordinates in millimeters
(scene's cm x 10) since mm is the more common default for structural/
architectural DXF templates opened in a fresh AutoCAD/LibreCAD session.
"""


def _rect_lines(x_cm, y_cm, w_cm, h_cm, layer):
    """Returns 4 LINE entities (as DXF text) forming a rectangle outline,
    given its bottom-left corner and size, all in cm - converted to mm."""
    x0, y0 = x_cm * 10, y_cm * 10
    x1, y1 = (x_cm + w_cm) * 10, (y_cm + h_cm) * 10
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    lines = []
    for i in range(4):
        xa, ya = corners[i]
        xb, yb = corners[(i + 1) % 4]
        lines.append(_line_entity(xa, ya, xb, yb, layer))
    return "".join(lines)


def _line_entity(x1, y1, x2, y2, layer):
    return (
        "0\nLINE\n"
        f"8\n{layer}\n"
        f"10\n{x1:.2f}\n20\n{y1:.2f}\n30\n0.0\n"
        f"11\n{x2:.2f}\n21\n{y2:.2f}\n31\n0.0\n"
    )


def _text_entity(x_cm, y_cm, height_cm, text, layer):
    x_mm, y_mm, h_mm = x_cm * 10, y_cm * 10, height_cm * 10
    safe_text = text.replace("\n", " ")
    return (
        "0\nTEXT\n"
        f"8\n{layer}\n"
        f"10\n{x_mm:.2f}\n20\n{y_mm:.2f}\n30\n0.0\n"
        f"40\n{h_mm:.2f}\n"
        f"1\n{safe_text}\n"
    )


DXF_HEADER = (
    "0\nSECTION\n2\nHEADER\n0\nENDSEC\n"
    "0\nSECTION\n2\nTABLES\n0\nENDSEC\n"
    "0\nSECTION\n2\nBLOCKS\n0\nENDSEC\n"
    "0\nSECTION\n2\nENTITIES\n"
)
DXF_FOOTER = "0\nENDSEC\n0\nEOF\n"


def generate_frame_dxf(frame_result, opening_result=None):
    """Returns DXF file content (str) for the frame elevation, plus
    opening framing (jack/king studs, header, sill, opening outline) if
    opening_result is provided (from Step D)."""
    geo = frame_result["geometry"]
    body = []
    has_openings = opening_result and not opening_result.get("error")

    # When opening data is present, draw studs from the opening result's
    # post-removal list ONLY - not frame_result's own unmodified stud list
    # too, which would duplicate every surviving stud and even redraw the
    # one(s) an opening actually removed.
    studs_to_draw = opening_result["geometry"]["remaining_original_studs"] if has_openings else geo["studs"]
    for s in studs_to_draw:
        body.append(_rect_lines(s["x_cm"] - s["width_cm"] / 2, s["y_cm"], s["width_cm"], s["height_cm"], "STUDS"))
    for b in geo["beams"]:
        body.append(_rect_lines(b["x_cm"], b["y_cm"], b["width_cm"], b["height_cm"], "BEAMS"))

    # overall wall outline, its own layer, for a clean reference boundary
    L, H = geo["wall_length_cm"], geo["wall_height_cm"]
    body.append(_rect_lines(0, 0, L, H, "WALL_OUTLINE"))
    body.append(_text_entity(0, H + max(L, H) * 0.03, max(L, H) * 0.025,
                              f"WALL {L/100:.2f}m x {H/100:.2f}m", "TEXT"))

    if has_openings:
        ogeo = opening_result["geometry"]
        for m in ogeo["new_members"]:
            layer = "JACK_KING_STUDS" if m["role"] in ("jack_stud", "king_stud") else "HEADER_SILL"
            # jack/king studs store x_cm as centerline (see opening3d.js's
            # rendering note); header/sill store it as left edge
            x_left = (m["x_cm"] - m["width_cm"] / 2) if m["role"] in ("jack_stud", "king_stud") else m["x_cm"]
            body.append(_rect_lines(x_left, m["y_cm"], m["width_cm"], m["height_cm"], layer))
        for o in opening_result["openings"]:
            x0, y0 = o["x_position_cm"], o["sill_height_cm"]
            body.append(_rect_lines(x0, y0, o["width_cm"], o["height_cm"], "OPENING_OUTLINE"))
            body.append(_text_entity(x0, y0 + o["height_cm"] + max(L, H) * 0.015, max(L, H) * 0.018,
                                      f"{o['type'].upper()} {o['width_cm']/100:.2f}x{o['height_cm']/100:.2f}m", "TEXT"))

    return DXF_HEADER + "".join(body) + DXF_FOOTER
