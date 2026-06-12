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

  showEnd(title, sub, stats){
    this.el.endTitle.textContent = title;
    this.el.endSub.innerHTML = sub;
    this.el.endStats.innerHTML = stats;
    this.el.endOverlay.classList.remove('hidden');
  }
}
