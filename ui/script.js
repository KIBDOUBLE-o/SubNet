/**
 * SubNet DungeonMaster — frontend
 *
 * Python → JS:
 *   setAuthenticated(bool)
 *   setMaximized(bool)
 *   sendAnnounce(message, type)   // type: info|error|warn|success
 *   setSlavesTree(tree)
 *   setInfo(data)
 *   setScreen(src)
 *   appendBash(text, type)
 *   clearBash()
 *   setLoginError(msg)            // optional, on splash
 *
 * JS → Python (window.pywebview.api):
 *   log_in(password)
 *   window_minimize / window_maximize / window_close
 *   on_slave_open(id)
 *   on_slave_close(id)
 *   on_page_change(page)
 *   on_group_toggle(name, collapsed)
 *   on_bash_command(cmd)
 *   on_screen_drop(dataUrl, filename)
 *   on_screen_expand()
 *   on_screen_fps(fps)
 *   on_screen_quality(quality)
 */

(function () {
  'use strict';

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function callPython(method, ...args) {
    try {
      if (window.pywebview && window.pywebview.api && typeof window.pywebview.api[method] === 'function') {
        return window.pywebview.api[method](...args);
      }
    } catch (e) {
      console.warn('[pywebview]', method, e);
    }
    console.log(`[stub] ${method}`, ...args);
    return Promise.resolve(null);
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  // ─── state ─────────────────────────────────────────────────
  let currentPage = 'info';
  let activeSlaveId = null;   // currently "opened" slave
  let slavesTreeData = [];
  let slavesIndex = {};       // id → slave object (flat)

  // ─── DOM ───────────────────────────────────────────────────
  const splash            = $('#splash');
  const app               = $('#app');
  const passwordInp       = $('#password');
  const btnLogin          = $('#btn-login');
  const loginError        = $('#login-error');
  const btnSlaves         = $('#btn-slaves');
  const drawer            = $('#drawer');
  const drawerOverlay     = $('#drawer-overlay');
  const btnDrawerClose    = $('#btn-drawer-close');
  const slavesTreeEl      = $('#slaves-tree');
  const tabs              = $('#tabs');
  const infoGrid          = $('#info-grid');
  const infoMeta          = $('#info-meta');
  const infoNoSlave       = $('#info-no-slave');
  const screenImg         = $('#screen-img');
  const screenPlaceholder = $('#screen-placeholder');
  const dropzone          = $('#screen-dropzone');
  const bashOutput        = $('#bash-output');
  const bashInput         = $('#bash-input');
  const activeSlaveBar    = $('#active-slave-bar');
  const activeSlaveName   = $('#active-slave-name');
  const activeSlaveDot    = $('#active-slave-dot');
  const btnCloseSlave     = $('#btn-close-slave');
  const announceContainer = $('#announce-container');
  const iconMaximize      = $('#icon-maximize');
  const iconRestore       = $('#icon-restore');

  // ─── AUTH / SPLASH ─────────────────────────────────────────
  btnLogin.addEventListener('click', onLogin);
  passwordInp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onLogin();
  });

  function onLogin() {
    // Does NOT close splash — only calls Python
    callPython('log_in', passwordInp.value);
  }

  function setLoginError(msg) {
    if (!msg) {
      loginError.hidden = true;
      loginError.textContent = '';
      return;
    }
    loginError.textContent = msg;
    loginError.hidden = false;
  }

  /** Python: setAuthenticated(true/false) */
  function setAuthenticated(state) {
    if (state) {
      splash.hidden = true;
      app.hidden = false;
      updateNoSlaveHint();
    } else {
      app.hidden = true;
      splash.hidden = false;
      passwordInp.value = '';
      setLoginError(null);
      closeSlave(false);
    }
  }

  // ─── WINDOW CONTROLS ───────────────────────────────────────
  $('#btn-minimize').addEventListener('click', () => callPython('window_minimize'));
  $('#btn-maximize').addEventListener('click', () => callPython('window_maximize'));
  $('#btn-close').addEventListener('click', () => callPython('window_close'));

  // splash controls (close/minimize before login)
  const btnSplashMin = $('#btn-splash-minimize');
  const btnSplashClose = $('#btn-splash-close');
  if (btnSplashMin) btnSplashMin.addEventListener('click', () => callPython('window_minimize'));
  if (btnSplashClose) btnSplashClose.addEventListener('click', () => callPython('window_close'));

  /** Python: setMaximized(bool) — swap maximize/restore icon */
  function setMaximized(state) {
    if (state) {
      iconMaximize.hidden = true;
      iconRestore.hidden = false;
    } else {
      iconMaximize.hidden = false;
      iconRestore.hidden = true;
    }
  }

  // ─── WINDOW DRAG (CSS region + Python fallback) ─────────────
  // CSS -webkit-app-region works on Chromium; if not, mousedown → start_drag()
  function bindDrag(el) {
    if (!el) return;
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      // don't start drag from interactive children
      if (e.target.closest('button, input, select, a, .no-drag')) return;
      callPython('start_drag');
    });
  }
  bindDrag($('#titlebar-drag'));
  bindDrag($('#splash-drag'));

  // ─── ANNOUNCE ──────────────────────────────────────────────
  /** Python: sendAnnounce(message, type)  type = info|error|warn|success */
  function sendAnnounce(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `announce ${type || 'info'}`;
    el.innerHTML = `
      <span class="announce-msg">${escapeHtml(message)}</span>
      <button class="announce-close" type="button" aria-label="Dismiss">×</button>
    `;
    const dismiss = () => {
      el.classList.add('hiding');
      setTimeout(() => el.remove(), 300);
    };
    el.querySelector('.announce-close').addEventListener('click', dismiss);
    announceContainer.appendChild(el);
    // auto-dismiss after 5s (errors stay longer)
    const ttl = type === 'error' ? 8000 : 5000;
    setTimeout(dismiss, ttl);
  }

  // ─── TABS ──────────────────────────────────────────────────
  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    switchPage(btn.dataset.page);
  });

  function switchPage(name) {
    if (name === currentPage) return;
    currentPage = name;
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === name));
    $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${name}`));
    callPython('on_page_change', name);
    if (name === 'bash') setTimeout(() => bashInput.focus(), 50);
  }

  // ─── DRAWER ────────────────────────────────────────────────
  function openDrawer() {
    drawer.classList.add('open');
    drawerOverlay.classList.add('open');
  }
  function closeDrawer() {
    drawer.classList.remove('open');
    drawerOverlay.classList.remove('open');
  }
  function toggleDrawer() {
    drawer.classList.contains('open') ? closeDrawer() : openDrawer();
  }

  btnSlaves.addEventListener('click', toggleDrawer);
  btnDrawerClose.addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);

  const btnSlavesRefresh = $('#btn-slaves-refresh');
  if (btnSlavesRefresh) {
    btnSlavesRefresh.addEventListener('click', () => {
      btnSlavesRefresh.classList.add('spinning');
      callPython('on_slaves_refresh');
      // remove spin after a short time (Python can call setSlavesTree anytime)
      setTimeout(() => btnSlavesRefresh.classList.remove('spinning'), 800);
    });
  }

  // ─── SLAVES TREE ───────────────────────────────────────────
  /**
   * tree: [
   *   { type:'group', name, collapsed?, children:[...] },
   *   { type:'slave', id, displayName, ip, ping, online }
   * ]
   */
  function setSlavesTree(tree) {
    slavesTreeData = Array.isArray(tree) ? tree : [];
    rebuildIndex(slavesTreeData);
    renderSlavesTree();
    // keep active slave highlight if still present
    if (activeSlaveId && !slavesIndex[activeSlaveId]) {
      closeSlave(false);
    } else if (activeSlaveId) {
      updateActiveSlaveBar(slavesIndex[activeSlaveId]);
    }
  }

  function rebuildIndex(nodes, map = {}) {
    slavesIndex = map;
    (nodes || []).forEach(n => {
      if (n.type === 'slave') map[n.id] = n;
      if (n.children) rebuildIndex(n.children, map);
    });
    return map;
  }

  function renderSlavesTree() {
    slavesTreeEl.innerHTML = '';
    if (!slavesTreeData.length) {
      const empty = document.createElement('div');
      empty.className = 'tree-empty';
      empty.textContent = 'Dungeon is empty';
      slavesTreeEl.appendChild(empty);
      return;
    }
    slavesTreeData.forEach(node => {
      slavesTreeEl.appendChild(
        node.type === 'group' ? renderGroup(node) : renderSlave(node)
      );
    });
  }

  function renderGroup(group) {
    const el = document.createElement('div');
    el.className = 'tree-group' + (group.collapsed ? ' collapsed' : '');
    el.dataset.group = group.name;

    const header = document.createElement('div');
    header.className = 'tree-group-header';
    header.innerHTML = `
      <span class="chevron">▼</span>
      <span class="group-name">${escapeHtml(group.name)}</span>
      <span class="group-count" style="margin-left:auto;opacity:0.5">${(group.children || []).length}</span>
    `;
    header.addEventListener('click', () => {
      el.classList.toggle('collapsed');
      callPython('on_group_toggle', group.name, el.classList.contains('collapsed'));
    });

    const body = document.createElement('div');
    body.className = 'tree-group-body';
    (group.children || []).forEach(child => {
      body.appendChild(child.type === 'group' ? renderGroup(child) : renderSlave(child));
    });

    el.appendChild(header);
    el.appendChild(body);
    return el;
  }

  function renderSlave(slave) {
    const el = document.createElement('div');
    el.className = 'slave-item' + (slave.id === activeSlaveId ? ' selected' : '');
    el.dataset.id = slave.id;

    const pingStr = slave.ping != null ? `${slave.ping} ms` : '—';
    el.innerHTML = `
      <span class="slave-status ${slave.online ? 'online' : ''}"></span>
      <span class="slave-name">${escapeHtml(slave.displayName || slave.id)}</span>
      <div class="slave-meta">
        <span class="id">${escapeHtml(slave.id)}</span>
        <span>${escapeHtml(slave.ip || '—')}</span>
        <span>${pingStr}</span>
      </div>
    `;

    el.addEventListener('click', () => openSlave(slave.id));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      callPython('on_slave_context', slave.id, e.clientX, e.clientY);
    });
    return el;
  }

  // ─── OPEN / CLOSE SLAVE ────────────────────────────────────
  function openSlave(id) {
    const slave = slavesIndex[id];
    if (!slave) return;

    const prev = activeSlaveId;
    activeSlaveId = id;

    // highlight in tree
    $$('.slave-item').forEach(s => s.classList.toggle('selected', s.dataset.id === id));

    updateActiveSlaveBar(slave);
    updateNoSlaveHint();

    // clear page data belonging to previous context (Python will refill)
    if (prev !== id) {
      setInfo({});
      setScreen(null);
      clearBash();
      appendBash(`Slave ${slave.displayName || id} joined the dungeon`, 'sys');
    }

    callPython('on_slave_open', id);
    // optionally close drawer after select
    // closeDrawer();
  }

  function closeSlave(notify = true) {
    const prev = activeSlaveId;
    activeSlaveId = null;

    $$('.slave-item').forEach(s => s.classList.remove('selected'));
    activeSlaveBar.hidden = true;
    updateNoSlaveHint();

    setInfo({});
    setScreen(null);
    clearBash();

    if (notify && prev) {
      callPython('on_slave_close', prev);
    }
  }

  function updateActiveSlaveBar(slave) {
    if (!slave) {
      activeSlaveBar.hidden = true;
      return;
    }
    activeSlaveBar.hidden = false;
    activeSlaveName.textContent = slave.displayName || slave.id;
    activeSlaveDot.classList.toggle('online', !!slave.online);
  }

  function updateNoSlaveHint() {
    const noSlave = !activeSlaveId;
    if (infoNoSlave) {
      infoNoSlave.classList.toggle('visible', noSlave);
    }
    infoGrid.style.display = noSlave ? 'none' : '';
    bashInput.disabled = noSlave;
    bashInput.placeholder = noSlave ? 'select a slave first, master…' : 'command…';
  }

  btnCloseSlave.addEventListener('click', () => closeSlave(true));

  // ─── INFO ──────────────────────────────────────────────────
  function setInfo(data) {
    infoGrid.innerHTML = '';
    let entries = [];

    if (Array.isArray(data)) {
      entries = data.map(item => [item.key, item.value]);
    } else if (data && typeof data === 'object') {
      entries = Object.entries(data);
    }

    if (!entries.length) {
      if (activeSlaveId) {
        const empty = document.createElement('div');
        empty.className = 'info-empty';
        empty.style.gridColumn = '1 / -1';
        empty.textContent = 'No data';
        infoGrid.appendChild(empty);
      }
      infoMeta.textContent = '—';
      return;
    }

    entries.forEach(([key, value]) => {
      const card = document.createElement('div');
      card.className = 'info-card';
      card.innerHTML = `
        <span class="key">${escapeHtml(key)}</span>
        <span class="value">${escapeHtml(value)}</span>
      `;
      infoGrid.appendChild(card);
    });
    infoMeta.textContent = `${entries.length} item${entries.length === 1 ? '' : 's'}`;
  }

  // ─── SCREEN ────────────────────────────────────────────────
  function setScreen(src) {
    if (!src) {
      screenImg.hidden = true;
      screenImg.removeAttribute('src');
      screenPlaceholder.hidden = false;
      return;
    }
    screenImg.src = src;
    screenImg.hidden = false;
    screenPlaceholder.hidden = true;
  }

  ;['dragenter', 'dragover'].forEach(ev => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
    });
  });
  ;['dragleave', 'drop'].forEach(ev => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (!files || !files.length) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) {
      callPython('on_screen_drop', null, 'not_image');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setScreen(reader.result);
      callPython('on_screen_drop', reader.result, file.name);
    };
    reader.readAsDataURL(file);
  });

  $('#btn-screen-expand').addEventListener('click', () => callPython('on_screen_expand'));
  $('#screen-fps').addEventListener('change', (e) => callPython('on_screen_fps', Number(e.target.value)));
  $('#screen-quality').addEventListener('change', (e) => callPython('on_screen_quality', e.target.value));

  // ─── BASH ──────────────────────────────────────────────────
  function appendBash(text, type = 'out') {
    const line = document.createElement('div');
    line.className = `bash-line ${type}`;
    line.textContent = text;
    bashOutput.appendChild(line);
    bashOutput.scrollTop = bashOutput.scrollHeight;
  }

  function clearBash() {
    bashOutput.innerHTML = '';
  }

  bashInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (!activeSlaveId) {
        sendAnnounce('No slave selected, master', 'warn');
        return;
      }
      const cmd = bashInput.value.trim();
      if (!cmd) return;
      appendBash(cmd, 'cmd');
      bashInput.value = '';
      callPython('on_bash_command', cmd);
    }
  });

  // ─── EXPOSE ────────────────────────────────────────────────
  window.setAuthenticated = setAuthenticated;
  window.setMaximized     = setMaximized;
  window.sendAnnounce     = sendAnnounce;
  window.setSlavesTree    = setSlavesTree;
  window.setInfo          = setInfo;
  window.setScreen        = setScreen;
  window.appendBash       = appendBash;
  window.clearBash        = clearBash;
  window.setLoginError    = setLoginError;

  // also under DM namespace
  window.DM = {
    setAuthenticated, setMaximized, sendAnnounce,
    setSlavesTree, setInfo, setScreen, appendBash, clearBash,
    setLoginError, openSlave, closeSlave, switchPage,
  };

  // initial hint state
  updateNoSlaveHint();

})();