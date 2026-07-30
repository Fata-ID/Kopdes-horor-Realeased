/* ui.js — Screen transitions, UI state, and Menu Audio */
'use strict';

/* ──────────────────────────────────────────────
   MENU AUDIO SYSTEM
   Place your audio file at: assets/audio/menu_ambience.mp3
   (or .ogg / .wav — all three formats are tried)
────────────────────────────────────────────── */
const MenuAudio = (() => {
  let audio = null;
  let fadeInterval = null;
  let sourceIdx = 0;
  let wantsPlay = false; // true if play() was requested before a source finished loading
  const VOLUME = 0.4;
  // Tried in order — mp3 first for best browser support, then ogg, then wav.
  // If a format's file is missing or unsupported, onerror advances to the next.
  const SOURCES = [
    'assets/audio/menu_ambience.mp3',
    'assets/audio/menu_ambience.ogg',
    'assets/audio/menu_ambience.wav',
  ];

  function init() {
    audio = new Audio();
    audio.loop = true;
    audio.volume = 0;
    audio.preload = 'auto';
    sourceIdx = 0;
    attachSource(SOURCES[sourceIdx]);

    audio.onerror = () => {
      // This format/file failed — try the next one in the list.
      sourceIdx++;
      if (sourceIdx < SOURCES.length) {
        attachSource(SOURCES[sourceIdx]);
      } else {
        // All formats failed — silently give up, game still works without music.
        console.warn('[MenuAudio] No playable menu_ambience file found in assets/audio/');
      }
    };

    audio.oncanplaythrough = () => {
      if (wantsPlay) {
        wantsPlay = false;
        play();
      }
    };
  }

  function attachSource(src) {
    audio.src = src;
    audio.load();
  }

  function fadeTo(targetVol, durationMs, onDone) {
    if (!audio) return;
    clearInterval(fadeInterval);
    const startVol = audio.volume;
    const diff = targetVol - startVol;
    const steps = 30;
    const stepMs = durationMs / steps;
    let step = 0;
    fadeInterval = setInterval(() => {
      step++;
      audio.volume = Math.max(0, Math.min(1, startVol + diff * (step / steps)));
      if (step >= steps) {
        clearInterval(fadeInterval);
        if (onDone) onDone();
      }
    }, stepMs);
  }

  function play() {
    if (!audio) return;
    if (audio.readyState < 2) {
      // Not loaded enough to play yet — try again once it's ready.
      wantsPlay = true;
      return;
    }
    try { audio.currentTime = 0; } catch (e) {}
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.then(() => {
        fadeTo(VOLUME, 2000);
      }).catch(() => {
        // Autoplay blocked — will try on next user interaction
      });
    }
  }

  function stop(instantly) {
    if (!audio) return;
    if (instantly) {
      clearInterval(fadeInterval);
      audio.pause();
      audio.volume = 0;
    } else {
      fadeTo(0, 1000, () => audio.pause());
    }
  }

  function tryResume() {
    // Called on first user gesture
    if (!audio || !audio.paused) return;
    audio.play().then(() => fadeTo(VOLUME, 1500)).catch(() => {});
  }

  return { init, play, stop, tryResume };
})();


/* ──────────────────────────────────────────────
   MAIN UI MODULE
────────────────────────────────────────────── */
const UI = (() => {
  const CORRUPTED_STRINGS = [
    'ERROR_404_SOUL_NOT_FOUND',
    'SYS_PANIC: CANNOT_EXIT',
    '01001000 01000101 01001100 01010000',
    'YOU SHOULD NOT IN HERE',
    'HE-----SEE--YOU',
    'DONT LOOK YOUR_BACK',
    'MEMORY_CORRUPTION_AT_0xDEAD',
    'FATAL: SANITY_CHECK_FAILED',
    'WARNING: ENTITY_DETECTED_PROXIMITY_0M',
    'INDEX: KORBAN_KE_267_MASUK_LABIRIN',
    '6767676767',
    '666',
    '[ SIGNAL LOST ]',
    'WESDI_WESDI_SJUKUR',
    '̷̡̛̗̹͚͙̘̫̊̒̿͗̈̒k̷͔̹͍̦̺̳̓̐̓̔å̷̙̞̹̼̤m̸̛͉u̴̢̘̅̚ ̸͍͆s̷͖͂u̴̢̘̅̚d̸͉͆å̷̙̞̹̼̤h̷̓̈ ̸͍͆m̸̛͉å̷̙̞̹̼̤t̷͔̹͍̦̺̳̓i̷͔̹͍̦̺̳̓',
  ];

  const LOADING_MESSAGES = [
    'LOADING NIGHTMARE...',
    'PUTTING SEMBAKO...',
    'WAKING ENTITIES...',
    'LOADING LAST MEMORIES...',
    'CONFIGURING.....IDK WHAT SHOULD I WRITE..',
    'APA LAGI YA WKWKWK...',
    'ALMOST DONE... OR NO',
  ];

  let activeScreen = null;
  let firstInteraction = false;

  function init() {
    // Init audio system
    MenuAudio.init();

    // Capture first user interaction for autoplay policy
    const unlockAudio = () => {
      if (!firstInteraction) {
        firstInteraction = true;
        MenuAudio.tryResume();
      }
    };
    document.addEventListener('click', unlockAudio, { once: true });
    document.addEventListener('touchstart', unlockAudio, { once: true });

    // Button handlers
    document.getElementById('btn-play').addEventListener('click', startGame);
    document.getElementById('btn-howto').addEventListener('click', () => showScreen('howto-screen'));
    document.getElementById('btn-credits').addEventListener('click', () => showScreen('credits-screen'));
    document.getElementById('btn-back-howto').addEventListener('click', () => showScreen('home-screen'));
    document.getElementById('btn-back-credits').addEventListener('click', () => showScreen('home-screen'));

    // Game buttons
    document.getElementById('btn-resume').addEventListener('click', GameEngine.resume);
    document.getElementById('btn-quit').addEventListener('click', quitToMenu);
    document.getElementById('btn-retry').addEventListener('click', retryGame);
    document.getElementById('btn-quit-death').addEventListener('click', quitToMenu);
    document.getElementById('btn-retry-win').addEventListener('click', retryGame);
    document.getElementById('btn-quit-win').addEventListener('click', quitToMenu);

    // Touch controls for mobile
    setupTouchControls();

    // Corrupted text atmosphere
    startCorruptedText('corrupted-text');
    startCorruptedText('corrupted-text-home');
  }

  function startLoading(onComplete) {
    const bar = document.getElementById('loading-bar');
    const pct = document.getElementById('loading-percent');
    const txt = document.getElementById('loading-text');
    let progress = 0;
    let msgIdx = 0;

    const interval = setInterval(() => {
      progress += Math.random() * 8 + 2;
      if (progress > 100) progress = 100;

      bar.style.width = progress + '%';
      pct.textContent = Math.floor(progress) + '%';

      if (progress > (msgIdx+1) * (100/LOADING_MESSAGES.length)) {
        msgIdx = Math.min(msgIdx+1, LOADING_MESSAGES.length-1);
        txt.textContent = LOADING_MESSAGES[msgIdx];
      }

      if (Math.random() < 0.1) {
        bar.style.width = (progress - Math.random()*15) + '%';
        setTimeout(() => { bar.style.width = progress + '%'; }, 80);
      }

      if (progress >= 100) {
        clearInterval(interval);
        pct.textContent = '100%';
        txt.textContent = 'WELCOME TO HELL :-).';
        setTimeout(() => {
          showScreen('home-screen');
          MenuAudio.play(); // Start menu music
          if (onComplete) onComplete();
        }, 900);
      }
    }, 60);
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => {
      s.classList.remove('active');
      s.style.display = 'none';
    });
    activeScreen = id;
    const el = document.getElementById(id);
    el.style.display = 'flex';
    void el.offsetWidth;
    el.classList.add('active');

    // Play menu music on home/howto/credits screens
    if (id === 'home-screen' || id === 'howto-screen' || id === 'credits-screen') {
      MenuAudio.tryResume();
    }
  }

  function startGame() {
    MenuAudio.stop(false); // Fade out menu music
    showScreen('game-screen');
    GameEngine.start();
  }

  function retryGame() {
    document.getElementById('caught-screen').classList.add('hidden');
    document.getElementById('win-screen').classList.add('hidden');
    GameEngine.restart();
  }

  function quitToMenu() {
    document.getElementById('caught-screen').classList.add('hidden');
    document.getElementById('win-screen').classList.add('hidden');
    document.getElementById('pause-menu').classList.add('hidden');
    GameEngine.stop();
    showScreen('home-screen');
    MenuAudio.play(); // Resume menu music on return
  }

  function startCorruptedText(id) {
    const el = document.getElementById(id);
    if (!el) return;
    setInterval(() => {
      const str = CORRUPTED_STRINGS[Math.floor(Math.random() * CORRUPTED_STRINGS.length)];
      el.innerHTML = str.split('').map(c =>
        Math.random() < 0.05 ?
        `<span style="color:rgba(255,0,34,0.6)">${c}</span>` : c
      ).join('');
    }, 2000 + Math.random() * 3000);
  }

  /* ── TOUCH CONTROLS (mobile) ── */
  function setupTouchControls() {
    const tc = document.getElementById('touch-controls');
    if (!tc) return;

    // Joystick
    const joystick = document.getElementById('joystick-area');
    const joystickKnob = document.getElementById('joystick-knob');
    let joystickTouchId = null; // identifier of the touch owning the joystick
    let joystickOrigin = { x: 0, y: 0 };
    const MAX_DIST = 45;

    // Helper: find a touch in a TouchList by identifier
    function findTouch(touchList, id) {
      for (let i = 0; i < touchList.length; i++) {
        if (touchList[i].identifier === id) return touchList[i];
      }
      return null;
    }

    function resetJoystick() {
      joystickTouchId = null;
      joystickKnob.style.transform = 'translate(-50%,-50%)';
      GameEngine.setMobileJoystick(0, 0);
    }

    joystick.addEventListener('touchstart', e => {
      e.preventDefault();
      if (joystickTouchId !== null) return; // already tracking a touch
      const t = e.changedTouches[0];
      joystickTouchId = t.identifier;
      const rect = joystick.getBoundingClientRect();
      joystickOrigin.x = rect.left + rect.width / 2;
      joystickOrigin.y = rect.top + rect.height / 2;
      joystickKnob.style.transform = 'translate(-50%,-50%)';
    }, { passive: false });

    joystick.addEventListener('touchmove', e => {
      e.preventDefault();
      if (joystickTouchId === null) return;
      const t = findTouch(e.touches, joystickTouchId);
      if (!t) return;
      let dx = t.clientX - joystickOrigin.x;
      let dy = t.clientY - joystickOrigin.y;
      const dist = Math.sqrt(dx*dx+dy*dy);
      if (dist > MAX_DIST) { dx *= MAX_DIST/dist; dy *= MAX_DIST/dist; }
      joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

      const threshold = 8;
      const ndx = dist > threshold ? dx / MAX_DIST : 0;
      const ndy = dist > threshold ? dy / MAX_DIST : 0;
      GameEngine.setMobileJoystick(ndx, ndy);
    }, { passive: false });

    joystick.addEventListener('touchend', e => {
      e.preventDefault();
      if (!findTouch(e.changedTouches, joystickTouchId)) return;
      resetJoystick();
    }, { passive: false });

    joystick.addEventListener('touchcancel', e => {
      e.preventDefault();
      resetJoystick();
    }, { passive: false });

    // Look area (right side swipe)
    const lookArea = document.getElementById('look-area');
    let lookTouchId = null; // identifier of the touch owning the look drag
    let lookLastX = 0, lookLastY = 0;

    function resetLook() {
      lookTouchId = null;
    }

    lookArea.addEventListener('touchstart', e => {
      e.preventDefault();
      if (lookTouchId !== null) return; // already tracking a touch
      const t = e.changedTouches[0];
      lookTouchId = t.identifier;
      lookLastX = t.clientX;
      lookLastY = t.clientY;
    }, { passive: false });

    lookArea.addEventListener('touchmove', e => {
      e.preventDefault();
      if (lookTouchId === null) return;
      const t = findTouch(e.touches, lookTouchId);
      if (!t) return;
      const dx = t.clientX - lookLastX;
      const dy = t.clientY - lookLastY;
      lookLastX = t.clientX;
      lookLastY = t.clientY;
      GameEngine.addMouseDelta(dx * 1.5, dy * 1.5);
    }, { passive: false });

    lookArea.addEventListener('touchend', e => {
      e.preventDefault();
      if (!findTouch(e.changedTouches, lookTouchId)) return;
      resetLook();
    }, { passive: false });

    lookArea.addEventListener('touchcancel', e => {
      e.preventDefault();
      resetLook();
    }, { passive: false });

    // Action buttons — each tracks its own touch identifier so pressing
    // run + interact with different fingers (on top of joystick + look)
    // never gets confused, even with 3-4 simultaneous touches.
    const runBtn = document.getElementById('btn-run-mobile');
    let runTouchId = null;
    runBtn.addEventListener('touchstart', e => {
      e.preventDefault();
      if (runTouchId !== null) return;
      runTouchId = e.changedTouches[0].identifier;
      GameEngine.setMobileRun(true);
    }, { passive: false });
    runBtn.addEventListener('touchend', e => {
      e.preventDefault();
      if (!findTouch(e.changedTouches, runTouchId)) return;
      runTouchId = null;
      GameEngine.setMobileRun(false);
    }, { passive: false });
    runBtn.addEventListener('touchcancel', e => {
      e.preventDefault();
      runTouchId = null;
      GameEngine.setMobileRun(false);
    }, { passive: false });

    const interactBtn = document.getElementById('btn-interact-mobile');
    let interactTouchId = null;
    interactBtn.addEventListener('touchstart', e => {
      e.preventDefault();
      if (interactTouchId !== null) return;
      interactTouchId = e.changedTouches[0].identifier;
      GameEngine.triggerMobileInteract();
    }, { passive: false });
    interactBtn.addEventListener('touchend', e => {
      e.preventDefault();
      if (!findTouch(e.changedTouches, interactTouchId)) return;
      interactTouchId = null;
    }, { passive: false });
    interactBtn.addEventListener('touchcancel', e => {
      e.preventDefault();
      interactTouchId = null;
    }, { passive: false });

    // Safety net: if a touch is interrupted anywhere (e.g. OS gesture,
    // incoming call), release any stuck joystick/look/button state so
    // 3+ finger multi-touch (joystick + look + run/interact) never
    // leaves a control stuck "on".
    document.addEventListener('touchcancel', () => {
      resetJoystick();
      resetLook();
      runTouchId = null;
      interactTouchId = null;
      GameEngine.setMobileRun(false);
    }, { passive: true });
  }

  // ── UI HELPERS ──────────────────────────────────────────
  function showKeyCollected(index) {
    const slot = document.getElementById('key' + index);
    if (slot) slot.classList.add('collected');
    showFlash('green');
  }

  function showCaught() {
    document.getElementById('caught-screen').classList.remove('hidden');
  }

  function showWin() {
    document.getElementById('win-screen').classList.remove('hidden');
  }

  function showPause() {
    document.getElementById('pause-menu').classList.remove('hidden');
  }

  function hidePause() {
    document.getElementById('pause-menu').classList.add('hidden');
  }

  function showInteractPrompt(text) {
    const el = document.getElementById('interact-prompt');
    el.textContent = text;
    el.classList.remove('hidden');
  }

  function hideInteractPrompt() {
    document.getElementById('interact-prompt').classList.add('hidden');
  }

  function setStamina(pct) {
    const fill = document.getElementById('stamina-fill');
    if (fill) fill.style.width = (pct * 100) + '%';
  }

  function setSanity(pct) {
    const fill = document.getElementById('sanity-fill');
    if (fill) fill.style.width = (pct * 100) + '%';
  }

  function showGhostWarning(show) {
    const el = document.getElementById('ghost-warning');
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
  }

  function showFlash(type) {
    const el = document.getElementById('red-flash');
    if (!el) return;
    if (type === 'red') {
      el.style.background = 'rgba(255,0,0,0.35)';
    } else if (type === 'white') {
      el.style.background = 'rgba(255,255,255,0.5)';
    } else if (type === 'green') {
      el.style.background = 'rgba(0,255,100,0.15)';
    }
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 150);
  }

  function setVignetteIntensity(intensity) {
    const v = document.getElementById('vignette');
    if (!v) return;
    const inner = 50 - intensity * 30;
    v.style.background = `radial-gradient(ellipse at center, transparent ${inner}%, rgba(0,0,0,${0.6 + intensity * 0.4}) 100%)`;
  }

  function screenShake() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    canvas.classList.add('shaking');
    setTimeout(() => canvas.classList.remove('shaking'), 350);
  }

  function showPointerLock() {
    document.getElementById('pointer-lock-overlay').classList.remove('hidden');
  }

  function hidePointerLock() {
    document.getElementById('pointer-lock-overlay').classList.add('hidden');
  }

  function resetKeys() {
    for (let i = 0; i < 3; i++) {
      const slot = document.getElementById('key' + i);
      if (slot) slot.classList.remove('collected');
    }
  }

  return {
    init, startLoading, showScreen,
    showKeyCollected, showCaught, showWin,
    showPause, hidePause,
    showInteractPrompt, hideInteractPrompt,
    setStamina, setSanity,
    showGhostWarning, showFlash,
    setVignetteIntensity, screenShake,
    showPointerLock, hidePointerLock,
    resetKeys,
  };
})();
