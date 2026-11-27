/**
 * SKETCH3D — Parametric Starter Presets
 * =======================================
 * Pre-configured parametric models for Bambu Lab A1 build volume (256x256x256 mm).
 */

export const PRESETS = {
  card: {
    name: 'EDC Frame',
    type: 'extrude',
    isClosed: true,
    points: [
      { x: -45, y: -26 }, { x: 40, y: -26 }, { x: 45, y: -21 },
      { x: 45, y: 21 }, { x: 40, y: 26 }, { x: -40, y: 26 }, { x: -45, y: 21 }
    ],
    holes: [
      { x: -38, y: -19, r: 1.6 }, { x: 38, y: -19, r: 1.6 },
      { x: 38, y: 19, r: 1.6 }, { x: -38, y: 19, r: 1.6 }
    ],
    cutouts: [
      [{ x: -25, y: -15 }, { x: 5, y: -15 }, { x: -10, y: 15 }, { x: -30, y: 15 }],
      [{ x: 15, y: -15 }, { x: 30, y: -15 }, { x: 30, y: 15 }, { x: 2, y: 15 }]
    ],
    extrudeHeight: 6,
    bevelSize: 0.5,
    twistDeg: 0,
    cornerRadius: 2,
    shellEnabled: false,
    texturePattern: 'none'
  },

  hex: {
    name: 'Truss',
    type: 'extrude',
    isClosed: true,
    points: [
      { x: -55, y: -25 }, { x: 0, y: -50 }, { x: 55, y: -25 },
      { x: 55, y: 25 }, { x: 20, y: 45 }, { x: -20, y: 45 }, { x: -55, y: 25 }
    ],
    holes: [
      { x: -42, y: -15, r: 2.1 }, { x: 42, y: -15, r: 2.1 },
      { x: -42, y: 15, r: 2.1 }, { x: 42, y: 15, r: 2.1 }
    ],
    cutouts: [
      [{ x: -25, y: -15 }, { x: 0, y: -30 }, { x: 25, y: -15 }, { x: 15, y: 20 }, { x: -15, y: 20 }]
    ],
    extrudeHeight: 12,
    bevelSize: 1.0,
    twistDeg: 0,
    cornerRadius: 3,
    shellEnabled: false,
    texturePattern: 'none'
  },

  lamp: {
    name: 'Lamp Fin',
    type: 'extrude',
    isClosed: true,
    points: (() => {
      const pts = [];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const r = i % 2 === 0 ? 48 : 38;
        pts.push({ x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r) });
      }
      return pts;
    })(),
    holes: [],
    cutouts: [
      (() => {
        const pts = [];
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          pts.push({ x: Math.round(Math.cos(a) * 28), y: Math.round(Math.sin(a) * 28) });
        }
        return pts;
      })()
    ],
    extrudeHeight: 110,
    bevelSize: 0,
    twistDeg: 90,
    cornerRadius: 0,
    shellEnabled: false,
    texturePattern: 'none'
  },

  vase: {
    name: 'Vase Shade',
    type: 'revolve',
    sketchPlane: 'XZ',
    isClosed: false,
    points: [
      { x: 18, y: 0 },
      { x: 44, y: -25 },
      { x: 52, y: -65 },
      { x: 34, y: -100 },
      { x: 28, y: -125 },
      { x: 40, y: -145 }
    ],
    holes: [],
    cutouts: [],
    extrudeHeight: 145,
    bevelSize: 0,
    twistDeg: 0,
    cornerRadius: 0,
    shellEnabled: true,
    shellMode: 'vase_proxy',
    shellThickness: 0.8,
    texturePattern: 'weave',
    textureDepth: 1.2,
    textureFreq: 24,
    color: '#73E6F1'
  },

  flute: {
    name: 'Vintage Flute',
    type: 'revolve',
    sketchPlane: 'XZ',
    isClosed: false,
    points: [
      { x: 22, y: 0 },
      { x: 46, y: -30 },
      { x: 48, y: -80 },
      { x: 36, y: -120 },
      { x: 42, y: -150 }
    ],
    holes: [],
    cutouts: [],
    extrudeHeight: 150,
    bevelSize: 0,
    twistDeg: 0,
    cornerRadius: 0,
    shellEnabled: true,
    shellMode: 'vase_proxy',
    shellThickness: 0.8,
    texturePattern: 'flute',
    textureDepth: 1.5,
    textureFreq: 24,
    color: '#FEFF00'
  },

  gyroid: {
    name: 'Gyroid Amphora',
    type: 'revolve',
    sketchPlane: 'XZ',
    isClosed: false,
    points: [
      { x: 20, y: 0 },
      { x: 48, y: -35 },
      { x: 54, y: -75 },
      { x: 32, y: -115 },
      { x: 38, y: -155 }
    ],
    holes: [],
    cutouts: [],
    extrudeHeight: 155,
    bevelSize: 0,
    twistDeg: 0,
    cornerRadius: 0,
    shellEnabled: true,
    shellMode: 'vase_proxy',
    shellThickness: 0.8,
    texturePattern: 'gyroid',
    textureDepth: 1.2,
    textureFreq: 20,
    color: '#00E56D'
  },

  coral: {
    name: 'Turing Coral Shade',
    type: 'revolve',
    sketchPlane: 'XZ',
    isClosed: false,
    points: [
      { x: 24, y: 0 },
      { x: 50, y: -30 },
      { x: 50, y: -70 },
      { x: 38, y: -110 },
      { x: 44, y: -140 }
    ],
    holes: [],
    cutouts: [],
    extrudeHeight: 140,
    bevelSize: 0,
    twistDeg: 0,
    cornerRadius: 0,
    shellEnabled: true,
    shellMode: 'vase_proxy',
    shellThickness: 0.8,
    texturePattern: 'coral',
    textureDepth: 1.4,
    textureFreq: 18,
    color: '#FF66D9'
  },

  strata: {
    name: 'Strata Weave Vessel',
    type: 'revolve',
    sketchPlane: 'XZ',
    isClosed: false,
    points: [
      { x: 22, y: 0 },
      { x: 45, y: -28 },
      { x: 50, y: -72 },
      { x: 35, y: -112 },
      { x: 40, y: -148 }
    ],
    holes: [],
    cutouts: [],
    extrudeHeight: 148,
    bevelSize: 0,
    twistDeg: 0,
    cornerRadius: 0,
    shellEnabled: true,
    shellMode: 'vase_proxy',
    shellThickness: 0.8,
    texturePattern: 'strata',
    textureDepth: 1.2,
    textureFreq: 22,
    color: '#73E6F1'
  },

  bauble: {
    name: 'Christmas Bauble',
    type: 'revolve',
    sketchPlane: 'XZ',
    isClosed: false,
    points: [
      { x: 0.01, y: 0 },
      { x: 18, y: -12 },
      { x: 35, y: -35 },
      { x: 30, y: -55 },
      { x: 16, y: -65 },
      { x: 8, y: -72 },
      { x: 8, y: -80 }
    ],
    holes: [],
    cutouts: [],
    extrudeHeight: 80,
    bevelSize: 0,
    twistDeg: 0,
    cornerRadius: 0,
    shellEnabled: true,
    shellMode: 'hollow',
    shellThickness: 1.6,
    texturePattern: 'spiral',
    textureDepth: 1.0,
    textureFreq: 20,
    color: '#FF0055'
  },

  tree: {
    name: 'Christmas Tree',
    type: 'revolve',
    sketchPlane: 'XZ',
    isClosed: false,
    points: [
      { x: 45, y: 0 },
      { x: 32, y: -30 },
      { x: 38, y: -30 },
      { x: 24, y: -60 },
      { x: 30, y: -60 },
      { x: 12, y: -90 },
      { x: 16, y: -90 },
      { x: 0.5, y: -110 }
    ],
    holes: [],
    cutouts: [],
    extrudeHeight: 110,
    bevelSize: 0,
    twistDeg: 0,
    cornerRadius: 0,
    shellEnabled: false,
    texturePattern: 'wave',
    textureDepth: 1.0,
    textureFreq: 32,
    color: '#00E56D'
  },

  cube: {
    name: 'Precision Cube',
    type: 'extrude',
    isClosed: true,
    points: [
      { x: -20, y: -20 },
      { x: 20, y: -20 },
      { x: 20, y: 20 },
      { x: -20, y: 20 }
    ],
    holes: [{ x: 0, y: 0, r: 2.25 }],
    cutouts: [],
    extrudeHeight: 40,
    bevelSize: 0.8,
    twistDeg: 0,
    cornerRadius: 0,
    shellEnabled: false,
    texturePattern: 'none',
    color: '#73E6F1'
  }
};
