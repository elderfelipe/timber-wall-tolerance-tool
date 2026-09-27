/* opening3d.js
 * Step D: renders Step A's frame with the opening(s) cut in - original
 * studs inside each opening span removed, jack/king studs and header/
 * sill added (distinct colors), and a tolerance label per opening.
 * View modes mirror frame3d.js/panel3d.js/assembly3d.js.
 */
const OpeningViewer3D = (function () {
  let scene, perspCamera, orthoCamera, camera, renderer, controls, frameGroup, openingGroup, overlayGroup;
  let container;
  let currentMode = "perspective";
  let lastWallDims = { L: 300, H: 250 };
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
    controls.addEventListener("end", saveCurrentView);

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.6);
    dir1.position.set(200, 300, 400);
    scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dir2.position.set(-200, 100, -300);
    scene.add(dir2);

    frameGroup = new THREE.Group();
    openingGroup = new THREE.Group();
    overlayGroup = new THREE.Group();
    scene.add(frameGroup);
    scene.add(openingGroup);
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
    const mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.78, metalness: 0.02 });
    return new THREE.Mesh(geo, mat);
  }

  function overlayLine(points, color) {
    const geo = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)));
    const mat = new THREE.LineBasicMaterial({ color: color || 0xe08a2f, linewidth: 2, depthTest: false });
    const line = new THREE.Line(geo, mat);
    line.renderOrder = 998;
    return line;
  }

  function fitCamera(L, H) {
    const maxDim = Math.max(L, H) * 1.3;
    const center = new THREE.Vector3(L / 2, H / 2, 0);
    perspCamera.position.set(center.x + maxDim * 0.75, center.y + maxDim * 0.55, center.z + maxDim * 0.95);
    perspCamera.near = maxDim * 0.01;
    perspCamera.far = maxDim * 20;
    perspCamera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  }

  function updateOrthoFrustum() {
    if (!container) return;
    const aspect = container.clientWidth / container.clientHeight;
    const halfH = orthoViewHeightCm / 2;
    const halfW = halfH * aspect;
    orthoCamera.left = -halfW; orthoCamera.right = halfW;
    orthoCamera.top = halfH; orthoCamera.bottom = -halfH;
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
      setFrontView();
      camera.zoom = saved.zoom || 1;
      camera.updateProjectionMatrix();
    } else {
      setPerspectiveView();
    }
    camera.position.set(saved.position.x, saved.position.y, saved.position.z);
    controls.target.set(saved.target.x, saved.target.y, saved.target.z);
    controls.update();
  }

  const MEMBER_COLOR = { jack_stud: 0xb5763f, king_stud: 0xd9b98a, header: 0x8a5a2f, sill: 0x8a5a2f };

  function render(data) {
    clearGroup(frameGroup);
    clearGroup(openingGroup);
    clearGroup(overlayGroup);
    Label2D.clearLabels();

    const geo = data.opening.geometry;
    const L = geo.wall_length_cm, H = geo.wall_height_cm, D = geo.wall_depth_cm;
    lastWallDims = { L, H };

    geo.remaining_original_studs.forEach(s => {
      const mesh = woodBox(s.width_cm, s.height_cm, s.depth_cm, 0xd9b98a);
      mesh.position.set(s.x_cm, s.y_cm + s.height_cm / 2, 0);
      frameGroup.add(mesh);
    });
    geo.beams.forEach(b => {
      const mesh = woodBox(b.width_cm, b.height_cm, b.depth_cm, 0xc9a367);
      mesh.position.set(b.x_cm + b.width_cm / 2, b.y_cm + b.height_cm / 2, 0);
      frameGroup.add(mesh);
    });

    geo.new_members.forEach(m => {
      const color = MEMBER_COLOR[m.role] || 0xaaaaaa;
      const mesh = woodBox(m.width_cm, m.height_cm, m.depth_cm, color);
      // Jack/king studs store x_cm as a CENTERLINE (matching how the
      // original frame studs are positioned in frame3d.js) - header/sill
      // store x_cm as a LEFT EDGE (matching how beams are positioned).
      // Using one formula for both was the bug: it shifted jack/king
      // studs by half their width, misaligning them against the header.
      const xCenter = (m.role === "jack_stud" || m.role === "king_stud") ? m.x_cm : m.x_cm + m.width_cm / 2;
      mesh.position.set(xCenter, m.y_cm + m.height_cm / 2, 0);
      openingGroup.add(mesh);
    });

    const off = Math.max(L, H) * 0.06;
    const zFront = D / 2 + 1;
    data.opening.openings.forEach(o => {
      const x0 = o.x_position_cm, x1 = x0 + o.width_cm;
      const y0 = o.sill_height_cm, y1 = y0 + o.height_cm;
      overlayGroup.add(overlayLine([[x0, y0, zFront], [x1, y0, zFront], [x1, y1, zFront], [x0, y1, zFront], [x0, y0, zFront]], 0xe08a2f));

      const wt = o.width_tolerance, ht = o.height_tolerance;
      const wColor = wt.pass_rss ? "#2f6d3e" : "#a3312c";
      const hColor = ht.pass_rss ? "#2f6d3e" : "#a3312c";
      const wLabel = Label2D.createLabel(`W ${(o.width_cm / 100).toFixed(2)}m: ±${wt.rss_mm.toFixed(1)}mm RSS vs ${wt.din_limit_mm}mm limit`, { color: wColor });
      wLabel.position.set((x0 + x1) / 2, y1 + off * 0.9, zFront);
      overlayGroup.add(wLabel);
      const hLabel = Label2D.createLabel(`H ${(o.height_cm / 100).toFixed(2)}m: ±${ht.rss_mm.toFixed(1)}mm RSS vs ${ht.din_limit_mm}mm limit`, { color: hColor });
      hLabel.position.set(x1 + off * 1.6, (y0 + y1) / 2, zFront);
      overlayGroup.add(hLabel);
    });

    if (currentMode === "ortho") {
      setFrontView();
    } else {
      fitCamera(L, H);
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
