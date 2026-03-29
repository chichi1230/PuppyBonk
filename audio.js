/**
 * 复古 8-bit 风音效与背景音乐（Web Audio API 合成，无需外部音频文件）
 */
(() => {
  let ctx = null;
  let master = null;
  let bgmBus = null;
  let bgmTimer = null;
  let bgmStarted = false;
  let bgmStep = 0;

  const BPM = 88;
  const stepMs = Math.round(60000 / BPM / 2);

  function ensureCtx() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    bgmBus = ctx.createGain();
    bgmBus.gain.value = 0.11;
    bgmBus.connect(master);
    return ctx;
  }

  function sfxChain() {
    const g = ctx.createGain();
    g.connect(master);
    return g;
  }

  function startBgmLoop() {
    if (!ctx || bgmTimer || !bgmBus) return;
    /* 两轨：低音方波 + 高音三角，简单循环和弦感 */
    const bassLine = [98, 98, 110, 98, 87.31, 98, 110, 130.81];
    const hiLine = [392, 440, 493.88, 523.25, 440, 392, 440, 493.88];

    bgmTimer = window.setInterval(() => {
      if (!ctx || document.hidden) return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const t = ctx.currentTime;
      const i = bgmStep % 8;

      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2200;
      lp.Q.value = 0.7;

      const g1 = ctx.createGain();
      g1.gain.setValueAtTime(0.07, t);
      g1.gain.exponentialRampToValueAtTime(0.008, t + 0.14);
      g1.connect(bgmBus);
      lp.connect(g1);

      const o1 = ctx.createOscillator();
      o1.type = "square";
      o1.frequency.value = bassLine[i];
      o1.connect(lp);
      o1.start(t);
      o1.stop(t + 0.15);

      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.035, t + 0.02);
      g2.gain.exponentialRampToValueAtTime(0.006, t + 0.12);
      g2.connect(bgmBus);

      const o2 = ctx.createOscillator();
      o2.type = "triangle";
      o2.frequency.value = hiLine[i];
      o2.connect(g2);
      o2.start(t + 0.02);
      o2.stop(t + 0.13);

      bgmStep++;
    }, stepMs);
  }

  function stopBgmLoop() {
    if (bgmTimer) {
      window.clearInterval(bgmTimer);
      bgmTimer = null;
    }
  }

  function userActivate() {
    if (!ensureCtx()) return;
    if (!bgmStarted) {
      bgmStarted = true;
      startBgmLoop();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  }

  /** 轻点格子 / 按钮 */
  function playTap() {
    if (!ensureCtx()) return;
    userActivate();
    const c = ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = sfxChain();
    o.type = "square";
    o.frequency.setValueAtTime(1350, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.032);
    g.gain.setValueAtTime(0.11, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.05);
  }

  /** 消除：块数越多略丰富 */
  function playEliminate(n) {
    if (!ensureCtx()) return;
    userActivate();
    const c = ctx;
    const t = c.currentTime;
    const steps = Math.min(Math.max(n, 2), 10);
    for (let i = 0; i < steps; i++) {
      const o = c.createOscillator();
      const g = sfxChain();
      o.type = "triangle";
      const f0 = 200 + i * 48 + (n % 4) * 15;
      const at = t + i * 0.026;
      o.frequency.setValueAtTime(f0, at);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.3, at + 0.055);
      g.gain.setValueAtTime(0.1, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.09);
      o.connect(g);
      o.start(at);
      o.stop(at + 0.1);
    }
  }

  /** 单关通关（进入下一关） */
  function playLevelUp() {
    if (!ensureCtx()) return;
    userActivate();
    const c = ctx;
    const t = c.currentTime;
    const notes = [523.25, 659.25, 783.99, 987.77];
    notes.forEach((freq, i) => {
      const o = c.createOscillator();
      const g = sfxChain();
      o.type = "square";
      o.frequency.value = freq;
      const at = t + i * 0.085;
      g.gain.setValueAtTime(0.1, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.14);
      o.connect(g);
      o.start(at);
      o.stop(at + 0.16);
    });
  }

  /** 全部 100 关通关 */
  function playGameClear() {
    if (!ensureCtx()) return;
    userActivate();
    const c = ctx;
    const t = c.currentTime;
    const seq = [523, 587, 659, 784, 880, 988, 1046, 1175, 1046, 988, 1046];
    seq.forEach((freq, i) => {
      const o = c.createOscillator();
      const g = sfxChain();
      o.type = "square";
      o.frequency.value = freq;
      const at = t + i * 0.095;
      g.gain.setValueAtTime(0.11, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
      o.connect(g);
      o.start(at);
      o.stop(at + 0.2);
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopBgmLoop();
    else if (bgmStarted && ctx && !bgmTimer) startBgmLoop();
  });

  window.gameAudio = {
    playTap,
    playEliminate,
    playLevelUp,
    playGameClear,
    userActivate,
  };
})();
