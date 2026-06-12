// The lantern weapon. A point light handles the wide 360° glow; as the
// player holds left-click the arc narrows toward a 45° beam, a spotlight
// fades in along the aim direction, and damage ticks get stronger and
// faster. A ground-projected sector (custom shader) shows the exact
// damage zone and pulses on every tick.
import * as THREE from 'three';

const ARC_MAX = 360;        // degrees, fully relaxed
const ARC_MIN = 45;         // degrees, fully focused beam
const RANGE_WIDE = 9;       // light/damage radius when wide
const RANGE_NARROW = 16;    // beam reaches further when focused
const DPS_WIDE = 3;         // damage per second at 360°
const DPS_NARROW = 22;      // damage per second at 45°
const TICK_WIDE = 1;      // seconds between damage ticks at 360°
const TICK_NARROW = 0.25;   // seconds between damage ticks at 45°
const FOCUS_IN_TIME = 1.1;  // seconds to fully narrow while holding click
const FOCUS_OUT_TIME = 0.45;// seconds to relax back to 360°

const SECTOR_VERT = /* glsl */`
varying vec2 vPos;
void main(){
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SECTOR_FRAG = /* glsl */`
uniform float uHalfArc;
uniform float uRange;
uniform float uDir;
uniform float uIntensity;
uniform vec3 uColor;
varying vec2 vPos;
void main(){
  float r = length(vPos);
  if (r > uRange) discard;
  float radial = 1.0 - smoothstep(uRange * 0.45, uRange, r);
  float ang = atan(vPos.y, vPos.x);
  float d = ang - uDir;
  d = abs(atan(sin(d), cos(d)));
  float angular = 1.0 - smoothstep(uHalfArc * 0.82, uHalfArc, d);
  float a = radial * angular * uIntensity;
  gl_FragColor = vec4(uColor, a);
}`;

export class Lantern {
  constructor(scene){
    this.focus = 0;       // 0 = wide 360°, 1 = narrow 45° beam
    this.tickTimer = 0;
    this.pulse = 0;
    this.lowFuel = false;

    this.point = new THREE.PointLight(0xffb168, 60, RANGE_WIDE * 1.8, 1.6);
    scene.add(this.point);

    this.spot = new THREE.SpotLight(0xffc98a, 0, RANGE_NARROW * 2.2, 1.0, 0.5, 1.1);
    scene.add(this.spot);
    scene.add(this.spot.target);

    this.uniforms = {
      uHalfArc: { value: Math.PI + 0.2 },
      uRange: { value: RANGE_WIDE },
      uDir: { value: 0 },
      uIntensity: { value: 0.1 },
      uColor: { value: new THREE.Color(1.0, 0.72, 0.4) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SECTOR_VERT,
      fragmentShader: SECTOR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sector = new THREE.Mesh(new THREE.CircleGeometry(RANGE_NARROW + 2, 96), mat);
    this.sector.rotation.x = -Math.PI / 2;
    this.sector.position.y = 0.04;
    this.sector.renderOrder = 5;
    scene.add(this.sector);
  }

  get arcDeg(){ return ARC_MAX + (ARC_MIN - ARC_MAX) * this.focus; }
  get range(){ return RANGE_WIDE + (RANGE_NARROW - RANGE_WIDE) * this.focus; }

  // Returns a damage tick {damage, halfArc, range} when one fires, else null.
  update(dt, playerPos, aimDir, focusing, time){
    this.focus += focusing ? dt / FOCUS_IN_TIME : -dt / FOCUS_OUT_TIME;
    this.focus = Math.min(1, Math.max(0, this.focus));
    const f = this.focus;
    const arcRad = this.arcDeg * Math.PI / 180;
    const range = this.range;

    let flicker = 1 + 0.06 * Math.sin(time * 11) + 0.04 * Math.sin(time * 23 + 1.7);
    if (this.lowFuel) flicker *= 0.75 + 0.25 * Math.sin(time * 31) * Math.sin(time * 7.3);

    const lx = playerPos.x + aimDir.x * 0.5;
    const lz = playerPos.z + aimDir.z * 0.5;

    this.point.position.set(lx, 1.6, lz);
    this.point.intensity = (60 + (16 - 60) * f) * flicker;
    this.point.distance = RANGE_WIDE * 1.8 + (9 - RANGE_WIDE * 1.8) * f;

    this.spot.position.set(lx, 1.7, lz);
    this.spot.target.position.set(playerPos.x + aimDir.x * range, 0.3, playerPos.z + aimDir.z * range);
    this.spot.angle = Math.min(1.15, Math.max(0.12, arcRad / 2 * 1.05));
    this.spot.intensity = Math.pow(f, 1.4) * 180 * flicker;
    this.spot.distance = range * 2.2;

    this.pulse = Math.max(0, this.pulse - dt * 4);
    this.uniforms.uHalfArc.value = this.arcDeg >= 355 ? Math.PI + 0.2 : arcRad / 2;
    this.uniforms.uRange.value = range;
    this.uniforms.uDir.value = Math.atan2(-aimDir.z, aimDir.x);
    this.uniforms.uIntensity.value = (0.07 + 0.09 * f + 0.02 * this.pulse) * flicker;
    this.sector.position.set(playerPos.x, 0.04, playerPos.z);

    this.tickTimer += dt;
    const interval = TICK_WIDE + (TICK_NARROW - TICK_WIDE) * f;
    if (this.tickTimer >= interval){
      this.tickTimer = 0;
      this.pulse = 1;
      const k = Math.pow(f, 1.15);
      const dps = DPS_WIDE + (DPS_NARROW - DPS_WIDE) * k;
      return {
        damage: dps * interval,
        halfArc: this.arcDeg >= 355 ? Math.PI : arcRad / 2,
        range,
      };
    }
    return null;
  }
}
