'use strict';
const BLOCKS = [[11185, 90651], [110808, 190197]];
const COLORS = {H: '#27775f', A: '#e99874', D: '#aeb9b3', X: '#e8ece5'};
const OBS_COLORS = {H: '#72b89c', A: '#f0b18e', D: '#a8b79e', X: '#3e5540'};
const NAMES = {H: 'Barcelona · H', A: 'Athletic Club · A', D: 'Dead ball · D', X: 'No answer · X'};
let labels = null, half = 0, spells = [], importSequence = 0;
let playing = false, playbackRequest = null, previousTick = null, playhead = 0;
let renderedSegment = null, evidenceData = null, reviewRendered = false;
const EVIDENCE_COLUMNS = ['ball_visible', 'nearest_home_m', 'nearest_away_m', 'collective_motion_m_s', 'ball_speed_m_s', 'slow_index', 'phase_support', 'stoppage_index', 'ball_outside', 'local_state'];
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

function validatePrediction(text) {
  const parsed = parseCSV(text);
  const result = analyse(parsed);
  return {parsed, result};
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

function buildMatchStory(result, blocks = BLOCKS, windowFrames = 4500) {
  const longest = {H: null, A: null};
  for (const run of result.spells) {
    const previous = longest[run.label];
    if (!previous || run.end - run.start > previous.end - previous.start) longest[run.label] = run;
  }
  const halves = [], handovers = [];
  let busiest = null;
  for (let halfIndex = 0; halfIndex < blocks.length; halfIndex++) {
    const [start, end] = blocks[halfIndex], counts = {H: 0, A: 0, D: 0, X: 0};
    const runs = result.runs.filter(r => r.start >= start && r.end <= end);
    const events = [];
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]; counts[run.label] += run.end - run.start + 1;
      const previous = runs[i - 1];
      if (previous && previous.end + 1 === run.start && ['H', 'A'].includes(previous.label) && ['H', 'A'].includes(run.label) && previous.label !== run.label) events.push(run.start);
    }
    handovers.push(...events);
    const live = counts.H + counts.A;
    halves.push({half: halfIndex, start, end, counts, homeShare: live ? counts.H / live : null, handovers: events.length});
    const width = Math.min(windowFrames, end - start + 1);
    const starts = [...new Set([start, ...events.map(t => Math.min(t, end - width + 1))])].sort((a, b) => a - b);
    let left = 0, right = 0;
    for (const lo of starts) {
      const hi = lo + width - 1;
      while (left < events.length && events[left] < lo) left++;
      right = Math.max(right, left);
      while (right < events.length && events[right] <= hi) right++;
      const count = right - left;
      if (count && (!busiest || count > busiest.count)) busiest = {start: lo, end: hi, count, half: halfIndex};
    }
  }
  return {longest, halves, busiest, handovers: handovers.length};
}

function openStoryMoment(frame) {
  const target = BLOCKS.findIndex(([a, b]) => frame >= a && frame <= b);
  if (target < 0 || !labels) return;
  if (target !== half) setHalf(target);
  seek(frame);
  document.querySelector('a[href="#timeline"]').click();
}

function renderMatchStory(story) {
  const cards = $('storyCards'); cards.replaceChildren();
  const createCard = (kind, title, value, detail, frame) => {
    const card = document.createElement('button'); card.className = `story-card ${kind}`;
    const label = document.createElement('small'); label.textContent = title;
    const number = document.createElement('strong'); number.textContent = value;
    const description = document.createElement('p'); description.textContent = detail;
    const action = document.createElement('span'); action.textContent = frame === null ? 'No matching segment' : `${timecode(frame).slice(0, 8)} · Inspect moment →`;
    card.append(label, number, description, action);
    card.disabled = frame === null;
    if (frame !== null) card.addEventListener('click', () => openStoryMoment(frame));
    cards.append(card);
  };
  for (const [team, name] of [['H', 'Barcelona'], ['A', 'Athletic Club']]) {
    const run = story.longest[team];
    createCard(team === 'H' ? 'home-story' : 'away-story', `${name.toUpperCase()} / LONGEST SPELL`, run ? `${((run.end - run.start + 1) / 25).toFixed(run.end - run.start + 1 < 25 ? 2 : 1)}s` : '—',
      run ? `Longest continuous predicted ${name} possession. Stoppages split spells.` : `No live ${name} possession is predicted.`, run ? run.start : null);
  }
  const busy = story.busiest;
  createCard('handover-story', 'BUSIEST HANDOVER WINDOW', busy ? `${busy.count} changes` : '—', busy ? `${duration(busy.end - busy.start + 1)} window · direct team-to-team changes, excluding stoppages and unknown gaps.` : 'No direct H-to-A or A-to-H handover is predicted.', busy ? busy.start : null);
  const rows = $('halfRows'); rows.replaceChildren();
  for (const h of story.halves) {
    const row = document.createElement('button'); row.className = 'half-story-row';
    row.setAttribute('aria-label', `Inspect ${h.half === 0 ? 'first' : 'second'} half at its published start`);
    const name = document.createElement('b'); name.textContent = h.half === 0 ? '1st half' : '2nd half';
    const bar = document.createElement('span'); bar.className = 'half-story-bar';
    const fill = document.createElement('i'); fill.style.width = h.homeShare === null ? '0%' : `${h.homeShare * 100}%`; bar.append(fill);
    if (h.homeShare === null) bar.classList.add('no-live');
    const shares = document.createElement('span'); shares.className = 'half-story-shares';
    shares.textContent = h.homeShare === null ? 'No live predictions' : `${(h.homeShare * 100).toFixed(1)}% H / ${((1 - h.homeShare) * 100).toFixed(1)}% A`;
    const summary = document.createElement('small'); summary.textContent = `${h.handovers} direct handovers · ${duration(h.counts.D)} dead ball${h.counts.X ? ` · ${duration(h.counts.X)} unanswered` : ''}`;
    row.append(name, bar, shares, summary); row.addEventListener('click', () => openStoryMoment(h.start)); rows.append(row);
  }
  const [first, second] = story.halves;
  if (first.homeShare === null || second.homeShare === null) $('halfNarrative').textContent = 'A live-play share comparison requires H or A predictions in both halves.';
  else {
    const delta = (second.homeShare - first.homeShare) * 100;
    $('halfNarrative').textContent = Math.abs(delta) < .05 ? 'Barcelona’s predicted live-play share is unchanged to one decimal place.' : `Barcelona’s predicted live-play share ${delta > 0 ? 'rises' : 'falls'} by ${Math.abs(delta).toFixed(1)} percentage points in the second half.`;
  }
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

function loadData(text, name, evidence = null) {
  // Parse and analyse completely before replacing any currently displayed data.
  const {parsed, result} = validatePrediction(text);
  stopPlayback();
  renderedSegment = null;
  evidenceData = evidence;
  reviewRendered = false;
  labels = parsed;
  spells = result.runs;
  renderMatchStory(buildMatchStory(result));
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
  $('validationReport').hidden = false;
  $('importHeading').textContent = 'Prediction file loaded.';
  $('importButtonLabel').textContent = 'Replace & validate CSV';
  const explorerLink = document.querySelector('a[href="#timeline"]');
  explorerLink.removeAttribute('aria-disabled');
  explorerLink.removeAttribute('tabindex');
  document.querySelectorAll('[data-half], #scrub, #play').forEach(el => { el.disabled = false; });
  setStatus('✓ CSV format verified · 199,319 ordered frames. Analysis covers the two published half windows.');
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
  explainFrame(frame);
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

function validateEvidence(doc, expectedHash) {
  if (!doc || doc.schema !== 'devupward-evidence-v1' || doc.method !== 'tracking-motion-viterbi-v2' || doc.frames !== 199319) throw Error('Unsupported evidence file.');
  if (!expectedHash || doc.csv_sha256 !== expectedHash) throw Error('Evidence does not match this exact CSV.');
  if (JSON.stringify(doc.columns) !== JSON.stringify(EVIDENCE_COLUMNS) || !Array.isArray(doc.rows) || doc.rows.length !== 199319) throw Error('Incomplete evidence timeline.');
  for (const row of doc.rows) {
    if (!Array.isArray(row) || row.length !== EVIDENCE_COLUMNS.length) throw Error('Invalid evidence row.');
    row.forEach((v, i) => {
      if (v === null && [1, 2, 3, 4].includes(i)) return;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw Error('Invalid evidence value.');
      if ([0, 6, 8].includes(i) && v !== 0 && v !== 1) throw Error('Invalid evidence flag.');
      if ([5, 7].includes(i) && v > 1) throw Error('Invalid evidence index.');
      if (i === 9 && ![0, 1, 2].includes(v)) throw Error('Invalid local-state code.');
    });
  }
  if (!Array.isArray(doc.review_windows) || doc.review_windows.length > 6) throw Error('Invalid evidence review list.');
  for (const w of doc.review_windows) {
    if (!Number.isInteger(w.start) || !Number.isInteger(w.end) || w.end < w.start || !BLOCKS.some(([a, b]) => w.start >= a && w.end <= b)) throw Error('Invalid evidence review window.');
  }
  return doc;
}

async function hashBytes(bytes) {
  if (!globalThis.crypto?.subtle) throw Error('This browser cannot verify evidence hashes. Import the CSV alone or use localhost.');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

function explainFrame(frame) {
  $('evidenceDetails').hidden = !evidenceData;
  $('evidenceBadge').textContent = evidenceData ? 'CSV HASH VERIFIED' : 'NO EVIDENCE LOADED';
  if (!evidenceData) {
    $('evidenceStatus').textContent = 'To inspect actual V2 features, select the CSV and its .evidence.json together in the same import area. A CSV alone does not contain these signals.';
    return;
  }
  $('evidenceStatus').textContent = `Actual V2 inputs at frame ${frame.toLocaleString('en-US')}. Missing observations remain unavailable; no values are inferred from the displayed label.`;
  const r = evidenceData.rows[frame], [visible, home, away, motion, ballSpeed, slow, phase, dead, outside, local] = r;
  const number = (v, unit) => v === null ? 'Unavailable' : `${v.toFixed(2)} ${unit}`;
  $('whyBall').textContent = visible ? (outside ? 'Observed outside pitch' : 'Observed') : 'Not observed';
  $('whyBallSpeed').textContent = ballSpeed === null ? 'Ball speed unavailable' : `${ballSpeed.toFixed(2)} m/s ball speed`;
  $('whyDistances').textContent = `${home === null ? '—' : home.toFixed(2)} / ${away === null ? '—' : away.toFixed(2)} m`;
  $('whyMotion').textContent = number(motion, 'm/s');
  $('whyDead').textContent = dead.toFixed(3);
  $('whySignals').textContent = `Slow-motion index ${slow.toFixed(3)} · Automatic phase support ${phase ? 'present' : 'absent'}${outside ? ' · Outside-pitch evidence active' : ''}`;
  const localLabel = ['H', 'A', 'D'][local], finalLabel = labels[frame];
  const noTeamObservation = home === null && away === null && !phase && local === 0;
  $('whyDecision').textContent = noTeamObservation
    ? `No team-specific observation is available here. The per-frame tie-break selects H; the temporal result is ${NAMES[finalLabel]}. Viterbi considers neighbouring frames and transition penalties.`
    : localLabel === finalLabel
      ? `Per-frame selection: ${NAMES[localLabel]}. The final sequence agrees here. The per-frame rule has fixed tie-breaks; Viterbi also considers neighbouring frames and transition penalties.`
      : `Per-frame selection: ${NAMES[localLabel]}; temporal result: ${NAMES[finalLabel]}. The per-frame rule has fixed tie-breaks, and temporal decoding can override a single-frame selection to preserve sequence consistency.`;
  if (!reviewRendered) {
    reviewRendered = true;
    const list = $('reviewWindows'); list.replaceChildren();
    for (const w of evidenceData.review_windows) {
      const button = document.createElement('button');
      button.textContent = `${timecode(w.start).slice(0, 8)} · ${duration(w.end - w.start + 1)}`;
      button.title = 'Local evidence and decoded sequence disagree in this interval; this is not proof of an error.';
      button.addEventListener('click', () => {
        const targetHalf = BLOCKS.findIndex(([a, b]) => w.start >= a && w.start <= b);
        if (half !== targetHalf) setHalf(targetHalf);
        seek(w.start);
      });
      list.append(button);
    }
    if (!evidenceData.review_windows.length) list.textContent = 'No disagreement interval of at least one second was exported.';
  }
}

async function importFiles(files) {
  const selected = Array.from(files || []);
  if (!selected.length) return;
  const sequence = ++importSequence;
  $('importZone').setAttribute('aria-busy', 'true');
  $('validationReport').hidden = true;
  try {
    const csv = selected.filter(f => f.name.toLowerCase().endsWith('.csv'));
    const json = selected.filter(f => f.name.toLowerCase().endsWith('.json'));
    if (csv.length !== 1 || json.length > 1 || selected.length !== csv.length + json.length) throw Error('Select one CSV and, optionally, one evidence JSON.');
    if (csv[0].size > 10 * 1024 * 1024) throw Error('CSV must be smaller than 10 MB.');
    if (json[0]?.size > 30 * 1024 * 1024) throw Error('Evidence JSON must be smaller than 30 MB.');
    setStatus('Checking CSV structure and optional evidence binding…');
    const bytes = await csv[0].arrayBuffer();
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    validatePrediction(text);
    let evidence = null;
    if (json.length) evidence = validateEvidence(JSON.parse(await json[0].text()), await hashBytes(bytes));
    if (sequence !== importSequence) return;
    loadData(text, csv[0].name, evidence);
  } catch (error) {
    if (sequence === importSequence) setStatus(`Import rejected: ${error.message}${labels ? ' Previous data retained.' : ' No analysis has been loaded.'}`, true);
  } finally {
    if (sequence === importSequence) $('importZone').setAttribute('aria-busy', 'false');
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
  document.querySelector('a[href="#timeline"]').addEventListener('click', event => {
    if (!labels) { event.preventDefault(); $('status').textContent = 'Validate a prediction CSV first to open the explorer.'; }
  });
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
    await importFiles(event.target.files);
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
    importFiles(event.dataTransfer.files);
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
    for (const id of ['timeline', 'method']) if ($(id).getClientRects().length && $(id).getBoundingClientRect().top <= 160) current = `#${id}`;
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
    (async () => {
      try {
        const response = await fetch('../submission/final/DEVUPWARD.csv');
        if (!response.ok) return;
        const bytes = await response.arrayBuffer(), text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
        let evidence = null;
        try {
          const sidecar = await fetch('../submission/final/DEVUPWARD.evidence.json');
          if (sidecar.ok) evidence = validateEvidence(await sidecar.json(), await hashBytes(bytes));
        } catch { /* Missing or mismatched evidence must never be displayed. */ }
        if (importSequence === 0) loadData(text, 'DEVUPWARD.csv', evidence);
      } catch { if (importSequence === 0) setStatus('Select DEVUPWARD.csv to begin.'); }
    })();
  } else setStatus('Select DEVUPWARD.csv to begin.');
}
if (typeof module !== 'undefined') module.exports = {buildMatchStory, validateEvidence, EVIDENCE_COLUMNS, validatePrediction, parseCSV, analyse, duration, timecode, advanceFrame, lensBounds, orbitFraction};
