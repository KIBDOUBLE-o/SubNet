(function(){
  "use strict";

  // ----- DOM refs -----
  const stage              = document.getElementById('stage');
  const stageImage         = document.getElementById('stageImage');
  const stagePlaceholder   = document.getElementById('stagePlaceholder');
  const btnExit            = document.getElementById('btnExit');
  const fpsValue           = document.getElementById('fpsValue');
  const interactiveBar     = document.getElementById('interactiveBar');
  const interactiveBarText = document.getElementById('interactiveBarText');
  const interactiveModeBar = document.getElementById('interactiveModeBar');

  // ----- state -----
  let currentBase64 = null;
  let isInteractive = false;
  let lastMoveSent = 0;
  const MOVE_THROTTLE_MS = 16; // ~60 Hz

  // ============================================================
  //  PUBLIC API — called from Python via pywebview
  // ============================================================

  window.setScreen = function(base64, mimeType) {
    if (!base64 || typeof base64 !== 'string') {
      clearScreen();
      return;
    }

    let dataUri = base64.trim();

    if (!dataUri.startsWith('data:')) {
      const mime = (typeof mimeType === 'string' && mimeType.trim())
        ? mimeType.trim()
        : 'image/jpeg';
      dataUri = 'data:' + mime + ';base64,' + dataUri;
    }

    currentBase64 = dataUri;
    stageImage.src = dataUri;
    stageImage.hidden = false;
    stagePlaceholder.hidden = true;
  };

  window.setFrameRate = function(frames) {
    const num = Number(frames);
    if (isNaN(num) || !isFinite(num)) {
      fpsValue.textContent = '—';
    } else {
      fpsValue.textContent = Number.isInteger(num) ? num : num.toFixed(1);
    }
  };

  window.setInteractive = function(active) {
    isInteractive = Boolean(active);

    if (isInteractive) {
      interactiveBarText.textContent = 'alt to exit interactive mode';
      interactiveBar.classList.add('active');
      interactiveModeBar.classList.add('visible');
      document.body.classList.add('interactive');
    } else {
      interactiveBarText.textContent = 'alt to enter interactive mode';
      interactiveBar.classList.remove('active');
      interactiveModeBar.classList.remove('visible');
      document.body.classList.remove('interactive');
    }
  };

  // ============================================================
  //  INTERNAL HELPERS
  // ============================================================

  function clearScreen() {
    currentBase64 = null;
    stageImage.src = '';
    stageImage.hidden = true;
    stagePlaceholder.hidden = false;
  }

  function api() {
    return (window.pywebview && window.pywebview.api) ? window.pywebview.api : null;
  }

  function callApi(name, ...args) {
    const a = api();
    if (a && typeof a[name] === 'function') {
      try { a[name](...args); } catch (_) {}
    }
  }

  /**
   * Нормализованные координаты 0..1 относительно реальной области картинки
   * (с учётом object-fit: contain).
   */
  function normCoords(e, img) {
    const rect = img.getBoundingClientRect();
    const nw = img.naturalWidth || rect.width;
    const nh = img.naturalHeight || rect.height;
    if (!nw || !nh || rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const scale = Math.min(rect.width / nw, rect.height / nh);
    const dispW = nw * scale;
    const dispH = nh * scale;
    const offX = rect.left + (rect.width - dispW) / 2;
    const offY = rect.top + (rect.height - dispH) / 2;

    const x = (e.clientX - offX) / dispW;
    const y = (e.clientY - offY) / dispH;

    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return [x, y];
  }

  function mapButton(button) {
    if (button === 1) return 'middle';
    if (button === 2) return 'right';
    return 'left';
  }

  function mapKey(e) {
    const k = e.key;
    if (!k) return 'unknown';
    if (k.length === 1) return k.toLowerCase();
    return k.toLowerCase(); // ArrowUp -> arrowup, Control -> control
  }

  // ----- exit button -----
  btnExit.addEventListener('click', function(e) {
    e.stopPropagation();
    callApi('quit');
  });

  // ============================================================
  //  INTERACTIVE: toggle Alt, capture input
  // ============================================================

  // Alt — только keyup, чтобы не залипало
  window.addEventListener('keyup', function(e) {
    if (e.key !== 'Alt') return;
    e.preventDefault();
    window.setInteractive(!isInteractive);
    // опционально сообщить Python
    callApi('set_input_enabled', isInteractive);
  });

  // Mouse
  stage.addEventListener('mousemove', function(e) {
    if (!isInteractive || stageImage.hidden) return;
    const now = performance.now();
    if (now - lastMoveSent < MOVE_THROTTLE_MS) return;
    const coords = normCoords(e, stageImage);
    if (!coords) return;
    lastMoveSent = now;
    callApi('on_mouse_move', coords[0], coords[1]);
  });

  stage.addEventListener('mousedown', function(e) {
    if (!isInteractive || stageImage.hidden) return;
    e.preventDefault();
    const coords = normCoords(e, stageImage);
    if (!coords) return;
    callApi('on_mouse_down', mapButton(e.button), coords[0], coords[1]);
  });

  stage.addEventListener('mouseup', function(e) {
    if (!isInteractive || stageImage.hidden) return;
    e.preventDefault();
    const coords = normCoords(e, stageImage);
    if (!coords) return;
    callApi('on_mouse_up', mapButton(e.button), coords[0], coords[1]);
  });

  stage.addEventListener('wheel', function(e) {
    if (!isInteractive || stageImage.hidden) return;
    e.preventDefault();
    // pyautogui: положительный scroll = вверх
    const dy = e.deltaY > 0 ? -3 : 3;
    callApi('on_mouse_scroll', 0, dy);
  }, { passive: false });

  // Keyboard (только в interactive; Alt уже обработан)
  window.addEventListener('keydown', function(e) {
    if (!isInteractive) return;
    if (e.key === 'Alt') return;
    e.preventDefault();
    callApi('on_key_down', mapKey(e));
  });

  window.addEventListener('keyup', function(e) {
    if (!isInteractive) return;
    if (e.key === 'Alt') return; // toggle выше
    e.preventDefault();
    callApi('on_key_up', mapKey(e));
  });

  // ============================================================
  //  INIT
  // ============================================================

  clearScreen();
  window.setFrameRate(0);
  window.setInteractive(false);
  window.clearScreen = clearScreen;

  document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
  });

  stageImage.addEventListener('error', function() {
    if (stageImage.src && stageImage.src !== window.location.href) {
      stagePlaceholder.hidden = false;
      stageImage.hidden = true;
    }
  });
})();