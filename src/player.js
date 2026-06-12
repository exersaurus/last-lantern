import * as THREE from 'three';
import { createLightkeeper } from './assets.js';

const FLASH_COLOR = new THREE.Color(0xff2a2a);
const FLASH_TIME = 0.3;
const DASH_SPEED = 34;   // units/sec during In a Flash
const DASH_TIME = 0.18;  // dash duration -> ~6 units traveled

export class Player {
  constructor(scene){
    const { group, mats } = createLightkeeper();
    this.group = group;
    scene.add(group);
    this.mats = mats.map(m => ({ m, base: m.color.clone() }));
    this.pos = new THREE.Vector3(0, 0, 0);
    this.radius = 0.45;
    this.speed = 6.5;
    this.speedMult = 1;
    this.flashT = 0;
    this.invuln = 0;
    this.walkT = 0;
    this.dashT = 0;
    this.dashDir = new THREE.Vector3();
  }

  get dashing(){ return this.dashT > 0; }

  startDash(dir){
    if (this.dashing) return;
    this.dashT = DASH_TIME;
    this.dashDir.copy(dir);
    this.invuln = Math.max(this.invuln, DASH_TIME + 0.15);
  }

  update(dt, move, aimDir, world){
    if (this.dashT > 0){
      this.dashT -= dt;
      this.pos.addScaledVector(this.dashDir, DASH_SPEED * dt);
      this.walkT += dt * 18;
    } else if (move.lengthSq() > 0){
      this.pos.addScaledVector(move, this.speed * this.speedMult * dt);
      this.walkT += dt * 9;
    }
    world.collideCircle(this.pos, this.radius);
    this.group.position.set(this.pos.x, Math.abs(Math.sin(this.walkT)) * 0.07, this.pos.z);
    this.group.rotation.y = Math.atan2(aimDir.x, aimDir.z);
    this.group.rotation.x = this.dashing ? 0.35 : 0; // lean into the dash

    this.invuln = Math.max(0, this.invuln - dt);
    if (this.flashT > 0){
      this.flashT = Math.max(0, this.flashT - dt);
      const k = this.flashT / FLASH_TIME;
      for (const e of this.mats) e.m.color.copy(e.base).lerp(FLASH_COLOR, k);
    }
  }

  hitFlash(){
    this.flashT = FLASH_TIME;
    this.invuln = 0.5;
  }
}
