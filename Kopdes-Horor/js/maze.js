/* maze.js — Procedural supermarket ("Kopdes") layout: shelving aisles,
   products, tile floor, drop-ceiling light panels + disturbing decals */
'use strict';

const MazeGen = (() => {
  const CELL = 4;
  const WALL_H = 3.2;
  const COLS = 21;
  const ROWS = 21;

  let grid = [];

  function generate() {
    grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(1));
    const visited = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
    function carve(r, c) {
      visited[r][c] = true;
      grid[r][c] = 0;
      const dirs = shuffle([[0,-2],[0,2],[-2,0],[2,0]]);
      for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (nr > 0 && nr < ROWS-1 && nc > 0 && nc < COLS-1 && !visited[nr][nc]) {
          grid[r + dr/2][c + dc/2] = 0;
          carve(nr, nc);
        }
      }
    }
    carve(1, 1);
    grid[ROWS-2][COLS-2] = 0;
    grid[ROWS-2][COLS-3] = 0;
    return grid;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function build(scene) {
    generate();

    const shelfTex  = createShelfTexture();
    const floorTex  = createSupermarketFloorTexture();
    const ceilTex   = createSupermarketCeilingTexture();

    const wallMat  = new THREE.MeshLambertMaterial({ map: shelfTex });
    const floorMat = new THREE.MeshLambertMaterial({ map: floorTex });
    const ceilMat  = new THREE.MeshLambertMaterial({ map: ceilTex, color: 0xdedee8 });

    const wallGeos  = [];
    const floorGeos = [];
    const ceilGeos  = [];

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const wx = c * CELL - (COLS * CELL) / 2;
        const wz = r * CELL - (ROWS * CELL) / 2;

        if (grid[r][c] === 1) {
          const geo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
          geo.translate(wx + CELL/2, WALL_H/2, wz + CELL/2);
          wallGeos.push(geo);
        } else {
          // FLOOR tile
          const fg = new THREE.PlaneGeometry(CELL, CELL);
          fg.rotateX(-Math.PI/2);
          fg.translate(wx + CELL/2, 0, wz + CELL/2);
          floorGeos.push(fg);

          // CEILING tile — solid plane at top of walls
          const cg = new THREE.PlaneGeometry(CELL, CELL);
          cg.rotateX(Math.PI/2);  // face downward
          cg.translate(wx + CELL/2, WALL_H, wz + CELL/2);
          ceilGeos.push(cg);
        }
      }
    }

    // Shelf blocks (walls)
    if (wallGeos.length) {
      const merged = mergeGeometries(wallGeos);
      if (merged) scene.add(new THREE.Mesh(merged, wallMat));
    }

    // Floor
    if (floorGeos.length) {
      const merged = mergeGeometries(floorGeos);
      if (merged) scene.add(new THREE.Mesh(merged, floorMat));
    }

    // Ceiling — separate mesh so it uses correct normal direction
    if (ceilGeos.length) {
      const merged = mergeGeometries(ceilGeos);
      if (merged) {
        const ceilMesh = new THREE.Mesh(merged, ceilMat);
        scene.add(ceilMesh);
      }
    }

    // Protruding shelf boards + product boxes/cans/bottles on top
    addShelfBoardsAndProducts(scene);

    // Disturbing decals on shelves — blood smears, spills, scratches etc.
    addWallDetails(scene);

    addLights(scene);

    return { grid, CELL, ROWS, COLS, WALL_H };
  }

  function mergeGeometries(geos) {
    if (!geos.length) return null;
    const positions = [], normals = [], uvs = [], indices = [];
    let offset = 0;
    for (const g of geos) {
      const pos = g.attributes.position.array;
      const nor = g.attributes.normal.array;
      const uv  = g.attributes.uv ? g.attributes.uv.array : new Float32Array(pos.length / 3 * 2);
      for (let i = 0; i < pos.length; i++) positions.push(pos[i]);
      for (let i = 0; i < nor.length; i++) normals.push(nor[i]);
      for (let i = 0; i < uv.length;  i++) uvs.push(uv[i]);
      const idx = g.index ? g.index.array : null;
      const vCount = g.attributes.position.count;
      if (idx) {
        for (let i = 0; i < idx.length; i++) indices.push(idx[i] + offset);
      } else {
        for (let i = 0; i < vCount; i++) indices.push(i + offset);
      }
      offset += vCount;
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    merged.setAttribute('normal',   new THREE.Float32BufferAttribute(normals, 3));
    merged.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
    merged.setIndex(indices);
    geos.forEach(g => g.dispose());
    return merged;
  }

  // ── SHELF BOARDS + PRODUCTS ──────────────────────────────
  // Adds physical shelf ledges sticking out of the shelving walls, with
  // small grocery items (boxes/cans/bottles) sitting on top of them.
  // Also registers solid collision rectangles so the player can't walk
  // through the shelf/etalase (see isShelfBlocked()).
  let shelfObstacles = [];

  function addShelfBoardsAndProducts(scene) {
    shelfObstacles = [];

    const boardTex = createShelfBoardTexture();
    const boardMat = new THREE.MeshLambertMaterial({ map: boardTex, color: 0xc9b98a });
    const boardGeos = [];

    const labelTextures = createProductLabelTextures();
    const productGroup = new THREE.Group();
    let productCount = 0;
    const MAX_PRODUCTS = 90;

    const openCells = getOpenCells();
    const shelfSpots = [];
    for (const [r, c] of openCells) {
      const wx = c * CELL - (COLS * CELL) / 2 + CELL / 2;
      const wz = r * CELL - (ROWS * CELL) / 2 + CELL / 2;
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      for (const [dr, dc] of dirs) {
        const nr = r+dr, nc = c+dc;
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc] === 1) {
          shelfSpots.push({ wx, wz, dr, dc });
        }
      }
    }
    shuffle(shelfSpots);

    const boardHeights = [0.95, 1.85];
    const boardDepth = 0.5;
    const boardThickness = 0.06;
    const usedSpots = shelfSpots.slice(0, Math.min(shelfSpots.length, 70));

    for (const spot of usedSpots) {
      const { wx, wz, dr, dc } = spot;
      const faceX = wx + dc * (CELL / 2);
      const faceZ = wz + dr * (CELL / 2);
      const inwardX = -dc; // direction pointing away from wall, into aisle
      const inwardZ = -dr;
      const boardW = CELL * 0.92;

      // Register ONE solid collision box per shelf spot (covers the whole
      // protrusion column regardless of how many board heights render),
      // so the etalase/shelf + the products sitting on it can't be walked
      // through by the player.
      {
        const centerX = faceX + inwardX * (boardDepth / 2 - 0.02);
        const centerZ = faceZ + inwardZ * (boardDepth / 2 - 0.02);
        const halfX = dc !== 0 ? boardDepth / 2 : boardW / 2;
        const halfZ = dc !== 0 ? boardW / 2 : boardDepth / 2;
        shelfObstacles.push({ cx: centerX, cz: centerZ, hx: halfX, hz: halfZ });
      }

      for (const h of boardHeights) {
        if (Math.random() < 0.15) continue; // leave occasional gaps
        const geo = new THREE.BoxGeometry(
          dc !== 0 ? boardDepth : boardW,
          boardThickness,
          dc !== 0 ? boardW : boardDepth
        );
        const centerX = faceX + inwardX * (boardDepth / 2 - 0.02);
        const centerZ = faceZ + inwardZ * (boardDepth / 2 - 0.02);
        geo.translate(centerX, h, centerZ);
        boardGeos.push(geo);

        // Scatter products along the board
        if (productCount < MAX_PRODUCTS && Math.random() < 0.85) {
          const itemsOnBoard = 1 + Math.floor(Math.random() * 3);
          for (let i = 0; i < itemsOnBoard && productCount < MAX_PRODUCTS; i++) {
            const along = (Math.random() - 0.5) * (boardW - 0.4);
            const px = centerX + (dc !== 0 ? 0 : along);
            const pz = centerZ + (dc !== 0 ? along : 0);
            const boardTopY = h + boardThickness / 2;
            const { mesh: item, restHeight } = createProductItem(labelTextures);
            item.position.set(
              px + inwardX * (boardDepth * 0.15),
              boardTopY + restHeight,
              pz + inwardZ * (boardDepth * 0.15)
            );
            item.rotation.y = Math.random() * Math.PI * 2;
            productGroup.add(item);
            productCount++;
          }
        }
      }
    }

    if (boardGeos.length) {
      const merged = mergeGeometries(boardGeos);
      if (merged) scene.add(new THREE.Mesh(merged, boardMat));
    }
    scene.add(productGroup);
  }

  // Point-vs-rectangle collision test (with margin) against every
  // registered shelf/etalase obstacle. Mirrors the signature of isWall().
  function isShelfBlocked(x, z, margin = 0.3) {
    for (let i = 0; i < shelfObstacles.length; i++) {
      const o = shelfObstacles[i];
      if (x + margin > o.cx - o.hx && x - margin < o.cx + o.hx &&
          z + margin > o.cz - o.hz && z - margin < o.cz + o.hz) {
        return true;
      }
    }
    return false;
  }

  function createProductItem(labelTextures) {
    const kind = Math.random();
    let mesh, restHeight;
    if (kind < 0.4) {
      // Box (cereal / snack box)
      const w = 0.22 + Math.random() * 0.1;
      const h = 0.3 + Math.random() * 0.1;
      const d = 0.12 + Math.random() * 0.06;
      const tex = labelTextures[Math.floor(Math.random() * labelTextures.boxes.length)];
      const mat = new THREE.MeshLambertMaterial({ map: tex });
      mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      restHeight = h / 2;
    } else if (kind < 0.75) {
      // Can (canned goods / soda)
      const r = 0.055 + Math.random() * 0.02;
      const h = 0.16 + Math.random() * 0.06;
      const tex = labelTextures[Math.floor(Math.random() * labelTextures.cans.length)];
      const mat = new THREE.MeshLambertMaterial({ map: tex });
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), mat);
      restHeight = h / 2;
    } else {
      // Bottle (drinks)
      const r = 0.05 + Math.random() * 0.015;
      const h = 0.26 + Math.random() * 0.08;
      const tex = labelTextures[Math.floor(Math.random() * labelTextures.bottles.length)];
      const mat = new THREE.MeshLambertMaterial({ map: tex });
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, h, 10), mat);
      restHeight = h / 2;
    }
    restHeight += 0.001;
    return { mesh, restHeight };
  }

  // ── PRODUCT LABEL TEXTURES (small set, reused across many items) ──
  function createProductLabelTextures() {
    const palette = [
      ['#d4302f', '#ffdd55'], // red/yellow
      ['#2f7dd4', '#ffffff'], // blue/white
      ['#3fa34d', '#fff2c2'], // green/cream
      ['#e08a1f', '#ffffff'], // orange/white
      ['#7a3fb5', '#ffe08a'], // purple/gold
      ['#c2185b', '#ffffff'], // pink/white
    ];

    function labelCanvas(base, accent, drawFn) {
      const s = 64;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = s;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = accent;
      ctx.fillRect(0, s * 0.35, s, s * 0.18);
      if (drawFn) drawFn(ctx, s, base, accent);
      const tex = new THREE.CanvasTexture(canvas);
      return tex;
    }

    const boxes = palette.map(([base, accent]) => labelCanvas(base, accent, (ctx, s) => {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(s*0.1, s*0.55, s*0.8, s*0.08);
      ctx.fillRect(s*0.1, s*0.68, s*0.55, s*0.06);
    }));

    const cans = palette.map(([base, accent]) => labelCanvas(base, accent, (ctx, s) => {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s/2, s*0.2, s*0.12, 0, Math.PI*2); ctx.stroke();
    }));

    const bottles = palette.map(([base, accent]) => labelCanvas(accent, base, (ctx, s) => {
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(0, s*0.75, s, s*0.25);
    }));

    return { boxes, cans, bottles };
  }

  function createShelfBoardTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#8a6a3f';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = `rgba(60,40,15,${0.2 + Math.random()*0.2})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const y = Math.random() * size;
      ctx.moveTo(0, y); ctx.lineTo(size, y + (Math.random()-0.5)*10);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(30,20,10,0.5)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1, 1, size-2, size-2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 1);
    return tex;
  }

  // ── PROCEDURAL WALL / SHELF DETAILS (disturbing) ─────────
  function addWallDetails(scene) {
    const openCells = getOpenCells();

    // Blood decals — bercak darah di dinding, jumlah & intensitas dinaikkan lagi
    const numDecals = 34;
    const pool = [...openCells];
    const picked = [];
    for (let i = 0; i < numDecals && pool.length; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      picked.push(pool.splice(idx, 1)[0]);
    }

    for (const [r, c] of picked) {
      const wx = c * CELL - (COLS * CELL) / 2 + CELL / 2;
      const wz = r * CELL - (ROWS * CELL) / 2 + CELL / 2;
      const tex = createBloodDecalTexture();
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.7 + Math.random() * 0.3,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      const wallDirs = dirs.filter(([dr,dc]) => {
        const nr = r+dr, nc = c+dc;
        return nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc] === 1;
      });

      if (!wallDirs.length) continue;
      const [dr, dc] = wallDirs[Math.floor(Math.random() * wallDirs.length)];

      const w = 0.9 + Math.random() * 1.4;
      const h = 0.9 + Math.random() * 1.6;
      const geo = new THREE.PlaneGeometry(w, h);
      const mesh = new THREE.Mesh(geo, mat);

      const wallX = wx + dc * (CELL / 2 - 0.05);
      const wallZ = wz + dr * (CELL / 2 - 0.05);
      mesh.position.set(wallX, 1.6 + Math.random() * 1.4, wallZ);

      if (dc !== 0) mesh.rotation.y = dc > 0 ? -Math.PI/2 : Math.PI/2;
      if (dr !== 0) mesh.rotation.y = dr > 0 ? Math.PI : 0;

      mesh.rotation.z = (Math.random() - 0.5) * 0.4;
      scene.add(mesh);
    }

    // Floor spills — kini didominasi genangan darah, sisanya tumpahan belanja
    const numPools = 20;
    const poolPool = [...openCells];
    for (let i = 0; i < numPools && poolPool.length; i++) {
      const idx = Math.floor(Math.random() * poolPool.length);
      const [r, c] = poolPool.splice(idx, 1)[0];
      const wx = c * CELL - (COLS * CELL) / 2 + CELL / 2;
      const wz = r * CELL - (ROWS * CELL) / 2 + CELL / 2;

      const isBlood = Math.random() < 0.65;
      const tex = isBlood ? createBloodPoolTexture() : createSpillTexture();
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.7 + Math.random() * 0.3, depthWrite: false
      });
      const size = 0.7 + Math.random() * 1.6;
      const geo = new THREE.PlaneGeometry(size, size);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(wx + (Math.random()-0.5)*CELL*0.6, 0.01, wz + (Math.random()-0.5)*CELL*0.6);
      mesh.rotation.y = Math.random() * Math.PI * 2;
      scene.add(mesh);
    }

    // Ceiling blood drips — extra disturbing touch, looking straight up
    const numCeilingDrips = 9;
    const ceilPool = [...openCells];
    for (let i = 0; i < numCeilingDrips && ceilPool.length; i++) {
      const idx = Math.floor(Math.random() * ceilPool.length);
      const [r, c] = ceilPool.splice(idx, 1)[0];
      const wx = c * CELL - (COLS * CELL) / 2 + CELL / 2;
      const wz = r * CELL - (ROWS * CELL) / 2 + CELL / 2;
      const tex = createBloodDecalTexture();
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.6 + Math.random() * 0.3, depthWrite: false, side: THREE.DoubleSide
      });
      const size = 0.8 + Math.random() * 1.2;
      const geo = new THREE.PlaneGeometry(size, size);
      geo.rotateX(Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(wx + (Math.random()-0.5)*CELL*0.5, WALL_H - 0.02, wz + (Math.random()-0.5)*CELL*0.5);
      scene.add(mesh);
    }

    // A handful of knocked-over / spilled cardboard boxes on the floor
    const numFallen = 10;
    const fallenPool = [...openCells];
    for (let i = 0; i < numFallen && fallenPool.length; i++) {
      const idx = Math.floor(Math.random() * fallenPool.length);
      const [r, c] = fallenPool.splice(idx, 1)[0];
      const wx = c * CELL - (COLS * CELL) / 2 + CELL / 2 + (Math.random()-0.5)*CELL*0.5;
      const wz = r * CELL - (ROWS * CELL) / 2 + CELL / 2 + (Math.random()-0.5)*CELL*0.5;
      const s = 0.28 + Math.random() * 0.14;
      const geo = new THREE.BoxGeometry(s, s * 0.7, s * 0.8);
      const mat = new THREE.MeshLambertMaterial({ color: 0xc9a86a });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(wx, s * 0.35, wz);
      mesh.rotation.set((Math.random()-0.5)*1.2, Math.random()*Math.PI*2, (Math.random()-0.5)*1.2);
      scene.add(mesh);
    }
  }

  function createBloodDecalTexture() {
    const s = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = s;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, s, s);

    const type = Math.floor(Math.random() * 3);
    if (type === 0) {
      // Splatter — lebih rapat & lebih gelap
      for (let i = 0; i < 22; i++) {
        const x = 10 + Math.random() * 108, y = 10 + Math.random() * 108;
        const r = 3 + Math.random() * 22;
        ctx.fillStyle = `rgba(${70+Math.floor(Math.random()*40)},0,0,${0.75+Math.random()*0.25})`;
        ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
        // Drip
        if (Math.random() < 0.55) {
          ctx.fillRect(x - 2.5, y, 5, 14 + Math.random() * 44);
        }
      }
    } else if (type === 1) {
      // Handprint smear
      ctx.fillStyle = 'rgba(100,0,0,0.9)';
      ctx.beginPath();
      ctx.ellipse(s/2, s/2, 20, 30, 0, 0, Math.PI*2);
      ctx.fill();
      // Fingers
      for (let f = 0; f < 4; f++) {
        const fx = s/2 - 24 + f*16;
        ctx.beginPath();
        ctx.ellipse(fx, s/2 - 35, 5, 18, (f-1.5)*0.15, 0, Math.PI*2);
        ctx.fill();
      }
    } else {
      // Scratch marks
      ctx.strokeStyle = 'rgba(139,0,0,0.9)';
      ctx.lineWidth = 3;
      for (let l = 0; l < 4; l++) {
        const sx = 10 + l*20, sy = 10 + Math.random()*20;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + 5 + Math.random()*10, sy + 60 + Math.random()*40);
        ctx.stroke();
      }
    }

    return new THREE.CanvasTexture(canvas);
  }

  function createBloodPoolTexture() {
    const s = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = s;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, s, s);

    const grd = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
    grd.addColorStop(0, 'rgba(90,0,0,0.95)');
    grd.addColorStop(0.5, 'rgba(60,0,0,0.8)');
    grd.addColorStop(1, 'rgba(40,0,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(s/2, s/2+8, 58, 48, 0.3, 0, Math.PI*2);
    ctx.fill();

    return new THREE.CanvasTexture(canvas);
  }

  function createSpillTexture() {
    const s = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = s;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, s, s);

    const spillColors = [
      'rgba(230,150,20,0.75)',   // juice
      'rgba(240,240,220,0.8)',   // milk
      'rgba(40,30,10,0.7)',      // oil/coffee
      'rgba(120,180,60,0.7)',    // soda
    ];
    const col = spillColors[Math.floor(Math.random() * spillColors.length)];

    const grd = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
    grd.addColorStop(0, col);
    grd.addColorStop(0.6, col.replace(/[\d.]+\)$/, '0.4)'));
    grd.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(s/2, s/2, 46 + Math.random()*10, 38 + Math.random()*10, Math.random(), 0, Math.PI*2);
    ctx.fill();

    return new THREE.CanvasTexture(canvas);
  }

  // ── PROCEDURAL TEXTURES ─────────────────────────────────
  function createShelfTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Metal shelving base
    ctx.fillStyle = '#9a9ba3';
    ctx.fillRect(0, 0, size, size);

    // Vertical support columns
    ctx.fillStyle = 'rgba(70,72,80,0.6)';
    ctx.fillRect(0, 0, 8, size);
    ctx.fillRect(size-8, 0, 8, size);
    ctx.fillRect(size/2-4, 0, 8, size);

    // Horizontal shelf bands
    const bandCount = 4;
    for (let i = 0; i <= bandCount; i++) {
      const y = i * (size / bandCount);
      ctx.fillStyle = 'rgba(60,62,70,0.55)';
      ctx.fillRect(0, y - 4, size, 8);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(0, y - 3, size, 2);
    }

    // Colorful product boxes painted between bands (background depth layer)
    const rowH = size / bandCount;
    const palette = ['#d4302f','#2f7dd4','#3fa34d','#e08a1f','#7a3fb5','#c2185b','#ffdd55'];
    for (let row = 0; row < bandCount; row++) {
      const y0 = row * rowH + 10;
      const rowHInner = rowH - 20;
      let x = 6;
      while (x < size - 10) {
        const w = 14 + Math.random() * 18;
        if (x + w > size - 6) break;
        ctx.fillStyle = palette[Math.floor(Math.random() * palette.length)];
        const h = rowHInner * (0.55 + Math.random() * 0.4);
        ctx.fillRect(x, y0 + (rowHInner - h), w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x, y0 + (rowHInner - h) + 2, w, 3);
        x += w + 3;
      }
    }

    // Grime / rust streaks for horror atmosphere
    ctx.strokeStyle = 'rgba(40,30,20,0.25)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      const sx = Math.random()*size;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx + (Math.random()-0.5)*20, size);
      ctx.stroke();
    }

    // Faint disturbing message occasionally
    if (Math.random() < 0.3) {
      ctx.save();
      ctx.globalAlpha = 0.05 + Math.random() * 0.05;
      ctx.fillStyle = '#cc0000';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('LARI', Math.random()*180, Math.random()*220+20);
      ctx.restore();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 0.8);
    return tex;
  }

  function createSupermarketFloorTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Checkered supermarket tile — off-white / light grey
    ctx.fillStyle = '#c9c8c0';
    ctx.fillRect(0, 0, size, size);

    const tSize = size/4;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const light = (r + c) % 2 === 0;
        const shade = light ? (205 + Math.random()*10) : (170 + Math.random()*10);
        ctx.fillStyle = `rgb(${shade},${shade-2},${shade-6})`;
        ctx.fillRect(c*tSize+1, r*tSize+1, tSize-2, tSize-2);
      }
    }

    ctx.strokeStyle='rgba(90,88,80,0.6)'; ctx.lineWidth=2;
    for(let i=0;i<=4;i++){
      const p=i*tSize;
      ctx.beginPath();ctx.moveTo(p,0);ctx.lineTo(p,size);ctx.stroke();
      ctx.beginPath();ctx.moveTo(0,p);ctx.lineTo(size,p);ctx.stroke();
    }

    // Scuffs and dirt
    for(let i=0;i<14;i++){
      ctx.beginPath();
      ctx.arc(Math.random()*size,Math.random()*size,Math.random()*10+2,0,Math.PI*2);
      ctx.fillStyle=`rgba(60,55,45,${Math.random()*0.15})`; ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    return tex;
  }

  function createSupermarketCeilingTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Drop-ceiling grid, dirty white
    ctx.fillStyle = '#dedee6';
    ctx.fillRect(0, 0, size, size);

    const tSize = size/4;
    for(let r=0;r<4;r++) for(let c=0;c<4;c++){
      const s=205+Math.random()*15;
      ctx.fillStyle=`rgb(${s},${s},${s+4})`;
      ctx.fillRect(c*tSize+1,r*tSize+1,tSize-2,tSize-2);
    }

    // Grid lines (ceiling tile frame)
    ctx.strokeStyle='rgba(120,120,130,0.9)'; ctx.lineWidth=3;
    for(let i=0;i<=4;i++){
      const p=i*tSize;
      ctx.beginPath();ctx.moveTo(p,0);ctx.lineTo(p,size);ctx.stroke();
      ctx.beginPath();ctx.moveTo(0,p);ctx.lineTo(size,p);ctx.stroke();
    }

    // Fluorescent light panel in two of the tiles
    function lightPanel(cx, cy, w, h) {
      const grd = ctx.createLinearGradient(cx-w/2, cy-h/2, cx+w/2, cy+h/2);
      grd.addColorStop(0, 'rgba(255,255,240,0.95)');
      grd.addColorStop(1, 'rgba(230,230,255,0.85)');
      ctx.fillStyle = grd;
      ctx.fillRect(cx-w/2, cy-h/2, w, h);
      ctx.strokeStyle = 'rgba(150,150,160,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx-w/2, cy-h/2, w, h);
    }
    lightPanel(tSize*0.5, tSize*0.5, tSize*0.7, tSize*0.35);
    lightPanel(tSize*2.5, tSize*2.5, tSize*0.7, tSize*0.35);

    // Water stains / grime patches
    for(let i=0;i<5;i++){
      const grd=ctx.createRadialGradient(
        Math.random()*size,Math.random()*size,0,
        Math.random()*size,Math.random()*size,Math.random()*40+10
      );
      grd.addColorStop(0,'rgba(90,80,50,0.25)');
      grd.addColorStop(1,'transparent');
      ctx.fillStyle=grd; ctx.fillRect(0,0,size,size);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    return tex;
  }

  // ── LIGHTS ──────────────────────────────────────────────
  const flickerLights = [];

  function addLights(scene) {
    flickerLights.length = 0;

    // Cool fluorescent ambient — diredupkan agar toko lebih gelap/mencekam
    const ambient = new THREE.AmbientLight(0xdfe6e0, 0.20);
    scene.add(ambient);

    // Faint sickly green undertone for dread
    const ambientSick = new THREE.AmbientLight(0x113322, 0.04);
    scene.add(ambientSick);

    for (let r = 1; r < ROWS; r += 4) {
      for (let c = 1; c < COLS; c += 4) {
        if (grid[r][c] === 0) {
          const wx = c * CELL - (COLS * CELL) / 2 + CELL/2;
          const wz = r * CELL - (ROWS * CELL) / 2 + CELL/2;
          const light = new THREE.PointLight(0xf5fff5, 0.55, CELL * 4.5);
          light.position.set(wx, WALL_H - 0.2, wz);
          light.baseIntensity = 0.3 + Math.random() * 0.3;
          light.flickerSpeed = 0.5 + Math.random() * 2;
          light.flickerOffset = Math.random() * Math.PI * 2;
          // A few lights are dying/sickly colored
          if (Math.random() < 0.2) light.color.setHex(0xccffcc);
          if (Math.random() < 0.08) light.color.setHex(0xff8866);
          scene.add(light);
          flickerLights.push(light);
        }
      }
    }
  }

  function updateLights(time) {
    for (const light of flickerLights) {
      const t = time * light.flickerSpeed + light.flickerOffset;
      const stutter = Math.random() < 0.003 ? (Math.random() < 0.5 ? 0 : 2.5) : 1;
      // More dramatic flicker (fluorescent tubes stutter)
      const flicker = 0.8 + 0.2 * Math.sin(t) + 0.05 * Math.sin(t * 7.3);
      light.intensity = light.baseIntensity * flicker * stutter;
    }
  }

  // ── SPAWN POINTS ────────────────────────────────────────
  function getOpenCells() {
    const cells = [];
    for (let r = 1; r < ROWS-1; r++)
      for (let c = 1; c < COLS-1; c++)
        if (grid[r][c] === 0)
          cells.push([r, c]);
    return cells;
  }

  function cellToWorld(r, c) {
    return {
      x: c * CELL - (COLS * CELL) / 2 + CELL/2,
      y: 0,
      z: r * CELL - (ROWS * CELL) / 2 + CELL/2,
    };
  }

  function worldToCell(x, z) {
    const col = Math.floor((x + (COLS * CELL) / 2) / CELL);
    const row = Math.floor((z + (ROWS * CELL) / 2) / CELL);
    return { r: row, c: col };
  }

  function isWall(x, z, margin = 0.5) {
    const offsets = [
      [margin, margin], [margin, -margin],
      [-margin, margin], [-margin, -margin]
    ];
    for (const [dx, dz] of offsets) {
      const nr = Math.floor((z + dz + (ROWS * CELL) / 2) / CELL);
      const nc = Math.floor((x + dx + (COLS * CELL) / 2) / CELL);
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return true;
      if (grid[nr][nc] === 1) return true;
    }
    return false;
  }

  function getPlayerStart() { return cellToWorld(1, 1); }
  function getExitPosition() { return cellToWorld(ROWS-2, COLS-2); }

  function getKeyPositions() {
    const open = getOpenCells().filter(([r,c]) => Math.abs(r-1) + Math.abs(c-1) > 10);
    const picks = [];
    while (picks.length < 3 && open.length) {
      const idx = Math.floor(Math.random() * open.length);
      picks.push(cellToWorld(open[idx][0], open[idx][1]));
      open.splice(idx, 1);
    }
    return picks;
  }

  function getGhostStart() {
    const open = getOpenCells().filter(([r,c]) => r > ROWS/2 || c > COLS/2);
    if (!open.length) return cellToWorld(ROWS-3, COLS-3);
    const pick = open[Math.floor(Math.random() * open.length)];
    return cellToWorld(pick[0], pick[1]);
  }

  return {
    build, generate, updateLights,
    getPlayerStart, getExitPosition, getKeyPositions, getGhostStart,
    isWall, isShelfBlocked, cellToWorld, worldToCell,
    CELL, ROWS, COLS, WALL_H,
    get grid() { return grid; }
  };
})();
