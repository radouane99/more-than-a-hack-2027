# DEVUPWARD — technical report

## Approach
We infer team possession and stoppages from the supplied automatic tactical tracking and Smart Tagging. No video, external data, trained model, API, or manually produced labels are used. The implementation is `possession.py`.

Each tracking record is mapped from its one-based frame ID to the zero-based tactical video timeline. Metadata determines track membership in the two teams. Track slots are not treated as player identities. Normalised coordinates are scaled by the published 105.3 by 68 metre pitch dimensions.

For visible balls, the minimum ball-to-player distance for each team supplies bounded relative-control evidence. Evidence is weakened when the nearest player is far from the ball. Missing balls supply neutral team evidence and a weak stoppage prior, rather than an automatic dead-ball label. Visible balls outside the normalised pitch supply additional stoppage evidence.

Automatic tactical phases supply soft team evidence. Defensive phase ownership is inverted to the opponent. Overlapping phase votes are normalised to prevent their count from dominating. Set pieces, goals and players-in-box phases are excluded from this ownership prior because their intervals do not reliably represent live possession boundaries. N/A team tags are ignored.

An offline three-state Viterbi decoder finds a maximum-score sequence with a fixed transition penalty of 18 score units. The states are H, A and D. Decoding runs independently within the published half boundaries; all other frames receive X. This is an offline submission, so future observations are allowed. The constants are engineering heuristics, not estimates fitted to the public labels.

## Possession rules
Transient touches should not immediately transfer possession: accumulated opposing evidence must overcome the transition penalty. During missing observations, temporal continuity and automatic phase evidence help preserve possession. Stoppages are inferred from missing-ball evidence and pitch-boundary evidence. No frame-specific manual corrections or manually selected match exceptions are used. The published half boundaries are the only match-specific time constants.

## Assets and training
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

## Fixed-method public diagnostic
The first end-to-end run scored spellF1 0.348718 and macroF1 0.510379 on the supplied five minutes. Dead-ball F1 was 0.0, exposing a serious limitation in stoppage localisation. These results are a pipeline diagnostic, not evidence of full-match superiority. No parameters were changed after this diagnostic. The CSV passes the official format validator.
