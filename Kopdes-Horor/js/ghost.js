/* ghost.js — Nextbot-style Ghost AI with PNG sprite */
'use strict';

const Ghost = (() => {
  let mesh = null;
  let spriteMat = null;
  let position = new THREE.Vector3();
  let targetPos = new THREE.Vector3();
  let scene_ = null;
  let speed = 2.6;
  let baseSpeed = 3.2;
  let pathTimer = 0;
  let wanderDir = new THREE.Vector3(1, 0, 0);
  let state = 'wander'; // 'wander' | 'chase' | 'search'
  let lastKnownPlayer = null;
  let searchTimer = 0;
  let stuckTimer = 0;
  let lastPos = new THREE.Vector3();
  let alertLevel = 0; // 0-1
  let screamCooldown = 0;
  let isVisible = false;

  // Sprite animation
  let spriteBob = 0;
  let glitchTimer = 0;

  // ── AI TUNING ──────────────────────────────────────────────
  const OMNISCIENT_RANGE = 36;
  const CLOSE_RANGE = 15;
  const CLOSE_BOOST_MULT = 2.6;

  // ── INIT ─────────────────────────────────────────────────
  function init(scene, ghostTexture) {
    scene_ = scene;
    spriteMat = null;
    mesh = null;

    // Create billboard sprite
    const tex = ghostTexture || createDefaultGhostTexture();
    spriteMat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.1,
      depthTest: true,
      depthWrite: false,
      color: 0xffffff,
      sizeAttenuation: true,
    });

    mesh = new THREE.Sprite(spriteMat);
    mesh.scale.set(2.5, 3.5, 1);
    mesh.visible = false;
    scene.add(mesh);

    const start = MazeGen.getGhostStart();
    position.set(start.x, 1.5, start.z);
    mesh.position.copy(position);
    lastPos.copy(position);

    isVisible = false;
    state = 'wander';
    alertLevel = 0;
    speed = baseSpeed;
  }

  // Default ghost texture if no image provided
  function createDefaultGhostTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size/2; canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Draw creepy face ghost
    ctx.clearRect(0, 0, size/2, size);

    // Body glow
    const bodyGrad = ctx.createRadialGradient(64,100,10,64,100,80);
    bodyGrad.addColorStop(0,'rgba(255,255,255,0.9)');
    bodyGrad.addColorStop(0.5,'rgba(200,200,255,0.6)');
    bodyGrad.addColorStop(1,'transparent');
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(0,0,128,256);

    // Head
    ctx.fillStyle='rgba(240,230,240,0.95)';
    ctx.beginPath();
    ctx.ellipse(64,80,50,60,0,0,Math.PI*2);
    ctx.fill();

    // Eyes — hollow black
    ctx.fillStyle='#000000';
    ctx.beginPath();ctx.ellipse(44,72,14,18,0,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.ellipse(84,72,14,18,0,0,Math.PI*2);ctx.fill();

    // Red pupils
    ctx.fillStyle='#cc0000';
    ctx.beginPath();ctx.ellipse(44,76,6,8,0,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.ellipse(84,76,6,8,0,0,Math.PI*2);ctx.fill();

    // Mouth — open screaming
    ctx.fillStyle='#1a0000';
    ctx.beginPath();
    ctx.ellipse(64,108,22,16,0,0,Math.PI*2);
    ctx.fill();
    ctx.strokeStyle='rgba(200,0,0,0.5)';ctx.lineWidth=2;ctx.stroke();

    // Body (wispy)
    const bodyPath = new Path2D();
    bodyPath.moveTo(14,120);
    bodyPath.bezierCurveTo(10,160,20,190,14,220);
    bodyPath.bezierCurveTo(10,240,30,250,40,230);
    bodyPath.bezierCurveTo(50,250,60,255,64,240);
    bodyPath.bezierCurveTo(68,255,78,250,88,230);
    bodyPath.bezierCurveTo(98,250,118,240,114,220);
    bodyPath.bezierCurveTo(108,190,118,160,114,120);
    bodyPath.closePath();
    ctx.fillStyle='rgba(230,220,240,0.8)';
    ctx.fill(bodyPath);

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }

  // ── LOAD PNG GHOST ────────────────────────────────────────
  function loadGhostImage(url, onLoad) {
    const loader = new THREE.TextureLoader();
    loader.load(url, (tex) => {
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      if (spriteMat) {
        spriteMat.map = tex;
        spriteMat.needsUpdate = true;
      }
      if (onLoad) onLoad();
    }, undefined, () => {
      // fallback to default
      console.warn('Ghost image not found, using default');
    });
  }

  // ── AI UPDATE ─────────────────────────────────────────────
  function update(dt, playerPos, playerVisible) {
    if (!mesh) return;
    screamCooldown = Math.max(0, screamCooldown - dt);

    const distToPlayer = position.distanceTo(playerPos);

    // State machine
    switch (state) {
      case 'wander':
        updateWander(dt, playerPos, distToPlayer);
        break;
      case 'chase':
        updateChase(dt, playerPos, distToPlayer);
        break;
      case 'search':
        updateSearch(dt, playerPos, distToPlayer);
        break;
    }

    // Detection
    if (playerVisible && distToPlayer < 20) {
      alertLevel = Math.min(1, alertLevel + dt * 0.8);
    } else if (distToPlayer < 8) {
      // Heard nearby
      alertLevel = Math.min(1, alertLevel + dt * 0.3);
    } else if (distToPlayer < OMNISCIENT_RANGE) {
      // Ghost always senses the player's general presence within this
      // range, even through walls / without a direct line of sight —
      // it just builds up more slowly than an actual sighting so it
      // still feels beatable rather than an instant unfair chase.
      const proximityFactor = 1 - (distToPlayer / OMNISCIENT_RANGE);
      alertLevel = Math.min(1, alertLevel + dt * (0.05 + proximityFactor * 0.2));
    } else {
      alertLevel = Math.max(0, alertLevel - dt * 0.15);
    }

    if (alertLevel > 0.5 && state !== 'chase') {
      state = 'chase';
      lastKnownPlayer = playerPos.clone();
    } else if (alertLevel < 0.1 && state === 'chase') {
      state = 'search';
      searchTimer = 5 + Math.random() * 5;
    }

    // Speed scaling — base alert scaling, plus an extra surge of speed
    // once the ghost is within CLOSE_RANGE of the player for a more
    // intense, "it's right behind you" climax.
    const angerFactor = 1 + alertLevel * 0.8;
    let proximityBoost = 1;
    if (distToPlayer < CLOSE_RANGE) {
      proximityBoost = 1 + (1 - distToPlayer / CLOSE_RANGE) * (CLOSE_BOOST_MULT - 1);
    }
    speed = baseSpeed * angerFactor * proximityBoost;

    // Move ghost
    move(dt);

    // Sprite update
    spriteBob += dt * (state === 'chase' ? 8 : 3);
    mesh.position.set(
      position.x,
      1.5 + Math.sin(spriteBob) * 0.08,
      position.z
    );

    // Glitch effect when close
    glitchTimer += dt;
    if (distToPlayer < 10 && glitchTimer > 0.05 + Math.random() * 0.1) {
      glitchTimer = 0;
      spriteMat.color.setHex(
        Math.random() < 0.2 ? 0xff3333 :
        Math.random() < 0.1 ? 0x3333ff : 0xffffff
      );
    } else if (glitchTimer > 0.1) {
      spriteMat.color.setHex(0xffffff);
    }

    // Visibility
    mesh.visible = true;
    isVisible = true;

    // Return state info
    return {
      distToPlayer,
      alertLevel,
      state,
      isClose: distToPlayer < 2.5,
      isCaught: distToPlayer < 1.5,
      spawnScream: screamCooldown === 0 && alertLevel > 0.8 && distToPlayer < 15,
    };
  }

  function updateWander(dt, playerPos, dist) {
    pathTimer -= dt;
    if (pathTimer <= 0) {
      const angle = Math.random() * Math.PI * 2;
      let dirX = Math.cos(angle);
      let dirZ = Math.sin(angle);

      // Omniscient awareness: the ghost roughly knows where the player
      // is, so its "random" patrol direction is sometimes nudged toward
      // them instead of being purely random — subtle, not a beeline.
      if (dist < OMNISCIENT_RANGE && Math.random() < 0.45) {
        const toPlayer = new THREE.Vector3().subVectors(playerPos, position);
        toPlayer.y = 0;
        if (toPlayer.lengthSq() > 0.01) {
          toPlayer.normalize();
          const blend = 0.5;
          dirX = dirX * (1 - blend) + toPlayer.x * blend;
          dirZ = dirZ * (1 - blend) + toPlayer.z * blend;
        }
      }

      wanderDir.set(dirX, 0, dirZ).normalize();
      pathTimer = 1.5 + Math.random() * 2;
    }
  }

  function updateChase(dt, playerPos, dist) {
    // Move toward player directly
    const dir = new THREE.Vector3().subVectors(playerPos, position).normalize();
    wanderDir.copy(dir);
    lastKnownPlayer = playerPos.clone();
    screamCooldown = 4; // Can scream again after 4s
  }

  function updateSearch(dt, playerPos, dist) {
    searchTimer -= dt;
    if (searchTimer <= 0) {
      state = 'wander';
    }
    if (lastKnownPlayer) {
      const dir = new THREE.Vector3().subVectors(lastKnownPlayer, position);
      if (dir.length() > 1) {
        wanderDir.copy(dir.normalize());
      } else {
        // Reached last known — random search
        const angle = Math.random() * Math.PI * 2;
        wanderDir.set(Math.cos(angle), 0, Math.sin(angle));
        lastKnownPlayer = null;
      }
    }
  }

  function move(dt) {
    const vel = wanderDir.clone().multiplyScalar(speed * dt);
    const nx = position.x + vel.x;
    const nz = position.z + vel.z;

    const margin = 0.6;

    // Try full movement
    if (!MazeGen.isWall(nx, nz, margin)) {
      position.x = nx;
      position.z = nz;
    } else {
      // Try slide X
      if (!MazeGen.isWall(nx, position.z, margin)) {
        position.x = nx;
        wanderDir.z *= -0.5;
      }
      // Try slide Z
      else if (!MazeGen.isWall(position.x, nz, margin)) {
        position.z = nz;
        wanderDir.x *= -0.5;
      } else {
        // Bounce
        wanderDir.x = -wanderDir.x + (Math.random()-0.5)*0.5;
        wanderDir.z = -wanderDir.z + (Math.random()-0.5)*0.5;
        wanderDir.normalize();
        pathTimer = 0;
      }
    }

    // Stuck detection
    if (position.distanceTo(lastPos) < 0.01 * dt * 60) {
      stuckTimer += dt;
      if (stuckTimer > 0.5) {
        const angle = Math.random() * Math.PI * 2;
        wanderDir.set(Math.cos(angle), 0, Math.sin(angle));
        stuckTimer = 0;
        pathTimer = 0;
      }
    } else {
      stuckTimer = 0;
    }
    lastPos.copy(position);
  }

  // ── GETTERS ───────────────────────────────────────────────
  function getPosition() { return position.clone(); }
  function getAlertLevel() { return alertLevel; }
  function getState() { return state; }
  function getMesh() { return mesh; }

  function dispose() {
    if (mesh && scene_) scene_.remove(mesh);
    if (spriteMat) spriteMat.dispose();
    mesh = null;
    spriteMat = null;
  }

  return {
    init, update, loadGhostImage,
    getPosition, getAlertLevel, getState, getMesh,
    dispose,
  };
})();
