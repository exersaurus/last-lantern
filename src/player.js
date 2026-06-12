import * as THREE from 'three';
import { createLightkeeper } from './assets.js';

const FLASH_COLOR = new THREE.Color(0xff2a2a);
const FLASH_TIME = 0.3;

export class Player {
  constructor(scene){
    const { group, mats } = createLightkeeper();
    this.group = group;
    scene.add(group);
    this.mats = mats.map(m => ({ m, base: m.color.clone() }));
    this.pos = new THREE.Vector3(0, 0, 0);
    this.radius = 0.45;
    this.speed = 6.5;
    this.flashT = 0;
    this.invuln = 0;
    this.walkT = 0;
  }

  update(dt, move, aimDir, world){
    if (move.lengthSq() > 0){
      this.pos.addScaledVector(move, this.speed * dt);
      this.walkT += dt * 9;
    }
    world.collideCircle(this.pos, this.radius);
    this.group.position.set(this.pos.x, Math.abs(Math.sin(this.walkT)) * 0.07, this.pos.z);
    this.group.rotation.y = Math.atan2(aimDir.x, aimDir.z);

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
