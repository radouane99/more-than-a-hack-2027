"""V2: unlabeled collective-motion evidence separates occlusions from stoppages.
No ground truth is loaded. V1 remains available in possession.py.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from games import GAME, GAMES, require, half_video_blocks
from starter.baseline import team_of_each_track, write_submission
from possession import emissions, decode


def average(values, radius):
    """Centred mean ignoring NaNs, with correct edge denominators."""
    valid = np.isfinite(values)
    cumulative = np.r_[0., np.cumsum(np.where(valid, values, 0.))]
    counts = np.r_[0, np.cumsum(valid)]
    i = np.arange(len(values))
    a, b = np.maximum(0, i-radius), np.minimum(len(values), i+radius+1)
    denominator = counts[b]-counts[a]
    return np.divide(cumulative[b]-cumulative[a], denominator,
                     out=np.full(len(values), np.nan), where=denominator > 0)


def read_features():
    meta, raw = require(['atd_meta', 'atd_raw'])
    teams = team_of_each_track(meta)
    n = GAMES[GAME]['n_video_frames']
    xy = np.full((n, len(teams), 2), np.nan, dtype=np.float32)
    ball = np.full((n, 2), np.nan)
    seen = np.zeros(n, dtype=bool)
    with open(raw) as handle:
        for line in handle:
            parts = line.strip().split(':')
            if len(parts) != 3:
                raise ValueError('Malformed ATD row')
            i = int(parts[0])-1
            if not 0 <= i < n or seen[i]:
                raise ValueError('Invalid or duplicate frame')
            seen[i] = True
            groups = np.fromstring(parts[1].replace(';', ','), sep=',')
            if len(groups) != len(teams)*3:
                raise ValueError('Unexpected player channel count')
            xy[i] = groups.reshape(-1, 3)[:, :2]
            ball[i] = np.fromstring(parts[2], sep=',')[:2]
    if not seen.all():
        raise ValueError('Incomplete ATD timeline')
    pitch = np.array(GAMES[GAME]['pitch'])
    distances = np.linalg.norm((xy-ball[:, None, :])*pitch, axis=2)
    distances[~np.isfinite(distances)] = np.inf
    nearest = np.column_stack([distances[:, teams == t].min(axis=1) for t in (0, 1)])
    # One-second displacements: no dependency on ambiguous exported speed units.
    # Reject implausible slot jumps and missing endpoints instead of interpolating them.
    speed = np.linalg.norm((xy[25:]-xy[:-25])*pitch, axis=2)
    speed[speed > 12.] = np.nan
    enough = np.isfinite(speed).sum(axis=1) >= 8
    collective = np.full(n, np.nan)
    collective[25:][enough] = np.nanquantile(speed[enough], .75, axis=1)
    return nearest, ball, collective


def motion_evidence(collective):
    """Two unsupervised motion clusters, fitted only on unlabeled half windows."""
    slow = np.full(len(collective), .5)
    blocks = half_video_blocks(GAME)
    motion = np.full(len(collective), np.nan)
    for _, a, b in blocks:
        motion[a:b+1] = average(collective[a:b+1], 25)
    values = np.concatenate([motion[a:b+1] for _, a, b in blocks])
    values = values[np.isfinite(values)]
    if len(values) < 2:
        return slow, {'motion_centres_m_s': None}
    centres = np.quantile(values, [.25, .75])
    for _ in range(50):
        group = abs(values-centres[1]) < abs(values-centres[0])
        updated = np.array([values[~group].mean() if (~group).any() else centres[0],
                            values[group].mean() if group.any() else centres[1]])
        if np.max(abs(updated-centres)) < 1e-6:
            centres = updated
            break
        centres = updated
    low, high = sorted(centres)
    valid = np.isfinite(motion)
    if high-low > .1:
        slow[valid] = np.clip((high-motion[valid])/(high-low), 0., 1.)
    return slow, {'motion_centres_m_s': [float(low), float(high)]}


def dead_probability(slow, stationary, moving, missing, phase_support):
    """Fixed physical heuristics; never selected against public reference labels."""
    return np.clip(.10+.50*slow+.25*stationary-.25*moving+.15*missing-.10*phase_support,
                   .02, .95)


def build_scores(nearest, ball, collective):
    ownership = emissions(nearest, ball)[:, :2]
    normalised = ownership-ownership.max(axis=1, keepdims=True)
    log_team = normalised-np.log(np.exp(normalised).sum(axis=1, keepdims=True))
    slow, diagnostics = motion_evidence(collective)
    visible = np.isfinite(ball).all(axis=1)
    # Ball movement measured across 0.4 seconds, only within continuously observed runs.
    speed = np.full(len(ball), np.nan)
    uninterrupted = np.convolve(visible.astype(int), np.ones(11, dtype=int), mode='valid') == 11
    displacement = np.linalg.norm((ball[10:]-ball[:-10])*GAMES[GAME]['pitch'], axis=1)/.4
    good = uninterrupted & (displacement < 45.)
    speed[10:][good] = displacement[good]
    stationary = np.zeros(len(ball))
    moving = np.zeros(len(ball))
    valid = np.isfinite(speed)
    stationary[valid] = np.clip(1.-speed[valid]/1., 0., 1.)
    moving[valid] = np.clip((speed[valid]-2.)/3., 0., 1.)
    # Phase evidence is weak and probabilistic; its window is not a restart timestamp.
    from starter.load_smart_tagging import load
    phase = np.zeros(len(ball))
    for event in load():
        if event['code'] not in ('SET PIECES', 'PLAYERS IN THE BOX', 'GOALS'):
            a,b=max(0,event['start_frame']),min(len(ball),event['end_frame'])
            phase[a:b] = 1.
    pdead = dead_probability(slow, stationary, moving, ~visible, phase)
    outside = visible & ((ball < 0).any(axis=1) | (ball > 1).any(axis=1))
    pdead[outside] = np.maximum(pdead[outside], .8)
    scores = np.column_stack([log_team+np.log1p(-pdead)[:, None], np.log(pdead)])
    diagnostics['mean_dead_probability_in_halves'] = float(np.mean(np.concatenate([
        pdead[a:b+1] for _,a,b in half_video_blocks(GAME)])))
    return scores, diagnostics


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='submission/DEVUPWARD_v2.csv')
    args = parser.parse_args()
    nearest, ball, collective = read_features()
    scores, diagnostics = build_scores(nearest, ball, collective)
    labels = decode(scores)
    write_submission(args.out, labels)
    path = Path(args.out)
    report = {'file':path.name, 'rows':len(labels), 'method':'tracking-motion-viterbi-v2',
              'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
              'labels':{x:int((labels == x).sum()) for x in ('H','A','D','X')},
              'ground_truth_used_for_inference':False, **diagnostics}
    path.with_suffix('.manifest.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report, indent=2))

if __name__ == '__main__':
    main()
