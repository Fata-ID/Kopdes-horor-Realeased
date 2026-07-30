/* minimap.js — 2D Minimap Renderer */
'use strict';

const Minimap = (() => {
  let canvas = null;
  let ctx = null;
  const MAP_W = 160;
  const MAP_H = 160;

  function init() {
    canvas = document.getElementById('minimap-canvas');
    ctx = canvas.getContext('2d');
  }

  function render(playerPos, ghostPos, keyPositions, collectedKeys, exitPos) {
    if (!ctx) return;
    ctx.clearRect(0, 0, MAP_W, MAP_H);

    const grid = MazeGen.grid;
    const ROWS = MazeGen.ROWS;
    const COLS = MazeGen.COLS;
    const CELL = MazeGen.CELL;

    const cellW = MAP_W / COLS;
    const cellH = MAP_H / ROWS;

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, MAP_W, MAP_H);

    // Maze
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (grid[r][c] === 1) {
          ctx.fillStyle = 'rgba(80,70,50,0.9)';
        } else {
          ctx.fillStyle = 'rgba(180,165,120,0.15)';
        }
        ctx.fillRect(c * cellW, r * cellH, cellW, cellH);
      }
    }

    // Convert world to map coords
    const halfW = (COLS * CELL) / 2;
    const halfH = (ROWS * CELL) / 2;

    function worldToMap(wx, wz) {
      const mx = ((wx + halfW) / (COLS * CELL)) * MAP_W;
      const my = ((wz + halfH) / (ROWS * CELL)) * MAP_H;
      return { x: mx, y: my };
    }

    // Exit marker
    const exit = worldToMap(exitPos.x, exitPos.z);
    const exitPulse = 0.7 + 0.3 * Math.sin(Date.now() * 0.005);
    ctx.fillStyle = `rgba(0,255,100,${exitPulse})`;
    ctx.beginPath();
    ctx.moveTo(exit.x, exit.y - 5);
    ctx.lineTo(exit.x + 4, exit.y + 3);
    ctx.lineTo(exit.x - 4, exit.y + 3);
    ctx.closePath();
    ctx.fill();

    // Key markers
    for (let i = 0; i < keyPositions.length; i++) {
      if (collectedKeys[i]) continue;
      const kp = worldToMap(keyPositions[i].x, keyPositions[i].z);
      const pulse = 0.6 + 0.4 * Math.sin(Date.now() * 0.004 + i * 2);
      ctx.fillStyle = `rgba(255,180,0,${pulse})`;
      ctx.beginPath();
      ctx.arc(kp.x, kp.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ghost marker (flicker when hunting)
    const gmp = worldToMap(ghostPos.x, ghostPos.z);
    const ghostFlicker = Math.random() > 0.15;
    if (ghostFlicker) {
      ctx.fillStyle = '#ff0022';
      ctx.shadowColor = '#ff0022';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(gmp.x, gmp.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Player marker
    const pm = worldToMap(playerPos.x, playerPos.z);
    ctx.fillStyle = '#00ffff';
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(pm.x, pm.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Player dot center bright
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(pm.x, pm.y, 2, 0, Math.PI * 2);
    ctx.fill();

    // Scan line overlay
    ctx.strokeStyle = 'rgba(0,255,150,0.05)';
    ctx.lineWidth = 1;
    for (let y = 0; y < MAP_H; y += 4) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(MAP_W, y);
      ctx.stroke();
    }

    // Border glow
    ctx.strokeStyle = 'rgba(255,0,34,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, MAP_W, MAP_H);
  }

  return { init, render };
})();
