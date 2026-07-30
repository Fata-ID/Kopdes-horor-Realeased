/* game.js — Core Game Engine (FIXED + MOBILE + ENHANCED) */
'use strict';

const GameEngine = (() => {
  let renderer, scene, camera;
  let clock, animId;

  let running = false;
  let paused = false;
  let gameOver = false;

  const player = {
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    speed: 7,
    runSpeed: 11,
    stamina: 1,
    sanity: 1,
    height: 1.7,
    isRunning: false,
    onGround: true,
  };

  const keys = {};
  let mouseDX = 0;
  let mouseDY = 0;
  let isPointerLocked = false;

  // Mobile state
  let mobileJoystick = { x: 0, y: 0 };
  let mobileRun = false;
  let mobileInteract = false;
  const isMobile = /Android|iPhone|iPad|iPod|Touch/i.test(navigator.userAgent) ||
                   (navigator.maxTouchPoints > 1) ||
                   (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);

  let keyPositions = [];
  let keyMeshes = [];
  let collectedKeys = [false, false, false];
  let exitPos = new THREE.Vector3();
  let exitMesh = null;
  let exitUnlocked = false;
  let doorMesh = null;
  let doorHinge = null;
  let doorBlocking = true;
  let doorOpening = false;
  let doorOpenT = 0;

  let breathTimer = 0;
  let sanityFlickerTimer = 0;
  let ambienceTimer = 0;
  let ghostNearSoundTimer = 0;
  let heartbeatTimer = 0;

  // ── AUDIO ─────────────────────────────────────────────────
  let audioCtx = null;

  function getAudioCtx() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function playTone(freq, type, duration, vol, delay) {
    const ctx = getAudioCtx(); if (!ctx) return;
    delay = delay || 0;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    gain.gain.setValueAtTime(0, ctx.currentTime + delay);
    gain.gain.linearRampToValueAtTime(vol || 0.3, ctx.currentTime + delay + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + duration + 0.05);
  }

  function playNoise(duration, vol, freq_low, freq_high) {
    const ctx = getAudioCtx(); if (!ctx) return;
    const bufSize = ctx.sampleRate * duration;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = (freq_low + freq_high) / 2;
    filter.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol || 0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    src.start(); src.stop(ctx.currentTime + duration);
  }

  let lastFootstepTime = 0;
  function playFootstep(isRunning) {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    const interval = isRunning ? 0.28 : 0.45;
    if (now - lastFootstepTime < interval) return;
    lastFootstepTime = now;
    playTone(60 + Math.random() * 20, 'sine', 0.08, 0.18);
    playNoise(0.06, 0.05, 100, 400);
  }

  function playSoundKeyPickup() {
    playTone(440, 'sine', 0.2, 0.25);
    playTone(554, 'sine', 0.2, 0.2, 0.1);
    playTone(659, 'sine', 0.3, 0.3, 0.2);
  }

  function playSoundAllKeysCollected() {
    playTone(220, 'sawtooth', 0.5, 0.15);
    playTone(277, 'sawtooth', 0.5, 0.12, 0.05);
    playTone(330, 'sawtooth', 0.5, 0.1, 0.1);
    playNoise(0.4, 0.1, 200, 800);
  }

  function playSoundGhostNear() {
    playTone(40 + Math.random() * 20, 'sawtooth', 0.3, 0.08);
    playNoise(0.2, 0.04, 50, 200);
  }

  // Continuous chase audio: a "lub-dub" heartbeat that plays only while
  // the ghost is actively chasing (info.state === 'chase') and within
  // CHASE_AUDIO_RANGE. Tempo and volume both scale with proximity.
  const CHASE_AUDIO_RANGE = 18;
  function playHeartbeatThump(vol, closeness) {
    playTone(50 + closeness * 8, 'sine', 0.14, vol);
    playNoise(0.08, vol * 0.4, 40, 150);
    playTone(42 + closeness * 6, 'sine', 0.12, vol * 0.8, 0.16);
  }
  function updateChaseHeartbeat(dt, info) {
    heartbeatTimer -= dt;
    const chasing = info.state === 'chase' && info.distToPlayer < CHASE_AUDIO_RANGE;
    if (!chasing) return;
    if (heartbeatTimer <= 0) {
      const closeness = 1 - Math.min(1, info.distToPlayer / CHASE_AUDIO_RANGE);
      const interval = 0.85 - closeness * 0.55;   // 0.85s far -> ~0.3s very close
      const vol = 0.12 + closeness * 0.22;
      playHeartbeatThump(vol, closeness);
      heartbeatTimer = interval;
    }
  }

  function playSoundCaught() {
    playNoise(0.6, 0.4, 800, 3000);
    playTone(120, 'sawtooth', 0.8, 0.3);
    playTone(60, 'square', 0.8, 0.4, 0.1);
  }

  function playSoundWin() {
    for (let i = 0; i < 5; i++) playTone(200 + i * 80, 'sine', 0.4, 0.2, i * 0.15);
  }

  function playSoundAmbient() {
    const freq = 55 + Math.random() * 30;
    playTone(freq, 'sawtooth', 2.0, 0.04);
    playTone(freq * 1.5, 'sine', 1.5, 0.02, 0.3);
  }

  // Disturbing subliminal whisper sound
  function playSoundWhisper() {
    const ctx = getAudioCtx(); if (!ctx) return;
    const freq = 180 + Math.random() * 80;
    playTone(freq, 'sine', 1.2, 0.025);
    playTone(freq * 0.99, 'sine', 1.2, 0.02, 0.05);
    playNoise(0.8, 0.012, 300, 1200);
  }

  // ── INIT ─────────────────────────────────────────────────
  function init() {
    const canvas = document.getElementById('game-canvas');

    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    // Lower pixel ratio on mobile for performance
    renderer.setPixelRatio(isMobile ? Math.min(window.devicePixelRatio, 1) : Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = false;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020200);
    scene.fog = new THREE.FogExp2(0x020200, 0.075);

    camera = new THREE.PerspectiveCamera(
      isMobile ? 90 : 80,  // Wider FOV on mobile
      window.innerWidth / window.innerHeight, 0.1, 80
    );

    clock = new THREE.Clock();

    setupInput(canvas);
    window.addEventListener('resize', onResize);

    // Show/hide mobile controls
    const tc = document.getElementById('touch-controls');
    if (tc) tc.style.display = isMobile ? 'block' : 'none';

    Minimap.init();
  }

  // ── START / RESTART ───────────────────────────────────────
  function start() {
    if (!renderer) init();
    buildWorld();
    setupPointerLock();
    running = true;
    paused = false;
    gameOver = false;
    clock.getDelta();
    clock.start();
    if (animId) cancelAnimationFrame(animId);
    loop();
    setTimeout(() => { if (running) playSoundAmbient(); }, 1000);
  }

  function restart() {
    running = false;
    if (animId) cancelAnimationFrame(animId);
    while (scene.children.length > 0) scene.remove(scene.children[0]);
    keyMeshes = [];
    collectedKeys = [false, false, false];
    exitUnlocked = false;
    doorBlocking = true;
    doorOpening = false;
    doorOpenT = 0;
    ghostNearSoundTimer = 0;
    heartbeatTimer = 0;
    UI.resetKeys();
    start();
  }

  function stop() {
    running = false; paused = false; gameOver = false;
    if (animId) cancelAnimationFrame(animId);
    Ghost.dispose();
    teardownPointerLock();
    releasePointerLock();
  }

  // ── BUILD WORLD ───────────────────────────────────────────
  function buildWorld() {
    while (scene.children.length > 0) scene.remove(scene.children[0]);

    MazeGen.build(scene);

    const startPt = MazeGen.getPlayerStart();
    player.pos.set(startPt.x, player.height, startPt.z);
    player.vel.set(0, 0, 0);
    player.yaw = 0; player.pitch = 0;
    player.stamina = 1; player.sanity = 1;

    keyPositions = MazeGen.getKeyPositions();
    collectedKeys = [false, false, false];
    keyMeshes = [];
    for (let i = 0; i < keyPositions.length; i++) {
      const kp = keyPositions[i];
      const kmesh = createKeyMesh(i);
      kmesh.position.set(kp.x, 0.9, kp.z);
      scene.add(kmesh);
      keyMeshes.push(kmesh);
    }

    const ep = MazeGen.getExitPosition();
    exitPos.set(ep.x, 0, ep.z);
    exitMesh = createExitMarker();
    exitMesh.position.set(ep.x, 0, ep.z);
    scene.add(exitMesh);

    const doorParts = createDoor();
    doorMesh = doorParts.group;
    doorHinge = doorParts.hinge;
    doorMesh.position.set(ep.x, 0, ep.z - MazeGen.CELL * 0.5);
    scene.add(doorMesh);
    doorBlocking = true;
    doorOpening = false;
    doorOpenT = 0;

    Ghost.init(scene, null);
    Ghost.loadGhostImage('assets/ghosts/ghost.png');

    camera.position.copy(player.pos);
  }

  // ── MAIN LOOP ─────────────────────────────────────────────
  function loop() {
    animId = requestAnimationFrame(loop);
    if (!running || paused || gameOver) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;
    update(dt, time);
    render(time);
  }

  function update(dt, time) {
    updatePlayer(dt, time);
    updateGhost(dt, time);
    updateKeys(dt, time);
    updateExit(dt, time);
    updateHorrorFX(dt, time);
    updateHUD(dt);
    MazeGen.updateLights(time);

    ambienceTimer -= dt;
    if (ambienceTimer <= 0) {
      ambienceTimer = 8 + Math.random() * 12;
      if (Math.random() < 0.6) playSoundAmbient();
      // Occasional whispers at low sanity
      if (player.sanity < 0.5 && Math.random() < 0.4) playSoundWhisper();
    }

    Minimap.render(
      player.pos,
      Ghost.getPosition(),
      keyPositions,
      collectedKeys,
      { x: exitPos.x, z: exitPos.z }
    );
  }

  // ── PLAYER ───────────────────────────────────────────────
  function updatePlayer(dt, time) {
    // Mouse look (desktop)
    if (isPointerLocked) {
      player.yaw   -= mouseDX * 0.0018;
      player.pitch -= mouseDY * 0.0018;
      player.pitch = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, player.pitch));
      mouseDX = 0; mouseDY = 0;
    } else if (!isPointerLocked && isMobile) {
      // Mobile: mouse deltas come from touch look area
      player.yaw   -= mouseDX * 0.003;
      player.pitch -= mouseDY * 0.003;
      player.pitch = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, player.pitch));
      mouseDX = 0; mouseDY = 0;
    }

    const euler = new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler);

    breathTimer += dt * (player.isRunning ? 12 : 4);
    if (player.isRunning) {
      const roll = Math.sin(breathTimer) * 0.018;
      camera.quaternion.setFromEuler(new THREE.Euler(player.pitch, player.yaw, roll, 'YXZ'));
    }

    camera.position.copy(player.pos);
    const bobY = Math.sin(breathTimer) * (player.isRunning ? 0.06 : 0.025);
    camera.position.y += bobY;

    const sinY = Math.sin(player.yaw);
    const cosY = Math.cos(player.yaw);
    const forward = new THREE.Vector3(-sinY, 0, -cosY);
    const right   = new THREE.Vector3( cosY,  0, -sinY);

    let moveVec = new THREE.Vector3();
    // Keyboard
    if (keys['w'] || keys['arrowup'])    moveVec.add(forward);
    if (keys['s'] || keys['arrowdown'])  moveVec.sub(forward);
    if (keys['a'] || keys['arrowleft'])  moveVec.sub(right);
    if (keys['d'] || keys['arrowright']) moveVec.add(right);

    // Mobile joystick
    if (mobileJoystick.x !== 0 || mobileJoystick.y !== 0) {
      moveVec.add(forward.clone().multiplyScalar(-mobileJoystick.y));
      moveVec.add(right.clone().multiplyScalar(mobileJoystick.x));
    }

    const isMoving = moveVec.lengthSq() > 0;
    player.isRunning = !!((keys['shift'] || mobileRun) && player.stamina > 0.05 && isMoving);

    if (player.isRunning) {
      player.stamina = Math.max(0, player.stamina - dt * 0.25);
      if (player.stamina <= 0) player.isRunning = false;
    } else {
      player.stamina = Math.min(1, player.stamina + dt * 0.15);
    }

    const spd = player.isRunning ? player.runSpeed : player.speed;
    if (isMoving) {
      moveVec.normalize().multiplyScalar(spd * dt);
      playFootstep(player.isRunning);
    }

    const margin = 0.4;
    const nx = player.pos.x + moveVec.x;
    const nz = player.pos.z + moveVec.z;
    if (!MazeGen.isWall(nx, player.pos.z, margin) && !MazeGen.isShelfBlocked(nx, player.pos.z, 0.35)) {
      player.pos.x = nx;
    }
    if (!MazeGen.isWall(player.pos.x, nz, margin) && !MazeGen.isShelfBlocked(player.pos.x, nz, 0.35)) {
      player.pos.z = nz;
    }

    // Door collision (horizontal distance only — door group's own Y no longer matters)
    if (doorBlocking && doorMesh) {
      const doorFlat = new THREE.Vector3(doorMesh.position.x, player.pos.y, doorMesh.position.z);
      const doorDist = player.pos.distanceTo(doorFlat);
      if (doorDist < 1.8) {
        const pushDir = player.pos.clone().sub(doorFlat);
        pushDir.y = 0;
        if (pushDir.lengthSq() > 0) {
          pushDir.normalize().multiplyScalar(1.8 - doorDist + 0.05);
          player.pos.x += pushDir.x;
          player.pos.z += pushDir.z;
        }
      }
    }

    player.pos.y = player.height;

    // Interact
    const doInteract = keys['e'] || mobileInteract;
    if (doInteract) {
      checkKeyPickup();
      checkExitInteract();
      keys['e'] = false;
      mobileInteract = false;
    }

    // Prompts
    let nearSomething = false;
    for (let i = 0; i < keyPositions.length; i++) {
      if (collectedKeys[i]) continue;
      const d = player.pos.distanceTo(
        new THREE.Vector3(keyPositions[i].x, player.pos.y, keyPositions[i].z)
      );
      if (d < 2.5) {
        UI.showInteractPrompt(isMobile ? '[ TAP 🗝 ] Ambil Kunci ' + (i + 1) : '[E] Ambil Kunci ' + (i + 1));
        nearSomething = true;
        break;
      }
    }

    if (!nearSomething) {
      const exitDist = player.pos.distanceTo(new THREE.Vector3(exitPos.x, player.pos.y, exitPos.z));
      if (exitDist < 3.0) {
        if (exitUnlocked) {
          UI.showInteractPrompt(isMobile ? '[ TAP 🗝 ] KELUAR!' : '[E] KELUAR — SELAMAT!');
        } else {
          const needed = collectedKeys.filter(Boolean).length;
          UI.showInteractPrompt(`Kunci: ${needed}/3 — Pintu Terkunci`);
        }
        nearSomething = true;
      }
    }

    if (!nearSomething) UI.hideInteractPrompt();
  }

  function checkExitInteract() {
    if (!exitUnlocked) return;
    const exitDist = player.pos.distanceTo(new THREE.Vector3(exitPos.x, player.pos.y, exitPos.z));
    if (exitDist < 3.0) triggerWin();
  }

  function checkKeyPickup() {
    for (let i = 0; i < keyPositions.length; i++) {
      if (collectedKeys[i]) continue;
      const d = player.pos.distanceTo(
        new THREE.Vector3(keyPositions[i].x, player.pos.y, keyPositions[i].z)
      );
      if (d < 2.5) {
        collectedKeys[i] = true;
        scene.remove(keyMeshes[i]);
        UI.showKeyCollected(i);
        playSoundKeyPickup();
        if (collectedKeys.every(Boolean)) {
          exitUnlocked = true;
          doorBlocking = false;
          doorOpening = true;
          doorOpenT = 0;
          UI.showFlash('green');
          playSoundAllKeysCollected();
          UI.showInteractPrompt('SEMUA KUNCI TERKUMPUL — CARI PINTU KELUAR!');
          setTimeout(() => UI.hideInteractPrompt(), 3000);
        }
        break;
      }
    }
  }

  // ── GHOST ─────────────────────────────────────────────────
  function updateGhost(dt, time) {
    const gpos = Ghost.getPosition();
    const toGhost = gpos.clone().sub(player.pos);
    const sinY = Math.sin(player.yaw);
    const cosY = Math.cos(player.yaw);
    const forward = new THREE.Vector3(-sinY, 0, -cosY);
    const dot = toGhost.clone().normalize().dot(forward);
    const playerVisible = dot > 0.3;

    const info = Ghost.update(dt, player.pos, playerVisible);
    if (!info) return;

    if (info.isCaught && !gameOver) {
      playSoundCaught();
      triggerDeath();
      return;
    }

    ghostNearSoundTimer -= dt;
    updateChaseHeartbeat(dt, info);

    if (info.isClose) {
      UI.showGhostWarning(true);
      UI.showFlash('red');
      if (Math.random() < 0.02) UI.screenShake();
      player.sanity = Math.max(0, player.sanity - dt * 0.4);
      if (ghostNearSoundTimer <= 0) {
        playSoundGhostNear();
        ghostNearSoundTimer = 0.5;
      }
    } else if (info.distToPlayer < 10) {
      UI.showGhostWarning(true);
      player.sanity = Math.max(0, player.sanity - dt * 0.08);
      if (ghostNearSoundTimer <= 0) {
        playSoundGhostNear();
        ghostNearSoundTimer = 2.0;
      }
    } else {
      UI.showGhostWarning(false);
      player.sanity = Math.min(1, player.sanity + dt * 0.03);
    }
  }

  // ── KEYS & EXIT ───────────────────────────────────────────
  function updateKeys(dt, time) {
    for (let i = 0; i < keyMeshes.length; i++) {
      if (collectedKeys[i] || !keyMeshes[i]) continue;
      keyMeshes[i].rotation.y += dt * 2;
      keyMeshes[i].position.y = 0.9 + Math.sin(time * 3 + i * 2) * 0.15;
    }
  }

  function updateExit(dt, time) {
    if (!exitMesh) return;
    if (exitMesh.userData.sign) {
      exitMesh.userData.sign.rotation.y = Math.sin(time * 0.6) * 0.05;
    }
    if (exitUnlocked && exitMesh.userData.signMat) {
      exitMesh.userData.signMat.opacity = 0.75 + Math.sin(time * 4) * 0.2;
      if (exitMesh.userData.signLight) {
        exitMesh.userData.signLight.intensity = 1.0 + Math.sin(time * 4) * 0.5;
      }
    }

    // Animate the door swinging open on its hinge once unlocked
    if (doorOpening && doorHinge) {
      doorOpenT = Math.min(1, doorOpenT + dt / 1.1);
      const eased = 1 - Math.pow(1 - doorOpenT, 3); // ease-out
      doorHinge.rotation.y = -eased * Math.PI * 0.62;
      if (doorOpenT >= 1) doorOpening = false;
    }
  }

  // ── HORROR FX ─────────────────────────────────────────────
  function updateHorrorFX(dt, time) {
    const insanity = 1 - player.sanity;
    UI.setVignetteIntensity(insanity * 0.7 + Ghost.getAlertLevel() * 0.3);

    if (insanity > 0.5) {
      const tiltAmt = (insanity - 0.5) * 0.06;
      const curEuler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      curEuler.z += Math.sin(time * 3) * tiltAmt * dt;
      camera.quaternion.setFromEuler(curEuler);
    }

    sanityFlickerTimer -= dt;
    if (player.sanity < 0.3 && sanityFlickerTimer <= 0) {
      sanityFlickerTimer = Math.random() * 2 + 0.5;
      UI.showFlash(Math.random() < 0.5 ? 'white' : 'red');
    }
  }

  function updateHUD(dt) {
    UI.setStamina(player.stamina);
    UI.setSanity(player.sanity);
  }

  function render(time) {
    renderer.render(scene, camera);
  }

  // ── OBJECT CREATORS ───────────────────────────────────────
  function createKeyMesh(index) {
    const colors = [0xffcc00, 0xff6600, 0xff0066];
    const group = new THREE.Group();
    const bodyGeo = new THREE.TorusGeometry(0.18, 0.04, 8, 16);
    const stemGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8);
    const mat = new THREE.MeshLambertMaterial({ color: colors[index], emissive: colors[index], emissiveIntensity: 0.4 });
    const body = new THREE.Mesh(bodyGeo, mat);
    body.rotation.x = Math.PI / 2;
    group.add(body);
    const stem = new THREE.Mesh(stemGeo, mat);
    stem.position.set(0, -0.25, 0);
    group.add(stem);
    const light = new THREE.PointLight(colors[index], 0.5, 3);
    group.add(light);
    return group;
  }

  function createExitSignTexture() {
    const w = 256, h = 96;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a1a0a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#00ff55';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.font = 'bold 46px monospace';
    ctx.fillStyle = '#00ff55';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#00ff55';
    ctx.shadowBlur = 14;
    ctx.fillText('KELUAR', w / 2, h / 2 + 2);
    return new THREE.CanvasTexture(canvas);
  }

  function createExitMarker() {
    const group = new THREE.Group();

    // Hanging illuminated "KELUAR" sign above the doorway
    const signTex = createExitSignTexture();
    const signMat = new THREE.MeshBasicMaterial({
      map: signTex, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), signMat);
    sign.position.set(0, MazeGen.WALL_H - 0.5, -MazeGen.CELL * 0.5);
    group.add(sign);

    const signLight = new THREE.PointLight(0x00ff55, 0.8, 8);
    signLight.position.set(0, MazeGen.WALL_H - 0.6, -MazeGen.CELL * 0.5);
    group.add(signLight);

    // Soft glow ring on the floor marking the exit cell
    const ringGeo = new THREE.RingGeometry(0.5, 1.5, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ff55, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.02;
    group.add(ring);

    group.userData.sign = sign;
    group.userData.signMat = signMat;
    group.userData.signLight = signLight;
    return group;
  }

  // ── EXIT DOOR (real hinged door: frame + swinging panel) ──
  function createDoorPanelTexture() {
    const w = 256, h = 384;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');

    // Brushed steel base
    ctx.fillStyle = '#4a4d55';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${Math.random()*0.05})`;
      ctx.beginPath();
      const y = Math.random() * h;
      ctx.moveTo(0, y); ctx.lineTo(w, y + (Math.random()-0.5)*4);
      ctx.stroke();
    }

    // Panel inset border
    ctx.strokeStyle = 'rgba(20,20,25,0.8)';
    ctx.lineWidth = 6;
    ctx.strokeRect(14, 14, w - 28, h - 28);

    // Push bar
    ctx.fillStyle = '#8a8d95';
    ctx.fillRect(24, h * 0.42, w - 48, 18);
    ctx.strokeStyle = 'rgba(20,20,25,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(24, h * 0.42, w - 48, 18);

    // Rivets
    ctx.fillStyle = 'rgba(20,20,25,0.6)';
    for (const rx of [22, w - 22]) {
      for (let ry = 24; ry < h - 20; ry += 40) {
        ctx.beginPath(); ctx.arc(rx, ry, 4, 0, Math.PI*2); ctx.fill();
      }
    }

    // Hazard stripe near the bottom (kick plate)
    const stripeY = h * 0.82, stripeH = h * 0.09;
    ctx.save();
    ctx.beginPath();
    ctx.rect(14, stripeY, w - 28, stripeH);
    ctx.clip();
    ctx.fillStyle = '#111';
    ctx.fillRect(14, stripeY, w - 28, stripeH);
    ctx.fillStyle = '#e6b800';
    for (let x = -stripeH; x < w; x += stripeH) {
      ctx.beginPath();
      ctx.moveTo(x, stripeY + stripeH);
      ctx.lineTo(x + stripeH, stripeY);
      ctx.lineTo(x + stripeH * 1.6, stripeY);
      ctx.lineTo(x + stripeH * 0.6, stripeY + stripeH);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Small reinforced window near the top
    ctx.fillStyle = 'rgba(10,20,15,0.85)';
    ctx.fillRect(w*0.28, h*0.1, w*0.44, h*0.16);
    ctx.strokeStyle = 'rgba(20,20,25,0.9)'; ctx.lineWidth = 5;
    ctx.strokeRect(w*0.28, h*0.1, w*0.44, h*0.16);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
    for (let gx = 1; gx < 3; gx++) {
      const x = w*0.28 + (w*0.44) * (gx/3);
      ctx.beginPath(); ctx.moveTo(x, h*0.1); ctx.lineTo(x, h*0.1+h*0.16); ctx.stroke();
    }

    // Grime streaks for horror consistency
    ctx.strokeStyle = 'rgba(20,10,10,0.25)';
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      const sx = Math.random()*w;
      ctx.moveTo(sx, h*0.3);
      ctx.lineTo(sx + (Math.random()-0.5)*20, h);
      ctx.stroke();
    }

    return new THREE.CanvasTexture(canvas);
  }

  // Returns { group, hinge }. `group` is placed in the world at floor
  // level (y=0); `hinge` is the pivot to rotate for the swing-open animation.
  function createDoor() {
    const group = new THREE.Group();
    const doorW = MazeGen.CELL * 0.82;
    const doorH = MazeGen.WALL_H * 0.86;
    const frameDepth = 0.22;

    // Frame — dark metal posts + lintel forming a free-standing doorway
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x24252b });
    const postGeo = new THREE.BoxGeometry(0.18, MazeGen.WALL_H, frameDepth);
    const postL = new THREE.Mesh(postGeo, frameMat);
    postL.position.set(-doorW/2 - 0.09, MazeGen.WALL_H/2, 0);
    group.add(postL);
    const postR = new THREE.Mesh(postGeo, frameMat);
    postR.position.set(doorW/2 + 0.09, MazeGen.WALL_H/2, 0);
    group.add(postR);
    const lintelGeo = new THREE.BoxGeometry(doorW + 0.5, 0.2, frameDepth);
    const lintel = new THREE.Mesh(lintelGeo, frameMat);
    lintel.position.set(0, MazeGen.WALL_H + 0.02, 0);
    group.add(lintel);

    // Hinge pivot sits at the LEFT edge of the doorway opening
    const hinge = new THREE.Object3D();
    hinge.position.set(-doorW/2, 0, 0);
    group.add(hinge);

    // Door panel — offset from the hinge by half its width so it spans
    // the doorway, and rotates around the hinge's Y axis to swing open
    const panelTex = createDoorPanelTexture();
    const panelMat = new THREE.MeshLambertMaterial({ map: panelTex });
    const panelGeo = new THREE.BoxGeometry(doorW, doorH, 0.08);
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.set(doorW/2, doorH/2, 0);
    hinge.add(panel);

    // Door handle
    const handleMat = new THREE.MeshLambertMaterial({ color: 0xd8d8d0 });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.32, 8), handleMat);
    handle.rotation.z = Math.PI / 2;
    handle.position.set(doorW - 0.18, doorH * 0.5, 0.08);
    hinge.add(handle);

    return { group, hinge };
  }

  // ── WIN / DEATH ───────────────────────────────────────────
  function triggerDeath() {
    if (gameOver) return;
    gameOver = true; running = false;
    releasePointerLock();
    UI.screenShake();
    UI.showFlash('red');
    setTimeout(() => UI.showCaught(), 400);
  }

  function triggerWin() {
    if (gameOver) return;
    gameOver = true; running = false;
    releasePointerLock();
    playSoundWin();
    setTimeout(() => UI.showWin(), 600);
  }

  // ── PAUSE ─────────────────────────────────────────────────
  function pause() {
    if (!running || gameOver) return;
    paused = true;
    releasePointerLock();
    UI.showPause();
  }

  function resume() {
    if (!paused) return;
    paused = false;
    UI.hidePause();
    if (!isMobile) setupPointerLock();
  }

  // ── INPUT ─────────────────────────────────────────────────
  function setupInput(canvas) {
    document.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      keys[k] = true;
      if (k === 'escape') {
        if (paused) resume();
        else pause();
      }
      if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k)) e.preventDefault();
    });

    document.addEventListener('keyup', e => {
      keys[e.key.toLowerCase()] = false;
    });

    document.addEventListener('mousemove', e => {
      if (isPointerLocked) {
        mouseDX += e.movementX || 0;
        mouseDY += e.movementY || 0;
      }
    });

    canvas.addEventListener('click', () => { getAudioCtx(); }, { once: true });
  }

  function setupPointerLock() {
    if (isMobile) {
      // No pointer lock on mobile — use touch controls
      UI.hidePointerLock();
      return;
    }
    teardownPointerLock();
    const overlay = document.getElementById('pointer-lock-overlay');
    const canvas = document.getElementById('game-canvas');
    overlay.addEventListener('click', requestPointerLock);
    canvas.addEventListener('click', requestPointerLock);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('mozpointerlockchange', onPointerLockChange);
    UI.showPointerLock();
  }

  function teardownPointerLock() {
    const overlay = document.getElementById('pointer-lock-overlay');
    const canvas = document.getElementById('game-canvas');
    if (overlay) overlay.removeEventListener('click', requestPointerLock);
    if (canvas) canvas.removeEventListener('click', requestPointerLock);
    document.removeEventListener('pointerlockchange', onPointerLockChange);
    document.removeEventListener('mozpointerlockchange', onPointerLockChange);
    const gs = document.getElementById('game-screen');
    if (gs) gs.classList.remove('pointer-locked');
  }

  function requestPointerLock() {
    if (!running || gameOver) return;
    const canvas = document.getElementById('game-canvas');
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
    getAudioCtx();
  }

  function releasePointerLock() {
    try { document.exitPointerLock(); } catch(e) {}
    isPointerLocked = false;
    mouseDX = 0; mouseDY = 0;
    const gs = document.getElementById('game-screen');
    if (gs) gs.classList.remove('pointer-locked');
  }

  function onPointerLockChange() {
    const canvas = document.getElementById('game-canvas');
    const gs = document.getElementById('game-screen');
    isPointerLocked = (document.pointerLockElement === canvas || document.mozPointerLockElement === canvas);
    if (isPointerLocked) {
      UI.hidePointerLock();
      if (gs) gs.classList.add('pointer-locked');
      mouseDX = 0; mouseDY = 0;
    } else {
      if (gs) gs.classList.remove('pointer-locked');
      if (running && !paused && !gameOver) UI.showPointerLock();
    }
  }

  function onResize() {
    if (!renderer || !camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ── MOBILE API ────────────────────────────────────────────
  function setMobileJoystick(x, y) { mobileJoystick.x = x; mobileJoystick.y = y; }
  function setMobileRun(v) { mobileRun = v; }
  function triggerMobileInteract() { mobileInteract = true; }
  function addMouseDelta(dx, dy) { mouseDX += dx; mouseDY += dy; }

  return {
    start, restart, stop, pause, resume,
    setMobileJoystick, setMobileRun, triggerMobileInteract, addMouseDelta,
  };
})();
