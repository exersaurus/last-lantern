// XP, levels, and the three lantern skill paths.
//
// Balance target: level ~30-40 when the 10:00 fuel runs out.
//   xpForKill   2 XP at minute 0, +1.6 XP per elapsed minute
//   xpToNext    18 + 5 * level
// Reaching level 35 costs ~3,640 XP ≈ 230-280 kills on a strong run.

export function xpForKill(elapsedMin){ return Math.round(3 + 1.6 * elapsedMin); }
export function xpToNext(level){ return 18 + 5 * level; }

export const ULT_UNLOCK = 10; // points in a path's passives to unlock its ultimate

// 8x8 pixel-art icons, rendered to SVG rects.
const ICONS = {
  wideDamage: [
    '...##...',
    '.#.##.#.',
    '..####..',
    '########',
    '..####..',
    '.#.##.#.',
    '...##...',
    '........',
  ],
  lightRadius: [
    '..####..',
    '.#....#.',
    '#..##..#',
    '#.####.#',
    '#.####.#',
    '#..##..#',
    '.#....#.',
    '..####..',
  ],
  lightTheWorld: [
    '#..##..#',
    '.#.##.#.',
    '..####..',
    '########',
    '########',
    '..####..',
    '.#.##.#.',
    '#..##..#',
  ],
  moveSpeed: [
    '#...#...',
    '##..##..',
    '.##..##.',
    '..##..##',
    '.##..##.',
    '##..##..',
    '#...#...',
    '........',
  ],
  health: [
    '.##..##.',
    '########',
    '########',
    '########',
    '.######.',
    '..####..',
    '...##...',
    '........',
  ],
  dash: [
    '....####',
    '...###..',
    '..###...',
    '.######.',
    '...###..',
    '..###...',
    '.###....',
    '###.....',
  ],
  beamDamage: [
    '#.......',
    '###.....',
    '#####...',
    '########',
    '########',
    '#####...',
    '###.....',
    '#.......',
  ],
  fastFocus: [
    '.######.',
    '.#....#.',
    '..#..#..',
    '...##...',
    '...##...',
    '..#..#..',
    '.#.##.#.',
    '.######.',
  ],
  focusState: [
    '........',
    '..####..',
    '.#....#.',
    '#..##..#',
    '#..##..#',
    '.#....#.',
    '..####..',
    '........',
  ],
};

export function iconSvg(id){
  const map = ICONS[id];
  let rects = '';
  for (let y = 0; y < map.length; y++){
    for (let x = 0; x < map[y].length; x++){
      if (map[y][x] !== '.') rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }
  }
  return `<svg viewBox="0 0 8 8" shape-rendering="crispEdges" fill="currentColor">${rects}</svg>`;
}

export const PATHS = [
  {
    id: 'aura', name: 'AURA', color: '#ffd36b',
    skills: [
      { id: 'wideDamage', name: 'Wide Damage', max: 10,
        desc: '+10% wide (360°) light damage per rank.' },
      { id: 'lightRadius', name: 'Light Radius', max: 10,
        desc: '+1 light radius per rank (beam gains half).' },
      { id: 'lightTheWorld', name: 'Light the World', max: 10, ultimate: true, key: 'E',
        desc: 'Pulse of light hits every ghoul on screen for 300% of wide damage, +150% per extra rank. 20s cooldown.' },
    ],
  },
  {
    id: 'physique', name: 'PHYSIQUE', color: '#8fe07a',
    skills: [
      { id: 'moveSpeed', name: 'Move Speed', max: 10,
        desc: '+10% movement speed per rank.' },
      { id: 'health', name: 'Health', max: 10,
        desc: '+10 max HP per rank (heals 10 on invest).' },
      { id: 'dash', name: 'In a Flash', max: 10, ultimate: true, key: 'SPACE',
        desc: 'Dash toward the cursor, invulnerable while moving. 14s cooldown, -1s per extra rank.' },
    ],
  },
  {
    id: 'focus', name: 'FOCUS', color: '#7fc8ff',
    skills: [
      { id: 'beamDamage', name: 'Beam Damage', max: 10,
        desc: '+10% beam (45°) damage per rank.' },
      { id: 'fastFocus', name: 'Fast Focus', max: 10,
        desc: 'Focus the light 0.1s faster per rank.' },
      { id: 'focusState', name: 'Focus State', max: 10, ultimate: true, key: 'R',
        desc: 'For 5s (+1s per extra rank) beam range and damage +50%. 20s cooldown.' },
    ],
  },
];

export class Progression {
  constructor(){
    this.level = 1;
    this.xp = 0;
    this.points = 0;
    this.ranks = {};
    for (const path of PATHS) for (const s of path.skills) this.ranks[s.id] = 0;
  }

  get next(){ return xpToNext(this.level); }

  // returns the number of levels gained
  addXp(amount){
    this.xp += amount;
    let ups = 0;
    while (this.xp >= this.next){
      this.xp -= this.next;
      this.level++;
      this.points++;
      ups++;
    }
    return ups;
  }

  pathInvested(path){
    let n = 0;
    for (const s of path.skills) if (!s.ultimate) n += this.ranks[s.id];
    return n;
  }

  isUnlocked(path, skill){
    return !skill.ultimate || this.pathInvested(path) >= ULT_UNLOCK;
  }

  canRank(path, skill){
    return this.points > 0 && this.ranks[skill.id] < skill.max && this.isUnlocked(path, skill);
  }

  invest(path, skill){
    if (!this.canRank(path, skill)) return false;
    this.points--;
    this.ranks[skill.id]++;
    return true;
  }

  // ---- derived modifiers
  get wideDamageMult(){ return 1 + 0.1 * this.ranks.wideDamage; }
  get radiusBonus(){ return this.ranks.lightRadius; }
  get moveSpeedMult(){ return 1 + 0.1 * this.ranks.moveSpeed; }
  get maxHpBonus(){ return 10 * this.ranks.health; }
  get beamDamageMult(){ return 1 + 0.1 * this.ranks.beamDamage; }
  get focusTimeReduction(){ return 0.1 * this.ranks.fastFocus; }
  // Light the World: rank 1 = 300% of wide DPS, +50% of that base per extra rank
  get pulseDamageMult(){ return this.ranks.lightTheWorld ? 3 + 1.5 * (this.ranks.lightTheWorld - 1) : 0; }
  get dashCooldown(){ return 14 - (this.ranks.dash - 1); }
  get focusStateDuration(){ return 5 + (this.ranks.focusState - 1); }
}
