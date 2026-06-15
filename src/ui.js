import { iconSvg, ULT_UNLOCK } from './skills.js';

export function fmtTime(sec){
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const IDS = [
  'hpFill', 'hpText', 'fuelFill', 'fuelText', 'fuelRow', 'timer', 'kills',
  'focusText', 'focusFill', 'hitFlash', 'startOverlay', 'startBtn',
  'endOverlay', 'endTitle', 'endSub', 'endStats', 'restartBtn',
  'settingsBtn', 'settingsPanel', 'volumeSlider',
  'xpFill', 'xpText', 'levelText',
  'skillsBtn', 'skillsOverlay', 'skillCols', 'skillLevel', 'skillPoints',
  'levelUpBanner', 'skillsClose',
  'abDash', 'abPulse', 'abFocus',
  'bossBars', 'bossBanner',
];

export class UI {
  constructor(){
    this.el = {};
    for (const id of IDS) this.el[id] = document.getElementById(id);
    this.el.restartBtn.addEventListener('click', () => location.reload());

    this.el.settingsBtn.addEventListener('click', () => {
      this.el.settingsPanel.classList.toggle('hidden');
    });
    document.addEventListener('click', e => {
      if (!this.el.settingsPanel.classList.contains('hidden') &&
          !this.el.settingsPanel.contains(e.target) &&
          e.target !== this.el.settingsBtn) {
        this.el.settingsPanel.classList.add('hidden');
      }
    });

    this.onSkillsToggle = null;
    this.onSkillsClose = null;
    this.el.skillsBtn.addEventListener('click', e => { e.target.blur(); this.onSkillsToggle?.(); });
    this.el.skillsClose.addEventListener('click', e => { e.target.blur(); this.onSkillsClose?.(); });
    this.skillNodes = new Map(); // skillId -> { el, rankEl, path, skill }
    this.pathReqEls = new Map(); // pathId -> invested-count element
  }

  bindStart(cb){ this.el.startBtn.addEventListener('click', cb, { once: true }); }
  hideStart(){ this.el.startOverlay.classList.add('hidden'); }

  setHP(hp, max){
    this.el.hpFill.style.width = `${Math.max(0, hp / max * 100)}%`;
    this.el.hpText.textContent = `${Math.max(0, Math.ceil(hp))}/${max}`;
  }

  setFuel(sec, max){
    this.el.fuelFill.style.width = `${Math.max(0, sec / max * 100)}%`;
    this.el.fuelText.textContent = fmtTime(sec);
    this.el.fuelRow.classList.toggle('low', sec < 60 && sec > 0);
  }

  setFocus(arcDeg, focus){
    this.el.focusText.textContent = `LIGHT ${Math.round(arcDeg)}°`;
    this.el.focusFill.style.width = `${focus * 100}%`;
  }

  setStats(kills, elapsed){
    this.el.kills.textContent = `${kills}`;
    this.el.timer.textContent = fmtTime(elapsed);
  }

  setXP(prog){
    this.el.levelText.textContent = `LVL ${prog.level}`;
    this.el.xpFill.style.width = `${Math.min(100, prog.xp / prog.next * 100)}%`;
    this.el.xpText.textContent = `${prog.xp}/${prog.next}`;
    this.el.skillLevel.textContent = `${prog.level}`;
    this.el.skillPoints.textContent = `${prog.points}`;
  }

  hitFlash(){
    const f = this.el.hitFlash;
    f.classList.remove('hit');
    void f.offsetWidth; // restart the CSS animation
    f.classList.add('hit');
  }

  setAudio(audio){
    this.audio = audio;
    this.el.volumeSlider.addEventListener('input', () => {
      audio.volume = this.el.volumeSlider.value / 100;
    });
  }

  // ------------------------------------------------------------ skill tree

  buildSkills(paths, onInvest){
    for (const path of paths){
      const col = document.createElement('div');
      col.className = 'skill-col';
      col.style.setProperty('--path-color', path.color);

      const h = document.createElement('h3');
      h.textContent = path.name;
      h.style.color = path.color;
      col.appendChild(h);

      const req = document.createElement('div');
      req.className = 'path-req';
      col.appendChild(req);
      this.pathReqEls.set(path.id, req);

      path.skills.forEach((skill, i) => {
        if (i > 0){
          const link = document.createElement('div');
          link.className = 'skill-link';
          col.appendChild(link);
        }
        const node = document.createElement('div');
        node.className = 'skill-node locked';
        node.style.color = path.color;

        const icon = document.createElement('div');
        icon.className = 'skill-icon';
        icon.innerHTML = iconSvg(skill.id);
        node.appendChild(icon);

        const rank = document.createElement('div');
        rank.className = 'skill-rank';
        rank.textContent = `0/${skill.max}`;
        node.appendChild(rank);

        const tip = document.createElement('div');
        tip.className = 'skill-tip';
        const hotkey = skill.key ? `<br/><span class="tip-key">[${skill.key}]</span>` : '';
        const reqTxt = skill.ultimate ? `<br/><span class="tip-req">Requires ${ULT_UNLOCK} points in ${path.name}</span>` : '';
        tip.innerHTML = `<b style="color:${path.color}">${skill.name}</b><br/>${skill.desc}${hotkey}${reqTxt}`;
        node.appendChild(tip);

        node.addEventListener('click', () => onInvest(path, skill));
        col.appendChild(node);
        this.skillNodes.set(skill.id, { el: node, rankEl: rank, path, skill });
      });

      this.el.skillCols.appendChild(col);
    }
  }

  refreshSkills(prog, paths){
    for (const path of paths){
      const invested = prog.pathInvested(path);
      this.pathReqEls.get(path.id).textContent = `INVESTED ${invested}/${ULT_UNLOCK}`;
      for (const skill of path.skills){
        const node = this.skillNodes.get(skill.id);
        const rank = prog.ranks[skill.id];
        const unlocked = prog.isUnlocked(path, skill);
        node.el.classList.toggle('locked', !unlocked);
        node.el.classList.toggle('can', prog.canRank(path, skill));
        node.el.classList.toggle('ranked', rank > 0);
        node.el.classList.toggle('maxed', rank >= skill.max);
        node.rankEl.textContent = `${rank}/${skill.max}`;
      }
    }
    this.el.skillPoints.textContent = `${prog.points}`;
    this.el.skillLevel.textContent = `${prog.level}`;
  }

  showSkills(prog, paths, leveled){
    this.refreshSkills(prog, paths);
    this.el.levelUpBanner.classList.toggle('hidden', !leveled);
    this.el.skillsOverlay.classList.remove('hidden');
  }

  hideSkills(){ this.el.skillsOverlay.classList.add('hidden'); }

  // ------------------------------------------------------------ ability dock

  initDock(paths){
    const find = id => {
      for (const p of paths) for (const s of p.skills) if (s.id === id) return p;
    };
    const slots = [
      ['abDash', 'dash'],
      ['abPulse', 'lightTheWorld'],
      ['abFocus', 'focusState'],
    ];
    for (const [slot, skillId] of slots){
      const el = this.el[slot];
      el.querySelector('.ab-icon').innerHTML = iconSvg(skillId);
      el.querySelector('.ab-icon').style.color = find(skillId).color;
    }
  }

  setAbility(slot, { rank, cd, cdMax, active }){
    const el = this.el[slot];
    el.classList.toggle('locked', rank < 1);
    el.classList.toggle('active', active > 0);
    const onCd = rank >= 1 && cd > 0.05;
    el.querySelector('.ab-cd').style.height = onCd ? `${cd / cdMax * 100}%` : '0%';
    const txt = el.querySelector('.ab-cdtxt');
    if (active > 0) txt.textContent = `${Math.ceil(active)}`;
    else txt.textContent = onCd ? `${Math.ceil(cd)}` : '';
  }

  // ------------------------------------------------------------ bosses

  announce(text, color = '#ff6b6b'){
    const el = this.el.bossBanner;
    el.textContent = text;
    el.style.color = color;
    el.classList.remove('show');
    void el.offsetWidth; // restart the animation
    el.classList.add('show');
  }

  updateBosses(list){
    const key = list.map(b => b.id).join(',');
    if (key !== this._bossKey){
      this._bossKey = key;
      this.el.bossBars.innerHTML = '';
      this._bossEls = new Map();
      for (const b of list){
        const row = document.createElement('div');
        row.className = 'boss-row';
        const name = document.createElement('div');
        name.className = 'boss-name';
        name.textContent = b.name;
        name.style.color = b.color;
        const bar = document.createElement('div');
        bar.className = 'boss-bar';
        const fill = document.createElement('div');
        fill.className = 'boss-fill';
        fill.style.background = b.color;
        bar.appendChild(fill);
        row.appendChild(name);
        row.appendChild(bar);
        this.el.bossBars.appendChild(row);
        this._bossEls.set(b.id, fill);
      }
    }
    for (const b of list){
      const fill = this._bossEls.get(b.id);
      if (fill) fill.style.width = `${Math.max(0, b.hp / b.maxHp * 100)}%`;
    }
  }

  showEnd(title, sub, stats){
    this.el.endTitle.textContent = title;
    this.el.endSub.innerHTML = sub;
    this.el.endStats.innerHTML = stats;
    this.el.endOverlay.classList.remove('hidden');
  }
}
