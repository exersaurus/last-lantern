// Enemy spawning, AI, the difficulty ramp, and bosses.
//
// Ramp (m = minutes elapsed, fully ramped at 8:00):
//   GHOUL   — spawn interval 3s -> 0.5s, pack 1 -> 4, max alive 16 -> 90,
//             HP 18 -> ~35, speed 2.4 -> 4.8, hits for 8
//   HOUND   — faster but frailer; first one at ~1:00, spawn interval
//             9s -> 3.5s, pack 1 -> 3, max alive 2 -> 18, HP 12 -> ~23,
//             speed 4.2 -> 6.0 (still under the player's 6.5), hits for 5
//   SPITTER — anti-camping artillery; first one at 2:00, hound-like spawn
//             rate, slow (1.8 -> 3.0) but 2x ghoul HP. Stops at range and
//             spits glowing projectiles that ignore obstacles. No touch
//             damage; the shot hits for 7.
// All regular enemies award the same XP per kill.
//
// BOSSES — one every 2 minutes from 3:00 (3/5/7/9). Each is a giant, stun-
//   and knockback-immune version with much higher HP (BOSS_HP_MULT x the
//   ghoul's ramped HP) and a signature move. They award a big XP bounty.
import * as THREE from 'three';
import { createGhoul, createGhoulHound, createGhoulSpitter, createGhoulOverlord } from './assets.js';
import { xpForKill } from './skills.js';

const STUN_TIME = 0.28;
const HOUND_FIRST_SPAWN = 60;    // seconds before the first hound shows up
const SPITTER_FIRST_SPAWN = 120; // seconds before the first spitter
const SPIT_RANGE = 15;           // fires when the player is this close
const SPIT_STANDOFF = 11;        // stops advancing at this distance
const SHOT_SPEED = 7.5;
const SHOT_MAX_DIST = 38;

// --- boss tuning ----------------------------------------------------------
const BOSS_HP_MULT = 5;          // boss HP as a multiple of the ghoul's ramped HP
const BOSS_SCHEDULE = [
  { at: 180, kind: 'giantGhoul' },
  { at: 300, kind: 'giantHound' },
  { at: 420, kind: 'giantSpitter' },
  { at: 540, kind: 'overlord' },
];
const BOSS_DEFS = {
  giantGhoul: {
    base: 'ghoul', name: 'GIANT GHOUL', color: '#9fff9b',
    scale: 3.5, r: 1.9, speed: 2.6, dmg: 20, atkCd: 1.0,
    bobF: 3, bobA: 0.1, eyeColor: 0x9fff9b, tint: [0, 0.12, -0.05],
    hpScale: 1.0, xpMult: 25,
  },
  giantHound: {
    base: 'hound', name: 'GIANT GHOUL HOUND', color: '#ff7a5a',
    scale: 3.0, r: 1.7, speed: 3.8, dmg: 14, atkCd: 1.0,
    bobF: 8, bobA: 0.12, eyeColor: 0xff5a3a, tint: [-0.03, 0.2, -0.03],
    hpScale: 0.85, xpMult: 30,
    chargeSpeed: 26, chargeTime: 0.55, chargeDmg: 28,
  },
  giantSpitter: {
    base: 'spitter', name: 'GIANT GHOUL SPITTER', color: '#b6ff5e',
    scale: 2.8, r: 1.6, speed: 1.7, dmg: 9, atkCd: 2.4,
    bobF: 2, bobA: 0.06, eyeColor: 0xb6ff5e, tint: [0.05, 0.2, -0.04],
    hpScale: 1.2, xpMult: 35,
  },
  overlord: {
    base: 'overlord', name: 'GHOUL OVERLORD', color: '#e85bff',
    scale: 2.4, r: 1.8, speed: 2.2, dmg: 12, atkCd: 1.2,
    bobF: 2, bobA: 0.05, eyeColor: 0xff4df0,
    hpScale: 1.6, xpMult: 45,
  },
};

// Ghoul Overlord traps ("ghoul flesh"): unlit so the player must sweep the
// lantern over the ground to spot them.
const TRAP_TTL = 10;             // seconds before a trap rots away
const TRAP_RADIUS = 1.3;
const TRAP_SLOW = 0.5;           // movement multiplier while standing in one
const OVERLORD_SUMMON_CD = 15;
const OVERLORD_TRAP_COUNT = 5;
const SUMMON_RADIUS = 16;        // traps drop within this radius of the player

export class EnemyManager {
  constructor(scene, world){
    this.scene = scene;
    this.world = world;
    this.list = [];
    this.spawnTimer = 2.5;
    this.houndTimer = HOUND_FIRST_SPAWN;
    this.spitterTimer = SPITTER_FIRST_SPAWN;
    this.bossIndex = 0;
    this._bossId = 0;
    this.onBoss = null;            // callback(name, color) on boss spawn
    this.playerSlowFactor = 1;     // read by main to slow the player on traps

    this.shots = [];
    this.shotGeo = new THREE.SphereGeometry(0.22, 6, 5);
    this.shotMat = new THREE.MeshBasicMaterial({ color: 0x86ff5e });

    this.traps = [];
    this.trapGeo = new THREE.DodecahedronGeometry(1, 0);
    this.trapGeo.scale(TRAP_RADIUS, 0.12, TRAP_RADIUS); // flat fleshy splat
    this.trapMat = new THREE.MeshStandardMaterial({ color: 0x5e0d0d, roughness: 1, flatShading: true });
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
      spitter: {
        interval: 9 + (3.5 - 9) * t,
        maxAlive: Math.min(12, Math.floor(1 + m * 1.5)),
        groupSize: 1 + Math.min(1, Math.floor(m / 4)),
        hp: 36 * (1 + 0.12 * m), // 2x ghoul
        speed: Math.min(3.0, 1.8 + 0.1 * m),
        dmg: 7,        // projectile damage
        atkCd: 3.0,    // seconds between shots
        bobF: 2.5, bobA: 0.05, // heavy sway
      },
    };
  }

  update(dt, elapsed, player, onPlayerHit){
    const diff = this.difficulty(elapsed);

    // bosses on a fixed schedule, regardless of the regular caps
    while (this.bossIndex < BOSS_SCHEDULE.length && elapsed >= BOSS_SCHEDULE[this.bossIndex].at){
      this.spawnBoss(BOSS_SCHEDULE[this.bossIndex].kind, player, elapsed);
      this.bossIndex++;
    }

    let ghouls = 0, hounds = 0, spitters = 0;
    for (const g of this.list){
      if (g.dying || g.boss) continue;
      if (g.type === 'hound') hounds++;
      else if (g.type === 'spitter') spitters++;
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

    this.spitterTimer -= dt;
    if (this.spitterTimer <= 0 && spitters < diff.spitter.maxAlive){
      this.spitterTimer = diff.spitter.interval * (0.75 + Math.random() * 0.5);
      const n = 1 + Math.floor(Math.random() * diff.spitter.groupSize);
      for (let i = 0; i < n && spitters < diff.spitter.maxAlive; i++, spitters++){
        this.spawn('spitter', player.pos, diff.spitter, diff.xp);
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
        g.group.scale.setScalar(s * g.scale);
        g.group.position.y = -0.8 * g.scale * (1 - s);
        if (g.deathT >= 0.35) this.remove(i);
        continue;
      }

      const dx = player.pos.x - g.pos.x, dz = player.pos.z - g.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 90){ this.remove(i); continue; } // left behind in a pruned room

      g.atkCd = Math.max(0, g.atkCd - dt);
      g.flash = Math.max(0, g.flash - dt * 3.2);
      if (g.teleT > 0) g.teleT = Math.max(0, g.teleT - dt);

      if (g.boss){
        this.updateBoss(g, dt, player, dist, dx, dz, onPlayerHit);
      } else if (g.stun > 0){
        g.stun -= dt;
        g.pos.x += g.kb.x * dt;
        g.pos.z += g.kb.y * dt;
        g.kb.multiplyScalar(Math.max(0, 1 - 6 * dt));
      } else {
        // spitters hold position once in firing range; everyone else closes in
        const advance = g.type !== 'spitter' || dist > SPIT_STANDOFF;
        const inv = advance ? 1 / Math.max(dist, 0.001) : 0;
        g.pos.x += (dx * inv * g.speed + g.sep.x * 3.0) * dt;
        g.pos.z += (dz * inv * g.speed + g.sep.y * 3.0) * dt;
      }
      this.world.collideCircle(g.pos, g.r);

      if (!g.boss){
        if (g.type === 'spitter'){
          if (dist < SPIT_RANGE && g.atkCd === 0 && g.stun <= 0){
            g.atkCd = g.atkCdMax;
            this.fireShot(g, player);
          }
        } else if (dist < player.radius + g.r + 0.35 && g.atkCd === 0 && g.stun <= 0){
          g.atkCd = g.atkCdMax;
          onPlayerHit(g.dmg);
        }
      }

      g.group.position.set(g.pos.x, 0.06 + Math.sin(t * g.bobF + g.phase) * g.bobA, g.pos.z);
      g.group.rotation.y = Math.atan2(dx, dz);
      if (g.teleT > 0){
        const p = 0.5 + 0.5 * Math.sin(t * 18); // red wind-up pulse
        for (const m of g.mats) m.emissive.setRGB(0.5 + 0.5 * p, 0.04, 0.04);
      } else {
        const f = Math.min(1, g.flash);
        for (const m of g.mats) m.emissive.setRGB(f, f, f * 0.85);
      }
      g.eyeMat.color.setHex(g.flash > 0.01 ? 0xffffff : g.eyeColor);
    }

    this.updateShots(dt, player, onPlayerHit);
    this.updateTraps(dt, player);
  }

  // ---------------------------------------------------------------- bosses

  updateBoss(g, dt, player, dist, dx, dz, onPlayerHit){
    const bk = g.bk;
    const inv = dist > 0.001 ? 1 / dist : 0;
    const toward = (sp) => { g.pos.x += dx * inv * sp * dt; g.pos.z += dz * inv * sp * dt; };
    const away = (sp) => { g.pos.x -= dx * inv * sp * dt; g.pos.z -= dz * inv * sp * dt; };
    const melee = (dmg) => {
      if (dist < player.radius + g.r + 0.4 && g.atkCd === 0){ g.atkCd = g.atkCdMax; onPlayerHit(dmg); }
    };

    if (bk.kind === 'giantGhoul'){
      toward(g.speed);
      melee(g.dmg);
      return;
    }

    if (bk.kind === 'giantHound'){
      if (bk.state === 'windup'){
        bk.t -= dt;
        g.teleT = Math.max(g.teleT, 0.1); // keep glowing red while winding up
        if (bk.t <= 0){
          bk.state = 'charge';
          bk.t = bk.chargeTime;
          bk.dir.set(dx * inv, dz * inv); // lock onto the player's position now
        }
      } else if (bk.state === 'charge'){
        g.pos.x += bk.dir.x * bk.chargeSpeed * dt;
        g.pos.z += bk.dir.y * bk.chargeSpeed * dt;
        bk.t -= dt;
        if (dist < player.radius + g.r + 0.6 && g.atkCd === 0){ g.atkCd = g.atkCdMax; onPlayerHit(bk.chargeDmg); }
        if (bk.t <= 0){ bk.state = 'recover'; bk.t = 0.9; }
      } else if (bk.state === 'recover'){
        bk.t -= dt; // stands panting, vulnerable
        if (bk.t <= 0){ bk.state = 'chase'; bk.cd = 7; }
      } else {
        toward(g.speed);
        melee(g.dmg);
        bk.cd -= dt;
        if (bk.cd <= 0 && dist > 5 && dist < 22){ bk.state = 'windup'; bk.t = 2.0; }
      }
      return;
    }

    if (bk.kind === 'giantSpitter'){
      if (dist > 13) toward(g.speed);
      else if (dist < 9) away(g.speed * 0.6);
      if (bk.burst > 0){
        bk.bt -= dt;
        if (bk.bt <= 0){ this.fireShotDir(g, dx * inv, dz * inv, g.dmg); bk.burst--; bk.bt = 0.16; }
      } else if (g.atkCd === 0 && dist < 20){
        g.atkCd = g.atkCdMax;
        if (Math.random() < 0.5){ bk.burst = 3; bk.bt = 0; }   // triple tap, straight
        else this.fireSpread(g, player, 5, 0.9);                // shotgun arc
      }
      return;
    }

    if (bk.kind === 'overlord'){
      if (dist > 14) toward(g.speed);
      else if (dist < 10) away(g.speed * 0.5);
      melee(g.dmg);
      bk.cd -= dt;
      if (bk.cd <= 0){ bk.cd = OVERLORD_SUMMON_CD; this.summonTraps(player); g.teleT = Math.max(g.teleT, 0.6); }
      return;
    }
  }

  spawnBoss(kind, player, elapsed){
    const def = BOSS_DEFS[kind];
    const m = elapsed / 60;
    let x = player.pos.x, z = player.pos.z - 18;
    for (let a = 0; a < 24; a++){
      const ang = Math.random() * Math.PI * 2, d = 16 + Math.random() * 6;
      const px = player.pos.x + Math.cos(ang) * d, pz = player.pos.z + Math.sin(ang) * d;
      if (this.world.hasRoomAtPoint(px, pz)){ x = px; z = pz; break; }
    }
    const made =
      def.base === 'hound' ? createGhoulHound() :
      def.base === 'spitter' ? createGhoulSpitter() :
      def.base === 'overlord' ? createGhoulOverlord() : createGhoul();
    const { group, mats, eyeMat } = made;
    if (def.tint) for (const mm of mats) mm.color.offsetHSL(def.tint[0], def.tint[1], def.tint[2]);
    group.scale.setScalar(def.scale);
    group.position.set(x, 0, z);
    this.scene.add(group);

    const hp = 18 * (1 + 0.12 * m) * BOSS_HP_MULT * def.hpScale;
    const id = ++this._bossId;
    this.list.push({
      type: 'boss', boss: true, name: def.name, color: def.color,
      pos: new THREE.Vector3(x, 0, z),
      r: def.r, hp, maxHp: hp,
      xp: Math.round(xpForKill(m) * def.xpMult),
      speed: def.speed, dmg: def.dmg, atkCdMax: def.atkCd, atkCd: 1.0,
      bobF: def.bobF, bobA: def.bobA, eyeColor: def.eyeColor, scale: def.scale,
      stun: 0, flash: 0, teleT: 0,
      phase: Math.random() * Math.PI * 2,
      kb: new THREE.Vector2(), sep: new THREE.Vector2(),
      dying: false, deathT: 0,
      group, mats, eyeMat,
      bk: this.makeBossState(kind, def, id),
    });
    if (this.onBoss) this.onBoss(def.name, def.color);
  }

  makeBossState(kind, def, id){
    const bk = { kind, id };
    if (kind === 'giantHound'){
      bk.state = 'chase'; bk.t = 0; bk.cd = 4; bk.dir = new THREE.Vector2();
      bk.chargeSpeed = def.chargeSpeed; bk.chargeTime = def.chargeTime; bk.chargeDmg = def.chargeDmg;
    } else if (kind === 'giantSpitter'){
      bk.burst = 0; bk.bt = 0;
    } else if (kind === 'overlord'){
      bk.cd = 8; // first summon a few seconds after it arrives
    }
    return bk;
  }

  getBosses(){
    const out = [];
    for (const g of this.list){
      if (g.boss && !g.dying) out.push({ id: g.bk.id, name: g.name, color: g.color, hp: Math.max(0, g.hp), maxHp: g.maxHp });
    }
    return out;
  }

  // -------------------------------------------------------------- projectiles

  fireShot(g, player){
    const dx = player.pos.x - g.pos.x, dz = player.pos.z - g.pos.z;
    const d = Math.max(0.001, Math.hypot(dx, dz));
    this.fireShotDir(g, dx / d, dz / d, g.dmg);
  }

  fireShotDir(g, dirx, dirz, dmg){
    const mesh = new THREE.Mesh(this.shotGeo, this.shotMat);
    mesh.position.set(g.pos.x, 1.4 * g.scale, g.pos.z); // leaves the (scaled) head
    if (g.scale > 1.5) mesh.scale.setScalar(1.6);        // bigger boss spit
    this.scene.add(mesh);
    this.shots.push({
      pos: new THREE.Vector2(g.pos.x, g.pos.z),
      dir: new THREE.Vector2(dirx, dirz), // straight line, no homing
      traveled: 0,
      dmg,
      base: g.scale > 1.5 ? 1.6 : 1,
      mesh,
    });
  }

  fireSpread(g, player, count, arc){
    const dx = player.pos.x - g.pos.x, dz = player.pos.z - g.pos.z;
    const base = Math.atan2(dz, dx);
    for (let i = 0; i < count; i++){
      const f = count === 1 ? 0 : (i / (count - 1) - 0.5);
      const a = base + f * arc;
      this.fireShotDir(g, Math.cos(a), Math.sin(a), g.dmg);
    }
  }

  updateShots(dt, player, onPlayerHit){
    const t = performance.now() / 1000;
    for (let i = this.shots.length - 1; i >= 0; i--){
      const s = this.shots[i];
      const step = SHOT_SPEED * dt;
      s.pos.x += s.dir.x * step;
      s.pos.y += s.dir.y * step;
      s.traveled += step;
      // glides over rocks and between trees on purpose — only the player stops it
      const dx = player.pos.x - s.pos.x, dz = player.pos.z - s.pos.y;
      if (Math.hypot(dx, dz) < player.radius + 0.35 * s.base){
        onPlayerHit(s.dmg);
        this.removeShot(i);
        continue;
      }
      if (s.traveled > SHOT_MAX_DIST){
        this.removeShot(i);
        continue;
      }
      const wob = s.base * (1 + 0.15 * Math.sin(t * 14 + s.traveled * 2));
      s.mesh.scale.setScalar(wob);
      s.mesh.position.set(s.pos.x, 1.0 + 0.1 * Math.sin(t * 9 + s.traveled), s.pos.y);
    }
  }

  removeShot(i){
    this.scene.remove(this.shots[i].mesh); // geometry/material are shared, kept alive
    this.shots.splice(i, 1);
  }

  // -------------------------------------------------------------- traps

  summonTraps(player){
    for (let k = 0; k < OVERLORD_TRAP_COUNT; k++){
      for (let attempt = 0; attempt < 8; attempt++){
        const ang = Math.random() * Math.PI * 2, r = 4 + Math.random() * (SUMMON_RADIUS - 4);
        const x = player.pos.x + Math.cos(ang) * r, z = player.pos.z + Math.sin(ang) * r;
        if (!this.world.hasRoomAtPoint(x, z)) continue;
        this.spawnTrap(x, z);
        break;
      }
    }
  }

  spawnTrap(x, z){
    const mesh = new THREE.Mesh(this.trapGeo, this.trapMat);
    mesh.position.set(x, 0.06, z);
    mesh.rotation.y = Math.random() * Math.PI;
    mesh.scale.set(0.1, 1, 0.1);
    this.scene.add(mesh);
    this.traps.push({ x, z, ttl: TRAP_TTL, mesh });
  }

  updateTraps(dt, player){
    let slow = 1;
    for (let i = this.traps.length - 1; i >= 0; i--){
      const tr = this.traps[i];
      tr.ttl -= dt;
      if (tr.ttl <= 0){ this.scene.remove(tr.mesh); this.traps.splice(i, 1); continue; }
      const grow = Math.min(1, (TRAP_TTL - tr.ttl) / 0.4); // pop in
      const fade = Math.min(1, tr.ttl / 1.0);              // shrink away
      const s = grow * fade;
      tr.mesh.scale.set(s, 1, s);
      const dx = player.pos.x - tr.x, dz = player.pos.z - tr.z;
      if (Math.hypot(dx, dz) < TRAP_RADIUS + player.radius) slow = TRAP_SLOW;
    }
    this.playerSlowFactor = slow;
  }

  spawn(type, playerPos, stats, xp){
    for (let attempt = 0; attempt < 12; attempt++){
      const ang = Math.random() * Math.PI * 2;
      const dist = 13 + Math.random() * 9; // just past the wide light radius
      const x = playerPos.x + Math.cos(ang) * dist;
      const z = playerPos.z + Math.sin(ang) * dist;
      if (!this.world.hasRoomAtPoint(x, z)) continue;
      if (this.world.pointBlocked(x, z, 0.8)) continue;
      const { group, mats, eyeMat } =
        type === 'hound' ? createGhoulHound() :
        type === 'spitter' ? createGhoulSpitter() : createGhoul();
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
        eyeColor: type === 'hound' ? 0xff9a5e : type === 'spitter' ? 0x7dff6a : 0x9fff9b,
        scale: 1,
        stun: 0,
        flash: 0,
        teleT: 0,
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
      g.flash = 1;
      if (!g.boss){ // bosses shrug off stun and knockback
        g.stun = Math.max(g.stun, STUN_TIME);
        if (d > 0.001){
          const kb = 1.2 + tick.damage * 0.12;
          g.kb.set(dx / d * kb, dz / d * kb);
        }
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
      g.flash = 1;
      if (!g.boss){
        g.stun = Math.max(g.stun, stunTime);
        if (d > 0.001) g.kb.set(dx / d * 4, dz / d * 4);
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

  remove(i){
    const g = this.list[i];
    this.scene.remove(g.group);
    for (const m of g.mats) m.dispose();
    g.eyeMat.dispose();
    this.list.splice(i, 1);
  }
}
