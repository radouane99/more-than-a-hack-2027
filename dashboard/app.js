'use strict';
const BLOCKS = [[11185, 90651], [110808, 190197]];
const COLORS = {H: '#27775f', A: '#e99874', D: '#aeb9b3', X: '#e8ece5'};
const OBS_COLORS = {H: '#72b89c', A: '#f0b18e', D: '#a8b79e', X: '#3e5540'};
const NAMES = {H: 'Barcelona · H', A: 'Athletic Club · A', D: 'Dead ball · D', X: 'No answer · X'};
let labels = null, half = 0, spells = [], importSequence = 0;
let playing = false, playbackRequest = null, previousTick = null, playhead = 0;
let renderedSegment = null;
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
  renderedSegment = null;
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
  $('state').style.color = OBS_COLORS[labels[frame]];
  $('spellDuration').textContent = run ? duration(run.end - run.start + 1) : '—';
  draw(frame);
  drawObservatory(frame, run);
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


function lensBounds(frame, start, end, width = 1500) {
  const span = Math.min(width, end - start + 1);
  const lo = Math.max(start, Math.min(end - span + 1, frame - Math.floor(span / 2)));
  return [lo, lo + span - 1];
}

function orbitFraction(x, y, centreX, centreY) {
  return ((Math.atan2(y - centreY, x - centreX) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
}

function sizedContext(canvas, height) {
  const ratio = window.devicePixelRatio || 1, width = canvas.clientWidth;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const c = canvas.getContext('2d');
  c.scale(ratio, ratio);
  return {c, width, height};
}

function drawObservatory(frame, run) {
  if (!run) return;
  const [a, b] = BLOCKS[half], length = b - a + 1;
  const ring = $('orbitCanvas'), size = ring.clientWidth;
  const {c} = sizedContext(ring, size), mid = size / 2, radius = mid - 25;
  c.lineWidth = 17;
  for (const segment of spells) {
    if (segment.end < a || segment.start > b) continue;
    const from = (segment.start - a) / length * Math.PI * 2 - Math.PI / 2;
    const to = (segment.end + 1 - a) / length * Math.PI * 2 - Math.PI / 2;
    c.strokeStyle = OBS_COLORS[segment.label];
    c.beginPath(); c.arc(mid, mid, radius, from, to); c.stroke();
  }
  c.lineWidth = 1;
  for (let tick = 0; tick < 60; tick++) {
    const angle = tick / 60 * Math.PI * 2 - Math.PI / 2;
    const major = tick % 5 === 0;
    c.strokeStyle = major ? '#8b9e8066' : '#7c907233';
    c.beginPath();
    c.moveTo(mid + Math.cos(angle) * (radius + 14), mid + Math.sin(angle) * (radius + 14));
    c.lineTo(mid + Math.cos(angle) * (radius + (major ? 21 : 17)), mid + Math.sin(angle) * (radius + (major ? 21 : 17)));
    c.stroke();
  }
  const currentAngle = (frame - a) / length * Math.PI * 2 - Math.PI / 2;
  c.strokeStyle = '#ff7839'; c.lineWidth = 2;
  c.beginPath();
  c.moveTo(mid + Math.cos(currentAngle) * (radius - 14), mid + Math.sin(currentAngle) * (radius - 14));
  c.lineTo(mid + Math.cos(currentAngle) * (radius + 23), mid + Math.sin(currentAngle) * (radius + 23)); c.stroke();
  c.fillStyle = '#fff2df'; c.beginPath();
  c.arc(mid + Math.cos(currentAngle) * radius, mid + Math.sin(currentAngle) * radius, 4, 0, Math.PI * 2); c.fill();
  $('orbitHalf').textContent = half === 0 ? '1ST HALF' : '2ND HALF';
  $('orbitClock').textContent = timecode(frame).slice(0, 8);
  $('segmentElapsed').textContent = `${((frame - run.start) / 25).toFixed(1)}s`;
  $('segmentTotal').textContent = `of ${((run.end - run.start + 1) / 25).toFixed(1)}s total`;
  $('segmentProgress').style.width = `${100 * (frame - run.start + 1) / (run.end - run.start + 1)}%`;
  $('segmentProgress').style.background = OBS_COLORS[run.label];
  const lens = $('lensCanvas'), {c: ctx, width} = sizedContext(lens, 104);
  const [lo, hi] = lensBounds(frame, a, b), span = hi - lo + 1;
  ctx.strokeStyle = '#91a48420'; ctx.lineWidth = 1;
  for (let tick = 0; tick <= 6; tick++) {
    const x = tick / 6 * width;
    ctx.beginPath(); ctx.moveTo(x, 5); ctx.lineTo(x, 91); ctx.stroke();
  }
  ctx.globalAlpha = .85;
  for (const segment of spells) {
    if (segment.end < lo || segment.start > hi) continue;
    const x = (Math.max(lo, segment.start) - lo) / span * width;
    const end = (Math.min(hi, segment.end) + 1 - lo) / span * width;
    ctx.fillStyle = OBS_COLORS[segment.label];
    ctx.fillRect(x, 25, Math.max(.5, end - x - 1), 42);
    if (end - x > 25) {
      ctx.fillStyle = '#0f2118'; ctx.font = '600 10px Segoe UI, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(segment.label, x + (end - x) / 2, 50);
    }
  }
  ctx.globalAlpha = 1;
  const cursor = (frame - lo) / span * width;
  ctx.strokeStyle = '#f7e8ce'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cursor, 12); ctx.lineTo(cursor, 82); ctx.stroke();
  ctx.fillStyle = '#ff7839'; ctx.beginPath(); ctx.moveTo(cursor - 4, 9); ctx.lineTo(cursor + 4, 9); ctx.lineTo(cursor, 15); ctx.fill();
  $('lensStart').textContent = timecode(lo).slice(0, 8);
  $('lensEnd').textContent = timecode(hi).slice(0, 8);
  const key = `${half}-${run.start}`;
  if (renderedSegment !== key) {
    renderedSegment = key;
    $('orbitState').textContent = NAMES[run.label].split(' · ')[0];
    $('segmentState').textContent = NAMES[run.label];
    const crest = $('orbitCrest');
    crest.hidden = run.label !== 'H' && run.label !== 'A';
    if (!crest.hidden) crest.src = run.label === 'H' ? 'assets/barcelona.svg' : 'assets/athletic-club.svg';
    $('orbitState').style.color = OBS_COLORS[run.label];
    const inHalf = spells.filter(segment => segment.start >= a && segment.end <= b);
    const index = inHalf.findIndex(segment => segment.start === run.start);
    $('previousSegment').disabled = index <= 0;
    $('nextSegment').disabled = index >= inHalf.length - 1;
    const upcoming = $('upcoming'); upcoming.replaceChildren();
    const next = inHalf.slice(index + 1, index + 4);
    if (!next.length) {
      const text = document.createElement('span'); text.className = 'upcoming-empty'; text.textContent = 'End of this half.'; upcoming.append(text);
    }
    for (const segment of next) {
      const button = document.createElement('button');
      button.className = 'upcoming-state'; button.style.setProperty('--state-color', OBS_COLORS[segment.label]);
      const label = document.createElement('b'); label.textContent = segment.label;
      const time = document.createElement('span'); time.textContent = timecode(segment.start).slice(0, 8);
      const amount = document.createElement('small'); amount.textContent = `${((segment.end - segment.start + 1) / 25).toFixed(1)}s`;
      button.append(label, time, amount);
      button.setAttribute('aria-label', `Seek to ${NAMES[segment.label]} at video time ${time.textContent}`);
      button.addEventListener('click', () => seek(segment.start)); upcoming.append(button);
    }
  }
}

function seek(frame) {
  if (!labels) return;
  stopPlayback();
  const [a, b] = BLOCKS[half];
  $('scrub').value = Math.max(a, Math.min(b, Math.round(frame)));
  inspect();
}

function stepSegment(direction) {
  if (!labels) return;
  const [a, b] = BLOCKS[half], frame = Number($('scrub').value);
  const segments = spells.filter(segment => segment.start >= a && segment.end <= b);
  const index = segments.findIndex(segment => frame >= segment.start && frame <= segment.end);
  const target = segments[index + direction];
  if (target) seek(target.start);
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
  $('previousSegment').addEventListener('click', () => stepSegment(-1));
  $('nextSegment').addEventListener('click', () => stepSegment(1));
  $('orbitCanvas').addEventListener('click', event => {
    if (!labels) return;
    const rect = event.currentTarget.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const radius = Math.hypot(x - rect.width / 2, y - rect.height / 2);
    if (radius < rect.width / 2 - 45 || radius > rect.width / 2) return;
    const [a, b] = BLOCKS[half];
    seek(a + orbitFraction(x, y, rect.width / 2, rect.height / 2) * (b - a));
  });
  $('lensCanvas').addEventListener('click', event => {
    if (!labels) return;
    const rect = event.currentTarget.getBoundingClientRect(), [a, b] = BLOCKS[half];
    const [lo, hi] = lensBounds(Number($('scrub').value), a, b);
    seek(lo + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * (hi - lo));
  });
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
if (typeof module !== 'undefined') module.exports = {parseCSV, analyse, duration, timecode, advanceFrame, lensBounds, orbitFraction};
