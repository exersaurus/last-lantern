// Ghoul spawning, AI, and the difficulty ramp.
//
// Ramp (t = minutes elapsed, fully ramped at 8:00):
//   spawn interval  3.5s -> 0.8s
//   pack size       1    -> up to 4
//   max alive       8    -> 45
//   ghoul HP        18   -> ~35
//   ghoul speed     2.4  -> 4.8 (always slower than the player's 6.5)
import * as THREE from 'three';
import { createGhoul } from './assets.js';

const TOUCH_DAMAGE = 8;
const ATTACK_COOLDOWN = 0.9;
const STUN_TIME = 0.28;

export class EnemyManager {
  constructor(scene, world){
    this.scene = scene;
    this.world = world;
    this.list = [];
    this.spawnTimer = 2.5;
  }

  difficulty(elapsed){
    const m = elapsed / 60;
    const t = Math.min(1, m / 8);
    return {
      interval: 3.5 + (0.8 - 3.5) * t,
      maxAlive: Math.min(45, Math.floor(8 + m * 4)),
      groupSize: 1 + Math.min(3, Math.floor(m / 2)),
      hp: 18 * (1 + 0.12 * m),
      speed: Math.min(4.8, 2.4 + 0.18 * m),
    };
  }

  update(dt, elapsed, player, onPlayerHit){
    const diff = this.difficulty(elapsed);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.list.length < diff.maxAlive){
      this.spawnTimer = diff.interval * (0.75 + Math.random() * 0.5);
      const n = 1 + Math.floor(Math.random() * diff.groupSize);
      for (let i = 0; i < n && this.list.length < diff.maxAlive; i++) this.spawn(player.pos, diff);
    }

    // pairwise separation so packs don't collapse into one ghoul
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
        g.atkCd = ATTACK_COOLDOWN;
        onPlayerHit(TOUCH_DAMAGE);
      }

      g.group.position.set(g.pos.x, 0.06 + Math.sin(t * 4 + g.phase) * 0.08, g.pos.z);
      g.group.rotation.y = Math.atan2(dx, dz);
      const f = Math.min(1, g.flash);
      for (const m of g.mats) m.emissive.setRGB(f, f, f * 0.85);
      g.eyeMat.color.setHex(g.flash > 0.01 ? 0xffffff : 0x9fff9b);
    }
  }

  spawn(playerPos, diff){
    for (let attempt = 0; attempt < 12; attempt++){
      const ang = Math.random() * Math.PI * 2;
      const dist = 13 + Math.random() * 9; // just past the wide light radius
      const x = playerPos.x + Math.cos(ang) * dist;
      const z = playerPos.z + Math.sin(ang) * dist;
      if (!this.world.hasRoomAtPoint(x, z)) continue;
      if (this.world.pointBlocked(x, z, 0.8)) continue;
      const { group, mats, eyeMat } = createGhoul();
      group.position.set(x, 0, z);
      this.scene.add(group);
      this.list.push({
        pos: new THREE.Vector3(x, 0, z),
        r: 0.55,
        hp: diff.hp,
        speed: diff.speed * (0.85 + Math.random() * 0.3),
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

  // Apply one lantern damage tick to every ghoul inside the light sector.
  applyLightTick(origin, aimDir, tick){
    let hits = 0, kills = 0;
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
      }
    }
    return { hits, kills };
  }

  remove(i){
    const g = this.list[i];
    this.scene.remove(g.group);
    for (const m of g.mats) m.dispose();
    g.eyeMat.dispose();
    this.list.splice(i, 1);
  }
}
