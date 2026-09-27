/* frame3d.js
 * Renders the parametric stud/beam frame and tolerance overlay lines.
 * Scene units = cm (1 three.js unit = 1 cm), matching the app's cm inputs.
 * Text labels use Label2D (CSS2DRenderer) - see label2d.js.
 *
 * View modes: runs a perspective camera (the original, default, untouched
 * behavior) and an orthographic camera (new - true parallel-projection
 * front elevation) side by side, and simply reassigns which one
 * OrbitControls drives (controls.object) when switching - the existing
 * orbit/pan/scroll-zoom interaction is not modified, it just gets pointed
 * at a different camera on request.
 */
const Viewer3D = (function () {
  let scene, perspCamera, orthoCamera, camera, renderer, controls, frameGroup, overlayGroup;
  let container;
  let currentMode = "perspective";
  let lastWallDims = { L: 300, H: 250, D: 12 };
  let orthoViewHeightCm = 400;

  function init(containerEl) {
    container = containerEl;
    scene = new THREE.Scene();
    scene.background = null;

    const aspect = container.clientWidth / container.clientHeight;
    perspCamera = new THREE.PerspectiveCamera(40, aspect, 0.1, 5000);
    orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
    camera = perspCamera;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    container.appendChild(renderer.domElement);

    Label2D.init(container);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.addEventListener("end", saveCurrentView); // persist whenever the user finishes an orbit/pan/zoom gesture

    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambient);
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.6);
    dir1.position.set(200, 300, 400);
    scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dir2.position.set(-200, 100, -300);
    scene.add(dir2);

    frameGroup = new THREE.Group();
    overlayGroup = new THREE.Group();
    scene.add(frameGroup);
    scene.add(overlayGroup);

    window.addEventListener("resize", onResize);
    animate();
  }

  function onResize() {
    if (!container) return;
    const aspect = container.clientWidth / container.clientHeight;
    perspCamera.aspect = aspect;
    perspCamera.updateProjectionMatrix();
    updateOrthoFrustum();
    renderer.setSize(container.clientWidth, container.clientHeight);
    Label2D.resize(container.clientWidth, container.clientHeight);
  }

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    Label2D.render(scene, camera);
  }

  function clearGroup(g) {
    while (g.children.length) {
      const c = g.children[0];
      // g.remove(c), not g.children.pop() - see label2d.js integration
      // notes: CSS2DObject's DOM cleanup depends on the 'removed' event
      // that only the proper remove() method dispatches.
      g.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (c.material.map) c.material.map.dispose();
        c.material.dispose();
      }
    }
  }

  function woodBox(width, height, depth, color) {
    const geo = new THREE.BoxGeometry(Math.max(width, 0.1), Math.max(height, 0.1), Math.max(depth, 0.1));
    const mat = new THREE.MeshStandardMaterial({ color: color || 0xd9b98a, roughness: 0.75, metalness: 0.02 });
    const mesh = new THREE.Mesh(geo, mat);
    return mesh;
  }

  function overlayLine(points, color) {
    const geo = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)));
    const mat = new THREE.LineBasicMaterial({ color: color || 0xe08a2f, linewidth: 2, depthTest: false });
    const line = new THREE.Line(geo, mat);
    line.renderOrder = 998;
    return line;
  }

  function dashedLine(points, color) {
    const geo = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)));
    const mat = new THREE.LineDashedMaterial({ color: color || 0x999999, dashSize: 6, gapSize: 4, depthTest: false });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    line.renderOrder = 997;
    return line;
  }

  function fitCameraToWall(L, H, D) {
    const maxDim = Math.max(L, H) * 1.3;
    const center = new THREE.Vector3(L / 2, H / 2, 0);
    perspCamera.position.set(center.x + maxDim * 0.75, center.y + maxDim * 0.55, center.z + maxDim * 0.95);
    perspCamera.near = maxDim * 0.01;
    perspCamera.far = maxDim * 20;
    perspCamera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  }

  // --- orthographic front view -----------------------------------------
  function updateOrthoFrustum() {
    if (!container) return;
    const aspect = container.clientWidth / container.clientHeight;
    const halfH = orthoViewHeightCm / 2;
    const halfW = halfH * aspect;
    orthoCamera.left = -halfW;
    orthoCamera.right = halfW;
    orthoCamera.top = halfH;
    orthoCamera.bottom = -halfH;
    orthoCamera.updateProjectionMatrix();
  }

  function setFrontView() {
    const { L, H } = lastWallDims;
    const center = new THREE.Vector3(L / 2, H / 2, 0);
    const maxDim = Math.max(L, H);
    orthoViewHeightCm = maxDim * 1.5;
    updateOrthoFrustum();
    orthoCamera.position.set(center.x, center.y, maxDim * 3);
    orthoCamera.up.set(0, 1, 0);
    orthoCamera.near = 0.1;
    orthoCamera.far = maxDim * 20;
    orthoCamera.updateProjectionMatrix();
    orthoCamera.lookAt(center);

    camera = orthoCamera;
    controls.object = camera;
    controls.target.copy(center);
    controls.update();
    currentMode = "ortho";
    saveCurrentView();
  }

  function setPerspectiveView() {
    camera = perspCamera;
    controls.object = camera;
    controls.update();
    currentMode = "perspective";
    saveCurrentView();
  }

  // --- zoom buttons (manual alternative to scroll-wheel zoom) -----------
  function zoomBy(factor) {
    if (camera === orthoCamera) {
      camera.zoom = Math.max(0.05, camera.zoom * factor);
      camera.updateProjectionMatrix();
    } else {
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
      offset.multiplyScalar(1 / factor);
      camera.position.copy(controls.target).add(offset);
    }
    controls.update();
    saveCurrentView();
  }

  // --- cross-page persistence --------------------------------------------
  function saveCurrentView() {
    CameraViewState.save({
      mode: currentMode,
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
      zoom: camera.zoom || 1,
    });
  }

  function restoreView() {
    const saved = CameraViewState.load();
    if (!saved) return;
    if (saved.mode === "ortho") {
      setFrontView(); // establishes correct frustum for the current wall first
      camera.zoom = saved.zoom || 1;
      camera.updateProjectionMatrix();
    } else {
      setPerspectiveView();
    }
    camera.position.set(saved.position.x, saved.position.y, saved.position.z);
    controls.target.set(saved.target.x, saved.target.y, saved.target.z);
    controls.update();
  }

  function render(data) {
    clearGroup(frameGroup);
    clearGroup(overlayGroup);
    Label2D.clearLabels();

    const geo = data.geometry;
    const L = geo.wall_length_cm, H = geo.wall_height_cm, D = geo.wall_depth_cm;
    lastWallDims = { L, H, D };

    // --- studs (x_cm = centerline, y_cm = bottom edge) ---
    geo.studs.forEach(s => {
      const mesh = woodBox(s.width_cm, s.height_cm, s.depth_cm, 0xd9b98a);
      mesh.position.set(s.x_cm, s.y_cm + s.height_cm / 2, 0);
      frameGroup.add(mesh);
    });

    // --- beams (x_cm = left edge, y_cm = bottom edge) ---
    geo.beams.forEach(b => {
      const mesh = woodBox(b.width_cm, b.height_cm, b.depth_cm, 0xc9a367);
      mesh.position.set(b.x_cm + b.width_cm / 2, b.y_cm + b.height_cm / 2, 0);
      frameGroup.add(mesh);
    });

    // --- tolerance overlays ---
    const maxDim = Math.max(L, H);
    const off = maxDim * 0.06;
    const zFront = D / 2 + 1;

    // top length line
    const lenTol = data.tolerances.length;
    overlayGroup.add(overlayLine([[0, H + off, zFront], [L, H + off, zFront]]));
    const lenLabel = Label2D.createLabel(`Length ${(L / 100).toFixed(2)} m  (±${lenTol.worst_case_mm.toFixed(1)} mm WC / ±${lenTol.rss_mm.toFixed(1)} mm RSS)`);
    lenLabel.position.set(L / 2, H + off * 1.4, zFront);
    overlayGroup.add(lenLabel);

    // left height line
    const hTol = data.tolerances.height;
    overlayGroup.add(overlayLine([[-off, 0, zFront], [-off, H, zFront]]));
    const hLabel = Label2D.createLabel(`Height ${(H / 100).toFixed(2)} m  (±${hTol.worst_case_mm.toFixed(1)} mm WC / ±${hTol.rss_mm.toFixed(1)} mm RSS)`);
    hLabel.position.set(-off * 1.4, H / 2, zFront);
    overlayGroup.add(hLabel);

    // diagonal (solid) + mirrored diagonal (dashed, the squareness comparison partner)
    const dTol = data.tolerances.diagonal;
    overlayGroup.add(overlayLine([[0, 0, zFront], [L, H, zFront]], 0xe08a2f));
    overlayGroup.add(dashedLine([[0, H, zFront], [L, 0, zFront]], 0x999999));
    const dLabel = Label2D.createLabel(`Diagonal ${(dTol.nominal_cm / 100).toFixed(2)} m  (±${dTol.rss_mm.toFixed(1)} mm RSS)`);
    dLabel.position.set(L * 0.74, H * 0.42, zFront);
    overlayGroup.add(dLabel);

    // squareness pass/fail badge near bottom-left corner
    const sq = data.tolerances.squareness;
    const sqColor = sq.pass_rss ? "#2f6d3e" : "#a3312c";
    const sqLabel = Label2D.createLabel(
      `Squareness limit ${sq.limit_mm} mm — ${sq.pass_rss ? "WITHIN LIMIT (RSS)" : "EXCEEDS LIMIT (RSS)"}`,
      { color: sqColor }
    );
    sqLabel.position.set(L * 0.18, off * 1.4, zFront);
    overlayGroup.add(sqLabel);

    if (currentMode === "ortho") {
      setFrontView();
    } else {
      fitCameraToWall(L, H, D);
    }
  }

  function exportSVG(filename) {
    SVGExport.exportScene(scene, camera, container.clientWidth, container.clientHeight, filename);
  }

  function exportEMF(filename) {
    SVGExport.exportSceneAsEMF(scene, camera, container.clientWidth, container.clientHeight, filename);
  }

  return { init, render, setFrontView, setPerspectiveView, zoomBy, restoreView, exportSVG, exportEMF, getMode: () => currentMode };
})();
