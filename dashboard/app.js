'use strict';
const BLOCKS = [[11185, 90651], [110808, 190197]];
const COLORS = {H: '#27775f', A: '#e99874', D: '#aeb9b3', X: '#e8ece5'};
const NAMES = {H: 'Barcelona · H', A: 'Athletic Club · A', D: 'Dead ball · D', X: 'No answer · X'};
let labels = null, half = 0, spells = [], importSequence = 0;
let playing = false, playbackRequest = null, previousTick = null, playhead = 0;
const $ = id => document.getElementById(id);

function parseCSV(text) {
  const rows = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (rows.shift().trim().toLowerCase() !== 'frame,label') throw Error('Expected CSV header: frame,label');
  if (rows.length !== 199319) throw Error('Expected exactly 199,319 prediction rows.');
  return rows.map((row, i) => {
    const p = row.split(','), label = (p[1] || '').trim().toUpperCase();
    if (p.length !== 2 || p[0].trim() !== String(i) || !Object.hasOwn(COLORS, label)) {
      throw Error(`Invalid frame or label at row ${i + 2}.`);
    }
    return label;
  });
}

function analyse(data) {
  const count = {H: 0, A: 0, D: 0, X: 0}, runs = [];
  for (const [start, end] of BLOCKS) {
    let a = start;
    for (let i = start; i <= end; i++) {
      count[data[i]]++;
      if (i === end || data[i + 1] !== data[a]) {
        runs.push({start: a, end: i, label: data[a]});
        a = i + 1;
      }
    }
  }
  return {count, runs, spells: runs.filter(r => r.label === 'H' || r.label === 'A')};
}

function duration(frames) {
  const s = Math.round(frames / 25);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function timecode(frame) {
  const s = Math.floor(frame / 25);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String((frame % 25) * 40).padStart(3, '0')}`;
}

function setStatus(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

function loadData(text, name) {
  // Parse and analyse completely before replacing any currently displayed data.
  const parsed = parseCSV(text), result = analyse(parsed);
  stopPlayback();
  labels = parsed;
  spells = result.runs;
  const {H, A, D, X} = result.count, live = H + A;
  const pct = v => live ? `${(100 * v / live).toFixed(1)}%` : '—';
  $('homeShare').textContent = $('balanceHome').textContent = pct(H);
  $('awayShare').textContent = $('balanceAway').textContent = pct(A);
  $('balanceBar').style.width = live ? `${100 * H / live}%` : '0%';
  $('spells').textContent = result.spells.length;
  $('deadTime').textContent = duration(D);
  $('abstained').textContent = duration(X);
  $('mean').textContent = result.spells.length ? `${(live / 25 / result.spells.length).toFixed(1)}s` : '—';
  $('longest').textContent = result.spells.length ? duration(Math.max(...result.spells.map(r => r.end - r.start + 1))) : '—';
  $('source').textContent = name;
  const total = H + A + D + X;
  for (const [id, value] of [['homeShare', live ? H / live : 0], ['awayShare', live ? A / live : 0], ['deadTime', total ? D / total : 0]]) {
    $(id + 'Meter').style.width = `${100 * value}%`;
  }
  document.body.classList.add('has-data');
  document.querySelectorAll('[data-half], #scrub, #play').forEach(el => { el.disabled = false; });
  setStatus('✓ Prediction file verified · 199,319 frames · Statistics cover the two published half windows.');
  setHalf(half);
}

function setHalf(value) {
  stopPlayback();
  half = value;
  document.querySelectorAll('[data-half]').forEach(b => {
    const selected = Number(b.dataset.half) === half + 1;
    b.classList.toggle('selected', selected);
    b.setAttribute('aria-pressed', String(selected));
  });
  const [a, b] = BLOCKS[half];
  $('scrub').min = a;
  $('scrub').max = b;
  $('scrub').value = a;
  inspect();
}

function inspect() {
  if (!labels) return;
  const frame = Number($('scrub').value), run = spells.find(r => frame >= r.start && frame <= r.end);
  $('timecode').textContent = timecode(frame);
  $('frame').textContent = frame.toLocaleString('en-US');
  $('state').textContent = NAMES[labels[frame]];
  $('state').style.color = labels[frame] === 'A' ? '#b57150' : labels[frame] === 'H' ? COLORS.H : '#7a8671';
  $('spellDuration').textContent = run ? duration(run.end - run.start + 1) : '—';
  draw(frame);
}

function draw(frame) {
  const canvas = $('timelineCanvas'), ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth, height = 85;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const c = canvas.getContext('2d');
  c.scale(ratio, ratio);
  const [a, b] = BLOCKS[half], length = b - a + 1;
  for (const r of spells) {
    if (r.end < a || r.start > b) continue;
    const x = (Math.max(a, r.start) - a) / length * width;
    const end = (Math.min(b, r.end) + 1 - a) / length * width;
    c.fillStyle = COLORS[r.label];
    c.fillRect(x, 10, Math.max(.4, end - x), 58);
  }
  const x = (frame - a) / length * width;
  c.strokeStyle = '#182c24';
  c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(x, 2); c.lineTo(x, 78); c.stroke();
  c.fillStyle = '#fa641c';
  c.beginPath(); c.moveTo(x - 4, 0); c.lineTo(x + 4, 0); c.lineTo(x, 6); c.fill();
}

async function importFile(file) {
  if (!file) return;
  const sequence = ++importSequence;
  try {
    if (file.size > 10 * 1024 * 1024) throw Error('CSV must be smaller than 10 MB.');
    setStatus(`Reading ${file.name}…`);
    const text = await file.text();
    if (sequence !== importSequence) return;
    loadData(text, file.name);
  } catch (error) {
    if (sequence === importSequence) setStatus(`Import rejected: ${error.message}${labels ? ' Previous data retained.' : ' Choose a valid prediction CSV.'}`, true);
  }
}


function advanceFrame(frame, elapsedSeconds, speed, end) {
  return Math.min(end, frame + Math.max(0, Math.min(elapsedSeconds, .25)) * 25 * speed);
}

function stopPlayback() {
  playing = false;
  previousTick = null;
  if (playbackRequest !== null) { cancelAnimationFrame(playbackRequest); playbackRequest = null; }
  if (typeof document !== 'undefined' && $('play')) {
    $('play').setAttribute('aria-pressed', 'false');
    $('play').setAttribute('aria-label', 'Play possession timeline');
    $('playLabel').textContent = 'Play timeline';
    $('play').querySelector('.play-glyph').textContent = '▶';
  }
}

function startPlayback() {
  if (!labels) return;
  if (playing) { stopPlayback(); return; }
  const [start, end] = BLOCKS[half];
  playhead = Number($('scrub').value);
  if (playhead >= end) playhead = start;
  playing = true;
  $('play').setAttribute('aria-pressed', 'true');
  $('play').setAttribute('aria-label', 'Pause possession timeline');
  $('playLabel').textContent = 'Pause timeline';
  $('play').querySelector('.play-glyph').textContent = 'Ⅱ';
  function tick(now) {
    if (!playing) return;
    if (previousTick !== null) playhead = advanceFrame(playhead, (now - previousTick) / 1000, Number($('speed').value), end);
    previousTick = now;
    $('scrub').value = Math.round(playhead);
    inspect();
    if (playhead >= end) { stopPlayback(); return; }
    playbackRequest = requestAnimationFrame(tick);
  }
  playbackRequest = requestAnimationFrame(tick);
}

if (typeof document !== 'undefined') {
  $('play').addEventListener('click', startPlayback);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlayback(); });
  document.querySelectorAll('[data-import]').forEach(button => button.addEventListener('click', () => $('file').click()));
  $('file').addEventListener('change', async event => {
    await importFile(event.target.files[0]);
    event.target.value = '';
  });
  const zone = $('importZone');
  ['dragenter', 'dragover'].forEach(type => zone.addEventListener(type, event => {
    event.preventDefault();
    zone.classList.add('drag-over');
  }));
  zone.addEventListener('dragleave', event => { if (!zone.contains(event.relatedTarget)) zone.classList.remove('drag-over'); });
  zone.addEventListener('drop', event => {
    event.preventDefault(); zone.classList.remove('drag-over');
    if (event.dataTransfer.files.length !== 1) { setStatus('Choose one prediction CSV at a time.', true); return; }
    importFile(event.dataTransfer.files[0]);
  });
  document.querySelectorAll('[data-half]').forEach(b => b.addEventListener('click', () => setHalf(Number(b.dataset.half) - 1)));
  $('scrub').addEventListener('input', () => { stopPlayback(); inspect(); });
  window.addEventListener('resize', inspect);
  $('timelineCanvas').addEventListener('click', e => {
    if (!labels) return;
    const rect = e.currentTarget.getBoundingClientRect(), [a, b] = BLOCKS[half];
    stopPlayback();
    $('scrub').value = Math.round(a + Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * (b - a));
    inspect();
  });
  const tip = $('timelineTooltip'), canvas = $('timelineCanvas');
  canvas.addEventListener('pointermove', event => {
    if (!labels || event.pointerType === 'touch') return;
    const rect = canvas.getBoundingClientRect(), fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const [a, b] = BLOCKS[half], frame = Math.round(a + fraction * (b - a));
    tip.textContent = `${timecode(frame)} · ${NAMES[labels[frame]]}`;
    tip.style.left = `${Math.max(22, Math.min(78, fraction * 100))}%`;
    tip.hidden = false;
  });
  canvas.addEventListener('pointerleave', () => { tip.hidden = true; });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!reducedMotion.matches && 'IntersectionObserver' in window) {
    document.body.classList.add('motion-ready');
    const reveal = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('in-view'); reveal.unobserve(entry.target); }
    }), {threshold: .08});
    document.querySelectorAll('.reveal').forEach(el => reveal.observe(el));
  }
  let scrollPending = false;
  function updateNav() {
    let current = '#overview';
    for (const id of ['timeline', 'method']) if ($(id).getBoundingClientRect().top <= 160) current = `#${id}`;
    document.querySelectorAll('.nav').forEach(link => {
      const active = link.getAttribute('href') === current;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    });
    scrollPending = false;
  }
  window.addEventListener('scroll', () => {
    if (!scrollPending) { scrollPending = true; window.requestAnimationFrame(updateNav); }
  }, {passive: true});
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    fetch('../submission/final/DEVUPWARD.csv').then(r => {
      if (!r.ok) throw Error('No local prediction file');
      return r.text();
    }).then(text => {
      if (importSequence === 0) loadData(text, 'DEVUPWARD.csv');
    }).catch(() => {
      if (importSequence === 0) setStatus('Select DEVUPWARD.csv to begin.');
    });
  } else setStatus('Select DEVUPWARD.csv to begin.');
}
if (typeof module !== 'undefined') module.exports = {parseCSV, analyse, duration, timecode, advanceFrame};
