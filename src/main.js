import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World, ROOM_SIZE } from './world.js';
import { Player } from './player.js';
import { Lantern, DPS_WIDE, PULSE_RADIUS } from './lantern.js';
import { EnemyManager } from './enemies.js';
import { UI, fmtTime } from './ui.js';
import { Progression, PATHS } from './skills.js';

const VIEW_HALF = 14;                              // ortho half-height in world units
const CAM_OFFSET = new THREE.Vector3(24, 30, 24);  // isometric camera offset
const BASE_HP = 100;
const FUEL_SECONDS = 600;                          // 10 minute night
const PULSE_COOLDOWN = 20;
const FOCUS_STATE_COOLDOWN = 20;

// states: 'menu' (start screen) -> 'playing' <-> 'skills' (paused) -> 'over'
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
    this.enemies.onBoss = (name, color) => this.ui.announce(name + ' EMERGES', color);

    this.composer = new EffectComposer(this.renderer);
    this.pixelSize = 3;
    this.pixelPass = new RenderPixelatedPass(this.pixelSize, this.scene, this.camera);
    this.pixelPass.normalEdgeStrength = 0.25;
    this.pixelPass.depthEdgeStrength = 0.3;
    this.composer.addPass(this.pixelPass);
    this.composer.addPass(new OutputPass());

    // --- progression
    this.prog = new Progression();
    this.maxHp = BASE_HP;
    this.cds = { dash: 0, pulse: 0, focusState: 0 };
    this.focusActiveT = 0;
    this.ui.buildSkills(PATHS, (path, skill) => this.invest(path, skill));
    this.ui.initDock(PATHS);
    this.ui.onSkillsToggle = () => this.toggleSkills();
    this.ui.onSkillsClose = () => this.closeSkills();
    this.ui.setXP(this.prog);

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
      if (e.code === 'Space') e.preventDefault(); // no page scroll / button re-trigger
      this.keys.add(e.code);
      if (e.code === 'BracketLeft') this.setPixelSize(-1);
      if (e.code === 'BracketRight') this.setPixelSize(1);
      if (e.code === 'KeyC' && (this.state === 'playing' || this.state === 'skills')) this.toggleSkills();
      if (e.code === 'Escape' && this.state === 'skills') this.closeSkills();
      if (this.state === 'playing' && !e.repeat){
        if (e.code === 'Space') this.tryDash();
        if (e.code === 'KeyE') this.tryPulse();
        if (e.code === 'KeyR') this.tryFocusState();
      }
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
    this.hp = BASE_HP;
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
    if (this.state === 'menu' || this.state === 'playing'){
      this.time += dt;
      this.update(dt);
    }
    this.composer.render(); // 'skills' and 'over' render a frozen frame
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
    // focusing the beam slows movement; overlord traps slow it further;
    // Move Speed ranks soften both taxes
    p.speedMult = this.prog.moveSpeedMult
      * (playing && this.mouseDown ? 0.35 : 1)
      * this.enemies.playerSlowFactor;
    p.update(dt, this.moveVec, this.aimDir, this.world);

    // room streaming: entering a new room spawns its neighbors, prunes the rest
    const ix = Math.round(p.pos.x / ROOM_SIZE), iz = Math.round(p.pos.z / ROOM_SIZE);
    if (ix !== this.curRoom[0] || iz !== this.curRoom[1]){
      this.curRoom = [ix, iz];
      this.world.enter(ix, iz);
    }

    // skill timers + lantern modifiers
    for (const k in this.cds) this.cds[k] = Math.max(0, this.cds[k] - (playing ? dt : 0));
    if (playing) this.focusActiveT = Math.max(0, this.focusActiveT - dt);
    const m = this.lantern.mods;
    m.wideMult = this.prog.wideDamageMult;
    m.beamMult = this.prog.beamDamageMult;
    m.radiusBonus = this.prog.radiusBonus;
    m.focusTimeReduction = this.prog.focusTimeReduction;
    m.beamBoost = this.focusActiveT > 0 ? 1.5 : 1;

    this.lantern.lowFuel = playing && this.fuel < 45;
    const tick = this.lantern.update(dt, p.pos, this.aimDir, playing && this.mouseDown, this.time);
    if (playing && tick){
      const res = this.enemies.applyLightTick(p.pos, this.aimDir, tick);
      this.kills += res.kills;
      this.gainXp(res.xp);
    }

    if (playing){
      this.elapsed += dt;
      this.fuel -= dt;
      this.enemies.update(dt, this.elapsed, p, dmg => this.damagePlayer(dmg));
      this.ui.updateBosses(this.enemies.getBosses());
      this.ui.setHP(this.hp, this.maxHp);
      this.ui.setFuel(this.fuel, FUEL_SECONDS);
      this.ui.setFocus(this.lantern.arcDeg, this.lantern.focus);
      this.ui.setStats(this.kills, this.elapsed);
      this.ui.setAbility('abDash', { rank: this.prog.ranks.dash, cd: this.cds.dash, cdMax: this.prog.dashCooldown, active: 0 });
      this.ui.setAbility('abPulse', { rank: this.prog.ranks.lightTheWorld, cd: this.cds.pulse, cdMax: PULSE_COOLDOWN, active: 0 });
      this.ui.setAbility('abFocus', { rank: this.prog.ranks.focusState, cd: this.cds.focusState, cdMax: FOCUS_STATE_COOLDOWN, active: this.focusActiveT });
      if (this.hp <= 0) this.gameOver(false);
      else if (this.fuel <= 0) this.gameOver(true);
    }
  }

  // ------------------------------------------------------------ progression

  gainXp(amount){
    if (!amount) return;
    const ups = this.prog.addXp(amount);
    this.ui.setXP(this.prog);
    if (ups > 0) this.openSkills(true);
  }

  invest(path, skill){
    if (!this.prog.invest(path, skill)) return;
    if (skill.id === 'health'){
      this.maxHp = BASE_HP + this.prog.maxHpBonus;
      this.hp = Math.min(this.hp + 10, this.maxHp);
      this.ui.setHP(this.hp, this.maxHp);
    }
    this.ui.refreshSkills(this.prog, PATHS);
    this.ui.setXP(this.prog);
  }

  openSkills(leveled = false){
    if (this.state === 'skills'){
      this.ui.showSkills(this.prog, PATHS, leveled);
      return;
    }
    if (this.state !== 'playing') return;
    this.state = 'skills';
    this.keys.clear();
    this.mouseDown = false;
    this.ui.showSkills(this.prog, PATHS, leveled);
  }

  closeSkills(){
    if (this.state !== 'skills') return;
    this.state = 'playing';
    this.ui.hideSkills();
  }

  toggleSkills(){
    if (this.state === 'skills') this.closeSkills();
    else this.openSkills();
  }

  // ------------------------------------------------------------ active skills

  tryDash(){
    if (this.prog.ranks.dash < 1 || this.cds.dash > 0 || this.player.dashing) return;
    this.player.startDash(this.aimDir);
    this.cds.dash = this.prog.dashCooldown;
  }

  tryPulse(){
    if (this.prog.ranks.lightTheWorld < 1 || this.cds.pulse > 0) return;
    this.cds.pulse = PULSE_COOLDOWN;
    this.lantern.firePulse();
    const dmg = DPS_WIDE * this.prog.wideDamageMult * this.prog.pulseDamageMult;
    const res = this.enemies.burst(this.player.pos, PULSE_RADIUS, dmg, 0.6);
    this.kills += res.kills;
    this.gainXp(res.xp);
  }

  tryFocusState(){
    if (this.prog.ranks.focusState < 1 || this.cds.focusState > 0) return;
    this.cds.focusState = FOCUS_STATE_COOLDOWN;
    this.focusActiveT = this.prog.focusStateDuration;
  }

  // ------------------------------------------------------------

  damagePlayer(dmg){
    if (this.player.invuln > 0) return;
    this.hp -= dmg;
    this.player.hitFlash();
    this.ui.hitFlash();
  }

  gameOver(survived){
    this.state = 'over';
    const stats = `SURVIVED ${fmtTime(this.elapsed)}<br/>LEVEL ${this.prog.level}<br/>GHOULS BANISHED: ${this.kills}`;
    if (survived){
      this.ui.showEnd('DAWN BREAKS', 'The lantern gutters out &mdash; but the sun rises.<br/>You kept the light alive.', stats);
    } else {
      this.ui.showEnd('DARKNESS TAKES YOU', 'The ghouls drag you beneath the roots.', stats);
    }
  }
}

new Game();
