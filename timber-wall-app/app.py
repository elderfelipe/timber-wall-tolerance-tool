import json
from pathlib import Path
from flask import Flask, jsonify, render_template, request, Response

from geometry import build_frame
from panel import build_panels
from assembly import build_assembly_check
from opening import build_openings
from provenance import compute_verification_stats, STANDARDS
from sensitivity import compute_sensitivity
from material_estimate import estimate_material
from dxf_export import generate_frame_dxf
from emf_export import svg_to_emf
from as_built import compute_as_built_check

app = Flask(__name__)

DATA_DIR = Path(__file__).parent / "data"
MATERIALS = json.loads((DATA_DIR / "materials.json").read_text())
DIN18202 = json.loads((DATA_DIR / "din18202.json").read_text())


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/step-b")
def step_b():
    return render_template("step_b.html")


@app.route("/step-c")
def step_c():
    return render_template("step_c.html")


@app.route("/step-d")
def step_d():
    return render_template("step_d.html")


@app.route("/step-e")
def step_e():
    return render_template("step_e.html")


@app.route("/provenance")
def provenance_page():
    return render_template("provenance.html")


@app.route("/api/provenance")
def api_provenance():
    stats = compute_verification_stats(MATERIALS, DIN18202)
    return jsonify({"stats": stats, "standards": STANDARDS})


@app.route("/api/materials")
def api_materials():
    return jsonify(MATERIALS["framing"])


@app.route("/api/sheeting-materials")
def api_sheeting_materials():
    return jsonify(MATERIALS["sheeting"])


@app.route("/api/frame", methods=["POST"])
def api_frame():
    config = request.get_json(force=True)
    try:
        result = build_frame(config, MATERIALS, DIN18202)
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(result)


@app.route("/api/panel", methods=["POST"])
def api_panel():
    body = request.get_json(force=True)
    try:
        frame_result = build_frame(body["frame"], MATERIALS, DIN18202)
        panel_result = build_panels(body["panel"], MATERIALS, DIN18202, frame_result)
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"frame": frame_result, "panel": panel_result})


@app.route("/api/material-estimate", methods=["POST"])
def api_material_estimate():
    body = request.get_json(force=True)
    try:
        frame_result = build_frame(body["frame"], MATERIALS, DIN18202)
        panel_result = build_panels(body["panel"], MATERIALS, DIN18202, frame_result)
        estimate_config = dict(body.get("estimate", {}))
        estimate_config["wall_height_cm"] = frame_result["geometry"]["wall_height_cm"]
        estimate_result = estimate_material(panel_result, estimate_config)
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"frame": frame_result, "panel": panel_result, "estimate": estimate_result})


@app.route("/api/assembly", methods=["POST"])
def api_assembly():
    body = request.get_json(force=True)
    try:
        frame_result = build_frame(body["frame"], MATERIALS, DIN18202)
        panel_result = build_panels(body["panel"], MATERIALS, DIN18202, frame_result)
        assembly_result = build_assembly_check(body["assembly"], MATERIALS, DIN18202, frame_result, panel_result)
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"frame": frame_result, "panel": panel_result, "assembly": assembly_result})


@app.route("/api/openings", methods=["POST"])
def api_openings():
    body = request.get_json(force=True)
    try:
        frame_result = build_frame(body["frame"], MATERIALS, DIN18202)
        opening_result = build_openings(body["opening"], MATERIALS, DIN18202, frame_result)
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"frame": frame_result, "opening": opening_result})


@app.route("/api/as-built", methods=["POST"])
def api_as_built():
    body = request.get_json(force=True)
    try:
        frame_result = build_frame(body["frame"], MATERIALS, DIN18202)
        opening_result = None
        if body.get("opening", {}).get("openings"):
            opening_result = build_openings(body["opening"], MATERIALS, DIN18202, frame_result)
        as_built_result = compute_as_built_check(body["measured"], frame_result, opening_result)
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"frame": frame_result, "opening": opening_result, "as_built": as_built_result})


@app.route("/api/export-dxf/frame", methods=["POST"])
def api_export_dxf_frame():
    body = request.get_json(force=True)
    try:
        frame_result = build_frame(body["frame"], MATERIALS, DIN18202)
        dxf_text = generate_frame_dxf(frame_result)
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    return Response(dxf_text, mimetype="application/dxf",
                     headers={"Content-Disposition": "attachment; filename=frame.dxf"})


@app.route("/api/export-dxf/openings", methods=["POST"])
def api_export_dxf_openings():
    body = request.get_json(force=True)
    try:
        frame_result = build_frame(body["frame"], MATERIALS, DIN18202)
        opening_result = build_openings(body["opening"], MATERIALS, DIN18202, frame_result)
        if opening_result.get("error"):
            return jsonify({"error": opening_result["error"]}), 400
        dxf_text = generate_frame_dxf(frame_result, opening_result)
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    return Response(dxf_text, mimetype="application/dxf",
                     headers={"Content-Disposition": "attachment; filename=frame_with_openings.dxf"})


@app.route("/api/export-emf", methods=["POST"])
def api_export_emf():
    # Converts a client-built SVG string (the SAME one the "Download SVG"
    # button already produces - see svg_export.js) into EMF, the binary
    # vector format Word/PowerPoint/Excel use. Hand-written from the public
    # MS-EMF spec rather than via an external tool (LibreOffice/Inkscape),
    # so the app keeps its only real dependency as Flask - see
    # emf_export.py for the actual writer and the bugs found/fixed while
    # building it (verified by rendering real output files, not just
    # checking the binary structure was well-formed).
    body = request.get_json(force=True)
    try:
        svg_string = body["svg"]
        width = int(body["width"])
        height = int(body["height"])
        emf_bytes = svg_to_emf(svg_string, width, height)
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    return Response(emf_bytes, mimetype="image/x-emf",
                     headers={"Content-Disposition": "attachment; filename=view.emf"})


@app.route("/api/sensitivity", methods=["POST"])
def api_sensitivity():
    body = request.get_json(force=True)
    try:
        frame_result = build_frame(body["frame"], MATERIALS, DIN18202)
        panel_result = build_panels(body["panel"], MATERIALS, DIN18202, frame_result)
        assembly_result = build_assembly_check(body["assembly"], MATERIALS, DIN18202, frame_result, panel_result)
        sensitivity_result = compute_sensitivity(frame_result, panel_result, assembly_result)
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"sensitivity": sensitivity_result})


if __name__ == "__main__":
    app.run(debug=True, port=5001)
