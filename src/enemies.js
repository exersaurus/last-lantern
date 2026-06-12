// Enemy spawning, AI, and the difficulty ramp.
//
// Ramp (m = minutes elapsed, fully ramped at 8:00):
//   GHOUL  — spawn interval 3s -> 0.5s, pack 1 -> 4, max alive 16 -> 90,
//            HP 18 -> ~35, speed 2.4 -> 4.8, hits for 8
//   HOUND  — faster but frailer; first one at ~1:00, spawn interval
//            9s -> 3.5s, pack 1 -> 3, max alive 2 -> 18, HP 12 -> ~23,
//            speed 4.2 -> 6.0 (still under the player's 6.5), hits for 5
// Both award the same XP per kill.
import * as THREE from 'three';
import { createGhoul, createGhoulHound } from './assets.js';
import { xpForKill } from './skills.js';

const STUN_TIME = 0.28;
const HOUND_FIRST_SPAWN = 60; // seconds before the first hound shows up

export class EnemyManager {
  constructor(scene, world){
    this.scene = scene;
    this.world = world;
    this.list = [];
    this.spawnTimer = 2.5;
    this.houndTimer = HOUND_FIRST_SPAWN;
  }

  difficulty(elapsed){
    const m = elapsed / 60;
    const t = Math.min(1, m / 8);
    return {
      xp: xpForKill(m),
      ghoul: {
        interval: 3 + (0.5 - 3) * t,
        maxAlive: Math.min(90, Math.floor(16 + m * 4)),
        groupSize: 1 + Math.min(3, Math.floor(m / 2)),
        hp: 18 * (1 + 0.12 * m),
        speed: Math.min(4.8, 2.4 + 0.18 * m),
        dmg: 8,
        atkCd: 0.9,
        bobF: 4, bobA: 0.08,
      },
      hound: {
        interval: 9 + (3.5 - 9) * t,
        maxAlive: Math.min(18, Math.floor(2 + m * 2)),
        groupSize: 1 + Math.min(2, Math.floor(m / 3)),
        hp: 12 * (1 + 0.12 * m),
        speed: Math.min(6.0, 4.2 + 0.2 * m),
        dmg: 5,
        atkCd: 0.7,
        bobF: 9, bobA: 0.1, // gallop
      },
    };
  }

  update(dt, elapsed, player, onPlayerHit){
    const diff = this.difficulty(elapsed);

    let ghouls = 0, hounds = 0;
    for (const g of this.list){
      if (g.dying) continue;
      if (g.type === 'hound') hounds++;
      else ghouls++;
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && ghouls < diff.ghoul.maxAlive){
      this.spawnTimer = diff.ghoul.interval * (0.75 + Math.random() * 0.5);
      const n = 1 + Math.floor(Math.random() * diff.ghoul.groupSize);
      for (let i = 0; i < n && ghouls < diff.ghoul.maxAlive; i++, ghouls++){
        this.spawn('ghoul', player.pos, diff.ghoul, diff.xp);
      }
    }

    this.houndTimer -= dt;
    if (this.houndTimer <= 0 && hounds < diff.hound.maxAlive){
      this.houndTimer = diff.hound.interval * (0.75 + Math.random() * 0.5);
      const n = 1 + Math.floor(Math.random() * diff.hound.groupSize);
      for (let i = 0; i < n && hounds < diff.hound.maxAlive; i++, hounds++){
        this.spawn('hound', player.pos, diff.hound, diff.xp);
      }
    }

    // pairwise separation so packs don't collapse into one enemy
    for (const g of this.list) g.sep.set(0, 0);
    for (let i = 0; i < this.list.length; i++){
      const a = this.list[i];
      if (a.dying) continue;
      for (let j = i + 1; j < this.list.length; j++){
        const b = this.list[j];
        if (b.dying) continue;
        const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
        const min = a.r + b.r + 0.2;
        const d2 = dx * dx + dz * dz;
        if (d2 > min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / min;
        const nx = dx / d, nz = dz / d;
        a.sep.x += nx * push; a.sep.y += nz * push;
        b.sep.x -= nx * push; b.sep.y -= nz * push;
      }
    }

    const t = performance.now() / 1000;
    for (let i = this.list.length - 1; i >= 0; i--){
      const g = this.list[i];

      if (g.dying){
        g.deathT += dt;
        const s = Math.max(0.001, 1 - g.deathT / 0.35);
        g.group.scale.setScalar(s);
        g.group.position.y = -0.8 * (1 - s);
        if (g.deathT >= 0.35) this.remove(i);
        continue;
      }

      const dx = player.pos.x - g.pos.x, dz = player.pos.z - g.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 80){ this.remove(i); continue; } // left behind in a pruned room

      g.atkCd = Math.max(0, g.atkCd - dt);
      g.flash = Math.max(0, g.flash - dt * 3.2);

      if (g.stun > 0){
        g.stun -= dt;
        g.pos.x += g.kb.x * dt;
        g.pos.z += g.kb.y * dt;
        g.kb.multiplyScalar(Math.max(0, 1 - 6 * dt));
      } else {
        const inv = 1 / Math.max(dist, 0.001);
        g.pos.x += (dx * inv * g.speed + g.sep.x * 3.0) * dt;
        g.pos.z += (dz * inv * g.speed + g.sep.y * 3.0) * dt;
      }
      this.world.collideCircle(g.pos, g.r);

      if (dist < player.radius + g.r + 0.35 && g.atkCd === 0 && g.stun <= 0){
        g.atkCd = g.atkCdMax;
        onPlayerHit(g.dmg);
      }

      g.group.position.set(g.pos.x, 0.06 + Math.sin(t * g.bobF + g.phase) * g.bobA, g.pos.z);
      g.group.rotation.y = Math.atan2(dx, dz);
      const f = Math.min(1, g.flash);
      for (const m of g.mats) m.emissive.setRGB(f, f, f * 0.85);
      g.eyeMat.color.setHex(g.flash > 0.01 ? 0xffffff : g.eyeColor);
    }
  }

  spawn(type, playerPos, stats, xp){
    for (let attempt = 0; attempt < 12; attempt++){
      const ang = Math.random() * Math.PI * 2;
      const dist = 13 + Math.random() * 9; // just past the wide light radius
      const x = playerPos.x + Math.cos(ang) * dist;
      const z = playerPos.z + Math.sin(ang) * dist;
      if (!this.world.hasRoomAtPoint(x, z)) continue;
      if (this.world.pointBlocked(x, z, 0.8)) continue;
      const { group, mats, eyeMat } = type === 'hound' ? createGhoulHound() : createGhoul();
      group.position.set(x, 0, z);
      this.scene.add(group);
      this.list.push({
        type,
        pos: new THREE.Vector3(x, 0, z),
        r: type === 'hound' ? 0.5 : 0.55,
        hp: stats.hp,
        xp,
        speed: stats.speed * (0.85 + Math.random() * 0.3),
        dmg: stats.dmg,
        atkCdMax: stats.atkCd,
        bobF: stats.bobF,
        bobA: stats.bobA,
        eyeColor: type === 'hound' ? 0xff9a5e : 0x9fff9b,
        stun: 0,
        flash: 0,
        atkCd: 0.4,
        phase: Math.random() * Math.PI * 2,
        kb: new THREE.Vector2(),
        sep: new THREE.Vector2(),
        dying: false,
        deathT: 0,
        group, mats, eyeMat,
      });
      return;
    }
  }

  // Apply one lantern damage tick to every enemy inside the light sector.
  applyLightTick(origin, aimDir, tick){
    let hits = 0, kills = 0, xp = 0;
    const full = tick.halfArc >= Math.PI - 0.01;
    for (const g of this.list){
      if (g.dying) continue;
      const dx = g.pos.x - origin.x, dz = g.pos.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d - g.r > tick.range) continue;
      if (!full && d > 0.001){
        const cos = (dx * aimDir.x + dz * aimDir.z) / d;
        const ang = Math.acos(Math.min(1, Math.max(-1, cos)));
        if (ang > tick.halfArc + Math.atan2(g.r, d)) continue;
      }
      hits++;
      g.hp -= tick.damage;
      g.stun = Math.max(g.stun, STUN_TIME);
      g.flash = 1;
      if (d > 0.001){
        const kb = 1.2 + tick.damage * 0.12;
        g.kb.set(dx / d * kb, dz / d * kb);
      }
      if (g.hp <= 0){
        g.dying = true;
        g.deathT = 0;
        kills++;
        xp += g.xp;
      }
    }
    return { hits, kills, xp };
  }

  // Light the World: damage every enemy within radius, regardless of arc.
  burst(origin, radius, dmg, stunTime){
    let hits = 0, kills = 0, xp = 0;
    for (const g of this.list){
      if (g.dying) continue;
      const dx = g.pos.x - origin.x, dz = g.pos.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d - g.r > radius) continue;
      hits++;
      g.hp -= dmg;
      g.stun = Math.max(g.stun, stunTime);
      g.flash = 1;
      if (d > 0.001) g.kb.set(dx / d * 4, dz / d * 4);
      if (g.hp <= 0){
        g.dying = true;
        g.deathT = 0;
        kills++;
        xp += g.xp;
      }
    }
    return { hits, kills, xp };
  }

  remove(i){
    const g = this.list[i];
    this.scene.remove(g.group);
    for (const m of g.mats) m.dispose();
    g.eyeMat.dispose();
    this.list.splice(i, 1);
  }
}
