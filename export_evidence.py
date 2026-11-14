"""Write non-public V2 feature evidence without exporting player/ball coordinates."""
import hashlib
import json
from pathlib import Path
import numpy as np
from games import GAME, half_video_blocks

COLUMNS = ['ball_visible', 'nearest_home_m', 'nearest_away_m', 'collective_motion_m_s',
           'ball_speed_m_s', 'slow_index', 'phase_support', 'stoppage_index',
           'ball_outside', 'local_state']


def write_evidence(csv_path, labels, evidence):
    csv_path = Path(csv_path)
    expected = len(labels)
    for name in COLUMNS:
        if len(evidence[name]) != expected:
            raise ValueError('Evidence frame count mismatch: ' + name)
    rows = []
    local_labels = np.array(['H', 'A', 'D'])[evidence['local_state']]
    disagreements = []
    for _, start, end in half_video_blocks(GAME):
        i = start
        while i <= end:
            if labels[i] == local_labels[i]:
                i += 1
                continue
            first = i
            while i <= end and labels[i] != local_labels[i]:
                i += 1
            if i-first >= 25:
                disagreements.append({'start': first, 'end': i-1,
                                      'reason': 'Local frame evidence differs from temporal decoding'})
    for frame in range(expected):
        row = []
        for name in COLUMNS:
            value = float(evidence[name][frame])
            row.append(round(value, 3) if np.isfinite(value) else None)
        rows.append(row)
    document = {'schema': 'devupward-evidence-v1', 'method': 'tracking-motion-viterbi-v2',
                'csv_sha256': hashlib.sha256(csv_path.read_bytes()).hexdigest(),
                'frames': expected, 'columns': COLUMNS, 'rows': rows,
                'review_windows': sorted(disagreements, key=lambda w:w['end']-w['start'], reverse=True)[:6],
                'notice': 'Heuristic evidence, not calibrated confidence or verified errors. Licensed derived data; keep local.'}
    output = csv_path.with_suffix('.evidence.json')
    output.write_text(json.dumps(document, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    return output
