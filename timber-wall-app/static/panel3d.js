/* panel3d.js
 * Step B: renders the Step A frame (lighter/behind) with panel sheets
 * (semi-transparent, in front, one per material-distinct color) overlaid,
 * joint lines at each stud-aligned panel edge, and a tolerance label at
 * each joint showing the combined worst-case/RSS interface tolerance.
 * Scene units = cm, same convention as frame3d.js.
 * Text labels use Label2D (CSS2DRenderer) - see label2d.js.
 * View modes (perspective/ortho front + zoom buttons) mirror frame3d.js -
 * see its comments for the reasoning.
 */
const PanelViewer3D = (function () {
  let scene, perspCamera, orthoCamera, camera, renderer, controls, frameGroup, panelGroup, overlayGroup;
  let container;
  let currentMode = "perspective";
  let lastWallDims = { L: 300, H: 250 };
  let orthoViewHeightCm = 400;

  const MATERIAL_COLORS = {
    osb: 0xc7a45e,
    plywood: 0xe0c294,
    particleboard: 0xb99b78,
    clt: 0xead9b8,
  };

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

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.55);
    dir1.position.set(200, 300, 400);
    scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dir2.position.set(-200, 100, -300);
    scene.add(dir2);

    frameGroup = new THREE.Group();
    panelGroup = new THREE.Group();
    overlayGroup = new THREE.Group();
    scene.add(frameGroup);
    scene.add(panelGroup);
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

  function woodBox(width, height, depth, color, opacity) {
    const geo = new THREE.BoxGeometry(Math.max(width, 0.1), Math.max(height, 0.1), Math.max(depth, 0.1));
    const mat = new THREE.MeshStandardMaterial({
      color: color, roughness: 0.8, metalness: 0.02,
      transparent: opacity !== undefined && opacity < 1,
      opacity: opacity !== undefined ? opacity : 1,
    });
    return new THREE.Mesh(geo, mat);
  }

  function lineEl(points, color, opts) {
    opts = opts || {};
    const geo = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)));
    const mat = new THREE.LineBasicMaterial({ color: color, linewidth: opts.width || 2, depthTest: false });
    const line = new THREE.Line(geo, mat);
    line.renderOrder = 998;
    return line;
  }

  function fitCamera(L, H) {
    const maxDim = Math.max(L, H) * 1.3;
    const center = new THREE.Vector3(L / 2, H / 2, 0);
    perspCamera.position.set(center.x + maxDim * 0.8, center.y + maxDim * 0.5, center.z + maxDim * 1.0);
    perspCamera.near = maxDim * 0.01;
    perspCamera.far = maxDim * 20;
    perspCamera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  }

  // --- orthographic front view (mirrors frame3d.js) ----------------------
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

  function render(data) {
    clearGroup(frameGroup);
    clearGroup(panelGroup);
    clearGroup(overlayGroup);
    Label2D.clearLabels();

    const frame = data.frame;
    const panelData = data.panel;
    const geo = frame.geometry;
    const L = geo.wall_length_cm, H = geo.wall_height_cm, D = geo.wall_depth_cm;
    lastWallDims = { L, H };

    // --- frame (studs/beams), rendered lighter/behind ---
    geo.studs.forEach(s => {
      const mesh = woodBox(s.width_cm, s.height_cm, s.depth_cm, 0xd9b98a, 1);
      mesh.position.set(s.x_cm, s.y_cm + s.height_cm / 2, 0);
      frameGroup.add(mesh);
    });
    geo.beams.forEach(b => {
      const mesh = woodBox(b.width_cm, b.height_cm, b.depth_cm, 0xc9a367, 1);
      mesh.position.set(b.x_cm + b.width_cm / 2, b.y_cm + b.height_cm / 2, 0);
      frameGroup.add(mesh);
    });

    // --- panel sheets, semi-transparent, offset in front of the frame ---
    const panelThicknessCm = 1.2; // visual thickness, not tied to a real input yet
    const panelColor = MATERIAL_COLORS[panelData.config.panel_material] || 0xdccBA0;
    const zFront = D / 2 + panelThicknessCm / 2 + 0.3;

    panelData.panels.forEach((p, i) => {
      const w = p.actual_width_cm;
      const mesh = woodBox(w, H, panelThicknessCm, panelColor, 0.8);
      mesh.position.set((p.x0_cm + p.x1_cm) / 2, H / 2, zFront);
      panelGroup.add(mesh);

      if (i < panelData.panels.length - 1) {
        const jointX = p.x1_cm;
        const zLine = zFront + panelThicknessCm / 2 + 0.5;
        overlayGroup.add(lineEl([[jointX, 0, zLine], [jointX, H, zLine]], 0x7c3a1f, { width: 2 }));

        const jc = panelData.joint_check;
        if (jc.combined_rss_mm !== null) {
          const passColor = jc.pass_rss ? "#2f6d3e" : "#a3312c";
          const label = Label2D.createLabel(`±${jc.combined_rss_mm.toFixed(1)}mm RSS`, { color: passColor });
          label.position.set(jointX, H * 0.55, zLine + 1);
          overlayGroup.add(label);
        }
      }
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
