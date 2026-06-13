// MapBuilder: themed procedural textures, AABB box geometry (merged per material),
// zones/spawns/ladders/water, radar bake. Works headless (scene=null) for previews.
import * as THREE from 'three';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import { World } from './world.js';
import { TEAM_INFO } from './data.js';

// ------------------------------------------------------------- textures ---
function makeCanvas(size, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  fn(g, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

function noise(g, s, base, amp, n = 900) {
  for (let i = 0; i < n; i++) {
    const v = (Math.random() - 0.5) * amp;
    g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 235 : 10},${Math.abs(v)})`;
    g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
}

function texSand(base, strata) {
  return makeCanvas(128, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16 + Math.random() * 10) {
      g.fillStyle = `rgba(80,55,25,${0.06 + Math.random() * 0.07})`;
      g.fillRect(0, y, s, 2 + Math.random() * 3);
    }
    if (strata) {
      g.fillStyle = 'rgba(255,235,200,0.08)';
      for (let y = 8; y < s; y += 24) g.fillRect(0, y, s, 5);
    }
    noise(g, s, base, 0.07);
  });
}

function texBlocks(base, line, blockW, blockH, moss = 0) {
  return makeCanvas(128, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    g.strokeStyle = line; g.lineWidth = 2;
    let off = 0;
    for (let y = 0; y < s; y += blockH) {
      for (let x = -blockW; x < s + blockW; x += blockW) {
        g.strokeRect(x + off, y, blockW, blockH);
        if (moss && Math.random() < 0.35) {
          g.fillStyle = `rgba(60,90,40,${0.1 + Math.random() * moss})`;
          g.fillRect(x + off + 2, y + 2, blockW - 4, blockH - 4);
        }
      }
      off = off ? 0 : blockW / 2;
    }
    noise(g, s, base, 0.08);
  });
}

function texPlanks(base, line) {
  return makeCanvas(128, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    g.strokeStyle = line; g.lineWidth = 2;
    for (let x = 0; x < s; x += 21) {
      g.strokeRect(x, 0, 21, s);
      g.fillStyle = 'rgba(40,20,5,0.12)';
      for (let i = 0; i < 5; i++) g.fillRect(x + 3 + Math.random() * 14, Math.random() * s, 1, 8 + Math.random() * 20);
    }
    // frame
    g.strokeStyle = 'rgba(35,18,5,0.8)'; g.lineWidth = 9;
    g.strokeRect(0, 0, s, s);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(s, s); g.moveTo(s, 0); g.lineTo(0, s); g.stroke();
  });
}

function texCobble(base, stone) {
  return makeCanvas(128, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    for (let y = 6; y < s; y += 18) {
      for (let x = 6; x < s; x += 18) {
        g.fillStyle = stone;
        g.beginPath();
        g.ellipse(x + Math.random() * 5, y + Math.random() * 5, 7 + Math.random() * 3, 5 + Math.random() * 3, Math.random(), 0, Math.PI * 2);
        g.fill();
      }
    }
    noise(g, s, base, 0.09);
  });
}

function texGrass(base, blade) {
  return makeCanvas(128, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 700; i++) {
      g.strokeStyle = `rgba(${blade},${0.12 + Math.random() * 0.25})`;
      g.lineWidth = 1;
      const x = Math.random() * s, y = Math.random() * s;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 3, y - 3 - Math.random() * 4); g.stroke();
    }
    noise(g, s, base, 0.05, 400);
  });
}

function texSnow(base) {
  return makeCanvas(128, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(255,255,255,${0.1 + Math.random() * 0.25})`;
      g.beginPath();
      g.ellipse(Math.random() * s, Math.random() * s, 2 + Math.random() * 5, 1.2 + Math.random() * 3, Math.random(), 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 120; i++) {
      g.fillStyle = `rgba(150,170,200,${0.05 + Math.random() * 0.1})`;
      g.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 4, 1 + Math.random() * 2);
    }
  });
}

function texHazard(base, stripe) {
  return makeCanvas(128, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    g.fillStyle = stripe;
    for (let i = -s; i < s * 2; i += 28) {
      g.beginPath();
      g.moveTo(i, 0); g.lineTo(i + 14, 0); g.lineTo(i + 14 - s, s); g.lineTo(i - s, s);
      g.closePath(); g.fill();
    }
    noise(g, s, base, 0.08, 500);
  });
}

// enchanted-ceiling: deep night blue with stars (Great Hall roof)
function texStars(base = '#0a1026') {
  return makeCanvas(256, (g, s) => {
    const grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, base); grad.addColorStop(1, '#141c3a');
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 240; i++) {
      const r = Math.random();
      g.fillStyle = `rgba(${r > 0.8 ? '255,240,200' : '210,225,255'},${0.25 + Math.random() * 0.75})`;
      const sz = Math.random() < 0.12 ? 2 : 1;
      g.fillRect(Math.random() * s, Math.random() * s, sz, sz);
    }
    // a faint nebula wisp
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(120,140,220,${0.02 + Math.random() * 0.03})`;
      g.beginPath();
      g.ellipse(s * 0.3 + Math.random() * s * 0.5, s * 0.4 + Math.random() * s * 0.3, 18 + Math.random() * 30, 6 + Math.random() * 12, Math.random(), 0, Math.PI * 2);
      g.fill();
    }
  });
}

const THEMES = {
  dust: {
    sky: 0xc8e0f0, fog: [0xd6c9a3, 60, 320],
    hemi: [0xcfe8ff, 0x8a7448, 0.9], sun: [0xfff2d0, 1.6, [40, 80, 20]],
    skyCfg: {
      top: '#2e6cb8', mid: '#8cc2e8', bot: '#e8e2c8',
      sun: { u: 0.62, v: 0.2, r: 30, color: '#fff6da', glow: '#ffeebb' },
      clouds: { n: 10, color: '255,252,245', alpha: 0.5 },
    },
    mats: () => ({
      floor: { tex: texSand('#c9a96a', false), tint: 0xd8c08c },
      wall: { tex: texSand('#c4a468', true), tint: 0xcfb084 },
      wall2: { tex: texBlocks('#b89a5e', 'rgba(90,65,30,0.45)', 42, 26), tint: 0xc4a874 },
      trim: { tex: texBlocks('#9a7e4a', 'rgba(70,50,20,0.5)', 32, 20), tint: 0xae9058 },
      crate: { tex: texPlanks('#8a6332', 'rgba(45,25,8,0.6)'), tint: 0xa87f4f },
      door: { tex: texBlocks('#5c5a55', 'rgba(20,20,20,0.6)', 16, 60), tint: 0x7a786f },
      metal: { tex: texBlocks('#6a6e72', 'rgba(30,30,32,0.5)', 64, 64), tint: 0x868a8e },
    }),
  },
  inferno: {
    sky: 0xbfd7e8, fog: [0xc9c3ae, 55, 300],
    hemi: [0xd8e8f8, 0x6f6b58, 0.85], sun: [0xffe8c0, 1.5, [-30, 70, 30]],
    skyCfg: {
      top: '#3a6ea8', mid: '#a8c2d8', bot: '#ead8b8',
      sun: { u: 0.3, v: 0.26, r: 34, color: '#ffeec8', glow: '#ffd9a0' },
      clouds: { n: 14, color: '255,248,238', alpha: 0.55 },
    },
    mats: () => ({
      floor: { tex: texCobble('#8e8878', '#7a7466'), tint: 0xa6a092 },
      wall: { tex: texSand('#cfc5ae', false), tint: 0xd8d0bc },
      wall2: { tex: texBlocks('#b05f3c', 'rgba(70,30,15,0.5)', 30, 14), tint: 0xb87454 },
      trim: { tex: texBlocks('#8a8474', 'rgba(50,46,38,0.5)', 40, 22), tint: 0x96907e },
      crate: { tex: texPlanks('#7c5a30', 'rgba(40,24,8,0.6)'), tint: 0x9a7546 },
      door: { tex: texPlanks('#4f3a22', 'rgba(20,12,4,0.7)'), tint: 0x6b4f2e },
      metal: { tex: texBlocks('#5e6266', 'rgba(28,28,30,0.5)', 64, 64), tint: 0x7e8286 },
    }),
  },
  aztec: {
    sky: 0x9fc4d8, fog: [0x90a890, 45, 260],
    hemi: [0xc2dcec, 0x4e6048, 0.8], sun: [0xeaf2d8, 1.3, [25, 90, -35]],
    skyCfg: {
      top: '#48749a', mid: '#9ab8c8', bot: '#c8d2b8',
      sun: { u: 0.52, v: 0.16, r: 24, color: '#f4f8e0', glow: '#d8e8c0' },
      clouds: { n: 22, color: '235,240,235', alpha: 0.65 },
    },
    mats: () => ({
      floor: { tex: texBlocks('#6f7a66', 'rgba(35,42,30,0.55)', 36, 36, 0.25), tint: 0x8a957c },
      wall: { tex: texBlocks('#75806d', 'rgba(38,45,32,0.5)', 44, 26, 0.3), tint: 0x86917a },
      wall2: { tex: texBlocks('#5f6a58', 'rgba(30,36,26,0.55)', 52, 32, 0.4), tint: 0x76816a },
      trim: { tex: texBlocks('#4f584a', 'rgba(24,30,22,0.6)', 30, 18, 0.2), tint: 0x68725e },
      crate: { tex: texPlanks('#6e5226', 'rgba(36,22,6,0.6)'), tint: 0x8a6a3a },
      door: { tex: texPlanks('#43331c', 'rgba(18,10,3,0.7)'), tint: 0x5e4828 },
      metal: { tex: texBlocks('#56605a', 'rgba(26,30,28,0.5)', 64, 64), tint: 0x76807a },
    }),
  },
  mirage: {
    sky: 0xcfe4f4, fog: [0xd8d2bc, 65, 330],
    hemi: [0xd8ecff, 0x95805a, 0.95], sun: [0xfff6dc, 1.7, [30, 90, -15]], amb: 0.24,
    skyCfg: {
      top: '#2a72c4', mid: '#90c8ee', bot: '#ecdfc2',
      sun: { u: 0.5, v: 0.14, r: 28, color: '#fffbe8', glow: '#fff0c4' },
      clouds: { n: 6, color: '255,255,250', alpha: 0.4 },
    },
    mats: () => ({
      floor: { tex: texCobble('#c0ab84', '#ac9870'), tint: 0xd0bd96 },
      wall: { tex: texSand('#d8c8a2', false), tint: 0xe0d2ae },
      wall2: { tex: texBlocks('#c8b88e', 'rgba(120,95,55,0.4)', 38, 22), tint: 0xd4c49a },
      trim: { tex: texBlocks('#a89066', 'rgba(85,65,35,0.5)', 30, 18), tint: 0xb89e72 },
      crate: { tex: texPlanks('#8a6332', 'rgba(45,25,8,0.6)'), tint: 0xa87f4f },
      door: { tex: texPlanks('#33586e', 'rgba(12,28,40,0.7)'), tint: 0x4a7390 }, // mirage blue doors
      metal: { tex: texBlocks('#6a6e72', 'rgba(30,30,32,0.5)', 64, 64), tint: 0x868a8e },
    }),
  },
  nuke: {
    sky: 0xb8c4cc, fog: [0xaeb6ba, 55, 300],
    hemi: [0xc8d4dc, 0x6e7276, 0.95], sun: [0xe8eef4, 1.05, [-20, 75, 25]], amb: 0.42,
    skyCfg: {
      top: '#5a7286', mid: '#9aacb8', bot: '#c8d0d4',
      sun: { u: 0.34, v: 0.2, r: 20, color: '#f0f4f8', glow: '#d8e0e8' },
      clouds: { n: 30, color: '225,232,238', alpha: 0.75 },
    },
    mats: () => ({
      floor: { tex: texBlocks('#8e9298', 'rgba(50,52,56,0.4)', 64, 64), tint: 0xa2a6ac },
      wall: { tex: texBlocks('#9aa0a6', 'rgba(58,60,64,0.4)', 58, 34), tint: 0xacb2b8 },
      wall2: { tex: texBlocks('#7e8488', 'rgba(45,48,50,0.5)', 50, 30), tint: 0x92989c },
      trim: { tex: texHazard('#8a7a30', '#2e2c20'), tint: 0xb09c44 },
      crate: { tex: texBlocks('#7e3a30', 'rgba(40,16,12,0.55)', 60, 36), tint: 0xa04c3e }, // red containers
      door: { tex: texBlocks('#5c5a55', 'rgba(20,20,20,0.6)', 16, 60), tint: 0x7a786f },
      metal: { tex: texBlocks('#646a70', 'rgba(28,30,34,0.55)', 64, 64), tint: 0x80868c },
    }),
  },
  castle: {
    sky: 0x9ab4d2, fog: [0x8e98a8, 50, 290],
    hemi: [0xb8cce4, 0x6a655e, 0.95], sun: [0xf4ecd8, 1.15, [35, 75, 25]], amb: 0.44,
    skyCfg: {
      top: '#3a5e90', mid: '#8aa6c4', bot: '#c8ccc2',
      sun: { u: 0.66, v: 0.22, r: 24, color: '#fdf4dc', glow: '#e8dcb8' },
      clouds: { n: 18, color: '238,240,242', alpha: 0.6 },
    },
    mats: () => ({
      floor: { tex: texCobble('#7e7a72', '#6e6a62'), tint: 0x969288 },
      wall: { tex: texBlocks('#84807a', 'rgba(40,38,34,0.5)', 44, 24), tint: 0x9a968e },
      wall2: { tex: texBlocks('#6e6a64', 'rgba(32,30,28,0.55)', 52, 30), tint: 0x84807a },
      trim: { tex: texBlocks('#5c5852', 'rgba(26,24,22,0.6)', 30, 18), tint: 0x726e66 },
      crate: { tex: texPlanks('#6e4f28', 'rgba(35,22,8,0.6)'), tint: 0x8c6a3c },
      door: { tex: texPlanks('#4a3520', 'rgba(20,12,4,0.7)'), tint: 0x654c2c },
      metal: { tex: texBlocks('#56605a', 'rgba(26,30,28,0.5)', 64, 64), tint: 0x76807a },
      roofsky: { tex: texStars(), tint: 0xffffff, basic: true }, // the enchanted ceiling (self-lit)
      carpet: { tex: texBlocks('#7e2a28', 'rgba(50,12,10,0.5)', 64, 22), tint: 0x9c3a34 },
    }),
  },
  night: {
    sky: 0x101a30, fog: [0x1a2440, 42, 250],
    hemi: [0x7088c0, 0x3e4658, 1.15], sun: [0xc4d6f4, 1.0, [-30, 80, 20]], amb: 0.5, // bright moonlight
    skyCfg: {
      top: '#060a1a', mid: '#101c3a', bot: '#1e2c4e',
      moon: { u: 0.7, v: 0.18, r: 22 },
      stars: 320,
      clouds: { n: 6, color: '40,52,86', alpha: 0.5 },
    },
    mats: () => ({
      floor: { tex: texCobble('#8a8e9c', '#7a7e8c'), tint: 0x9ca0b0 },
      wall: { tex: texBlocks('#949aa8', 'rgba(40,40,50,0.45)', 44, 24), tint: 0xa6acba },
      wall2: { tex: texBlocks('#828896', 'rgba(34,34,42,0.5)', 52, 30), tint: 0x9298a6 },
      trim: { tex: texBlocks('#747886', 'rgba(28,28,36,0.5)', 30, 18), tint: 0x848894 },
      crate: { tex: texPlanks('#8a7450', 'rgba(40,30,14,0.55)'), tint: 0xa08658 },
      door: { tex: texPlanks('#685440', 'rgba(26,20,10,0.6)'), tint: 0x7e6848 },
      metal: { tex: texBlocks('#7e8a94', 'rgba(36,40,44,0.45)', 64, 64), tint: 0x909ca6 },
    }),
  },
  snow: {
    sky: 0xc4d4e4, fog: [0xc2ccd8, 45, 250],
    hemi: [0xd4e2f2, 0x9a9ea8, 1.0], sun: [0xeef2fa, 1.0, [25, 65, 30]], amb: 0.34,
    skyCfg: {
      top: '#6884a4', mid: '#a8bcd0', bot: '#d8e0e8',
      sun: { u: 0.56, v: 0.3, r: 18, color: '#f4f8ff', glow: '#d8e2f0' },
      clouds: { n: 26, color: '232,238,246', alpha: 0.7 },
    },
    mats: () => ({
      floor: { tex: texSnow('#c8d2de'), tint: 0xdbe4ee },
      wall: { tex: texPlanks('#8a6c46', 'rgba(44,34,18,0.55)'), tint: 0xa08254 }, // timber shopfronts
      wall2: { tex: texBlocks('#8a8884', 'rgba(42,40,38,0.5)', 40, 22), tint: 0x9e9c96 },
      trim: { tex: texSnow('#b0bccc'), tint: 0xc6d2e0 },
      crate: { tex: texPlanks('#7c5a30', 'rgba(40,24,8,0.6)'), tint: 0x9a7546 },
      door: { tex: texPlanks('#4f3a22', 'rgba(20,12,4,0.7)'), tint: 0x6b4f2e },
      metal: { tex: texBlocks('#5e6266', 'rgba(28,28,30,0.5)', 64, 64), tint: 0x7e8286 },
    }),
  },
  pitch: {
    sky: 0xa8d0ee, fog: [0xb8d2c8, 70, 360],
    hemi: [0xd0e8ff, 0x5a8050, 1.05], sun: [0xfff8e0, 1.6, [40, 95, -20]], amb: 0.26,
    skyCfg: {
      top: '#2a78cc', mid: '#86c4ec', bot: '#cfe8d8',
      sun: { u: 0.42, v: 0.15, r: 28, color: '#fffce8', glow: '#ffefbe' },
      clouds: { n: 9, color: '255,255,252', alpha: 0.5 },
    },
    mats: () => ({
      floor: { tex: texGrass('#4e7a38', '210,235,160'), tint: 0x659250 },
      wall: { tex: texPlanks('#84643a', 'rgba(40,28,12,0.55)'), tint: 0x9c7c4e },
      wall2: { tex: texPlanks('#765636', 'rgba(34,24,10,0.6)'), tint: 0x8e6e44 },
      trim: { tex: texSand('#b8a878', false), tint: 0xc6b686 },
      crate: { tex: texPlanks('#7c5a30', 'rgba(40,24,8,0.6)'), tint: 0x9a7546 },
      door: { tex: texPlanks('#4f3a22', 'rgba(20,12,4,0.7)'), tint: 0x6b4f2e },
      metal: { tex: texBlocks('#6a6e72', 'rgba(30,30,32,0.5)', 64, 64), tint: 0x868a8e },
    }),
  },
  sewer: {
    sky: 0x0e1612, fog: [0x16241e, 38, 220],
    hemi: [0x6a9486, 0x32403a, 1.15], sun: [0xa8d8be, 0.85, [0, 80, 0]], amb: 0.52,
    skyCfg: {
      top: '#04080a', mid: '#0a1410', bot: '#12201a',
      stars: 0,
      clouds: { n: 0 },
    },
    mats: () => ({
      floor: { tex: texCobble('#7e8e86', '#6e7e76'), tint: 0x90a096 },
      wall: { tex: texBlocks('#88988e', 'rgba(34,42,38,0.5)', 44, 26, 0.45), tint: 0x9aaaa2 },
      wall2: { tex: texBlocks('#788880', 'rgba(28,36,32,0.5)', 52, 32, 0.5), tint: 0x8a9a92 },
      trim: { tex: texBlocks('#6a7a70', 'rgba(24,30,26,0.55)', 30, 18, 0.3), tint: 0x7c8c82 },
      crate: { tex: texBlocks('#90846e', 'rgba(38,34,24,0.5)', 36, 36), tint: 0xa4967c },
      door: { tex: texBlocks('#788084', 'rgba(28,30,32,0.55)', 16, 60), tint: 0x8a9298 },
      metal: { tex: texBlocks('#7e948a', 'rgba(34,40,38,0.45)', 64, 64), tint: 0x90a49a },
    }),
  },
  diagon: { // late-afternoon crooked shopping street: warm brick, painted shopfronts
    sky: 0xc8d8ec, fog: [0xc8b89a, 52, 290],
    hemi: [0xd8e4f4, 0x96785a, 1.0], sun: [0xffe9bd, 1.5, [-35, 60, 30]], amb: 0.34,
    skyCfg: {
      top: '#3a6aa8', mid: '#9ec0dc', bot: '#ecd9b4',
      sun: { u: 0.28, v: 0.3, r: 26, color: '#ffeec4', glow: '#ffd998' },
      clouds: { n: 12, color: '255,248,235', alpha: 0.55 },
    },
    mats: () => ({
      floor: { tex: texCobble('#a89678', '#94826a'), tint: 0xc2b294 },
      wall: { tex: texBlocks('#c08a62', 'rgba(70,38,20,0.45)', 30, 14), tint: 0xd0a078 },    // warm brick
      wall2: { tex: texPlanks('#6a5a86', 'rgba(28,22,40,0.5)'), tint: 0x8a76ac },            // painted shopfront (wisteria)
      trim: { tex: texBlocks('#8a7654', 'rgba(40,32,20,0.5)', 38, 20), tint: 0xa08a64 },
      crate: { tex: texPlanks('#8a6332', 'rgba(45,25,8,0.6)'), tint: 0xa87f4f },
      door: { tex: texPlanks('#48704e', 'rgba(16,30,18,0.65)'), tint: 0x648a68 },            // shop-green doors
      metal: { tex: texBlocks('#6a6e72', 'rgba(30,30,32,0.5)', 64, 64), tint: 0x868a8e },
    }),
  },
  bank: { // Gringotts: white marble above, rough-hewn vault rock below
    sky: 0xbcd0e4, fog: [0xb8bcc4, 55, 300],
    hemi: [0xdce4f0, 0x968e80, 1.15], sun: [0xfff4dc, 1.35, [30, 55, -25]], amb: 0.52,
    skyCfg: {
      top: '#46699c', mid: '#a4bcd4', bot: '#d8d4c4',
      sun: { u: 0.6, v: 0.24, r: 24, color: '#fff6dd', glow: '#ffe9b8' },
      clouds: { n: 14, color: '245,246,248', alpha: 0.55 },
    },
    mats: () => ({
      floor: { tex: texBlocks('#cbc4b4', 'rgba(120,112,96,0.35)', 52, 52), tint: 0xd8d2c2 }, // marble slabs
      wall: { tex: texBlocks('#c4bcaa', 'rgba(110,102,86,0.4)', 40, 60), tint: 0xd2cab8 },   // tall marble panels
      wall2: { tex: texBlocks('#8a8276', 'rgba(40,36,30,0.5)', 46, 26, 0.4), tint: 0xa09888 }, // vault rock
      trim: { tex: texBlocks('#a8842e', 'rgba(70,52,12,0.5)', 30, 16), tint: 0xc09a3e },     // goblin gold
      crate: { tex: texBlocks('#7e766e', 'rgba(34,30,26,0.55)', 26, 18), tint: 0x968e84 },   // iron strongboxes
      door: { tex: texBlocks('#7e7a72', 'rgba(30,28,24,0.55)', 14, 56), tint: 0x96928a },    // dark marble counters
      metal: { tex: texBlocks('#8a8076', 'rgba(40,36,32,0.5)', 64, 64), tint: 0x9e948a },
    }),
  },
  ministry: { // the Atrium: midnight-blue tile, gilded fittings, floo-green light
    sky: 0x0c1420, fog: [0x121a28, 48, 270],
    hemi: [0x7890c0, 0x3e4654, 1.35], sun: [0xc8d8f0, 1.15, [25, 60, 18]], amb: 0.8,
    skyCfg: {
      top: '#060c18', mid: '#0e1830', bot: '#1a2842', // enchanted ceiling, not real sky
      stars: 140,
      clouds: { n: 4, color: '46,62,98', alpha: 0.45 },
    },
    mats: () => ({
      floor: { tex: texCobble('#4e5a6e', '#424c5e'), tint: 0x68788e },                       // polished dark parquet-stone
      wall: { tex: texBlocks('#3f6a76', 'rgba(14,28,32,0.5)', 36, 22), tint: 0x58858f },     // peacock-blue glazed tile
      wall2: { tex: texBlocks('#32505e', 'rgba(12,20,26,0.55)', 44, 26), tint: 0x4a6a76 },
      trim: { tex: texBlocks('#9a7e34', 'rgba(60,46,14,0.5)', 28, 16), tint: 0xb89a48 },     // gilded mouldings
      crate: { tex: texPlanks('#6e5838', 'rgba(32,24,12,0.55)'), tint: 0x8a7048 },           // records crates
      door: { tex: texBlocks('#2c3a48', 'rgba(8,14,18,0.6)', 14, 58), tint: 0x46586a },      // lift grilles
      metal: { tex: texBlocks('#56606a', 'rgba(24,28,32,0.55)', 64, 64), tint: 0x6c7680 },
    }),
  },
};

// Painted equirect sky: gradient + sun/moon + clouds + stars, mapped on an
// inside-out sphere. Cheap, deterministic enough, and fog-immune.
function makeSkyDome(cfg) {
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, cfg.top);
  grad.addColorStop(0.55, cfg.mid);
  grad.addColorStop(0.78, cfg.bot);
  grad.addColorStop(1, cfg.bot);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  if (cfg.stars) {
    for (let i = 0; i < cfg.stars; i++) {
      const y = Math.random() ** 1.6 * H * 0.55;
      const r = Math.random();
      g.fillStyle = `rgba(${r > 0.85 ? '255,238,200' : '215,228,255'},${0.3 + Math.random() * 0.7})`;
      const sz = Math.random() < 0.08 ? 2 : 1;
      g.fillRect(Math.random() * W, y, sz, sz);
    }
  }
  const disc = (u, v, r, color, glowColor) => {
    const x = u * W, y = v * H;
    if (glowColor) {
      const gl = g.createRadialGradient(x, y, r * 0.6, x, y, r * 3.4);
      gl.addColorStop(0, glowColor + 'cc');
      gl.addColorStop(1, glowColor + '00');
      g.fillStyle = gl;
      g.fillRect(x - r * 3.4, y - r * 3.4, r * 6.8, r * 6.8);
    }
    g.fillStyle = color;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  if (cfg.sun) disc(cfg.sun.u, cfg.sun.v, cfg.sun.r, cfg.sun.color, cfg.sun.glow);
  if (cfg.moon) {
    disc(cfg.moon.u, cfg.moon.v, cfg.moon.r, '#e8edf6', '#aab8d8');
    // craters
    g.fillStyle = 'rgba(150,160,190,0.5)';
    const mx = cfg.moon.u * W, my = cfg.moon.v * H, mr = cfg.moon.r;
    for (const [ox, oy, cr] of [[-0.3, -0.2, 0.22], [0.25, 0.15, 0.16], [0.05, 0.4, 0.12], [-0.1, 0.1, 0.09]]) {
      g.beginPath(); g.arc(mx + ox * mr, my + oy * mr, cr * mr, 0, Math.PI * 2); g.fill();
    }
  }
  if (cfg.clouds && cfg.clouds.n) {
    const { n, color, alpha } = cfg.clouds;
    for (let i = 0; i < n; i++) {
      const cx = Math.random() * W;
      const cy = H * (0.3 + Math.random() * 0.28);
      const scale = 0.6 + Math.random() * 1.4;
      const a = alpha * (0.4 + Math.random() * 0.6);
      for (let b = 0; b < 7; b++) {
        g.fillStyle = `rgba(${color},${a * (0.25 + Math.random() * 0.3)})`;
        g.beginPath();
        g.ellipse(cx + (Math.random() - 0.5) * 90 * scale, cy + (Math.random() - 0.5) * 16 * scale,
          (26 + Math.random() * 34) * scale, (7 + Math.random() * 9) * scale, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(380, 28, 18), mat);
  mesh.renderOrder = -10;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

const DIRV = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] };

export class MapBuilder {
  constructor(themeName, scene) {
    this.themeName = themeName;
    this.theme = THEMES[themeName];
    this.scene = scene; // may be null for headless preview
    this.world = new World();
    this.geoByMat = {};
    this.meta = { sites: {}, routes: {}, torches: [], torchObjs: [], breakables: [], bells: [], npcs: [], theme: themeName };
    this.group = scene ? new THREE.Group() : null;
  }

  _addGeo(mat, cx, cy, cz, w, h, d) {
    if (!this.scene) return;
    const g = new THREE.BoxGeometry(w, h, d);
    // scale UVs so 1 texture tile ≈ 2.2m
    const uv = g.attributes.uv;
    const ts = 2.2;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      const [du, dv] = dims[f];
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * (du / ts), uv.getY(i) * (dv / ts));
      }
    }
    g.translate(cx, cy, cz);
    (this.geoByMat[mat] ||= []).push(g);
  }

  // center XZ, bottom at y0
  box(cx, y0, cz, w, h, d, mat = 'wall', opts = {}) {
    if (opts.collide !== false) this.world.addBox(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, mat);
    if (opts.visible !== false) this._addGeo(mat, cx, y0 + h / 2, cz, w, h, d);
    return this;
  }

  // axis-aligned rect floor with top at y
  floor(x0, z0, x1, z1, y = 0, mat = 'floor', thick = 0.6) {
    this.box((x0 + x1) / 2, y - thick, (z0 + z1) / 2, Math.abs(x1 - x0), thick, Math.abs(z1 - z0), mat);
    return this;
  }

  // wall along segment (must be axis aligned), thickness t, from y to y+h
  wall(x0, z0, x1, z1, h, opts = {}) {
    const { y = 0, t = 0.7, mat = 'wall' } = opts;
    if (Math.abs(x1 - x0) < 0.01) {
      const zl = Math.min(z0, z1), zh = Math.max(z0, z1);
      this.box(x0, y, (zl + zh) / 2, t, h, zh - zl + t, mat, opts);
    } else {
      const xl = Math.min(x0, x1), xh = Math.max(x0, x1);
      this.box((xl + xh) / 2, y, z0, xh - xl + t, h, t, mat, opts);
    }
    return this;
  }

  // Crates are BREAKABLE by default: a collider + an individual mesh that the
  // Environment system can shatter mid-round (and restore at round start).
  // Pass { solid: true } for crates that must never break (e.g. critical climbs).
  crate(cx, cz, s = 1.2, y = 0, mat = 'crate', opts = {}) {
    if (opts.solid) {
      this.box(cx, y, cz, s, s, s, mat);
      return this;
    }
    const b = this.world.addBox(cx - s / 2, y, cz - s / 2, cx + s / 2, y + s, cz + s / 2, mat);
    const rec = {
      kind: 'crate', box: b, mat, shape: 'box',
      x: cx, y: y + s / 2, z: cz, w: s, h: s, d: s,
      hp: s >= 1.4 ? 70 : 45, maxHp: s >= 1.4 ? 70 : 45, burn: 0, dead: false, mesh: null,
    };
    b.breakRec = rec;
    this.meta.breakables.push(rec);
    return this;
  }

  stack(cx, cz, s = 1.4, y = 0, opts = {}) {
    this.crate(cx, cz, s * 1.25, y, 'crate', opts);
    this.crate(cx + s * 0.1, cz - s * 0.05, s, y + s * 1.25, 'crate', opts);
    return this;
  }

  // Explosive barrel: shoot it and it blows, chaining into nearby barrels/crates.
  barrel(cx, cz, y = 0) {
    const r = 0.44, h = 1.0;
    const b = this.world.addBox(cx - r, y, cz - r, cx + r, y + h, cz + r, 'barrel');
    const rec = {
      kind: 'barrel', box: b, shape: 'cyl',
      x: cx, y: y + h / 2, z: cz, r, h,
      hp: 30, maxHp: 30, burn: 0, dead: false, mesh: null,
    };
    b.breakRec = rec;
    this.meta.breakables.push(rec);
    return this;
  }

  // Hanging bell: ring it with a bolt — a LOUD noise every bot investigates.
  bell(x, y, z) {
    this.meta.bells.push({ x, y, z, mesh: null, swingT: 99, cdUntil: 0 });
    return this;
  }

  // square column (collidable) — castle pillars, arcade supports
  pillar(cx, cz, s, h, y0 = 0, mat = 'trim') {
    this.box(cx, y0, cz, s, h, s, mat);
    return this;
  }

  // decorative mesh (cylinder/ring/cone). Visual-only by default; pass
  // { collide: true } to give a solid prop an upright AABB footprint so players
  // can't walk through it. Rings stay walk-through (a box would seal the middle).
  // The collider is registered before the scene guard so headless sims match.
  decor(kind, x, y, z, opts = {}) {
    if (opts.collide && kind !== 'ring') {
      const r = Math.max(opts.r ?? 0, opts.r0 ?? 0, opts.r1 ?? 0) || 0.4;
      const h = opts.h ?? (kind === 'cone' ? 1.6 : 3);
      this.world.addBox(x - r, Math.max(0, y - h / 2), z - r, x + r, y + h / 2, z + r, 'prop');
    }
    if (!this.scene) return this;
    const color = opts.color ?? 0x8a8a8a;
    let geo;
    if (kind === 'ring') geo = new THREE.TorusGeometry(opts.r ?? 1.4, opts.tube ?? 0.12, 8, 22);
    else if (kind === 'cone') geo = new THREE.ConeGeometry(opts.r ?? 0.8, opts.h ?? 1.6, 10);
    else geo = new THREE.CylinderGeometry(opts.r0 ?? opts.r ?? 0.12, opts.r1 ?? opts.r ?? 0.12, opts.h ?? 3, 8);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
    mesh.position.set(x, y, z);
    if (opts.rx) mesh.rotation.x = opts.rx;
    if (opts.ry) mesh.rotation.y = opts.ry;
    if (opts.rz) mesh.rotation.z = opts.rz;
    this.group.add(mesh);
    return this;
  }

  // ascending stairs from y0; dir = direction of ascent
  stairs(cx, cz, w, dir, steps, stepH, stepD, y0 = 0, mat = 'trim') {
    const [dx, dz] = DIRV[dir];
    for (let i = 0; i < steps; i++) {
      const off = (i + 0.5) * stepD;
      const px = cx + dx * off, pz = cz + dz * off;
      const h = y0 + (i + 1) * stepH;
      if (dx !== 0) this.box(px, 0, pz, stepD, h, w, mat);
      else this.box(px, 0, pz, w, h, stepD, mat);
    }
    return this;
  }

  // ladder volume against a wall; dir = outward normal (player approaches from there)
  ladder(cx, cz, y0, y1, dir, mat = 'metal') {
    const [nx, nz] = DIRV[dir];
    const t = 0.55;
    const x0 = cx - (nz !== 0 ? 0.7 : t / 2) + nx * 0.1;
    const x1 = cx + (nz !== 0 ? 0.7 : t / 2) + nx * 0.35;
    const z0 = cz - (nx !== 0 ? 0.7 : t / 2) + nz * 0.1;
    const z1 = cz + (nx !== 0 ? 0.7 : t / 2) + nz * 0.35;
    this.world.ladders.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), y0, y1: y1 + 0.4, nx, nz });
    if (this.scene) {
      // rails + rungs visual
      const railOff = nx !== 0 ? [0, 0.5] : [0.5, 0];
      for (const s of [-1, 1]) {
        this._addGeo(mat, cx + railOff[0] * s + nx * 0.12, (y0 + y1) / 2, cz + railOff[1] * s + nz * 0.12, 0.08 + Math.abs(nx) * 0.04, y1 - y0, 0.08 + Math.abs(nz) * 0.04);
      }
      for (let y = y0 + 0.35; y < y1; y += 0.38) {
        this._addGeo(mat, cx + nx * 0.12, y, cz + nz * 0.12, nx !== 0 ? 0.06 : 1.0, 0.06, nz !== 0 ? 0.06 : 1.0);
      }
    }
    return this;
  }

  water(x0, z0, x1, z1, y = 0.45) {
    this.world.waters.push({ x0, z0, x1, z1, y });
    if (this.scene) {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
      const m = new THREE.MeshLambertMaterial({ color: 0x2a6a78, transparent: true, opacity: 0.72 });
      const mesh = new THREE.Mesh(g, m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      this.group.add(mesh);
    }
    return this;
  }

  site(letter, x0, z0, x1, z1) {
    const r = { x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, letter };
    this.meta.sites[letter] = r;
    this.world.zones[`site${letter}`] = r;
    if (this.scene) {
      // painted site marker on the ground
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      g.strokeStyle = 'rgba(255,200,60,0.85)';
      g.lineWidth = 6;
      g.strokeRect(8, 8, 112, 112);
      g.font = 'bold 80px sans-serif';
      g.fillStyle = 'rgba(255,200,60,0.8)';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(letter, 64, 70);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(7, x1 - x0), Math.min(7, z1 - z0)),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.55 })
      );
      mesh.rotation.x = -Math.PI / 2;
      const y = this.world.floorY(r.cx, r.cz, 25) + 0.04;
      mesh.position.set(r.cx, y, r.cz);
      mesh.renderOrder = 1;
      this.group.add(mesh);
    }
    return this;
  }

  // 5 spawn slots around a center, facing yaw; also defines team buy zone
  spawns(team, cx, cz, yaw, spreadR = 4.5) {
    const arr = [];
    const offs = [[0, 0], [-1, 0.4], [1, 0.4], [-0.5, -0.8], [0.5, -0.8], [-1.5, -0.4], [1.5, -0.4]];
    for (const [ox, oz] of offs) {
      // rotate offset by yaw so the line faces the right way
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const rx = ox * spreadR * 0.55, rz = oz * spreadR * 0.55;
      arr.push({ x: cx + rx * c - rz * s, z: cz + rx * s + rz * c, yaw });
    }
    this.world.spawns[team] = arr;
    this.world.zones.buy[team] = { x0: cx - 11, z0: cz - 11, x1: cx + 11, z1: cz + 11 };
    if (this.scene) this._spawnPad(team, cx, cz, yaw, spreadR);
    return this;
  }

  dmSpawns(points) {
    this.world.dmSpawns = points.map((p) => ({ x: p[0], z: p[1], yaw: p[2] ?? 0 }));
    return this;
  }

  // CS-style spawn zone marking: team-colored ring per spawn slot + facing chevron
  _spawnPad(team, cx, cz, yaw, spreadR) {
    const info = TEAM_INFO[team];
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.strokeStyle = info.css;
    g.globalAlpha = 0.9;
    g.lineWidth = 7;
    g.beginPath(); g.arc(64, 64, 50, 0, Math.PI * 2); g.stroke();
    // chevron pointing "forward" (-y in canvas space maps to facing dir)
    g.fillStyle = info.css;
    g.beginPath(); g.moveTo(64, 6); g.lineTo(86, 34); g.lineTo(64, 26); g.lineTo(42, 34); g.closePath(); g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.5, depthWrite: false });
    for (const s of this.world.spawns[team]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), mat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = s.yaw;
      const y = this.world.floorY(s.x, s.z, 25) + 0.045;
      m.position.set(s.x, y, s.z);
      m.renderOrder = 1;
      this.group.add(m);
    }
    // banner post at the zone center
    const py = this.world.floorY(cx, cz, 25);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.1, 6), new THREE.MeshLambertMaterial({ color: 0x4a3a26 }));
    post.position.set(cx, py + 1.55, cz);
    this.group.add(post);
    const bw = 1.15, bh = 1.5;
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(bw, bh),
      new THREE.MeshLambertMaterial({ color: info.color, side: THREE.DoubleSide })
    );
    banner.position.set(cx + Math.sin(yaw + Math.PI / 2) * (bw / 2 + 0.07), py + 2.3, cz + Math.cos(yaw + Math.PI / 2) * (bw / 2 + 0.07));
    banner.rotation.y = yaw;
    this.group.add(banner);
    this.torch(cx, py + 3.0, cz, info.color);
    return this;
  }

  routes(r) { this.meta.routes = r; return this; }

  npc(type, cfg = {}) {
    this.meta.npcs.push({ type, ...cfg });
    return this;
  }

  torch(x, y, z, color = 0xffa040) {
    this.meta.torches.push({ x, y, z, color });
    return this;
  }

  bounds(x0, z0, x1, z1) {
    this.world.bounds = { x0, z0, x1, z1 };
    return this;
  }

  // Auto-layout: rects = [{x0,z0,x1,z1, y=0, wallH, mat, roof}] define the walkable union.
  // Floors/plateaus are emitted per rect; walls are generated on every boundary between
  // walkable and non-walkable space, guaranteeing an airtight map.
  layout(rects, { wallT = 0.8, defWallH = 5, wallMat = 'wall' } = {}) {
    const B = this.world.bounds;
    const cs = 1;
    const nx = Math.round((B.x1 - B.x0) / cs), nz = Math.round((B.z1 - B.z0) / cs);
    const fl = new Float32Array(nx * nz).fill(NaN);
    const wh = new Float32Array(nx * nz).fill(defWallH);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const cx = B.x0 + (ix + 0.5) * cs, cz = B.z0 + (iz + 0.5) * cs;
        let best = NaN, bh = defWallH;
        for (const r of rects) {
          if (cx > r.x0 && cx < r.x1 && cz > r.z0 && cz < r.z1) {
            const y = r.y || 0;
            if (isNaN(best) || y > best) { best = y; bh = r.wallH || defWallH; }
          }
        }
        fl[iz * nx + ix] = best;
        wh[iz * nx + ix] = bh;
      }
    }
    // floors / plateaus / roofs (deep bases so sunken areas stay sealed)
    for (const r of rects) {
      const y = r.y || 0;
      const w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      if (y > 0.01) this.box(cx, -3, cz, w, y + 3, d, r.mat || 'trim');
      else this.floor(r.x0, r.z0, r.x1, r.z1, y, r.mat || 'floor', 3 + Math.max(0, -y));
      if (r.roof) this.box(cx, r.roof, cz, w, 0.7, d, r.roofMat || 'wall2');
    }
    const at = (ix, iz) => (ix < 0 || iz < 0 || ix >= nx || iz >= nz) ? NaN : fl[iz * nx + ix];
    const whAt = (ix, iz) => (ix < 0 || iz < 0 || ix >= nx || iz >= nz) ? defWallH : wh[iz * nx + ix];
    // vertical edges (walls along z)
    for (let ix = 0; ix <= nx; ix++) {
      let run = null;
      for (let iz = 0; iz <= nz; iz++) {
        const a = at(ix - 1, iz), b = at(ix, iz);
        let info = null;
        if (iz < nz && (isNaN(a) !== isNaN(b))) {
          const inY = isNaN(a) ? b : a;
          const h = isNaN(a) ? whAt(ix, iz) : whAt(ix - 1, iz);
          info = { y: Math.round(inY * 10), h };
        }
        if (run && (!info || info.y !== run.y || info.h !== run.h)) {
          const X = B.x0 + ix * cs;
          const zA = B.z0 + run.start * cs, zB = B.z0 + iz * cs;
          this.box(X, run.y / 10, (zA + zB) / 2, wallT, run.h, zB - zA, wallMat);
          run = null;
        }
        if (info && !run) run = { ...info, start: iz };
      }
    }
    // horizontal edges (walls along x)
    for (let iz = 0; iz <= nz; iz++) {
      let run = null;
      for (let ix = 0; ix <= nx; ix++) {
        const a = at(ix, iz - 1), b = at(ix, iz);
        let info = null;
        if (ix < nx && (isNaN(a) !== isNaN(b))) {
          const inY = isNaN(a) ? b : a;
          const h = isNaN(a) ? whAt(ix, iz) : whAt(ix, iz - 1);
          info = { y: Math.round(inY * 10), h };
        }
        if (run && (!info || info.y !== run.y || info.h !== run.h)) {
          const Z = B.z0 + iz * cs;
          const xA = B.x0 + run.start * cs, xB = B.x0 + ix * cs;
          this.box((xA + xB) / 2, run.y / 10, Z, xB - xA, run.h, wallT, wallMat);
          run = null;
        }
        if (info && !run) run = { ...info, start: ix };
      }
    }
    return this;
  }

  finalize() {
    const world = this.world;
    world.finalize();
    let group = null;
    if (this.scene) {
      group = this.group;
      const mats = this.theme.mats();
      const matCache = {};
      const materialFor = (name) => {
        if (!matCache[name]) {
          const def = mats[name] || mats.wall;
          // basic = self-lit (e.g. the enchanted ceiling's stars)
          matCache[name] = def.basic
            ? new THREE.MeshBasicMaterial({ map: def.tex, color: def.tint })
            : new THREE.MeshLambertMaterial({ map: def.tex, color: def.tint });
        }
        return matCache[name];
      };
      for (const [matName, geos] of Object.entries(this.geoByMat)) {
        if (!geos.length) continue;
        const merged = BGU.mergeGeometries(geos, false);
        const mesh = new THREE.Mesh(merged, materialFor(matName));
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
        for (const g of geos) g.dispose?.();
      }
      // breakables get INDIVIDUAL meshes so they can shatter and restore
      let barrelMat = null;
      for (const rec of this.meta.breakables) {
        let mesh;
        if (rec.kind === 'barrel') {
          barrelMat ||= new THREE.MeshLambertMaterial({ map: texHazard('#7e2a1e', '#caa42c'), color: 0xd8d0c4 });
          mesh = new THREE.Mesh(new THREE.CylinderGeometry(rec.r, rec.r, rec.h, 12), barrelMat);
        } else {
          const g = new THREE.BoxGeometry(rec.w, rec.h, rec.d);
          mesh = new THREE.Mesh(g, materialFor(rec.mat || 'crate'));
        }
        mesh.position.set(rec.x, rec.y, rec.z);
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
        rec.mesh = mesh;
        group.add(mesh);
      }
      // bells: bronze dome + clapper hanging at the marked spot
      for (const bell of this.meta.bells) {
        const bg = new THREE.Group();
        const bronze = new THREE.MeshLambertMaterial({ color: 0x8a6a2c });
        const dome = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.85, 12, 1, true), bronze);
        dome.position.y = 0;
        bg.add(dome);
        const lip = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 6, 14), bronze);
        lip.rotation.x = Math.PI / 2;
        lip.position.y = -0.42;
        bg.add(lip);
        const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshLambertMaterial({ color: 0x4a3a20 }));
        clapper.position.y = -0.45;
        bg.add(clapper);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.12), new THREE.MeshLambertMaterial({ color: 0x3a2c1a }));
        bar.position.y = 0.5;
        bg.add(bar);
        bg.position.set(bell.x, bell.y, bell.z);
        bell.mesh = bg;
        group.add(bg);
      }
      // lights & sky
      const t = this.theme;
      const hemi = new THREE.HemisphereLight(t.hemi[0], t.hemi[1], t.hemi[2]);
      group.add(hemi);
      const sun = new THREE.DirectionalLight(t.sun[0], t.sun[1]);
      sun.position.set(...t.sun[2]);
      group.add(sun);
      const amb = new THREE.AmbientLight(0xffffff, t.amb ?? 0.18);
      group.add(amb);
      // real point lights for the first few torches, emissive glow for all;
      // registered so the Environment can snuff them out and relight them
      this.meta.torches.forEach((tc, i) => {
        let light = null;
        if (i < 8) {
          light = new THREE.PointLight(tc.color, 6, 11, 1.6);
          light.position.set(tc.x, tc.y, tc.z);
          group.add(light);
        }
        const glow = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.14), new THREE.MeshBasicMaterial({ color: tc.color }));
        glow.position.set(tc.x, tc.y, tc.z);
        group.add(glow);
        this.meta.torchObjs.push({ x: tc.x, y: tc.y, z: tc.z, color: tc.color, glow, light, lit: true, relightAt: 0 });
      });
      if (t.skyCfg) group.add(makeSkyDome(t.skyCfg));
      this.scene.add(group);
      this.scene.background = new THREE.Color(t.sky);
      this.scene.fog = new THREE.Fog(t.fog[0], t.fog[1], t.fog[2]);
    }
    return { world, group, meta: this.meta };
  }
}

// Top-down radar/preview bake from collider boxes. Returns {canvas, toMap(x,z)→[px,py], scale}
export function bakeRadar(world, size = 512) {
  const { x0, z0, x1, z1 } = world.bounds;
  const w = x1 - x0, h = z1 - z0;
  const scale = (size - 20) / Math.max(w, h);
  const ox = (size - w * scale) / 2, oz = (size - h * scale) / 2;
  const toMap = (x, z) => [ox + (x - x0) * scale, oz + (z - z0) * scale];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#0c0e14';
  g.fillRect(0, 0, size, size);
  const sorted = world.boxes.slice().sort((a, b) => a.y1 - b.y1);
  for (const b of sorted) {
    if (b.y0 > 2.2) continue;                      // roofs/lintels: keep interiors visible
    const [px0, pz0] = toMap(b.x0, b.z0);
    const [px1, pz1] = toMap(b.x1, b.z1);
    const ht = b.y1;
    if (ht < -0.5 && !(b.y1 - b.y0 > 0.2 && ht >= -4)) continue;
    if (ht <= 1.4) g.fillStyle = '#39404e';        // floor / low ground
    else if (ht <= 3.0) g.fillStyle = '#565f72';   // cover / crates / mid walls
    else g.fillStyle = '#79839b';                  // tall walls
    g.fillRect(px0, pz0, Math.max(1, px1 - px0), Math.max(1, pz1 - pz0));
  }
  for (const wz of world.waters) {
    const [px0, pz0] = toMap(wz.x0, wz.z0);
    const [px1, pz1] = toMap(wz.x1, wz.z1);
    g.fillStyle = 'rgba(40,110,140,0.8)';
    g.fillRect(px0, pz0, px1 - px0, pz1 - pz0);
  }
  for (const letter of ['A', 'B']) {
    const s = world.zones[`site${letter}`];
    if (!s) continue;
    const [px0, pz0] = toMap(s.x0, s.z0);
    const [px1, pz1] = toMap(s.x1, s.z1);
    g.fillStyle = 'rgba(255,190,60,0.16)';
    g.fillRect(px0, pz0, px1 - px0, pz1 - pz0);
    g.fillStyle = 'rgba(255,200,80,0.85)';
    g.font = `bold ${Math.round(14 + scale * 2)}px sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(letter, (px0 + px1) / 2, (pz0 + pz1) / 2);
  }
  // team spawn markers (CS-style: attackers green, defenders orange)
  const spawnColors = { death: 'rgba(73,224,125,0.9)', order: 'rgba(232,84,58,0.9)' };
  for (const team of ['order', 'death']) {
    const sp = world.spawns[team];
    if (!sp || !sp.length) continue;
    let mx = 0, mz = 0;
    for (const s of sp) { mx += s.x; mz += s.z; }
    const [px, pz] = toMap(mx / sp.length, mz / sp.length);
    g.strokeStyle = spawnColors[team];
    g.lineWidth = 2.5;
    g.beginPath(); g.arc(px, pz, 7 + scale, 0, Math.PI * 2); g.stroke();
    g.fillStyle = spawnColors[team];
    g.font = `bold ${Math.round(9 + scale * 1.4)}px sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(team === 'death' ? 'DE' : 'OP', px, pz);
  }
  return { canvas, toMap, scale };
}
