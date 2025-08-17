// Friendly, plain JS. Multi-pad. Recording. Exports. Snapshots. Ghost replay.
// Fixed labels (no % artifacts). CSS @layer debug. Light/Dark theme. Controller indicator.

const padsEl = document.getElementById('pads');
const startBtn = document.getElementById('startBtn');
const toggleDebugBtn = document.getElementById('toggleDebug');
const themeBtn = document.getElementById('themeBtn');
const statusEl = document.getElementById('status');
const connIndicator = document.getElementById('connIndicator');
const dzSlider = document.getElementById('deadzone');
const dzOut = document.getElementById('dzOut');

const recordBtn = document.getElementById('recordBtn');
const exportJsonBtn = document.getElementById('exportJsonBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const snapshotBtn = document.getElementById('snapshotBtn');
const replayBtn = document.getElementById('replayBtn');

const recStateEl = document.getElementById('recState');
const recFramesEl = document.getElementById('recFrames');
const recDurEl = document.getElementById('recDur');
const snapsEl = document.getElementById('snaps');

// Keep it human: names are friendly and comments explain intent
const BUTTON_NAMES = [
  'A / Cross', 'B / Circle', 'X / Square', 'Y / Triangle',
  'LB / L1', 'RB / R1', 'LT / L2 (analog)', 'RT / R2 (analog)',
  'Back / Select', 'Start / Options', 'Left Stick', 'Right Stick',
  'D-Pad Up', 'D-Pad Down', 'D-Pad Left', 'D-Pad Right',
  'Home / Guide'
];

const app = {
  running: false,
  deadzone: parseFloat(dzSlider.value),
  pads: new Map(), // index -> { id, ui }
  capture: {
    isRecording: false,
    beganAt: 0,
    frames: [], // { t, pads: [{index,id,buttons[],axes[],mapping}] }
  },
  ghostReplay: null, // { frames, i, startedAt }
};

const say = (html) => statusEl.innerHTML = html;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const withDeadzone = (v, dz) => {
  const s = Math.sign(v);
  const av = Math.abs(v);
  if (av < dz) return 0;
  const scaled = (av - dz) / (1 - dz);
  return clamp(scaled * s, -1, 1);
};

function setConnIndicator(on) {
  connIndicator.classList.toggle('is-on', !!on);
  connIndicator.classList.toggle('is-off', !on);
}

// --- UI builders ------------------------------------------------------------
function createPadUI(gp) {
  const el = document.createElement('article');
  el.className = 'pad';
  el.dataset.index = gp.index;

  const header = document.createElement('div');
  header.className = 'pad__header';
  header.innerHTML = `
    <div><div class="pill">#${gp.index}</div></div>
    <div class="meta">
      <div><strong>${gp.id}</strong></div>
      <div>mapping: <code>${gp.mapping || 'none'}</code> · ${gp.buttons.length} buttons · ${gp.axes.length} axes</div>
    </div>
  `;

  const sticks = document.createElement('div');
  sticks.className = 'row sticks';
  sticks.append(makeStick('Left Stick', 'ls', 0, 1), makeStick('Right Stick', 'rs', 2, 3));

  const triggers = document.createElement('div');
  triggers.className = 'row triggers';
  triggers.append(makeTrigger('L2', 6), makeTrigger('R2', 7));

  const buttons = document.createElement('div');
  buttons.className = 'row buttons';
  for (let i = 0; i < gp.buttons.length; i++) {
    const tile = document.createElement('div');
    tile.className = 'btn';
    tile.dataset.i = String(i);
    const safeName = BUTTON_NAMES[i] || `Button ${i}`; // no % artifacts
    tile.dataset.name = safeName;
    tile.innerHTML = `<span class="name">${safeName}</span><span class="val">0.00</span>`;
    buttons.appendChild(tile);
  }

  el.append(header, sticks, triggers, buttons);
  padsEl.appendChild(el);

  return { el, sticks: sticks.children, triggers: triggers.children, buttons: buttons.children };
}

function makeStick(label, key, axX, axY) {
  const wrap = document.createElement('div');
  wrap.className = 'stick';
  wrap.dataset.key = key;
  wrap.dataset.coords = '(0.00, 0.00)';
  wrap.innerHTML = `<div class="dot"></div><div class="deadzone"></div><span class="stick-label">${label}</span>`;
  wrap.dataset.axX = String(axX);
  wrap.dataset.axY = String(axY);
  return wrap;
}
function makeTrigger(label, buttonIndex) {
  const wrap = document.createElement('div');
  wrap.className = 'trigger';
  wrap.dataset.button = String(buttonIndex);
  wrap.dataset.value = '0.00';
  wrap.innerHTML = `<div class="fill"></div><div class="label">${label}</div>`;
  return wrap;
}

// --- Attach/Detach ----------------------------------------------------------
function attachPad(gp) {
  if (!app.pads.has(gp.index)) {
    const ui = createPadUI(gp);
    app.pads.set(gp.index, { ui, id: gp.id });
    setConnIndicator(true);
    say(`Connected: <strong>${gp.id}</strong>. Move a stick or press a button to see it here.`);
  }
}
function detachPad(index) {
  const entry = app.pads.get(index);
  if (entry) {
    entry.ui.el.remove();
    app.pads.delete(index);
  }
  setConnIndicator(app.pads.size > 0);
  if (app.pads.size === 0) {
    say('All controllers disconnected. Reconnect and click <strong>Start</strong>.');
  }
}

// --- Frames -----------------------------------------------------------------
function takeLiveFrame(t) {
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  const pads = [];
  for (const gp of list) {
    if (!gp) continue;
    pads.push({
      index: gp.index,
      id: gp.id,
      buttons: gp.buttons.map(b => ({ pressed: !!b.pressed, value: Number(b.value.toFixed(3)) })),
      axes: gp.axes.map(a => Number(a.toFixed(3))),
      mapping: gp.mapping || 'none'
    });
  }
  return { t, pads };
}

function paintFromLive() {
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  setConnIndicator(Array.from(list).some(Boolean));
  for (const gp of list) {
    if (!gp) continue;
    attachPad(gp);
    const entry = app.pads.get(gp.index);
    const ui = entry.ui;

    const ls = ui.sticks[0];
    const rs = ui.sticks[1];
    const lsx = withDeadzone(gp.axes[0] || 0, app.deadzone);
    const lsy = withDeadzone(gp.axes[1] || 0, app.deadzone);
    const rsx = withDeadzone(gp.axes[2] || 0, app.deadzone);
    const rsy = withDeadzone(gp.axes[3] || 0, app.deadzone);

    ls.querySelector('.dot').style.setProperty('--x', lsx.toFixed(2));
    ls.querySelector('.dot').style.setProperty('--y', lsy.toFixed(2));
    rs.querySelector('.dot').style.setProperty('--x', rsx.toFixed(2));
    rs.querySelector('.dot').style.setProperty('--y', rsy.toFixed(2));
    ls.style.setProperty('--dz', app.deadzone);
    rs.style.setProperty('--dz', app.deadzone);
    ls.dataset.coords = `(${lsx.toFixed(2)}, ${lsy.toFixed(2)})`;
    rs.dataset.coords = `(${rsx.toFixed(2)}, ${rsy.toFixed(2)})`;

    const ltVal = gp.buttons[6] ? gp.buttons[6].value : 0;
    const rtVal = gp.buttons[7] ? gp.buttons[7].value : 0;
    const lt = ui.triggers[0];
    const rt = ui.triggers[1];
    lt.style.setProperty('--v', ltVal.toFixed(2));
    rt.style.setProperty('--v', rtVal.toFixed(2));
    lt.dataset.value = Number(ltVal).toFixed(2);
    rt.dataset.value = Number(rtVal).toFixed(2);

    for (let i = 0; i < ui.buttons.length; i++) {
      const bEl = ui.buttons[i];
      const btn = gp.buttons[i];
      if (!btn) continue;
      bEl.dataset.pressed = btn.pressed ? '1' : '0';
      bEl.querySelector('.val').textContent = btn.value.toFixed(2);
    }
  }
}

function paintFromFrame(frame) {
  setConnIndicator(true); // indicate "virtual" presence during replay
  for (const pad of frame.pads) {
    if (!app.pads.has(pad.index)) {
      const fake = { index: pad.index, id: pad.id, mapping: pad.mapping || 'none', buttons: new Array(pad.buttons.length).fill(0).map(() => ({pressed:false,value:0})), axes: new Array(pad.axes.length).fill(0) };
      const ui = createPadUI(fake);
      app.pads.set(pad.index, { ui, id: pad.id });
    }
    const entry = app.pads.get(pad.index);
    const ui = entry.ui;

    const ls = ui.sticks[0];
    const rs = ui.sticks[1];
    const lsx = withDeadzone(pad.axes[0] || 0, app.deadzone);
    const lsy = withDeadzone(pad.axes[1] || 0, app.deadzone);
    const rsx = withDeadzone(pad.axes[2] || 0, app.deadzone);
    const rsy = withDeadzone(pad.axes[3] || 0, app.deadzone);
    ls.querySelector('.dot').style.setProperty('--x', lsx.toFixed(2));
    ls.querySelector('.dot').style.setProperty('--y', lsy.toFixed(2));
    rs.querySelector('.dot').style.setProperty('--x', rsx.toFixed(2));
    rs.querySelector('.dot').style.setProperty('--y', rsy.toFixed(2));
    ls.style.setProperty('--dz', app.deadzone);
    rs.style.setProperty('--dz', app.deadzone);
    ls.dataset.coords = `(${lsx.toFixed(2)}, ${lsy.toFixed(2)})`;
    rs.dataset.coords = `(${rsx.toFixed(2)}, ${rsy.toFixed(2)})`;

    const ltVal = pad.buttons[6] ? pad.buttons[6].value : 0;
    const rtVal = pad.buttons[7] ? pad.buttons[7].value : 0;
    const lt = ui.triggers[0];
    const rt = ui.triggers[1];
    lt.style.setProperty('--v', Number(ltVal).toFixed(2));
    rt.style.setProperty('--v', Number(rtVal).toFixed(2));
    lt.dataset.value = Number(ltVal).toFixed(2);
    rt.dataset.value = Number(rtVal).toFixed(2);

    for (let i = 0; i < ui.buttons.length && i < pad.buttons.length; i++) {
      const tile = ui.buttons[i];
      const btn = pad.buttons[i];
      tile.dataset.pressed = btn.pressed ? '1' : '0';
      tile.querySelector('.val').textContent = Number(btn.value).toFixed(2);
    }
  }
}

// --- Loop -------------------------------------------------------------------
function loop(now) {
  if (!app.running) return;
  if (app.ghostReplay) {
    const g = app.ghostReplay;
    const elapsed = now - g.startedAt;
    while (g.i < g.frames.length - 1 && g.frames[g.i + 1].t <= elapsed) g.i++;
    paintFromFrame(g.frames[g.i]);
    if (g.i >= g.frames.length - 1) {
      app.ghostReplay = null;
      replayBtn.disabled = false;
      say('Ghost replay finished.');
      setConnIndicator(app.pads.size > 0);
    }
  } else {
    paintFromLive();
    if (app.capture.isRecording) {
      const t = performance.now() - app.capture.beganAt;
      const frame = takeLiveFrame(t);
      app.capture.frames.push(frame);
      recFramesEl.textContent = String(app.capture.frames.length);
      recDurEl.textContent = (t/1000).toFixed(1) + 's';
    }
  }
  requestAnimationFrame(loop);
}

// --- Controls ---------------------------------------------------------------
startBtn.addEventListener('click', () => {
  app.running = true;
  say('Debugger running. If nothing updates, press any controller button.');
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of list) if (gp) attachPad(gp);
  requestAnimationFrame(loop);
});

toggleDebugBtn.addEventListener('click', () => {
  const was = toggleDebugBtn.getAttribute('aria-pressed') === 'true';
  toggleDebugBtn.setAttribute('aria-pressed', String(!was));
  document.body.classList.toggle('debug');
});

themeBtn.addEventListener('click', () => {
  const isLight = document.body.classList.toggle('theme-light');
  if (isLight) document.body.classList.remove('theme-dark');
  else document.body.classList.add('theme-dark');
});

dzSlider.addEventListener('input', () => {
  app.deadzone = parseFloat(dzSlider.value);
  dzOut.textContent = app.deadzone.toFixed(2);
});

window.addEventListener('gamepadconnected', (e) => {
  attachPad(e.gamepad);
});
window.addEventListener('gamepaddisconnected', (e) => {
  detachPad(e.gamepad.index);
});

// --- Recording --------------------------------------------------------------
recordBtn.addEventListener('click', () => {
  if (!app.capture.isRecording) {
    app.capture.isRecording = true;
    app.capture.beganAt = performance.now();
    app.capture.frames = [];
    recordBtn.textContent = 'Stop';
    recStateEl.textContent = 'Recording';
    exportJsonBtn.disabled = true;
    exportCsvBtn.disabled = true;
    replayBtn.disabled = true;
    say('Recording… do a few inputs, then hit Stop.');
  } else {
    app.capture.isRecording = false;
    recordBtn.textContent = 'Record';
    recStateEl.textContent = 'Stopped';
    const hasFrames = app.capture.frames.length > 0;
    exportJsonBtn.disabled = !hasFrames;
    exportCsvBtn.disabled = !hasFrames;
    replayBtn.disabled = !hasFrames;
    say('Recording stopped.');
  }
});

// --- Helpers to save files --------------------------------------------------
function downloadFile(name, text, mime='application/octet-stream') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// --- Exports ---------------------------------------------------------------
exportJsonBtn.addEventListener('click', () => {
  const payload = {
    createdAt: new Date().toISOString(),
    deadzone: app.deadzone,
    frames: app.capture.frames
  };
  downloadFile('gamepad-recording.json', JSON.stringify(payload, null, 2), 'application/json');
});

exportCsvBtn.addEventListener('click', () => {
  const rows = [['t(ms)','pad','kind','index','pressed','value']];
  for (const f of app.capture.frames) {
    for (const p of f.pads) {
      p.buttons.forEach((b, i) => rows.push([f.t.toFixed(1), p.index, 'button', i, b.pressed ? 1 : 0, b.value]));
      p.axes.forEach((a, i) => rows.push([f.t.toFixed(1), p.index, 'axis', i, '', a]));
    }
  }
  const csv = rows.map(r => r.join(',')).join('\n');
  downloadFile('gamepad-recording.csv', csv, 'text/csv');
});

// --- Snapshots --------------------------------------------------------------
snapshotBtn.addEventListener('click', () => {
  const frame = takeLiveFrame(0);
  const card = document.createElement('div');
  card.className = 'snap';
  const padCount = frame.pads.length;
  let pressed = 0, axes = 0;
  frame.pads.forEach(p => { pressed += p.buttons.filter(b => b.pressed).length; axes += p.axes.length; });
  card.innerHTML = `
    <div><strong>${padCount}</strong> pad(s); <strong>${pressed}</strong> pressed buttons; axes: <strong>${axes}</strong></div>
    <div class="meta">${new Date().toLocaleString()}</div>
  `;
  snapsEl.prepend(card);
});

// --- Ghost Replay -----------------------------------------------------------
replayBtn.addEventListener('click', () => {
  if (app.capture.frames.length === 0) return;
  app.ghostReplay = { frames: app.capture.frames, i: 0, startedAt: performance.now() };
  replayBtn.disabled = true;
  say('Ghost replay started…');
});

// --- Feature detection ------------------------------------------------------
if (!('getGamepads' in navigator)) {
  say('Heads up: your browser does not support the Gamepad API.');
}
