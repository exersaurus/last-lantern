// Procedural low-poly asset factories. Everything is generated in code —
// flora returns arrays of pre-colored, pre-transformed geometries so each
// room can merge them into a single draw call. Characters return Groups
// with per-instance materials (needed for damage flashes).
import * as THREE from 'three';

// Adds a flat vertex-color attribute and de-indexes so geometries of any
// primitive type can be merged together.
export function prepGeo(geo, color){
  let g = geo;
  if (g.index){
    g = g.toNonIndexed();
    geo.dispose();
  }
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++){
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// ---------------------------------------------------------------- flora

export function pineGeos(x, z, s, rng){
  const out = [];
  const trunkC = new THREE.Color(0x4a3526).offsetHSL(0, 0, (rng() - 0.5) * 0.05);
  const trunk = prepGeo(new THREE.CylinderGeometry(0.13 * s, 0.2 * s, 1.2 * s, 5), trunkC);
  trunk.translate(x, 0.6 * s, z);
  out.push(trunk);

  const base = new THREE.Color(0x274d2a)
    .offsetHSL((rng() - 0.5) * 0.04, (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.06);
  let y = 1.5 * s, r = 1.25 * s, h = 1.5 * s;
  for (let i = 0; i < 3; i++){
    const cone = prepGeo(new THREE.ConeGeometry(r, h, 6), base.clone().offsetHSL(0, 0, i * 0.025));
    cone.rotateY(rng() * Math.PI);
    cone.translate(x, y, z);
    out.push(cone);
    y += h * 0.55;
    r *= 0.7;
    h *= 0.8;
  }
  return out;
}

export function rockGeos(x, z, s, rng){
  const c = new THREE.Color(0x596069).offsetHSL(0, 0, (rng() - 0.5) * 0.12);
  const g = prepGeo(new THREE.DodecahedronGeometry(0.55 * s, 0), c);
  g.scale(1, 0.65, 1);
  g.rotateY(rng() * Math.PI * 2);
  g.translate(x, 0.28 * s, z);
  return [g];
}

export function tuftGeos(x, z, rng){
  const out = [];
  const blades = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < blades; i++){
    const c = new THREE.Color(0x46622e).offsetHSL((rng() - 0.5) * 0.03, 0, (rng() - 0.5) * 0.08);
    const h = 0.25 + rng() * 0.3;
    const g = prepGeo(new THREE.ConeGeometry(0.05 + rng() * 0.03, h, 4), c);
    g.rotateZ((rng() - 0.5) * 0.5);
    g.rotateY(rng() * Math.PI);
    g.translate(x + (rng() - 0.5) * 0.5, h * 0.45, z + (rng() - 0.5) * 0.5);
    out.push(g);
  }
  return out;
}

const MUSH_COLORS = [0x6fd6ff, 0xb78cff, 0x7fffb0];

export function mushroomGeos(x, z, rng){
  const solid = [], glow = [];
  const n = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++){
    const mx = x + (rng() - 0.5) * 0.8, mz = z + (rng() - 0.5) * 0.8;
    const s = 0.7 + rng() * 0.7;
    const stem = prepGeo(new THREE.CylinderGeometry(0.035 * s, 0.05 * s, 0.16 * s, 5), new THREE.Color(0xb8b2a4));
    stem.translate(mx, 0.08 * s, mz);
    solid.push(stem);
    const cap = prepGeo(new THREE.ConeGeometry(0.1 * s, 0.12 * s, 6), new THREE.Color(MUSH_COLORS[Math.floor(rng() * 3)]));
    cap.translate(mx, 0.2 * s, mz);
    glow.push(cap);
  }
  return { solid, glow };
}

// ---------------------------------------------------------------- ghoul

let GHOUL_GEO = null;
function ghoulGeo(){
  if (GHOUL_GEO) return GHOUL_GEO;
  const body = new THREE.IcosahedronGeometry(0.55, 0);
  body.scale(1, 1.25, 0.85);
  GHOUL_GEO = {
    body,
    head: new THREE.IcosahedronGeometry(0.3, 0),
    arm: new THREE.BoxGeometry(0.16, 0.78, 0.16),
    eye: new THREE.SphereGeometry(0.06, 6, 5),
  };
  return GHOUL_GEO;
}

export function createGhoul(){
  const geo = ghoulGeo();
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x76876f, roughness: 0.95, flatShading: true });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x8d9c84, roughness: 0.9, flatShading: true });
  const clawMat = new THREE.MeshStandardMaterial({ color: 0x5d6b57, roughness: 1, flatShading: true });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x9fff9b });

  const body = new THREE.Mesh(geo.body, bodyMat);
  body.position.y = 0.8;
  body.rotation.x = 0.25;

  const head = new THREE.Mesh(geo.head, headMat);
  head.position.set(0, 1.42, 0.18);

  const eyeL = new THREE.Mesh(geo.eye, eyeMat);
  eyeL.position.set(-0.11, 1.47, 0.4);
  const eyeR = new THREE.Mesh(geo.eye, eyeMat);
  eyeR.position.set(0.11, 1.47, 0.4);

  const armL = new THREE.Mesh(geo.arm, clawMat);
  armL.position.set(-0.4, 1.0, 0.25);
  armL.rotation.x = -0.9;
  const armR = new THREE.Mesh(geo.arm, clawMat);
  armR.position.set(0.4, 1.0, 0.25);
  armR.rotation.x = -0.9;

  group.add(body, head, eyeL, eyeR, armL, armR);
  return { group, mats: [bodyMat, headMat, clawMat], eyeMat };
}

// ---------------------------------------------------------- ghoul hound

let HOUND_GEO = null;
function houndGeo(){
  if (HOUND_GEO) return HOUND_GEO;
  const body = new THREE.IcosahedronGeometry(0.5, 0);
  body.scale(0.8, 0.7, 1.5);
  HOUND_GEO = {
    body,
    head: new THREE.IcosahedronGeometry(0.26, 0),
    snout: new THREE.BoxGeometry(0.18, 0.15, 0.32),
    leg: new THREE.BoxGeometry(0.12, 0.5, 0.12),
    tail: new THREE.BoxGeometry(0.09, 0.09, 0.48),
    eye: new THREE.SphereGeometry(0.05, 6, 5),
  };
  return HOUND_GEO;
}

export function createGhoulHound(){
  const geo = houndGeo();
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8a5648, roughness: 0.95, flatShading: true });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x9a6555, roughness: 0.9, flatShading: true });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x6b4036, roughness: 1, flatShading: true });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff9a5e });

  const body = new THREE.Mesh(geo.body, bodyMat);
  body.position.y = 0.55;

  const head = new THREE.Mesh(geo.head, headMat);
  head.position.set(0, 0.72, 0.75);
  const snout = new THREE.Mesh(geo.snout, headMat);
  snout.position.set(0, 0.64, 1.0);

  const eyeL = new THREE.Mesh(geo.eye, eyeMat);
  eyeL.position.set(-0.1, 0.8, 0.9);
  const eyeR = new THREE.Mesh(geo.eye, eyeMat);
  eyeR.position.set(0.1, 0.8, 0.9);

  const legs = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]){
    const leg = new THREE.Mesh(geo.leg, legMat);
    leg.position.set(sx * 0.25, 0.25, sz * 0.45);
    legs.push(leg);
  }

  const tail = new THREE.Mesh(geo.tail, legMat);
  tail.position.set(0, 0.72, -0.8);
  tail.rotation.x = -0.55;

  group.add(body, head, snout, eyeL, eyeR, ...legs, tail);
  return { group, mats: [bodyMat, headMat, legMat], eyeMat };
}

// --------------------------------------------------------- ghoul spitter

let SPITTER_GEO = null;
function spitterGeo(){
  if (SPITTER_GEO) return SPITTER_GEO;
  const body = new THREE.IcosahedronGeometry(0.45, 0);
  body.scale(0.75, 1.6, 0.7); // slim and tall
  const head = new THREE.IcosahedronGeometry(0.42, 0);
  head.scale(1.1, 1.0, 1.1); // bulbous
  SPITTER_GEO = {
    body,
    head,
    arm: new THREE.BoxGeometry(0.12, 0.7, 0.12),
    eye: new THREE.SphereGeometry(0.055, 6, 5),
    sac: new THREE.SphereGeometry(0.12, 6, 5),
  };
  return SPITTER_GEO;
}

export function createGhoulSpitter(){
  const geo = spitterGeo();
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5f8a52, roughness: 0.95, flatShading: true });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x74a55e, roughness: 0.9, flatShading: true });
  const armMat = new THREE.MeshStandardMaterial({ color: 0x4c6e42, roughness: 1, flatShading: true });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x7dff6a });

  const body = new THREE.Mesh(geo.body, bodyMat);
  body.position.y = 1.0;

  const head = new THREE.Mesh(geo.head, headMat);
  head.position.set(0, 1.85, 0.1);

  const eyeL = new THREE.Mesh(geo.eye, eyeMat);
  eyeL.position.set(-0.13, 1.95, 0.42);
  const eyeR = new THREE.Mesh(geo.eye, eyeMat);
  eyeR.position.set(0.13, 1.95, 0.42);
  // glowing venom sac under the jaw, shares the eye material so it
  // flashes white with damage ticks too
  const sac = new THREE.Mesh(geo.sac, eyeMat);
  sac.position.set(0, 1.62, 0.34);

  const armL = new THREE.Mesh(geo.arm, armMat);
  armL.position.set(-0.48, 1.15, 0.12);
  armL.rotation.set(-0.4, 0, 0.25);
  const armR = new THREE.Mesh(geo.arm, armMat);
  armR.position.set(0.48, 1.15, 0.12);
  armR.rotation.set(-0.4, 0, -0.25);

  group.add(body, head, eyeL, eyeR, sac, armL, armR);
  return { group, mats: [bodyMat, headMat, armMat], eyeMat };
}

// --------------------------------------------------------- ghoul overlord
// A larger, regal ghoul (boss). Built at roughly normal ghoul height so the
// caller can scale the whole group up. Wields a glowing staff; eyes, staff
// orb, and crown gems share `eyeMat` so they all flash white on damage.

export function createGhoulOverlord(){
  const group = new THREE.Group();
  const robeMat = new THREE.MeshStandardMaterial({ color: 0x3a2b5e, roughness: 0.95, flatShading: true });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x5a3f8c, roughness: 0.9, flatShading: true });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x7e8c75, roughness: 0.9, flatShading: true });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd9b24a, roughness: 0.4, metalness: 0.5, flatShading: true });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff4df0 });

  const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.95, 1.7, 7), robeMat);
  robe.position.y = 0.85;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.55, 7), trimMat);
  torso.position.y = 1.75;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), headMat);
  head.position.set(0, 2.2, 0.05);

  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), eyeMat);
  eyeL.position.set(-0.14, 2.26, 0.3);
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), eyeMat);
  eyeR.position.set(0.14, 2.26, 0.3);

  // spiked crown of gold with a glowing gem at each point
  const crown = new THREE.Group();
  crown.position.set(0, 2.5, 0.05);
  for (let i = 0; i < 6; i++){
    const a = (i / 6) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 4), goldMat);
    spike.position.set(Math.cos(a) * 0.3, 0.06, Math.sin(a) * 0.3);
    crown.add(spike);
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), eyeMat);
    gem.position.set(Math.cos(a) * 0.3, 0.2, Math.sin(a) * 0.3);
    crown.add(gem);
  }

  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.75, 0.14), robeMat);
  arm.position.set(0.5, 1.5, 0.25);
  arm.rotation.x = -0.5;

  // staff in the right hand
  const staff = new THREE.Group();
  staff.position.set(0.78, 0, 0.4);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.7, 6),
    new THREE.MeshStandardMaterial({ color: 0x2a2233, roughness: 0.8, flatShading: true }));
  pole.position.y = 1.35;
  const claw = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.04, 6, 10), goldMat);
  claw.position.y = 2.6;
  claw.rotation.x = Math.PI / 2;
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), eyeMat);
  orb.position.y = 2.7;
  staff.add(pole, claw, orb);

  group.add(robe, torso, head, eyeL, eyeR, crown, arm, staff);
  return { group, mats: [robeMat, trimMat, headMat, goldMat], eyeMat };
}

// ----------------------------------------------------------- lightkeeper

export function createLightkeeper(){
  const group = new THREE.Group();
  const coatMat = new THREE.MeshStandardMaterial({ color: 0x2c3a57, roughness: 0.9, flatShading: true });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x44537a, roughness: 0.9, flatShading: true });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd9b48f, roughness: 0.8, flatShading: true });
  const hatMat = new THREE.MeshStandardMaterial({ color: 0x202d49, roughness: 0.95, flatShading: true });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x33343c, roughness: 0.6, metalness: 0.4, flatShading: true });

  const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.48, 1.0, 7), coatMat);
  coat.position.y = 0.55;
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.31, 0.5, 7), trimMat);
  torso.position.y = 1.25;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), skinMat);
  head.position.y = 1.66;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.46, 0.07, 8), hatMat);
  brim.position.y = 1.82;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.26, 8), hatMat);
  cap.position.y = 1.97;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.55, 0.13), coatMat);
  arm.position.set(0.34, 1.32, 0.3);
  arm.rotation.x = -1.2;

  // hand-held lantern: open metal frame so the glowing core shows through
  const lantern = new THREE.Group();
  lantern.position.set(0.36, 1.1, 0.62);
  const lTop = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.2), metalMat);
  lTop.position.y = 0.14;
  const lBottom = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.2), metalMat);
  lBottom.position.y = -0.14;
  const lHook = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.08, 4), metalMat);
  lHook.position.y = 0.2;
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.085, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xffd98a })
  );
  lantern.add(lTop, lBottom, lHook, core);

  group.add(coat, torso, head, brim, cap, arm, lantern);
  return { group, mats: [coatMat, trimMat, skinMat, hatMat] };
}
