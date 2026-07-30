/* main.js — Bootstrap & Loading Sequence */
'use strict';

window.addEventListener('DOMContentLoaded', () => {

  // Show loading screen
  document.getElementById('loading-screen').style.display = 'flex';
  document.getElementById('loading-screen').classList.add('active');

  ['home-screen','howto-screen','credits-screen','game-screen'].forEach(id => {
    const el = document.getElementById(id);
    el.style.display = 'none';
    el.classList.remove('active');
  });

  // Initialize UI handlers
  UI.init();

  // Mobile pause button
  const mobilePauseBtn = document.getElementById('btn-pause-mobile');
  if (mobilePauseBtn) {
    mobilePauseBtn.addEventListener('touchstart', e => {
      e.preventDefault();
      GameEngine.pause();
    }, { passive: false });
    mobilePauseBtn.addEventListener('click', () => GameEngine.pause());
  }

  // Start loading sequence
  UI.startLoading(() => {});

  // Horror ambient: site-wide glitch
  setInterval(() => {
    if (Math.random() < 0.04) {
      document.body.style.transform = `translate(${(Math.random()-0.5)*4}px,${(Math.random()-0.5)*2}px)`;
      setTimeout(() => { document.body.style.transform = ''; }, 80);
    }
  }, 500);

  // Occasional invert
  setInterval(() => {
    if (Math.random() < 0.004) {
      document.body.style.filter = 'invert(1)';
      setTimeout(() => { document.body.style.filter = ''; }, 50);
    }
  }, 3000);

});
