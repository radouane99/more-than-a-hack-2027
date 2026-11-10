# DEVUPWARD — technical report

## V1 approach
We infer team possession and stoppages from the supplied automatic tactical tracking and Smart Tagging. No video, external data, trained model, API, or manually produced labels are used. The implementation is `possession.py`.

Each tracking record is mapped from its one-based frame ID to the zero-based tactical video timeline. Metadata determines track membership in the two teams. Track slots are not treated as player identities. Normalised coordinates are scaled by the published 105.3 by 68 metre pitch dimensions.

For visible balls, the minimum ball-to-player distance for each team supplies bounded relative-control evidence. Evidence is weakened when the nearest player is far from the ball. Missing balls supply neutral team evidence and a weak stoppage prior, rather than an automatic dead-ball label. Visible balls outside the normalised pitch supply additional stoppage evidence.

Automatic tactical phases supply soft team evidence. Defensive phase ownership is inverted to the opponent. Overlapping phase votes are normalised to prevent their count from dominating. Set pieces, goals and players-in-box phases are excluded from this ownership prior because their intervals do not reliably represent live possession boundaries. N/A team tags are ignored.

An offline three-state Viterbi decoder finds a maximum-score sequence with a fixed transition penalty of 18 score units. The states are H, A and D. Decoding runs independently within the published half boundaries; all other frames receive X. This is an offline submission, so future observations are allowed. The constants are engineering heuristics, not estimates fitted to the public labels.

## Possession rules
Transient touches should not immediately transfer possession: accumulated opposing evidence must overcome the transition penalty. During missing observations, temporal continuity and automatic phase evidence help preserve possession. Stoppages are inferred from missing-ball evidence and pitch-boundary evidence. No frame-specific manual corrections or manually selected match exceptions are used. The published half boundaries are the only match-specific time constants.

## V1 assets and training
Used: tactical ATD text, tactical ATD metadata XML, tactical Smart Tagging XML, and published pitch/half metadata. Broadcast tracking, homographies and videos are not used. There is no training dataset and no learned parameters. The pipeline never loads the public or private ground truth. The public five minutes are used only as an end-to-end diagnostic, after fixing the method, not for hyperparameter selection.

## Limitations
This is an initial heuristic entry, not a demonstrated improvement over the official baseline. Occlusion and stoppages can look alike; distant nearest players and aerial balls are ambiguous. Smart Tagging can be wrong, and phase boundaries are not possession boundaries. Constant transition penalties may suppress genuine short possessions or shift boundaries. No referee or restart recognition is performed. Full-match performance is unknown because the reference labels are private. Future work should validate general-purpose refinements on other matches, rather than tune on this match's public labels.

## Reproduction
Use Python 3.12 and `requirements-devupward.txt`. Arrange the organiser's files under `data/tactical/` using their original names, or set MTAH_DATA_DIR to a root containing that folder. Run:

```powershell
python possession.py --out submission/DEVUPWARD.csv
python evaluation/validate_submission.py submission/DEVUPWARD.csv
python evaluation/run_evaluation.py --results submission --out submission/diagnostics --no-detail
```

The output has exactly 199,319 rows with header `frame,label`. A manifest records the CSV SHA-256 and label counts. The method is deterministic; no random seed or network access is needed. Do not publish the licensed match assets. Submit the CSV and this Markdown report through the organisers' form and provide a public source repository URL.

## Fixed-method V1 public diagnostic
The first end-to-end run scored spellF1 0.348718 and macroF1 0.510379 on the supplied five minutes. Dead-ball F1 was 0.0, exposing a serious limitation in stoppage localisation. These results are a pipeline diagnostic, not evidence of full-match superiority. No parameters were changed after this diagnostic. The CSV passes the official format validator.

## V2 — motion-aware stoppage inference

### Motivation and versioning
V1 is preserved in `possession.py` and its output remains `submission/DEVUPWARD.csv`. V2 is an experimental candidate in `possession_v2.py`, outputting `submission/DEVUPWARD_v2.csv`. Do not silently substitute one version's CSV or hash for the other. No model is selected by sweeping the public labels.

### Additional observations
V2 reads player positions on every frame, including when the ball is missing. It estimates each track slot's displacement over one second in pitch metres. Missing endpoints are discarded; apparent speeds above 12 m/s are rejected as probable identity switches or tracking failures. At least eight usable tracks are required. The 75th percentile across tracks measures collective activity. A centred one-second-radius mean reduces jitter without crossing half boundaries. Slots remain tracklets, not asserted player identities.

Two one-dimensional motion centres are fitted by deterministic two-means clustering on unlabeled observations within the published half windows. Initial centres are the 25th and 75th percentiles; fitting stops at 50 iterations or movement below 1e-6. These are unsupervised fitted quantities, not label-trained parameters. They distinguish relatively slow and active play, without asserting that either cluster is a ground-truth state. Low motion alone cannot reliably distinguish a stoppage from slow live play.

Ball movement uses displacement across 0.4 seconds, requiring all 11 intervening observations. Apparent ball speeds above 45 m/s are discarded. Stationary evidence decreases linearly to zero at 1 m/s; moving evidence increases from 2 to 5 m/s. These physically motivated constants are fixed engineering choices, not tuned on the public reference.

### Hierarchical state scores
The V1 team evidence is normalised to conditional log-probabilities of H and A. A separate stoppage heuristic is computed as:

```
pD = clip(0.10 + 0.50*slow + 0.25*stationary - 0.25*moving
          + 0.15*missing_ball - 0.10*automatic_phase_support, 0.02, 0.95)
```

A visible ball outside the pitch raises pD to at least 0.8. Team scores are `log(1-pD) + log(pTeam)` and the dead-ball score is `log(pD)`. These scores are heuristic evidence, not calibrated probabilities. The unchanged Viterbi decoder uses transition cost 18. Separating stoppage and team evidence prevents a close stationary player from automatically overriding dead-ball evidence. Set-piece interval edges are not used as precise restart times.

### Fixed V2 diagnostic and limitations
After fixing this method and passing synthetic physical-invariant tests, it was run once against the public window, with no subsequent parameter changes. Results:

| Metric | V1 | V2 |
|---|---:|---:|
| spellF1 | 0.348718 | 0.390476 |
| macroF1 | 0.510379 | 0.808254 |
| Dead-ball F1 | 0.000000 | 0.790347 |

These are diagnostics on the same 17 public possessions, not an independent validation set and not a full-match improvement claim. Development responded to V1's general missing-motion limitation; public reference labels were not used to fit parameters or select thresholds. Independent evaluation on other matches is still needed. The full match has a private reference. V2 can overpredict stoppages in slow live phases and can miss stoppages where players continue moving. Relative motion clusters can change with the match. Track switches smaller than the jump filter remain possible. Ball-out observations can themselves be wrong.

### Reproduce V2

```powershell
python -m unittest test_possession_v2 -v
python possession_v2.py --out submission/DEVUPWARD_v2.csv
python evaluation/validate_submission.py submission/DEVUPWARD_v2.csv
```

Full output: 50,651 H, 30,439 A, 77,767 D, 40,462 X. Unsupervised motion centres: approximately 1.5021 and 3.6414 m/s. The manifest records the exact hash and fitted centres. Output must be renamed to DEVUPWARD.csv for the official team-named upload if V2 is selected; run V2 with `--out` rather than losing track of the generating command. The dashboard now defaults to the V2 candidate and clearly labels its fixed diagnostic.
