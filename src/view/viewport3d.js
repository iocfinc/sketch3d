/**
 * SKETCH3D — 3D Three.js Viewport & Orbit Controller
 * ====================================================
 * Manages Three.js scene, lighting, Bambu Lab A1 print bed helper,
 * touch/pointer orbit controls, pinch zoom, and render loop.
 */

/**
 * Initializes the 3D Three.js viewport and orbit controls.
 * @param {Object} options
 * @param {HTMLElement} options.container
 * @param {number} [options.bedSizeMm=256]
 * @param {number} [options.maxHeightMm=256]
 * @returns {Object} Viewport API
 */
import { createCanvas2DFallback } from './canvas2dFallback.js';

export function initViewport3D({ container, bedSizeMm = 256, maxHeightMm = 256, getWireframe } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#020203');
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 2500);

  let renderer;
  let activeBedSizeMm = bedSizeMm;
  let fallbackRenderer = null;
  const dummyCanvas = document.createElement('canvas');
  const contextStatus = { ok: true, reason: null, lostCount: 0, fallbackActive: false };

  const setBanner = (msg) => {
    const el = typeof document !== 'undefined' ? document.getElementById('webglFallbackBanner') : null;
    if (!el) return;
    if (msg) {
      el.textContent = msg;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  };

  try {
    if (typeof window !== 'undefined' && window.__SKETCH3D_FORCE_CANVAS2D_FALLBACK) {
      throw new Error('Forced Canvas2D wireframe fallback');
    }
    const opts = { antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' };
    try {
      renderer = new THREE.WebGLRenderer(opts);
    } catch (_) {
      renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    }
    const gl = renderer?.getContext?.();
    if (!gl) throw new Error('WebGL context unavailable');
    renderer.setClearColor?.(0x020203, 1);
  } catch (err) {
    contextStatus.ok = false;
    contextStatus.fallbackActive = true;
    contextStatus.reason = err?.message || 'WebGL initialization failed';
    setBanner(`3D WebGL unavailable (${contextStatus.reason}). Using Canvas2D wireframe fallback.`);
    fallbackRenderer = createCanvas2DFallback({
      canvas: dummyCanvas,
      getOrbit: () => orbit,
      getPartsGroup: () => partsGroup,
      getBedSizeMm: () => activeBedSizeMm,
      getWireframe
    });
    renderer = {
      domElement: dummyCanvas,
      setPixelRatio: () => {},
      setSize: (w, h) => fallbackRenderer.setSize(w, h),
      setClearColor: () => {},
      render: () => fallbackRenderer.render()
    };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.85);
  keyLight.position.set(160, 260, 180);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x73E6F1, 0.45);
  rimLight.position.set(-160, 120, -140);
  scene.add(rimLight);

  // Print Bed & Build Envelope
  const bedGroup = new THREE.Group();
  scene.add(bedGroup);

  function setBedDimensions(widthMm = bedSizeMm, heightMm = maxHeightMm) {
    const w = Math.max(80, Number(widthMm) || 256);
    const h = Math.max(80, Number(heightMm) || 256);
    activeBedSizeMm = w;
    while (bedGroup.children.length > 0) {
      const ch = bedGroup.children[0];
      bedGroup.remove(ch);
      ch.geometry?.dispose?.();
      ch.material?.dispose?.();
    }
    const plateMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w),
      new THREE.MeshStandardMaterial({ color: 0x0b0b12, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide })
    );
    plateMesh.rotation.x = -Math.PI / 2;
    plateMesh.position.y = -0.2;
    bedGroup.add(plateMesh);
    bedGroup.add(new THREE.GridHelper(w, Math.max(10, Math.round(w / 10)), 0x00E56D, 0x1c1c28));
    bedGroup.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.5, w)),
      new THREE.LineBasicMaterial({ color: 0x00E56D })
    ));
    const volumeBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, w)),
      new THREE.LineBasicMaterial({ color: 0x73E6F1, transparent: true, opacity: 0.16 })
    );
    volumeBox.position.y = h / 2;
    bedGroup.add(volumeBox);
  }
  setBedDimensions(bedSizeMm, maxHeightMm);

  const partsGroup = new THREE.Group();
  scene.add(partsGroup);

  // Orbit Controller State
  const orbit = {
    theta: Math.PI / 4,
    phi: Math.PI / 3.2,
    radius: 260,
    isDragging: false,
    lastX: 0,
    lastY: 0,
    pinchDist: 0,
    autoSpin: false,
    targetY: 20
  };

  function updateCamera(targetY = orbit.targetY) {
    orbit.targetY = targetY;
    const sp = Math.sin(orbit.phi);
    camera.position.set(
      orbit.radius * sp * Math.sin(orbit.theta),
      targetY + orbit.radius * Math.cos(orbit.phi),
      orbit.radius * sp * Math.cos(orbit.theta)
    );
    camera.lookAt(0, targetY, 0);
  }

  const canvas = renderer.domElement;
  updateCamera(orbit.targetY);

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    contextStatus.ok = false;
    contextStatus.reason = 'webglcontextlost';
    contextStatus.lostCount += 1;
    setBanner('3D WebGL context lost. Attempting automatic restoration or click Reset View.');
  });

  canvas.addEventListener('webglcontextrestored', () => {
    contextStatus.ok = true;
    contextStatus.reason = null;
    setBanner('');
    renderer.setClearColor?.(0x020203, 1);
    resize();
    renderNow();
  });

  // Touch Orbit & Pinch Zoom
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      orbit.isDragging = true;
      orbit.lastX = e.touches[0].clientX;
      orbit.lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      orbit.isDragging = false;
      orbit.pinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && orbit.isDragging) {
      orbit.theta -= (e.touches[0].clientX - orbit.lastX) * 0.008;
      orbit.phi = Math.max(0.15, Math.min(Math.PI / 2 - 0.05, orbit.phi - (e.touches[0].clientY - orbit.lastY) * 0.008));
      orbit.lastX = e.touches[0].clientX;
      orbit.lastY = e.touches[0].clientY;
      updateCamera();
    } else if (e.touches.length === 2) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      orbit.radius = Math.max(80, Math.min(850, orbit.radius - (d - orbit.pinchDist) * 0.6));
      orbit.pinchDist = d;
      updateCamera();
    }
  }, { passive: false });

  canvas.addEventListener('touchend', () => { orbit.isDragging = false; });

  // Desktop Pointer Orbit
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    orbit.isDragging = true;
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || !orbit.isDragging) return;
    orbit.theta -= (e.clientX - orbit.lastX) * 0.008;
    orbit.phi = Math.max(0.15, Math.min(Math.PI / 2 - 0.05, orbit.phi - (e.clientY - orbit.lastY) * 0.008));
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
    updateCamera();
  });

  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') return;
    orbit.isDragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbit.radius = Math.max(80, Math.min(850, orbit.radius + e.deltaY * 0.25));
    updateCamera();
  }, { passive: false });

  let lastW = 0;
  let lastH = 0;

  function resize() {
    const rect = container.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    if (w <= 0 || h <= 0) return false;
    if (w !== lastW || h !== lastH) {
      lastW = w;
      lastH = h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    return true;
  }

  function renderNow() {
    if (!contextStatus.ok && !fallbackRenderer) return false;
    if (!resize()) return false;
    if (fallbackRenderer) fallbackRenderer.render();
    else renderer.render(scene, camera);
    return true;
  }

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (resize()) renderNow();
    });
    ro.observe(container);
  }

  function animate() {
    requestAnimationFrame(animate);
    if (!contextStatus.ok && !fallbackRenderer) return;
    if (orbit.autoSpin && !orbit.isDragging) {
      orbit.theta += 0.005;
      updateCamera();
    }
    resize();
    if (fallbackRenderer) fallbackRenderer.render();
    else renderer.render(scene, camera);
  }

  return {
    scene,
    camera,
    renderer,
    partsGroup,
    updateCamera,
    resize,
    renderNow,
    setBedDimensions,
    getContextStatus: () => ({ ...contextStatus }),
    zoomIn: () => { orbit.radius = Math.max(80, orbit.radius - 35); updateCamera(); renderNow(); },
    zoomOut: () => { orbit.radius = Math.min(850, orbit.radius + 35); updateCamera(); renderNow(); },
    resetView: () => { orbit.theta = Math.PI / 4; orbit.phi = Math.PI / 3.2; orbit.radius = 260; updateCamera(); renderNow(); },
    setCameraOrbit: (theta, phi, radius = orbit.radius, targetY = orbit.targetY) => {
      orbit.theta = theta; orbit.phi = phi; orbit.radius = radius; updateCamera(targetY);
    },
    toggleAutoSpin: () => { orbit.autoSpin = !orbit.autoSpin; return orbit.autoSpin; },
    getAutoSpin: () => orbit.autoSpin,
    animate
  };
}
