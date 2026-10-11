import { createShelf, createTable } from './components.js';
import { tierOf } from './config.js';
import {
  COLLECTION, COUNTS, DEFAULT_COUNT, HELP, NOTES, TABLETOPS, photoUrl,
} from './data.js';
import {
  decodePicture, fetchPicture, materialSet, pictureAt, preparePicture, sharpened, tabletopTile,
} from './api.js';
import * as store from './state.js';
import {
  clamp, clockText, cutPuzzle, deviceTier, gridFor, minutesText, newSeed, rateCount,
} from './utils.js';

const $ = (sel) => document.querySelector(sel);
const ui = {
  body: document.body,
  table: $('#table'),
  layers: [...document.querySelectorAll('#table canvas')],
  badgeWrap: $('#badgeWrap'),
  badge: $('#badge'),
  lid: $('#lid'),
  rail: $('#rail'),
  unpack: $('#unpack'),
  notice: $('#notice'),
  coach: $('#coach'),
  shelf: $('#shelf'),
  create: $('#create'),
  edit: $('#edit'),
  confirm: $('#confirm'),
  pause: $('#pause'),
  settings: $('#settings'),
  help: $('#help'),
  toast: $('#toast'),
  preview: $('#preview'),
  previewCanvas: $('#previewCanvas'),
  cutBtn: $('#cutBtn'),
};
const setText = (sel, text) => { $(sel).textContent = text; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fine = () => window.matchMedia('(pointer: fine)').matches;

const tier = deviceTier();
let settings = store.loadSettings();
let index = store.loadIndex();
let current = null;
let pause = null;
let lidUrl = '';
let storageWarned = false;
let lidDue = false;

let toastTimer = 0;
const toast = (text) => {
  ui.toast.textContent = text;
  ui.toast.classList.add('is-shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('is-shown'), 3600);
};
const warnStorage = () => {
  if (storageWarned) return;
  storageWarned = true;
  toast('Storage is full, so progress isn’t saving. Delete a finished puzzle to make room.');
};

const sound = (() => {
  let ac = null;
  let out = null;
  let noise = null;
  const context = () => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!ac && AC) {
      ac = new AC();
      out = ac.createBiquadFilter();
      const level = ac.createGain();
      Object.assign(out, { type: 'lowpass' });
      out.frequency.value = 2600;
      out.Q.value = 0.3;
      level.gain.value = 0.6;
      out.connect(level).connect(ac.destination);
      const len = Math.round(ac.sampleRate * 0.3);
      noise = ac.createBuffer(1, len, ac.sampleRate);
      noise.copyToChannel(Float32Array.from({ length: len }, () => Math.random() * 2 - 1), 0);
    }
    if (ac?.state === 'suspended') ac.resume();
    return ac;
  };
  const vary = (v) => v * (0.93 + Math.random() * 0.14);
  const swell = (env, t, gain, ms) => {
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  };
  const hush = ({
    freq, gain, ms, at = 0,
  }) => {
    const t = ac.currentTime + at;
    const src = ac.createBufferSource();
    const band = ac.createBiquadFilter();
    const env = ac.createGain();
    src.buffer = noise;
    band.type = 'bandpass';
    band.frequency.value = vary(freq);
    band.Q.value = 0.8;
    swell(env, t, gain, ms);
    src.connect(band).connect(env).connect(out);
    src.start(t, Math.random() * 0.15, ms / 1000 + 0.05);
  };
  const tone = ({
    freq, gain, ms, at = 0, fall = 0.7, steady = false,
  }) => {
    const t = ac.currentTime + at;
    const osc = ac.createOscillator();
    const env = ac.createGain();
    const f = steady ? freq : vary(freq);
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * fall, t + ms / 1000);
    swell(env, t, gain, ms);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.03);
  };
  const play = (make) => () => { if (settings.sound && context()) make(); };
  return {
    wake: () => settings.sound && context(),
    pick: play(() => hush({ freq: 900, gain: 0.045, ms: 60 })),
    flip: play(() => {
      hush({ freq: 700, gain: 0.06, ms: 90 });
      tone({
        freq: 150, gain: 0.07, ms: 70, at: 0.07,
      });
    }),
    snap: play(() => {
      hush({ freq: 1100, gain: 0.06, ms: 35 });
      tone({ freq: 190, gain: 0.2, ms: 90 });
      tone({ freq: 320, gain: 0.06, ms: 50 });
    }),
    finish: play(() => [[392, 0], [493.88, 0.17], [587.33, 0.34], [783.99, 0.55]].forEach(([freq, at]) => {
      tone({
        freq, gain: 0.07, ms: 1700, at: at + 0.3, fall: 1, steady: true,
      });
      tone({
        freq: freq * 2, gain: 0.016, ms: 700, at: at + 0.3, fall: 1, steady: true,
      });
    })),
  };
})();

const clock = (() => {
  let total = 0;
  let since = null;
  let last = 0;
  return {
    start: (ms) => {
      total = ms;
      since = Date.now();
      last = since;
    },
    resume: () => {
      if (since !== null || !current || current.done || !ui.body.classList.contains('is-ready')) return;
      since = Date.now();
      last = since;
    },
    stop: (atLastMove) => {
      if (since === null) return;
      total += Math.max(0, (atLastMove ? Math.max(last, since) : Date.now()) - since);
      since = null;
    },
    touch: () => { last = Date.now(); },
    add: (ms) => { total += ms; },
    value: () => total + (since === null ? 0 : Date.now() - since),
    running: () => since !== null,
    lastMove: () => last,
  };
})();

const saveIndex = () => store.saveIndex(index) || warnStorage();
const nameTaken = (name, exceptId) => index.some((m) => m.id !== exceptId && m.name.trim().toLowerCase() === name.trim().toLowerCase());
const freeName = (base, n = 1) => {
  const name = n === 1 ? base : `${base} (${n})`;
  return nameTaken(name) ? freeName(base, n + 1) : name;
};
const fetchWidth = (n) => (n <= 500 ? 2000 : 3400);

let saveTimer = 0;
const persist = () => {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (!current) return;
  const snapshot = ui.body.classList.contains('is-ready') && table.serialize();
  if (snapshot && !store.saveTable(current.id, snapshot)) warnStorage();
  Object.assign(current, { elapsed: clock.value(), updated: Date.now() });
  saveIndex();
};
const scheduleSave = (why) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, why === 'view' ? 900 : 250);
};

const showProgress = () => {
  if (!current || !ui.body.classList.contains('is-ready')) return;
  const { joined, n } = table.stats();
  current.joined = joined;
  setText('#badgeJoined', `${joined.toLocaleString()} of ${n.toLocaleString()} joined`);
  setText('#lidJoined', `${joined.toLocaleString()} of ${n.toLocaleString()}`);
};
const showClock = () => {
  const text = clockText(clock.value());
  setText('#badgeClock', text);
  setText('#lidClock', text);
};
const creditOf = (meta) => {
  if (meta.src.kind === 'collection') return `Photograph by ${meta.src.credit} on Unsplash`;
  if (meta.src.kind === 'link') return `Photograph from ${new URL(meta.src.url).hostname}`;
  return 'Your own photograph';
};
const dressBox = (meta) => {
  $('#badgeArt').src = meta.thumb;
  setText('#badgeName', meta.name);
  if (!ui.body.classList.contains('is-ready')) setText('#badgeJoined', `${meta.n.toLocaleString()} pieces`);
  setText('#lidCount', meta.n.toLocaleString());
  setText('#lidName', meta.name);
  setText('#lidDesc', meta.desc || '');
  setText('#lidCredit', creditOf(meta));
  $('#lidStamp').hidden = !meta.done;
  $('#lidArt').src = lidUrl || meta.thumb;
  $('#lidArt').alt = `Picture on the lid: ${meta.name}`;
  showClock();
};
const setLid = (open) => {
  ui.lid.classList.toggle('is-open', open);
  ui.badge.setAttribute('aria-expanded', String(open));
};

const table = createTable({
  host: ui.table,
  tier: (n) => tierOf(tier, n),
  base: ui.layers[0],
  float: ui.layers[1],
  insets: () => {
    const rail = ui.rail.getBoundingClientRect();
    const badge = ui.badge.getBoundingClientRect();
    const across = rail.width > rail.height;
    const right = across ? 16 : window.innerWidth - rail.left + 8;
    const lidEdge = ui.badgeWrap.getBoundingClientRect().left + ui.lid.offsetWidth + 16;
    const beside = (lidDue || ui.lid.classList.contains('is-open')) && window.innerWidth - lidEdge - right >= 360;
    return {
      top: beside ? 16 : badge.bottom + 8,
      bottom: across ? window.innerHeight - rail.top + 8 : 16,
      right,
      left: beside ? lidEdge : 16,
    };
  },
  on: {
    activity: () => clock.touch(),
    zoom: (pct) => setText('#zoomPct', `${pct}%`),
    history: ({ undo, redo }) => {
      $('#undoBtn').disabled = !undo;
      $('#redoBtn').disabled = !redo;
    },
    change: (why) => {
      scheduleSave(why);
      if (why !== 'view') showProgress();
    },
    pick: () => sound.pick(),
    flip: () => sound.flip(),
    snap: () => {
      sound.snap();
      navigator.vibrate?.(8);
    },
    select: (count) => {
      $('#held').hidden = !count;
      setText('#heldText', `${count} ${count === 1 ? 'piece' : 'pieces'} picked up. Drag any one to carry them.`);
    },
    complete: () => {
      if (!current) return;
      clock.stop(false);
      current.done = true;
      persist();
      sound.finish();
      dressBox(current);
      const done = current;
      const wide = window.matchMedia('(min-width: 760px)').matches;
      lidDue = wide;
      table.present();
      setTimeout(() => {
        lidDue = false;
        if (current === done) setLid(true);
      }, wide ? 900 : 2000);
      toast(`Complete. ${current.n.toLocaleString()} pieces in ${clockText(current.elapsed)}.`);
    },
  },
});

const showUnpack = (n) => {
  ui.unpack.hidden = false;
  setText('#unpackCount', n.toLocaleString());
  $('#unpackMeter').style.transform = 'scaleX(0)';
};
const showNotice = ({
  title, text, upload = false, retry = false,
}) => {
  ui.unpack.hidden = true;
  ui.notice.hidden = false;
  setText('#noticeTitle', title);
  setText('#noticeText', text);
  $('#noticeUpload').hidden = !upload;
  $('#noticeRetry').hidden = !retry;
};

const refetch = async (meta) => {
  const url = meta.src.kind === 'collection' ? photoUrl(meta.src.photo, fetchWidth(meta.n)) : meta.src.url;
  if (!url) return null;
  const blob = await fetchPicture(url);
  await store.putImage(meta.id, blob);
  return blob;
};

const closePuzzle = (save = true) => {
  if (!current) return;
  if (save) persist();
  clearTimeout(saveTimer);
  clock.stop(false);
  table.unload();
  current = null;
  pause = null;
  setLid(false);
  applyTabletop();
  ui.body.classList.remove('has-puzzle', 'is-ready');
  ui.unpack.hidden = true;
  ui.notice.hidden = true;
  $('#held').hidden = true;
};

const openPuzzle = async (id, blobHint) => {
  closePuzzle();
  const meta = index.find((m) => m.id === id);
  if (!meta) return;
  current = meta;
  applyTabletop();
  clock.start(meta.elapsed || 0);
  clock.stop(false);
  store.saveLastOpen(id);
  URL.revokeObjectURL(lidUrl);
  lidUrl = '';
  ui.body.classList.add('has-puzzle');
  dressBox(meta);
  showUnpack(meta.n);
  try {
    const blob = blobHint ?? (await store.getImage(id)) ?? (await refetch(meta));
    if (current !== meta) return;
    if (!blob) {
      showNotice({
        title: 'The picture for this box is missing',
        text: 'This browser didn’t keep the photo you uploaded. Choose the same photo again and every piece will be right where you left it.',
        upload: true,
      });
      return;
    }
    lidUrl = URL.createObjectURL(blob);
    $('#lidArt').src = lidUrl;
    const bitmap = await pictureAt(blob, meta.w, meta.h);
    const restored = await table.load({
      meta,
      bitmap,
      saved: store.loadTable(id),
      onProgress: (p) => { $('#unpackMeter').style.transform = `scaleX(${p})`; },
    });
    if (current !== meta) return;
    ui.unpack.hidden = true;
    ui.body.classList.add('is-ready');
    showProgress();
    clock.resume();
    if (!restored) persist();
    if (!settings.coached) ui.coach.hidden = false;
    ui.table.focus({ preventScroll: true });
  } catch (err) {
    if (err.message === 'cancelled' || current !== meta) return;
    showNotice({ title: 'The box wouldn’t open', text: err.message, retry: true });
  }
};

const shelf3d = tierOf(tier, 100).name === 'low' ? null : createShelf({ canvas: $('#shelfScene'), host: ui.shelf });
ui.shelf.classList.toggle('is-solid', Boolean(shelf3d));
const depthOf = (n) => Math.round(clamp(9 + Math.log2(n / 100) * 1.8, 9, 19));
const boxOf = ({
  attr, art, name, count, say, tally = '', deep, flag = '', meta, tools = '',
}) => `<li class="box" style="--deep:${deep}px">
    <button class="box-open" type="button" ${attr} data-art="${art}" data-name="${esc(name)}" data-count="${tally}" data-deep="${deep}" aria-label="${esc(name)}, ${say}">
      <span class="box-lid">
        <span class="box-art" style="background-image:url('${art}')"></span>
        <span class="box-band"><span class="box-name">${esc(name)}</span><span class="box-count">${count}</span></span>
        ${flag}
      </span>
    </button>
    <div class="box-meta">${meta}${tools}</div>
  </li>`;
const spineOf = (m) => {
  const pct = Math.round(((m.joined || 0) / m.n) * 100);
  const status = m.done ? 'Complete' : `${pct}% joined`;
  return boxOf({
    attr: `data-open="${m.id}"`,
    art: m.thumb,
    name: m.name,
    count: `<b>${m.n.toLocaleString()}</b>pieces`,
    say: `${m.n.toLocaleString()} pieces`,
    tally: m.n.toLocaleString(),
    deep: depthOf(m.n),
    flag: m.done ? '<span class="box-flag">Complete</span>' : '',
    meta: `<span class="box-stat">${current?.id === m.id ? '<b>On the table</b>' : ''}<span>${status} · <span class="clock">${clockText(m.elapsed || 0)}</span></span>
      <span class="box-bar"><span style="transform:scaleX(${m.done ? 1 : pct / 100})"></span></span></span>`,
    tools: `<button class="icon-btn" type="button" data-edit="${m.id}" aria-label="Relabel ${esc(m.name)}"><svg><use href="#i-pencil"/></svg></button>
      <button class="icon-btn" type="button" data-delete="${m.id}" aria-label="Delete ${esc(m.name)}"><svg><use href="#i-trash"/></svg></button>`,
  });
};
const sealedOf = (c) => boxOf({
  attr: `data-sealed="${c.key}"`,
  art: photoUrl(c.photo, 520, 72),
  name: c.name,
  count: 'Sealed',
  say: 'sealed',
  deep: 12,
  flag: '<span class="box-wrap"></span>',
  meta: `<span class="box-stat"><span>${esc(c.desc)}</span></span>`,
});

const renderShelf = () => {
  const done = index.filter((m) => m.done).length;
  $('#mine').innerHTML = index.map(spineOf).join('');
  $('#mineEmpty').hidden = index.length > 0;
  $('#sealed').innerHTML = COLLECTION.map(sealedOf).join('');
  setText('#shelfSummary', index.length
    ? `${index.length} ${index.length === 1 ? 'box' : 'boxes'}, ${done} complete`
    : 'Pick a box to begin.');
  $('#shelfClose').hidden = !current;
  if (ui.shelf.open) shelf3d?.update();
};

const openShelf = () => {
  if (current) {
    clock.stop(false);
    persist();
  }
  setLid(false);
  renderShelf();
  if (!ui.shelf.open) ui.shelf.showModal();
  document.fonts.ready.then(() => shelf3d?.update());
};

ui.shelf.addEventListener('cancel', (e) => { if (!current) e.preventDefault(); });
ui.shelf.addEventListener('close', () => clock.resume());
ui.shelf.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.open) {
    ui.shelf.close();
    if (current?.id !== t.dataset.open) openPuzzle(t.dataset.open);
  }
  if (t.dataset.sealed) openCreate(t.dataset.sealed);
  if (t.dataset.edit) openEdit(t.dataset.edit);
  if (t.dataset.delete) openDelete(t.dataset.delete);
});

const draft = {
  source: 'collection', key: null, blob: null, url: '', picture: null, seed: 0, count: DEFAULT_COUNT, autoName: '', token: 0,
};
const RATE_TEXT = {
  ok: 'Comfortable on this device.',
  lag: 'May lag on this device.',
  slow: 'Likely sluggish on this device.',
};

$('#counts').innerHTML = COUNTS.map((n) => `<label class="count" data-rate="${rateCount(n, tier)}">
    <input type="radio" name="count" value="${n}"${n === DEFAULT_COUNT ? ' checked' : ''}><span>${n.toLocaleString()}</span></label>`).join('');
$('#countKey').hidden = COUNTS.every((n) => rateCount(n, tier) === 'ok');
$('#picker').innerHTML = COLLECTION.map((c) => `<label class="pick">
    <input class="sr-only" type="radio" name="photo" value="${c.key}">
    <img src="${photoUrl(c.photo, 240, 60)}" alt="${esc(c.name)}" loading="lazy"></label>`).join('');

const drawPreview = () => {
  const c = ui.previewCanvas;
  const ctx = c.getContext('2d');
  const pic = draft.picture;
  const aspect = pic ? pic.width / pic.height : 1.5;
  const grid = gridFor(draft.count, aspect);
  const rate = rateCount(grid.total, tier);
  setText('#countNote', `${grid.cols} × ${grid.rows} grid, ${grid.total.toLocaleString()} pieces${pic ? '' : ' for a landscape photo'}. ${RATE_TEXT[rate]}`);
  $('#countNote').dataset.rate = rate;
  ui.cutBtn.textContent = `Cut ${grid.total.toLocaleString()} pieces`;
  if (!pic) return;
  const w = aspect >= 1 ? 720 : Math.round(720 * aspect);
  const h = Math.round(w / aspect);
  Object.assign(c, { width: w, height: h });
  ctx.drawImage(pic, 0, 0, w, h);
  const cut = cutPuzzle({
    cols: grid.cols, rows: grid.rows, w, h, seed: draft.seed,
  });
  ctx.lineWidth = grid.total > 2000 ? 0.6 : 1;
  ctx.strokeStyle = 'rgba(250, 246, 238, 0.55)';
  cut.pieces.forEach((pc) => {
    ctx.setTransform(1, 0, 0, 1, pc.hx, pc.hy);
    ctx.stroke(pc.path);
  });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
};

const setPreview = (state, note = '') => {
  ui.preview.dataset.state = state;
  setText('#previewNote', note);
};
const setSourceError = (text) => setText('#sourceError', text);
const proposeName = (name) => {
  const input = $('#nameInput');
  if (input.value.trim() && input.value !== draft.autoName) return;
  draft.autoName = freeName(name);
  input.value = draft.autoName;
  setText('#nameError', '');
};

const usePicture = async (load, name) => {
  draft.token += 1;
  const mine = draft.token;
  draft.picture = null;
  setSourceError('');
  setPreview('loading', 'Checking the picture…');
  drawPreview();
  try {
    const picture = await load();
    if (mine !== draft.token) return;
    draft.picture = picture;
    setPreview('ready');
    drawPreview();
    if (name) proposeName(name);
  } catch (err) {
    if (mine !== draft.token) return;
    setPreview('error', 'No picture yet.');
    setSourceError(err.message);
  }
};

const loadImage = (src) => new Promise((done, fail) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => done(img);
  img.onerror = () => fail(new Error('This photo didn’t load. Check your connection and try again.'));
  img.src = src;
});

const chooseCollection = (key) => {
  const c = COLLECTION.find((x) => x.key === key);
  Object.assign(draft, { key, blob: null, url: '' });
  usePicture(() => loadImage(photoUrl(c.photo, 960, 72)), c.name);
};
const chooseBlob = (blob, name) => {
  Object.assign(draft, { key: null, blob, url: draft.source === 'link' ? draft.url : '' });
  usePicture(() => decodePicture(blob), name);
};
const fileName = (file) => file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 60);

const showSource = (source) => {
  draft.source = source;
  document.querySelectorAll('.source-panel').forEach((p) => { p.hidden = p.dataset.panel !== source; });
  draft.token += 1;
  draft.picture = null;
  if ($('#nameInput').value === draft.autoName) {
    $('#nameInput').value = '';
    draft.autoName = '';
  }
  setSourceError('');
  setPreview('empty', {
    collection: 'Choose a photograph to see where the die will cut.',
    link: 'Paste the address of a photo, then press Enter.',
    upload: 'Choose a photo from your device.',
  }[source]);
  drawPreview();
  const checked = $('#picker input:checked');
  if (source === 'collection' && checked) chooseCollection(checked.value);
};

const openCreate = (key) => {
  const form = $('#createForm');
  form.reset();
  Object.assign(draft, {
    key: null, blob: null, url: '', picture: null, seed: newSeed(), count: DEFAULT_COUNT, autoName: '',
  });
  setText('#nameError', '');
  showFile(null);
  ui.cutBtn.removeAttribute('aria-busy');
  ui.cutBtn.disabled = false;
  const pick = key ?? COLLECTION[Math.floor(Math.random() * COLLECTION.length)].key;
  $(`#picker input[value="${pick}"]`).checked = true;
  showSource('collection');
  ui.create.showModal();
  $('#picker input:checked').closest('.pick').scrollIntoView({ block: 'nearest', inline: 'center' });
  if (key && fine()) $('#nameInput').focus();
  else $('input[name="source"]:checked').focus();
};

$('#createForm').addEventListener('change', (e) => {
  const { name, value } = e.target;
  if (name === 'source') showSource(value);
  if (name === 'photo') chooseCollection(value);
  if (name === 'count') {
    draft.count = Number(value);
    drawPreview();
  }
});
$('#linkInput').addEventListener('change', (e) => {
  const raw = e.target.value.trim();
  if (!raw) return;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) throw new Error();
    draft.url = url.href;
    usePicture(async () => {
      const blob = await fetchPicture(url.href);
      draft.blob = blob;
      return decodePicture(blob);
    }, '');
  } catch {
    setPreview('error', 'No picture yet.');
    setSourceError('That doesn’t look like a web address. It should start with https://');
  }
});
$('#linkInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    e.target.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
const showFile = (file) => {
  setText('#drop span', file ? file.name : 'Choose a photo');
  setText('#drop small', file ? 'Choose a different photo, or drop one here' : 'or drop one here');
  if (file) chooseBlob(file, fileName(file));
};
$('#fileInput').addEventListener('change', (e) => showFile(e.target.files[0]));
const drop = $('#drop');
['dragenter', 'dragover'].forEach((type) => drop.addEventListener(type, (e) => {
  e.preventDefault();
  drop.classList.add('is-over');
}));
['dragleave', 'drop'].forEach((type) => drop.addEventListener(type, () => drop.classList.remove('is-over')));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
  if (file) showFile(file);
  else setSourceError('That file isn’t a picture.');
});
$('#nameInput').addEventListener('input', (e) => {
  setText('#nameError', nameTaken(e.target.value) ? 'You already have a box with this name.' : '');
});

$('#createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#nameInput').value.trim();
  const desc = $('#descInput').value.trim();
  if (!draft.picture) {
    setSourceError(draft.source === 'collection' ? 'Choose a photograph first.' : 'Add a picture first.');
    return;
  }
  if (!name || nameTaken(name)) {
    setText('#nameError', name ? 'You already have a box with this name.' : 'Every box needs a name.');
    $('#nameInput').focus();
    return;
  }
  ui.cutBtn.disabled = true;
  ui.cutBtn.setAttribute('aria-busy', 'true');
  try {
    const sealed = COLLECTION.find((c) => c.key === draft.key);
    ui.cutBtn.textContent = sealed ? 'Fetching the photo…' : 'Reading the photo…';
    const blob = sealed ? await fetchPicture(photoUrl(sealed.photo, fetchWidth(draft.count))) : draft.blob;
    ui.cutBtn.textContent = 'Cutting…';
    const prepared = await preparePicture(blob, draft.count);
    const id = `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    const kept = await store.putImage(id, prepared.blob);
    const meta = {
      id,
      name,
      desc,
      src: sealed
        ? { kind: 'collection', photo: sealed.photo, credit: sealed.credit }
        : { kind: draft.source, url: draft.source === 'link' ? draft.url : '' },
      cols: prepared.grid.cols,
      rows: prepared.grid.rows,
      n: prepared.grid.total,
      w: prepared.w,
      h: prepared.h,
      seed: draft.seed,
      thumb: prepared.thumb,
      elapsed: 0,
      joined: 0,
      done: false,
      created: Date.now(),
      updated: Date.now(),
    };
    index = [meta, ...index];
    saveIndex();
    ui.create.close();
    ui.shelf.close();
    if (!kept) toast(meta.src.kind === 'upload' ? 'This browser won’t keep the photo. Keep the file to reopen this box later.' : 'This browser won’t keep the photo, so it will be fetched again next time.');
    openPuzzle(id, prepared.blob);
  } catch (err) {
    setSourceError(err.message);
    drawPreview();
  } finally {
    ui.cutBtn.disabled = false;
    ui.cutBtn.removeAttribute('aria-busy');
  }
});

let editing = null;
const openEdit = (id) => {
  editing = index.find((m) => m.id === id);
  $('#editName').value = editing.name;
  $('#editDesc').value = editing.desc || '';
  setText('#editError', '');
  ui.edit.showModal();
  $('#editName').focus();
  $('#editName').select();
};
$('#editForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#editName').value.trim();
  if (!name || nameTaken(name, editing.id)) {
    setText('#editError', name ? 'You already have a box with this name.' : 'Every box needs a name.');
    return;
  }
  const target = index.find((m) => m.id === editing.id);
  if (target) Object.assign(target, { name, desc: $('#editDesc').value.trim() });
  saveIndex();
  if (current?.id === editing.id) dressBox(current);
  renderShelf();
  ui.edit.close();
});

let deleting = null;
const openDelete = (id) => {
  deleting = index.find((m) => m.id === id);
  setText('#confirmText', `“${deleting.name}” and its ${deleting.n.toLocaleString()} pieces will be deleted, along with the time you’ve spent on it.`);
  ui.confirm.showModal();
};
ui.confirm.addEventListener('close', () => {
  if (ui.confirm.returnValue !== 'delete' || !deleting) return;
  const { id } = deleting;
  if (current?.id === id) closePuzzle();
  index = index.filter((m) => m.id !== id);
  saveIndex();
  store.dropTable(id);
  store.deleteImage(id);
  deleting = null;
  renderShelf();
});

const showPause = () => {
  const idle = pause.kind === 'idle';
  setText('#pauseTitle', idle ? 'The clock is paused' : 'Welcome back');
  setText('#pauseText', idle
    ? `No moves for ${minutesText(Date.now() - pause.from)}, so the clock stopped at your last one.`
    : 'You stepped away, so the clock stopped when you left.');
  setText('#pauseClock', clockText(clock.value()));
  $('#pauseAdd').hidden = !idle;
  ui.pause.returnValue = '';
  if (!ui.pause.open) ui.pause.showModal();
};
ui.pause.addEventListener('close', () => {
  if (!pause) return;
  if (ui.pause.returnValue === 'add') clock.add(Date.now() - pause.from);
  pause = null;
  clock.resume();
  showClock();
});

const idleLimit = () => settings.idleMin * 60000;
setInterval(() => {
  if (!current) return;
  if (clock.running() && Date.now() - clock.lastMove() > idleLimit()) {
    clock.stop(true);
    pause = { kind: 'idle', from: clock.lastMove() };
    persist();
    showPause();
  }
  if (pause?.kind === 'idle') setText('#pauseAdd', `I was still working · add ${minutesText(Date.now() - pause.from)}`);
  showClock();
}, 1000);
setInterval(() => {
  if (current && clock.running()) {
    current.elapsed = clock.value();
    saveIndex();
  }
}, 15000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (current && clock.running()) {
      clock.stop(Date.now() - clock.lastMove() > idleLimit());
      pause = { kind: 'away', at: Date.now() };
    }
    persist();
    return;
  }
  if (pause?.kind !== 'away') return;
  if (Date.now() - pause.at < 15000) {
    pause = null;
    clock.resume();
  } else {
    showPause();
  }
});
window.addEventListener('pagehide', persist);
['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach((type) => window.addEventListener(type, () => {
  if (clock.running()) clock.touch();
}, { passive: true }));
window.addEventListener('pointerdown', () => sound.wake(), { once: true });

const applySettings = () => {
  document.querySelectorAll('[data-assists]').forEach((el) => { el.hidden = !settings.assists; });
  table.setTurning({ edge: settings.turnEdge, scroll: settings.turnScroll, zoom: settings.zoom });
  $('#zoom').hidden = !settings.zoom;
  $('#setZoom').checked = settings.zoom;
  $('#setTurnEdge').checked = settings.turnEdge;
  $('#setTurnScroll').checked = settings.turnScroll;
  const mode = settings.view ?? tierOf(tier, 500).view;
  table.setView(mode);
  document.querySelectorAll('input[name="view"]').forEach((input) => { input.checked = input.value === mode; });
  applyTabletop();
  $('#setAssists').checked = settings.assists;
  $('#setSound').checked = settings.sound;
  $('#setIdle').value = settings.idleMin;
  setText('#setIdleOut', `${settings.idleMin} min`);
};
const changeSettings = (patch) => {
  settings = { ...settings, ...patch };
  store.saveSettings(settings);
  applySettings();
};
$('#setAssists').addEventListener('change', (e) => changeSettings({ assists: e.target.checked }));
$('#setSound').addEventListener('change', (e) => changeSettings({ sound: e.target.checked }));
$('#setIdle').addEventListener('input', (e) => changeSettings({ idleMin: Number(e.target.value) }));
$('#setView').addEventListener('change', (e) => changeSettings({ view: e.target.value }));
$('#setZoom').addEventListener('change', (e) => changeSettings({ zoom: e.target.checked }));
$('#setTurnEdge').addEventListener('change', (e) => changeSettings({ turnEdge: e.target.checked }));
$('#setTurnScroll').addEventListener('change', (e) => changeSettings({ turnScroll: e.target.checked }));

const tiles = new Map();
let shown = '';
const markTops = () => document.querySelectorAll('#tabletops .top').forEach((el) => {
  const key = el.querySelector('input').value;
  const tile = tiles.get(key)?.tile;
  el.classList.toggle('is-loading', key === shown && !tile);
  if (tile) Object.assign(el.querySelector('.top-swatch').style, { backgroundImage: `url(${tile.swatch})`, filter: `brightness(${tabletopOf(key).gain})` });
});
const tileOf = (top) => {
  if (!tiles.has(top.key)) {
    const entry = {};
    entry.promise = (top.ph ? materialSet(top) : tabletopTile(top, photoUrl(top.photo, 1800, 82))).then((tile) => {
      entry.tile = tile;
      markTops();
      if (top.sharp) {
        sharpened(top, tile).then((fine) => {
          entry.tile = fine;
          if (shown === top.key) table.setTabletop(top, fine);
        }, () => {});
      }
      return tile;
    }, (err) => {
      tiles.delete(top.key);
      throw err;
    });
    tiles.set(top.key, entry);
  }
  return tiles.get(top.key).promise;
};
const warmTops = () => TABLETOPS.reduce((prev, top) => prev.then(() => tileOf(top)).catch(() => {}), Promise.resolve());
const tabletopOf = (key) => TABLETOPS.find((t) => t.key === key) ?? TABLETOPS[0];
function applyTabletop() {
  const top = tabletopOf(current?.table ?? settings.table);
  const own = Boolean(current?.table) && current.table !== settings.table;
  ui.body.dataset.tone = top.tone;
  ui.table.style.backgroundColor = top.color;
  if (shown !== top.key) {
    shown = top.key;
    const ready = tiles.get(top.key)?.tile;
    table.setTabletop(top, ready ?? null);
    if (!ready) {
      if (top.photo) {
        tabletopTile(top, photoUrl(top.photo, 240, 60), 256)
          .then((soft) => { if (shown === top.key && !tiles.get(top.key)?.tile) table.setTabletop(top, soft); }, () => {});
      }
      tileOf(top).then((tile) => { if (shown === top.key) table.setTabletop(top, tile); }, () => {});
    }
  }
  markTops();
  document.querySelectorAll('#tabletops input').forEach((input) => { input.checked = input.value === top.key; });
  setText('#tabletopNote', `${own ? `Only this puzzle sits on ${top.name.toLowerCase()}.` : `Every puzzle sits on ${top.name.toLowerCase()} unless you choose otherwise.`} ${top.credit}.`);
  $('#tabletopDefault').hidden = !own;
}
$('#tabletops').innerHTML = TABLETOPS.map((t) => `<label class="top">
    <input class="sr-only" type="radio" name="tabletop" value="${t.key}"><span class="top-swatch"></span><span class="top-name">${t.name}</span></label>`).join('');
document.querySelectorAll('#tabletops .top-swatch').forEach((el, n) => {
  el.style.backgroundColor = TABLETOPS[n].color;
});
$('#tabletops').addEventListener('change', (e) => {
  if (!current) {
    changeSettings({ table: e.target.value });
    return;
  }
  if (e.target.value === settings.table) delete current.table;
  else current.table = e.target.value;
  saveIndex();
  applyTabletop();
});
$('#tabletopDefault').addEventListener('click', () => {
  const key = current?.table ?? settings.table;
  if (current) delete current.table;
  saveIndex();
  changeSettings({ table: key });
});

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
document.querySelectorAll('[data-tip]').forEach((el) => {
  const keys = (el.dataset.keys ?? '').replace('{mod}', MOD).split(' ').filter(Boolean).map((key) => `<kbd>${key}</kbd>`).join('');
  el.insertAdjacentHTML('beforeend', `<span class="tip" aria-hidden="true">${el.dataset.tip}${keys}</span>`);
  el.setAttribute('aria-label', el.dataset.tip);
});
$('#helpBody').innerHTML = `${HELP.map((group) => `<section class="guide">
    <h3 class="label">${group.title}</h3>
    <div class="guide-head" aria-hidden="true"><span></span><span>Mouse and keyboard</span><span>Touch</span></div>
    ${group.rows.map(([what, desk, touch]) => `<dl class="guide-row"><dt>${what}</dt><dd data-with="Mouse and keyboard">${desk.replaceAll('{mod}', MOD)}</dd><dd data-with="Touch">${touch}</dd></dl>`).join('')}
  </section>`).join('')}
  <section class="guide"><h3 class="label">Good to know</h3><ul class="guide-notes">${NOTES.map((note) => `<li>${note}</li>`).join('')}</ul></section>`;

[ui.settings, ui.help].forEach((sheet) => sheet.addEventListener('pointerdown', (e) => {
  const r = sheet.getBoundingClientRect();
  if (e.target === sheet && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) sheet.close();
}));
ui.settings.addEventListener('close', () => { if (!ui.shelf.open) clock.resume(); });

$('#coachList').innerHTML = (fine()
  ? ['Drag a piece by its middle to carry it.', 'Drag it by its edge to turn it, or scroll while holding it.', 'Double-click to flip it over.', 'Scroll to zoom, drag the table to pan, right-drag to spin it.', 'Press ? for the full guide.']
  : ['Drag a piece to carry it.', 'Keep it held and twist with a second finger to turn it.', 'Double-tap to flip it over.', 'Pinch to zoom, drag the table to pan, twist with two fingers to spin it.', 'Settings has the full guide.']
).map((t) => `<li>${t}</li>`).join('');

const actions = {
  shelf: openShelf,
  'close-shelf': () => ui.shelf.close(),
  new: () => openCreate(),
  fit: () => table.fit(),
  undo: () => {
    if ($('#undoBtn').disabled) return;
    table.undo();
    sound.pick();
  },
  redo: () => {
    if ($('#redoBtn').disabled) return;
    table.redo();
    sound.pick();
  },
  spin: (e) => table.spin(((e?.shiftKey ? -1 : 1) * Math.PI) / 2),
  help: () => {
    if (ui.settings.open) ui.settings.close();
    ui.help.showModal();
    ui.help.scrollTop = 0;
  },
  putdown: () => table.release(),
  zoomin: () => table.zoomBy(1.25),
  zoomout: () => table.zoomBy(0.8),
  zoom100: () => table.zoomReset(),
  settings: () => {
    warmTops();
    if (current) clock.stop(false);
    ui.settings.showModal();
    $('#setAssists').focus();
  },
  lid: () => setLid(false),
  coached: () => {
    ui.coach.hidden = true;
    changeSettings({ coached: true });
  },
};
document.addEventListener('click', (e) => {
  const closer = e.target.closest('[data-close]');
  if (closer) closer.closest('dialog').close();
  const btn = e.target.closest('[data-act], [data-assist]');
  if (btn?.dataset.act) actions[btn.dataset.act]?.(e);
  if (btn?.dataset.assist) table.assist(btn.dataset.assist);
});
ui.badge.addEventListener('click', () => setLid(!ui.lid.classList.contains('is-open')));
$('#noticeRetry').addEventListener('click', () => current && openPuzzle(current.id));
$('#noticeFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !current) return;
  await store.putImage(current.id, file);
  ui.notice.hidden = true;
  openPuzzle(current.id, file);
});

document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select')) return;
  const open = document.querySelector('dialog[open]');
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (e.key === '?' && !mod && (!open || open === ui.help || open === ui.shelf)) {
    e.preventDefault();
    if (open === ui.help) ui.help.close();
    else actions.help();
    return;
  }
  if (open) return;
  if (mod && (k === 'z' || k === 'y')) {
    e.preventDefault();
    actions[k === 'y' || e.shiftKey ? 'redo' : 'undo']();
    return;
  }
  if (mod) return;
  if (k === 'v' && current) {
    changeSettings({ view: (settings.view ?? tierOf(tier, 500).view) === 'flat' ? '3d' : 'flat' });
    return;
  }
  if (e.key === 'Escape' && ui.lid.classList.contains('is-open')) {
    setLid(false);
    return;
  }
  if (table.key(e)) e.preventDefault();
});
ui.table.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());

window.addEventListener('storage', (e) => {
  if (e.key === store.keyOf('index')) {
    const theirs = store.loadIndex();
    const mine = current && theirs.find((m) => m.id === current.id);
    if (current && !mine) {
      closePuzzle(false);
      toast('This puzzle was deleted in another tab.');
    }
    if (mine) Object.assign(current, { name: mine.name, desc: mine.desc });
    index = theirs.map((m) => (m.id === current?.id ? current : m));
    applyTabletop();
    if (current) dressBox(current);
    if (!current || ui.shelf.open) openShelf();
  }
  if (current && e.newValue && e.key === store.keyOf(`table:${current.id}`)) {
    closePuzzle(false);
    toast('This puzzle is being worked in another tab, so it went back on the shelf here.');
    openShelf();
  }
});

applySettings();
const last = store.loadLastOpen();
if (last && index.some((m) => m.id === last)) openPuzzle(last);
else openShelf();
