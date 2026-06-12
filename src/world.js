// Endless forest, streamed as connected rooms on a grid.
// Only the current room plus its 4 orthogonal neighbors exist at once;
// anything further is disposed. Each room is deterministic from its grid
// coordinates, walled with pines, with a gate at the middle of each edge.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pineGeos, rockGeos, tuftGeos, mushroomGeos } from './assets.js';

export const ROOM_SIZE = 48;
const HALF = ROOM_SIZE / 2;
const GATE_HALF = 5;       // half-width of the opening in each tree wall
const CLEAR_LANE = 3.5;    // cross-shaped corridor kept free of obstacles

function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roomSeed(ix, iz){
  let h = (ix * 374761393 + iz * 668265263 + 1013904223) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function vhash(ix, iz){
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % 1024) / 1024;
}

function smooth(t){ return t * t * (3 - 2 * t); }

// Value noise in world space so terrain colors are seamless across rooms.
function noise2(x, z){
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = smooth(x - x0), fz = smooth(z - z0);
  const a = vhash(x0, z0), b = vhash(x0 + 1, z0);
  const c = vhash(x0, z0 + 1), d = vhash(x0 + 1, z0 + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

const C_GRASS_DARK = new THREE.Color(0x223a1d);
const C_GRASS = new THREE.Color(0x2f4d26);
const C_GRASS_DRY = new THREE.Color(0x4d4b27);
const C_DIRT = new THREE.Color(0x3b2e1f);
const C_DIRT_DARK = new THREE.Color(0x281f15);

export class World {
  constructor(scene){
    this.scene = scene;
    this.rooms = new Map();
    this.obstacles = [];
    this.cx = 0;
    this.cz = 0;
    this.enter(0, 0);
  }

  key(ix, iz){ return ix + ',' + iz; }

  enter(ix, iz){
    this.cx = ix;
    this.cz = iz;
    const want = [[ix, iz], [ix + 1, iz], [ix - 1, iz], [ix, iz + 1], [ix, iz - 1]];
    for (const [x, z] of want) this.ensureRoom(x, z);
    for (const [key, room] of [...this.rooms]){
      if (Math.abs(room.ix - ix) + Math.abs(room.iz - iz) > 1) this.disposeRoom(key, room);
    }
    this.obstacles = [];
    for (const room of this.rooms.values()) this.obstacles.push(...room.obstacles);
  }

  ensureRoom(ix, iz){
    const key = this.key(ix, iz);
    if (this.rooms.has(key)) return;
    const rng = mulberry32(roomSeed(ix, iz));
    const wx = ix * ROOM_SIZE, wz = iz * ROOM_SIZE;
    const group = new THREE.Group();
    group.position.set(wx, 0, wz);
    const obstacles = [];
    const staticGeos = [];
    const glowGeos = [];

    // -- ground with vertex-painted grass/dirt patches
    const ground = new THREE.PlaneGeometry(ROOM_SIZE, ROOM_SIZE, 16, 16);
    ground.rotateX(-Math.PI / 2);
    const pos = ground.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i++){
      const gx = pos.getX(i) + wx, gz = pos.getZ(i) + wz;
      const n = noise2(gx * 0.14, gz * 0.14) * 0.7 + noise2(gx * 0.45 + 31.7, gz * 0.45 + 17.3) * 0.3;
      if (n < 0.34) col.copy(C_DIRT_DARK).lerp(C_DIRT, n / 0.34);
      else if (n < 0.42) col.copy(C_DIRT).lerp(C_GRASS_DARK, (n - 0.34) / 0.08);
      else if (n < 0.75) col.copy(C_GRASS_DARK).lerp(C_GRASS, (n - 0.42) / 0.33);
      else col.copy(C_GRASS).lerp(C_GRASS_DRY, (n - 0.75) / 0.25);
      const j = 0.92 + noise2(gx * 1.7 + 91, gz * 1.7 + 47) * 0.16;
      colors[i * 3] = col.r * j;
      colors[i * 3 + 1] = col.g * j;
      colors[i * 3 + 2] = col.b * j;
    }
    ground.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    group.add(new THREE.Mesh(ground, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })));

    // -- tree walls along all 4 edges, gate in the middle of each
    for (let edge = 0; edge < 4; edge++){
      let t = -HALF + 1.2;
      while (t <= HALF - 1.2){
        if (Math.abs(t) >= GATE_HALF){
          const inset = 0.8 + rng() * 0.9;
          let x, z;
          if (edge === 0){ x = t; z = -HALF + inset; }
          else if (edge === 1){ x = t; z = HALF - inset; }
          else if (edge === 2){ x = -HALF + inset; z = t; }
          else { x = HALF - inset; z = t; }
          staticGeos.push(...pineGeos(x, z, 0.9 + rng() * 0.5, rng));
          obstacles.push({ x: wx + x, z: wz + z, r: 0.95 });
        }
        t += 2.0 + rng() * 0.6;
      }
    }

    // -- interior trees & rocks (cross corridor to the gates stays clear)
    const nTrees = 9 + Math.floor(rng() * 5);
    for (let i = 0; i < nTrees; i++){
      const x = (rng() * 2 - 1) * (HALF - 5), z = (rng() * 2 - 1) * (HALF - 5);
      if (Math.abs(x) < CLEAR_LANE || Math.abs(z) < CLEAR_LANE) continue;
      staticGeos.push(...pineGeos(x, z, 0.9 + rng() * 0.7, rng));
      obstacles.push({ x: wx + x, z: wz + z, r: 0.85 });
    }
    const nRocks = 4 + Math.floor(rng() * 4);
    for (let i = 0; i < nRocks; i++){
      const x = (rng() * 2 - 1) * (HALF - 5), z = (rng() * 2 - 1) * (HALF - 5);
      if (Math.abs(x) < CLEAR_LANE || Math.abs(z) < CLEAR_LANE) continue;
      const s = 0.7 + rng() * 0.9;
      staticGeos.push(...rockGeos(x, z, s, rng));
      obstacles.push({ x: wx + x, z: wz + z, r: 0.55 * s + 0.25 });
    }

    // -- decoration: grass tufts + faintly glowing mushrooms
    for (let i = 0; i < 48; i++){
      staticGeos.push(...tuftGeos((rng() * 2 - 1) * (HALF - 1.5), (rng() * 2 - 1) * (HALF - 1.5), rng));
    }
    for (let i = 0; i < 5; i++){
      const m = mushroomGeos((rng() * 2 - 1) * (HALF - 3), (rng() * 2 - 1) * (HALF - 3), rng);
      staticGeos.push(...m.solid);
      glowGeos.push(...m.glow);
    }

    // one merged mesh per room for all static flora = one draw call
    if (staticGeos.length){
      const merged = mergeGeometries(staticGeos);
      group.add(new THREE.Mesh(merged, new THREE.MeshStandardMaterial({
        vertexColors: true, flatShading: true, roughness: 0.95,
      })));
    }
    if (glowGeos.length){
      group.add(new THREE.Mesh(mergeGeometries(glowGeos), new THREE.MeshBasicMaterial({ vertexColors: true })));
    }

    this.scene.add(group);
    this.rooms.set(key, { ix, iz, group, obstacles });
  }

  disposeRoom(key, room){
    this.scene.remove(room.group);
    room.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.rooms.delete(key);
  }

  // push a circle out of any obstacle it overlaps
  collideCircle(p, r){
    for (const o of this.obstacles){
      const dx = p.x - o.x, dz = p.z - o.z;
      const rr = r + o.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr || d2 < 1e-9) continue;
      const d = Math.sqrt(d2);
      const push = (rr - d) / d;
      p.x += dx * push;
      p.z += dz * push;
    }
  }

  pointBlocked(x, z, r){
    for (const o of this.obstacles){
      const dx = x - o.x, dz = z - o.z, rr = r + o.r;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    return false;
  }

  hasRoomAtPoint(x, z){
    return this.rooms.has(this.key(Math.round(x / ROOM_SIZE), Math.round(z / ROOM_SIZE)));
  }
}
