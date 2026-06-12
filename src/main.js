import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World, ROOM_SIZE } from './world.js';
import { Player } from './player.js';
import { Lantern } from './lantern.js';
import { EnemyManager } from './enemies.js';
import { UI, fmtTime } from './ui.js';

const VIEW_HALF = 14;                              // ortho half-height in world units
const CAM_OFFSET = new THREE.Vector3(24, 30, 24);  // isometric camera offset
const MAX_HP = 100;
const FUEL_SECONDS = 600;                          // 10 minute night

class Game {
  constructor(){
    this.ui = new UI();

    this.bgm = new Audio('./assets/bgm_main.mp3');
    this.bgm.loop = true;
    this.bgm.volume = 0.5;
    this.ui.setAudio(this.bgm);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(1); // the pixel pass supplies the chunky look
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    document.body.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060d);
    this.scene.fog = new THREE.Fog(0x05060d, 52, 110);

    const aspect = innerWidth / innerHeight;
    this.camera = new THREE.OrthographicCamera(-VIEW_HALF * aspect, VIEW_HALF * aspect, VIEW_HALF, -VIEW_HALF, 1, 200);

    // barely-there moonlight so silhouettes read in the dark
    this.scene.add(new THREE.HemisphereLight(0x2c3a5e, 0x131009, 0.32));

    this.world = new World(this.scene);
    this.player = new Player(this.scene);
    this.lantern = new Lantern(this.scene);
    this.enemies = new EnemyManager(this.scene, this.world);

    this.composer = new EffectComposer(this.renderer);
    this.pixelSize = 3;
    this.pixelPass = new RenderPixelatedPass(this.pixelSize, this.scene, this.camera);
    this.pixelPass.normalEdgeStrength = 0.25;
    this.pixelPass.depthEdgeStrength = 0.3;
    this.composer.addPass(this.pixelPass);
    this.composer.addPass(new OutputPass());

    // --- input
    this.keys = new Set();
    this.mouseNdc = new THREE.Vector2();
    this.mouseDown = false;
    this.aimDir = new THREE.Vector3(0, 0, 1);
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.aimPoint = new THREE.Vector3();
    this.moveVec = new THREE.Vector3();

    addEventListener('keydown', e => {
      this.keys.add(e.code);
      if (e.code === 'BracketLeft') this.setPixelSize(-1);
      if (e.code === 'BracketRight') this.setPixelSize(1);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('mousemove', e => this.mouseNdc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1));
    addEventListener('mousedown', e => { if (e.button === 0) this.mouseDown = true; });
    addEventListener('mouseup', e => { if (e.button === 0) this.mouseDown = false; });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('resize', () => this.onResize());
    addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });

    // screen-relative WASD basis for the fixed isometric camera
    this.fwd = new THREE.Vector3(-CAM_OFFSET.x, 0, -CAM_OFFSET.z).normalize();
    this.right = new THREE.Vector3(-this.fwd.z, 0, this.fwd.x);

    this.state = 'menu';
    this.hp = MAX_HP;
    this.fuel = FUEL_SECONDS;
    this.kills = 0;
    this.elapsed = 0;
    this.time = 0;
    this.curRoom = [0, 0];
    this.clock = new THREE.Clock();

    this.ui.bindStart(() => {
      this.ui.hideStart();
      this.state = 'playing';
      this.bgm.play().catch(() => {});
    });

    this.renderer.setAnimationLoop(() => this.frame());
  }

  setPixelSize(d){
    this.pixelSize = Math.min(8, Math.max(1, this.pixelSize + d));
    this.pixelPass.setPixelSize(this.pixelSize);
  }

  onResize(){
    const aspect = innerWidth / innerHeight;
    this.camera.left = -VIEW_HALF * aspect;
    this.camera.right = VIEW_HALF * aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
  }

  frame(){
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    if (this.state !== 'over') this.update(dt);
    this.composer.render();
  }

  update(dt){
    const playing = this.state === 'playing';
    const p = this.player;

    // camera follows, then mouse ray onto the ground gives the aim direction
    this.camera.position.copy(p.pos).add(CAM_OFFSET);
    this.camera.lookAt(p.pos.x, 0, p.pos.z);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.mouseNdc, this.camera);
    if (this.raycaster.ray.intersectPlane(this.groundPlane, this.aimPoint)){
      const dx = this.aimPoint.x - p.pos.x, dz = this.aimPoint.z - p.pos.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.05) this.aimDir.set(dx / len, 0, dz / len);
    }

    this.moveVec.set(0, 0, 0);
    if (playing){
      const f = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0)
              - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
      const r = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0)
              - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
      if (f || r) this.moveVec.addScaledVector(this.fwd, f).addScaledVector(this.right, r).normalize();
    }
    p.update(dt, this.moveVec, this.aimDir, this.world);

    // room streaming: entering a new room spawns its neighbors, prunes the rest
    const ix = Math.round(p.pos.x / ROOM_SIZE), iz = Math.round(p.pos.z / ROOM_SIZE);
    if (ix !== this.curRoom[0] || iz !== this.curRoom[1]){
      this.curRoom = [ix, iz];
      this.world.enter(ix, iz);
    }

    this.lantern.lowFuel = playing && this.fuel < 45;
    const tick = this.lantern.update(dt, p.pos, this.aimDir, playing && this.mouseDown, this.time);
    if (playing && tick){
      const res = this.enemies.applyLightTick(p.pos, this.aimDir, tick);
      this.kills += res.kills;
    }

    if (playing){
      this.elapsed += dt;
      this.fuel -= dt;
      this.enemies.update(dt, this.elapsed, p, dmg => this.damagePlayer(dmg));
      this.ui.setHP(this.hp, MAX_HP);
      this.ui.setFuel(this.fuel, FUEL_SECONDS);
      this.ui.setFocus(this.lantern.arcDeg, this.lantern.focus);
      this.ui.setStats(this.kills, this.elapsed);
      if (this.hp <= 0) this.gameOver(false);
      else if (this.fuel <= 0) this.gameOver(true);
    }
  }

  damagePlayer(dmg){
    if (this.player.invuln > 0) return;
    this.hp -= dmg;
    this.player.hitFlash();
    this.ui.hitFlash();
  }

  gameOver(survived){
    this.state = 'over';
    const stats = `SURVIVED ${fmtTime(this.elapsed)}<br/>GHOULS BANISHED: ${this.kills}`;
    if (survived){
      this.ui.showEnd('DAWN BREAKS', 'The lantern gutters out &mdash; but the sun rises.<br/>You kept the light alive.', stats);
    } else {
      this.ui.showEnd('DARKNESS TAKES YOU', 'The ghouls drag you beneath the roots.', stats);
    }
  }
}

new Game();
