// The lantern weapon. A point light handles the wide 360° glow; as the
// player holds left-click the arc narrows toward a 45° beam, a spotlight
// fades in along the aim direction, and damage ticks get stronger and
// faster. A ground-projected sector (custom shader) shows the exact
// damage zone and pulses on every tick.
//
// Skill modifiers are applied through `this.mods` (set by the game each
// frame): wideMult/beamMult scale DPS, radiusBonus extends the light
// (full for wide, half for beam), focusTimeReduction speeds narrowing,
// beamBoost is 1.5 while Focus State is active.
import * as THREE from 'three';

export const ARC_MAX = 360;        // degrees, fully relaxed
export const ARC_MIN = 45;         // degrees, fully focused beam
export const RANGE_WIDE = 7;       // light/damage radius when wide
export const RANGE_NARROW = 16;    // beam reaches further when focused
export const DPS_WIDE = 2;         // damage per second at 360°
export const DPS_NARROW = 10;      // damage per second at 45°
export const TICK_WIDE = 1;      // seconds between damage ticks at 360°
export const TICK_NARROW = 0.15;   // seconds between damage ticks at 45°
export const FOCUS_IN_TIME = 1.7;  // seconds to fully narrow while holding click
export const FOCUS_OUT_TIME = 0.45;// seconds to relax back to 360°
export const PULSE_RADIUS = 30;    // Light the World reach (covers the screen)

const WARM = new THREE.Color(1.0, 0.72, 0.4);
const FOCUS_TINT = new THREE.Color(0.72, 0.88, 1.05); // Focus State blue-white

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

const RING_FRAG = /* glsl */`
uniform float uR;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vPos;
void main(){
  float r = length(vPos);
  float band = 1.0 - smoothstep(0.0, 1.6, abs(r - uR));
  gl_FragColor = vec4(uColor, band * uAlpha);
}`;

export class Lantern {
  constructor(scene){
    this.focus = 0;       // 0 = wide 360°, 1 = narrow 45° beam
    this.tickTimer = 0;
    this.pulse = 0;
    this.lowFuel = false;
    this.mods = { wideMult: 1, beamMult: 1, radiusBonus: 0, focusTimeReduction: 0, beamBoost: 1 };

    this.point = new THREE.PointLight(0xffb168, 60, RANGE_WIDE * 1.8, 1.6);
    scene.add(this.point);

    this.spot = new THREE.SpotLight(0xffc98a, 0, RANGE_NARROW * 2.2, 1.0, 0.5, 1.1);
    scene.add(this.spot);
    scene.add(this.spot.target);

    const discGeo = new THREE.CircleGeometry(34, 96);

    this.uniforms = {
      uHalfArc: { value: Math.PI + 0.2 },
      uRange: { value: RANGE_WIDE },
      uDir: { value: 0 },
      uIntensity: { value: 0.1 },
      uColor: { value: WARM.clone() },
    };
    this.sector = new THREE.Mesh(discGeo, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SECTOR_VERT,
      fragmentShader: SECTOR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.sector.rotation.x = -Math.PI / 2;
    this.sector.position.y = 0.04;
    this.sector.renderOrder = 5;
    scene.add(this.sector);

    // Light the World expanding ring
    this.ringUniforms = {
      uR: { value: 0 },
      uAlpha: { value: 0 },
      uColor: { value: new THREE.Color(1.0, 0.85, 0.55) },
    };
    this.ring = new THREE.Mesh(discGeo, new THREE.ShaderMaterial({
      uniforms: this.ringUniforms,
      vertexShader: SECTOR_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.05;
    this.ring.renderOrder = 6;
    this.ring.visible = false;
    scene.add(this.ring);
    this.pulseT = -1;
    this.burstGlow = 0;
  }

  get arcDeg(){ return ARC_MAX + (ARC_MIN - ARC_MAX) * this.focus; }
  get rangeWide(){ return RANGE_WIDE + this.mods.radiusBonus; }
  get rangeNarrow(){ return (RANGE_NARROW + this.mods.radiusBonus * 0.5) * this.mods.beamBoost; }
  get range(){ return this.rangeWide + (this.rangeNarrow - this.rangeWide) * this.focus; }
  get focusInTime(){ return Math.max(0.1, FOCUS_IN_TIME - this.mods.focusTimeReduction); }

  firePulse(){
    this.pulseT = 0;
    this.burstGlow = 1;
  }

  // Returns a damage tick {damage, halfArc, range} when one fires, else null.
  update(dt, playerPos, aimDir, focusing, time){
    this.focus += focusing ? dt / this.focusInTime : -dt / FOCUS_OUT_TIME;
    this.focus = Math.min(1, Math.max(0, this.focus));
    const f = this.focus;
    const arcRad = this.arcDeg * Math.PI / 180;
    const range = this.range;
    const focusState = this.mods.beamBoost > 1;

    let flicker = 1 + 0.06 * Math.sin(time * 11) + 0.04 * Math.sin(time * 23 + 1.7);
    if (this.lowFuel) flicker *= 0.75 + 0.25 * Math.sin(time * 31) * Math.sin(time * 7.3);

    const lx = playerPos.x + aimDir.x * 0.5;
    const lz = playerPos.z + aimDir.z * 0.5;

    this.burstGlow = Math.max(0, this.burstGlow - dt * 2.5);
    this.point.position.set(lx, 1.6, lz);
    this.point.intensity = (60 + (16 - 60) * f) * flicker + this.burstGlow * 250;
    this.point.distance = Math.max(this.rangeWide * 1.8 + (9 - this.rangeWide * 1.8) * f, this.burstGlow * 30);

    this.spot.position.set(lx, 1.7, lz);
    this.spot.target.position.set(playerPos.x + aimDir.x * range, 0.3, playerPos.z + aimDir.z * range);
    this.spot.angle = Math.min(1.15, Math.max(0.12, arcRad / 2 * 1.05));
    this.spot.intensity = Math.pow(f, 1.4) * (focusState ? 280 : 180) * flicker;
    this.spot.distance = range * 2.2;
    this.spot.color.setHex(focusState ? 0xbfe2ff : 0xffc98a);

    this.pulse = Math.max(0, this.pulse - dt * 4);
    this.uniforms.uHalfArc.value = this.arcDeg >= 355 ? Math.PI + 0.2 : arcRad / 2;
    this.uniforms.uRange.value = range;
    this.uniforms.uDir.value = Math.atan2(-aimDir.z, aimDir.x);
    this.uniforms.uIntensity.value = (0.07 + 0.09 * f + 0.05 * this.pulse) * flicker;
    this.uniforms.uColor.value.copy(WARM).lerp(FOCUS_TINT, focusState ? f : 0);
    this.sector.position.set(playerPos.x, 0.04, playerPos.z);

    // expanding Light the World ring
    if (this.pulseT >= 0){
      this.pulseT += dt;
      const k = this.pulseT / 0.6;
      if (k >= 1){
        this.pulseT = -1;
        this.ring.visible = false;
      } else {
        this.ring.visible = true;
        this.ring.position.set(playerPos.x, 0.05, playerPos.z);
        const ease = 1 - (1 - k) * (1 - k);
        this.ringUniforms.uR.value = PULSE_RADIUS * ease;
        this.ringUniforms.uAlpha.value = 0.8 * (1 - k);
      }
    }

    this.tickTimer += dt;
    const interval = TICK_WIDE + (TICK_NARROW - TICK_WIDE) * f;
    if (this.tickTimer >= interval){
      this.tickTimer = 0;
      this.pulse = 1;
      const k = Math.pow(f, 1.15);
      const dpsWide = DPS_WIDE * this.mods.wideMult;
      const dpsNarrow = DPS_NARROW * this.mods.beamMult * this.mods.beamBoost;
      const dps = dpsWide + (dpsNarrow - dpsWide) * k;
      return {
        damage: dps * interval,
        halfArc: this.arcDeg >= 355 ? Math.PI : arcRad / 2,
        range,
      };
    }
    return null;
  }
}
