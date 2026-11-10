"""Deterministic tracking/tagging possession inference; never reads ground truth."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from games import GAMES, GAME, require, half_video_blocks
from starter.baseline import team_of_each_track, write_submission
from starter.load_smart_tagging import load


def observations():
    meta, raw = require(['atd_meta', 'atd_raw'])
    teams = team_of_each_track(meta)
    n = GAMES[GAME]['n_video_frames']
    distance = np.full((n, 2), np.inf)
    ball = np.full((n, 2), np.nan)
    seen = np.zeros(n, dtype=bool)
    with open(raw) as f:
        for line in f:
            p = line.strip().split(':')
            if len(p) != 3:
                raise ValueError('Malformed ATD record')
            i = int(p[0])-1
            if not 0 <= i < n or seen[i]:
                raise ValueError('Duplicate or invalid ATD frame')
            seen[i] = True
            b = np.array([float(v) for v in p[2].split(',')[:2]])
            ball[i] = b
            if not np.isfinite(b).all():
                continue
            xy = np.array([[float(v) for v in s.split(',')[:2]] for s in p[1].split(';')])
            if len(xy) != len(teams):
                raise ValueError('Track slot count differs from metadata')
            d = np.linalg.norm((xy-b)*GAMES[GAME]['pitch'], axis=1)
            for t in (0, 1):
                valid = d[(teams == t) & np.isfinite(d)]
                if len(valid):
                    distance[i, t] = valid.min()
    if not seen.all():
        raise ValueError('Incomplete ATD timeline')
    return distance, ball


def emissions(distance, ball):
    n = len(ball)
    # Neutral team evidence during occlusion; missing ball alone is weak dead-ball evidence.
    scores = np.tile([0., 0., .12], (n, 1))
    visible = np.isfinite(ball).all(axis=1)
    usable = visible & np.isfinite(distance).all(axis=1)
    delta = np.clip((distance[usable, 1]-distance[usable, 0])/2., -2., 2.)
    control = np.exp(-np.min(distance[usable], axis=1)/5.)
    scores[usable, 0] += delta*control
    scores[usable, 1] -= delta*control
    scores[visible, 2] = -.8
    outside = visible & ((ball < 0).any(axis=1) | (ball > 1).any(axis=1))
    scores[outside, 2] += 2.
    # Defensive phases name the defending side, so invert their ownership evidence.
    phase = np.zeros((n, 2))
    for e in load():
        code = (e['code'] or '').upper()
        team = e['tags'].get('Team', '').lower()
        t = 0 if team == 'barcelona' else 1 if team in ('atletic club', 'athletic club') else None
        if t is None or code in ('SET PIECES', 'PLAYERS IN THE BOX', 'GOALS'):
            continue
        if code.startswith('DEFEND') or code == 'DEFENSIVE TRANSITION':
            t = 1-t
        a, b = max(0, e['start_frame']), min(n, e['end_frame'])
        phase[a:b, t] += 1
    total = phase.sum(axis=1)
    active = total > 0
    for t in (0, 1):
        scores[active, t] += .7*phase[active, t]/total[active]
    scores[active, 2] -= .4
    return scores


def decode(scores):
    # Offline Viterbi: all match observations are available; discourage transient switches.
    labels = np.full(len(scores), 'X', dtype='<U1')
    penalty = np.full((3, 3), 18.)
    np.fill_diagonal(penalty, 0.)
    for _, start, end in half_video_blocks(GAME):
        block = scores[start:end+1]
        back = np.zeros((len(block), 3), dtype=np.int8)
        value = block[0].copy()
        for i in range(1, len(block)):
            choices = value[:, None]-penalty
            back[i] = choices.argmax(axis=0)
            value = choices.max(axis=0)+block[i]
        state = int(value.argmax())
        states = np.empty(len(block), dtype=np.int8)
        for i in range(len(block)-1, -1, -1):
            states[i] = state
            state = int(back[i, state])
        labels[start:end+1] = np.array(['H', 'A', 'D'])[states]
    return labels


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='submission/DEVUPWARD.csv')
    args = parser.parse_args()
    distance, ball = observations()
    labels = decode(emissions(distance, ball))
    write_submission(args.out, labels)
    path = Path(args.out)
    report = {'file': path.name, 'rows': len(labels), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
              'labels': {x: int((labels == x).sum()) for x in ('H','A','D','X')},
              'method': 'tracking-tagging-viterbi-v1', 'ground_truth_used_for_inference': False}
    path.with_suffix('.manifest.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report, indent=2))

if __name__ == '__main__':
    main()
