"""
emf_export.py
--------------
Hand-written EMF (Enhanced Metafile, Microsoft's binary vector format used
throughout Word/PowerPoint/Excel) writer, built directly from the public
MS-EMF specification's record structures - no external library or
converter tool (LibreOffice/Inkscape) required, for exactly the same
reason dxf_export.py hand-writes DXF: keeping the app's only real
dependency as Flask, not asking the user to install anything else.

This module doesn't do general SVG parsing - it specifically understands
the SVG structure svg_export.js produces (plain fill/stroke attributes,
no CSS style shorthand - see that file's own compatibility fix), and
converts each element it recognises into the matching EMF record:
  <path fill="rgb(...)">   -> a filled polygon (EMR_POLYGON), no pen
  <path stroke="rgb(...)"> -> an open polyline (EMR_POLYLINE), dashed
                               if stroke-dasharray is present
  <rect ...>                -> a filled polygon (its 4 corners)
  <text ...>                -> real vector text (EMR_EXTTEXTOUTW)

Verified against a real renderer (LibreOffice, used here only as a QA
tool during development, not a runtime dependency) by actually
converting output files back to PNG and inspecting them.
"""
import re
import struct

# --- stock object handle for "no pen" (NULL_PEN), per MS-WMF/EMF spec ---
STOCK_OBJECT_FLAG = 0x80000000
NULL_PEN = STOCK_OBJECT_FLAG | 8

EMR_HEADER = 1
EMR_POLYGON = 3
EMR_POLYLINE = 4
EMR_EOF = 14
EMR_SETTEXTCOLOR = 24
EMR_SETBKMODE = 18
EMR_SELECTOBJECT = 37
EMR_DELETEOBJECT = 40
EMR_EXTCREATEPEN = 95
EMR_CREATEBRUSHINDIRECT = 39
EMR_EXTTEXTOUTW = 84
EMR_CREATEFONTINDIRECTW = 82
EMR_SETTEXTALIGN = 22

TA_CENTER = 6
TA_TOP = 0
TRANSPARENT_BKMODE = 1

PS_SOLID = 0
PS_DASH = 1
PS_GEOMETRIC = 0x00010000
BS_SOLID = 0


def _rgb_to_colorref(r, g, b):
    """COLORREF is 0x00BBGGRR - the reverse byte order from usual RGB."""
    return (b << 16) | (g << 8) | r


class EMFWriter:
    def __init__(self, width, height):
        self.width = width
        self.height = height
        self.records = bytearray()
        self.next_handle = 1
        self.n_records = 0  # header + EOF added at finalize()
        # Start with NO bounds at all (not 0..width/0..height!) - treating
        # the canvas size as an initial data point was the actual bug:
        # found by tracing a specific negative-coordinate label that went
        # completely invisible while everything else looked merely
        # squashed. With min/max starting at the canvas size, any content
        # sitting entirely in negative space never pulled max_x/max_y down
        # from their positive defaults, so the declared frame ended up
        # wildly larger than the real content - which corrupts the
        # scale/position every renderer derives from rclFrame vs rclBounds.
        self.min_x, self.min_y = float("inf"), float("inf")
        self.max_x, self.max_y = float("-inf"), float("-inf")
        self._current_pen_is_null = False

    def _track_bounds(self, points):
        for x, y in points:
            self.min_x = min(self.min_x, x)
            self.min_y = min(self.min_y, y)
            self.max_x = max(self.max_x, x)
            self.max_y = max(self.max_y, y)

    def _add_record(self, rec_bytes):
        self.records += rec_bytes
        self.n_records += 1

    def _create_brush(self, rgb):
        handle = self.next_handle
        self.next_handle += 1
        colorref = _rgb_to_colorref(*rgb)
        rec = struct.pack("<IIIIII", EMR_CREATEBRUSHINDIRECT, 24, handle, 0, colorref, 0)
        self._add_record(rec)
        return handle

    def _create_pen(self, rgb, width_px=1, dashed=False):
        # EMR_CREATEPEN only creates a "cosmetic" pen, which per the GDI
        # spec is ALWAYS exactly 1 physical pixel wide no matter what width
        # is declared - the width field is silently ignored. Found by
        # rendering a real file with 1px/2px/8px pens side by side and
        # seeing all three come out identically thin and pale (thin lines
        # anti-alias lighter than their true color). EMR_EXTCREATEPEN with
        # the PS_GEOMETRIC flag is the actual GDI mechanism for a pen whose
        # width participates in scaling like everything else - this is
        # what the tolerance overlay lines need to render as bold and
        # correctly colored as they do in the SVG/on-screen versions.
        handle = self.next_handle
        self.next_handle += 1
        colorref = _rgb_to_colorref(*rgb)
        style = PS_GEOMETRIC | (PS_DASH if dashed else PS_SOLID)
        width = max(1, round(width_px))
        elp = struct.pack("<IIIIII", style, width, BS_SOLID, colorref, 0, 0)  # elpNumEntries=0
        body = struct.pack("<IIIII", handle, 0, 0, 0, 0) + elp  # ihPen, offBmi, cbBmi, offBits, cbBits
        n_size = 8 + len(body)
        rec = struct.pack("<II", EMR_EXTCREATEPEN, n_size) + body
        self._add_record(rec)
        return handle

    def _select_object(self, handle):
        rec = struct.pack("<III", EMR_SELECTOBJECT, 12, handle & 0xFFFFFFFF)
        self._add_record(rec)

    def _delete_object(self, handle):
        # Every CREATE* record above needs a matching DELETEOBJECT once the
        # object is no longer in use - the actual root cause of exports
        # that rendered correctly sometimes and not other times (traced by
        # finding two byte-IDENTICAL files render differently between
        # runs): with a brush or font created for nearly every shape and
        # NONE ever deleted, a real chrome capture (dozens of rects/labels)
        # plus the wood geometry accumulates enough undeleted GDI handles
        # that resource-limited renderers start failing unpredictably.
        # Real EMF writers always clean up; this was a genuine spec gap,
        # not a rendering quirk to work around.
        rec = struct.pack("<III", EMR_DELETEOBJECT, 12, handle & 0xFFFFFFFF)
        self._add_record(rec)

    def add_polygon(self, points, fill_rgb):
        """A filled shape with no visible border - matches how the wood
        meshes/label backgrounds are drawn in the SVG (fill only)."""
        if len(points) < 3:
            return
        if not self._current_pen_is_null:
            self._select_object(NULL_PEN)
            self._current_pen_is_null = True
        brush = self._create_brush(fill_rgb)
        self._select_object(brush)

        pts = [(round(x), round(y)) for x, y in points]
        self._track_bounds(pts)
        bx0 = min(p[0] for p in pts)
        by0 = min(p[1] for p in pts)
        bx1 = max(p[0] for p in pts)
        by1 = max(p[1] for p in pts)

        body = struct.pack("<iiii", bx0, by0, bx1, by1)
        body += struct.pack("<I", len(pts))
        for x, y in pts:
            body += struct.pack("<ii", x, y)
        n_size = 4 + 4 + 16 + 4 + 8 * len(pts)
        rec = struct.pack("<II", EMR_POLYGON, n_size) + body
        self._add_record(rec)
        self._delete_object(brush)

    def add_polyline(self, points, stroke_rgb, width_px=1.5, dashed=False):
        """An open, unfilled line - the tolerance overlay lines."""
        if len(points) < 2:
            return
        pen = self._create_pen(stroke_rgb, width_px, dashed)
        self._select_object(pen)
        self._current_pen_is_null = False

        pts = [(round(x), round(y)) for x, y in points]
        self._track_bounds(pts)
        bx0 = min(p[0] for p in pts)
        by0 = min(p[1] for p in pts)
        bx1 = max(p[0] for p in pts)
        by1 = max(p[1] for p in pts)

        body = struct.pack("<iiii", bx0, by0, bx1, by1)
        body += struct.pack("<I", len(pts))
        for x, y in pts:
            body += struct.pack("<ii", x, y)
        n_size = 4 + 4 + 16 + 4 + 8 * len(pts)
        rec = struct.pack("<II", EMR_POLYLINE, n_size) + body
        self._add_record(rec)
        self._delete_object(pen)

    def add_text(self, x, y, text, rgb, font_size_px=15, bold=True, align="left"):
        x, y = round(x), round(y)
        # Track the text's full estimated extent, not just its anchor
        # point - found by rendering a real longer label ("OVERALL: EXCEEDS
        # DIN 18202 (RSS)") and seeing it clipped on the left. With
        # center alignment, roughly half the string's width sits to the
        # LEFT of x; only tracking the anchor point never accounted for
        # that, so the declared canvas bounds ended up too tight whenever
        # a label was long enough for the gap to matter.
        est_width = len(text) * font_size_px * 0.56
        # A margin ON TOP of the estimate above, for bounds-tracking only -
        # found by rendering a real long, capital-heavy label ("OVERALL:
        # EXCEEDS DIN 18202...") and seeing its first character clipped:
        # the flat average-character-width estimate above is close enough
        # for sizing the label's background rect, but real Arial capitals
        # (particularly a run of them like "EXCEEDS") render measurably
        # wider than that average, so bounds computed from the same
        # estimate leave zero margin for the real font metrics to exceed
        # it. This only widens what gets tracked as the canvas's extent -
        # it doesn't change the rect drawn behind the text.
        bounds_margin = est_width * 0.2 + 10
        # Vertical bounds were previously tracked as a single point (just
        # y), which is what actually let the topmost label on a page get
        # its top sliced off - the glyphs extend both above and below y
        # (center-anchored, see the alignment note below), and nothing
        # accounted for that upward extent when computing the canvas's
        # overall bounds. font_size_px*0.75 is a generous approximation of
        # cap-height-plus-margin above and below the center line.
        v_margin = font_size_px * 0.75
        if align == "center":
            self._track_bounds([(x - est_width / 2 - bounds_margin, y - v_margin), (x + est_width / 2 + bounds_margin, y + v_margin)])
        else:
            self._track_bounds([(x - bounds_margin, y - v_margin), (x + est_width + bounds_margin, y + v_margin)])

        # EMR_CREATEFONTINDIRECTW (a fixed-size LOGFONTW record, 92 bytes
        # of struct + a 64-WCHAR face-name field padded/truncated to fit)
        font_handle = self.next_handle
        self.next_handle += 1
        face_name = "Arial"
        face_utf16 = face_name.encode("utf-16-le")
        # LOGFONTW.lfFaceName is WCHAR[LF_FACESIZE], LF_FACESIZE=32 - a
        # fixed, standard Windows constant (making the full LOGFONTW
        # struct exactly 92 bytes). An earlier version of this used 64
        # WCHARs (128 bytes), doubling the field's correct size - LibreOffice's
        # lenient EMF parser tolerated this fine (it navigates by each
        # record's declared nSize, not a fixed expected size per record
        # type), but a stricter parser validating CREATEFONTINDIRECTW's
        # size against the standard could reject the whole file outright -
        # a very plausible explanation for files that "come out empty"
        # somewhere other than the one tool used to verify them here.
        face_utf16 = face_utf16[:31 * 2] + b"\x00" * (32 * 2 - len(face_utf16[:31 * 2]))
        weight = 700 if bold else 400
        logfont = struct.pack(
            "<iiiiiBBBBBBBB",
            -round(font_size_px), 0, 0, 0, weight,
            0, 0, 0, 0, 0, 0, 0, 0,
        )
        logfont += face_utf16
        rec = struct.pack("<III", EMR_CREATEFONTINDIRECTW, 12 + len(logfont), font_handle) + logfont
        self._add_record(rec)
        self._select_object(font_handle)

        colorref = _rgb_to_colorref(*rgb)
        rec = struct.pack("<III", EMR_SETTEXTCOLOR, 12, colorref)
        self._add_record(rec)

        # GDI defaults to OPAQUE background mode for text, which paints a
        # solid rectangle (in the current background color, white by
        # default) behind every glyph BEFORE drawing it - normally
        # invisible against a white page, but for light-colored text on a
        # colored/dark background (e.g. white text on a button) that
        # opaque white box completely covers the glyph, rendering it
        # invisible. Caught with an isolated white-text-on-dark-rect test
        # after white button labels went missing in a real combined
        # export. TRANSPARENT background mode draws just the glyph.
        rec = struct.pack("<III", EMR_SETBKMODE, 12, TRANSPARENT_BKMODE)
        self._add_record(rec)

        # GDI's default text anchor is the string's TOP-LEFT corner. The
        # 3D-view labels (from SVGRenderer's text-anchor="middle") need
        # CENTER alignment to land correctly - but DOM-captured text (a
        # form label, a table cell) is naturally LEFT-aligned from its own
        # element's left edge, and forcing center alignment there shifts
        # every line left by about half its own width, clipping its start
        # off the page - caught by actually rendering a combined export
        # and seeing every label missing its first few characters.
        #
        # Vertically, the source SVG anchors every one of these labels with
        # dominant-baseline="middle" (y is the vertical CENTER of the
        # glyphs), but this used TA_BASELINE (y is the BASELINE) - a
        # systematic mismatch that shifts EMF text measurably higher than
        # its SVG counterpart. Caught by a direct SVG-vs-EMF comparison at
        # high resolution: the topmost label ("Length...") had its very top
        # sliced off by the canvas edge, because bounds-tracking assumed
        # center anchoring while the actual draw call didn't use it. Fixed
        # by using TA_TOP and shifting the drawn y up by half the font size
        # first, which approximates a center anchor closely enough for a
        # single line of UI-label text (no exact font-metrics table is
        # available to do this precisely, and this is a vector EMF acting
        # as a drop-in replacement for the SVG's own approximate visual
        # position, not a typesetting-grade layout engine).
        align_flag = TA_CENTER if align == "center" else 0
        rec = struct.pack("<III", EMR_SETTEXTALIGN, 12, align_flag | TA_TOP)
        self._add_record(rec)
        draw_y = y - round(font_size_px * 0.5)

        text_utf16 = text.encode("utf-16-le")
        n_chars = len(text)
        str_padded_len = (len(text_utf16) + 3) // 4 * 4

        # Fixed EMR_EXTTEXTOUTW layout (all offsets from record start):
        #   0  iType, nSize            (8)
        #   8  rclBounds               (16)  -> ends at 24
        #  24  iGraphicsMode           (4)   -> ends at 28
        #  28  exScale                 (4)   -> ends at 32
        #  32  eyScale                 (4)   -> ends at 36
        #  36  emrtext.ptlReference    (8)   -> ends at 44
        #  44  emrtext.nChars          (4)   -> ends at 48
        #  48  emrtext.offString       (4)   -> ends at 52
        #  52  emrtext.fOptions        (4)   -> ends at 56
        #  56  emrtext.rcl             (16)  -> ends at 72
        #  72  emrtext.offDx           (4)   -> ends at 76
        #  76  string data starts here
        off_string = 76

        # rclBounds is only advisory here (fOptions below has no
        # ETO_CLIPPED flag set, so per spec this should never actually
        # clip anything) - but a fixed +-200px box was too narrow for
        # many of this app's real labels ("Height 2.80 m (+-16.0 mm WC /
        # +-16.0 mm RSS)" easily exceeds 400px total width at normal font
        # sizes), and PowerPoint's own EMF import was confirmed (via a
        # real screenshot showing labels cut off mid-string once pasted
        # in) to clip text against this box regardless of the flag -
        # sizing it generously from the actual text length, not a
        # constant, fixes real, reproduced clipping rather than a
        # hypothetical one.
        half_w = max(200, len(text) * font_size_px * 0.7)
        half_h = max(20, font_size_px * 1.5)
        body = struct.pack("<iiii", round(x - half_w), round(draw_y - half_h), round(x + half_w), round(draw_y + half_h))
        body += struct.pack("<i", 1)  # iGraphicsMode = GM_COMPATIBLE
        body += struct.pack("<ff", 1.0, 1.0)  # exScale, eyScale
        body += struct.pack("<ii", x, draw_y)  # ptlReference
        body += struct.pack("<I", n_chars)
        body += struct.pack("<I", off_string)
        body += struct.pack("<I", 0)  # fOptions
        body += struct.pack("<iiii", 0, 0, 0, 0)  # rcl (unused, fOptions has no clip/opaque flag)
        body += struct.pack("<I", 0)  # offDx = 0 -> renderer uses the font's own advance widths
        body += text_utf16
        body += b"\x00" * (str_padded_len - len(text_utf16))

        n_size = 8 + len(body)
        rec = struct.pack("<II", EMR_EXTTEXTOUTW, n_size) + body
        self._add_record(rec)
        self._delete_object(font_handle)

    def finalize(self):
        n_records_total = self.n_records + 2  # + header + EOF
        eof_rec = struct.pack("<IIIII", EMR_EOF, 20, 0, 0, 20)
        body = self.records + eof_rec
        total_size = 88 + len(body)

        if self.min_x == float("inf"):
            # nothing was ever drawn - fall back to the canvas size rather
            # than writing an infinite/NaN bound
            self.min_x, self.min_y, self.max_x, self.max_y = 0, 0, self.width, self.height

        px_to_01mm = 26.4583 / 96.0 * 100  # ~96 DPI reference -> 0.01mm units
        frame = (
            round(self.min_x * px_to_01mm), round(self.min_y * px_to_01mm),
            round(self.max_x * px_to_01mm), round(self.max_y * px_to_01mm),
        )

        # szlDevice/szlMillimeters must be derived from the SAME actual
        # tracked content extent as rclBounds/rclFrame above - NOT from
        # the declared canvas width/height passed to the constructor.
        # Those can legitimately differ: a section's CSS width (used as
        # its declared canvas size) often exceeds where its actual VISIBLE
        # content ends (e.g. a full-width header with no full-width
        # background fill, so only its left-aligned text gets drawn) -
        # any such gap between "declared" and "actually drawn" reintroduces
        # the exact same declared-vs-real scale mismatch fixed earlier for
        # the single-section case, just via a different cause. Always
        # computing these from the real bounds keeps every field
        # consistent with what was actually drawn, regardless of how
        # accurately each section's declared size matched its own content.
        content_w = max(1, self.max_x - self.min_x)
        content_h = max(1, self.max_y - self.min_y)
        device_w_mm = round(content_w * 25.4 / 96.0)
        device_h_mm = round(content_h * 25.4 / 96.0)

        header = struct.pack(
            "<II4i4iIIIIHHIIIiiii",
            EMR_HEADER, 88,
            round(self.min_x), round(self.min_y), round(self.max_x), round(self.max_y),
            *frame,
            0x464D4520, 0x00010000, total_size, n_records_total,
            self.next_handle, 0,
            0, 0, 0,
            round(content_w), round(content_h), device_w_mm, device_h_mm,
        )
        return bytes(header) + bytes(body)


def _parse_subpaths_from_path_d(d):
    """Parses the specific 'M x,y L x,y L x,y z M x,y L x,y ... z' format
    SVGRenderer emits - critically, ONE <path> element can bundle MULTIPLE
    separate triangles (subpaths) that share the same fill, each starting
    with its own 'M' and ending at 'z'. Treating the whole d string as one
    flat point list (an earlier version of this function did) merges
    unrelated triangles into one warped, incorrectly-connected polygon -
    caught by actually rendering a real exported file and visually
    comparing it to the correct SVG version. Returns a list of point-lists,
    one per subpath."""
    subpaths = []
    current = []
    for cmd, x, y in re.findall(r'([ML])\s*(-?[\d.]+),\s*(-?[\d.]+)', d):
        if cmd == "M" and current:
            subpaths.append(current)
            current = []
        current.append((float(x), float(y)))
    if current:
        subpaths.append(current)
    return subpaths


def _clamp255(v):
    return max(0, min(255, int(v)))


def _parse_rgb(value):
    m = re.match(r'rgb\((-?\d+),\s*(-?\d+),\s*(-?\d+)\)', value or "")
    if not m:
        return None
    return tuple(_clamp255(v) for v in m.groups())


def draw_svg_into_writer(writer, svg_string, width, height, offset_x=0, offset_y=0, center_origin=False):
    """Draws one SVG fragment's shapes into an EXISTING EMFWriter, at a
    given placement offset within a larger combined canvas - this is what
    lets several independent sections (a form, the 3D view, a results
    table) end up correctly positioned relative to each other in ONE
    combined EMF, rather than each needing its own file.

    center_origin=True handles SVGRenderer's own coordinate convention
    (paths span -width/2..width/2, not 0..width - see svg_export.js's
    notes on this) by shifting to top-left-origin first, then applying
    the placement offset - both a plain single-section export (offset=0)
    and a combined multi-section export share this exact same path.
    """
    cx = width / 2 if center_origin else 0
    cy = height / 2 if center_origin else 0

    def tx(x):
        return x + cx + offset_x

    def ty(y):
        return y + cy + offset_y

    tag_pattern = re.compile(r'<(path|rect|text)\b([^>]*?)(/>|>(.*?)</text>)', re.DOTALL)

    def parse_attrs(attr_str):
        return dict(re.findall(r'([\w-]+)="([^"]*)"', attr_str))

    for m in tag_pattern.finditer(svg_string):
        tag = m.group(1)
        attrs = parse_attrs(m.group(2))

        if tag == "path":
            fill = attrs.get("fill")
            stroke = attrs.get("stroke")
            subpaths = _parse_subpaths_from_path_d(attrs.get("d", ""))
            if fill and fill != "none":
                rgb = _parse_rgb(fill)
                if rgb:
                    for points in subpaths:
                        if len(points) >= 3:
                            writer.add_polygon([(tx(x), ty(y)) for x, y in points], rgb)
            elif stroke and stroke != "none":
                rgb = _parse_rgb(stroke)
                dashed = "stroke-dasharray" in attrs
                width_px = float(attrs.get("stroke-width", 1.5))
                if rgb:
                    for points in subpaths:
                        if len(points) >= 2:
                            writer.add_polyline([(tx(x), ty(y)) for x, y in points], rgb, width_px, dashed)

        elif tag == "rect":
            fill = attrs.get("fill")
            if not fill or fill == "none":
                continue
            rgb = _parse_rgb(fill)
            if not rgb:
                continue
            x = float(attrs.get("x", 0))
            y = float(attrs.get("y", 0))
            w = float(attrs.get("width", 0))
            h = float(attrs.get("height", 0))
            writer.add_polygon([(tx(x), ty(y)), (tx(x + w), ty(y)), (tx(x + w), ty(y + h)), (tx(x), ty(y + h))], rgb)

        elif tag == "text":
            fill = attrs.get("fill", "#000000")
            rgb = _parse_rgb(fill)
            if rgb is None:
                hexval = fill.lstrip("#")
                if len(hexval) == 6:
                    rgb = tuple(int(hexval[i:i + 2], 16) for i in (0, 2, 4))
                else:
                    rgb = (0, 0, 0)
            x = float(attrs.get("x", 0))
            y = float(attrs.get("y", 0))
            font_size = float(attrs.get("font-size", 15))
            text_content = m.group(4) or ""
            writer.add_text(tx(x), ty(y), text_content, rgb, font_size, bold=True, align="center")


def svg_to_emf(svg_string, width, height):
    """Single-section convenience wrapper (still used by the plain,
    per-section 'Download EMF' buttons) - draws one SVG fragment centered
    at the origin, exactly as SVGRenderer produced it, into a fresh file."""
    writer = EMFWriter(width, height)
    draw_svg_into_writer(writer, svg_string, width, height, center_origin=True)
    return writer.finalize()
