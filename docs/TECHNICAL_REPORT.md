# DEVUPWARD - technical report

## System and inputs

The submitted method is **tracking-motion-viterbi-v2**, implemented by `possession_v2.py`. It labels 199,319 tactical-video frames as H (Barcelona), A (Athletic Club), D (dead ball) or X (no answer). It operates offline, using future observations when decoding a possession sequence.

Required organiser assets: `BAR-ATH_tactical_atd.txt`, `BAR-ATH_tactical_atd.xml` and `BAR-ATH_tactical_smart_tagging.xml`, under `data/tactical/`. Videos, broadcast tracking and homographies are not used. Coordinates are converted to metres using the published 105.3 x 68.0 m pitch. ATD IDs map to video frames by subtracting one. Track slots identify team-associated tracklets, not individual players.

The pipeline checks frame completeness, duplicate IDs and player channel counts. Missing observations remain missing. Public half windows are 11,185-90,651 and 110,808-190,197 inclusive; frames outside these windows receive X.

## Ownership evidence

For a visible ball, compute its nearest player distance within each team. Let dH and dA be these distances. Geometric evidence is `clip((dA-dH)/2, -2, 2) * exp(-min(dH,dA)/5)` for H and its negative for A. This weakens proximity evidence when no player is near the ball.

Automatic Smart Tagging phases add soft team evidence. Defensive phase labels are inverted to the opponent. Overlapping phase votes are normalised; unknown team names are ignored. Set pieces, goals and players-in-box phases are excluded from ownership evidence because their intervals do not reliably define possession boundaries. The remaining team scores are normalised to conditional team log-probabilities.

## Motion-aware stoppage evidence

Estimate each slot's displacement across one second, in metres per second. Discard missing endpoints and displacements implying speeds above 12 m/s. Require eight usable tracks and use their 75th-percentile speed as collective activity. A centred mean with a 25-frame radius is computed separately within each published half.

Two deterministic one-dimensional motion clusters are fitted to unlabeled observations within the halves. Initialise the centres at the 25th and 75th percentiles; stop after 50 iterations or centre movement below 1e-6. The centres are approximately 1.5021 and 3.6414 m/s. Slow-motion evidence is the clipped relative position between these centres; missing motion has neutral value 0.5. These are unsupervised fitted quantities, not label-trained parameters.

Ball motion is displacement over 0.4 seconds, requiring all 11 intervening observations. Apparent speeds over 45 m/s are discarded. Stationary evidence decreases linearly to zero at 1 m/s; moving evidence rises linearly from 2 to 5 m/s. Automatic phase support excludes set pieces, goals and players-in-box intervals.

```text
pD = clip(0.10 + 0.50*slow + 0.25*stationary - 0.25*moving
          + 0.15*missing_ball - 0.10*phase_support, 0.02, 0.95)
```

A visible ball outside the pitch raises pD to at least 0.8. Team state scores are `log(1-pD) + log(pTeam)`; the dead-ball score is `log(pD)`. These are heuristic scores, not calibrated probabilities. All thresholds are fixed engineering choices, not selected by a public-label sweep.

## Sequence and possession rules

A Viterbi decoder applies a cost of 18 for any change among H, A and D, independently per half. Transient touches must accumulate enough opposing evidence before possession transfers. During ball occlusions, team evidence and temporal continuity can preserve possession. D segments split possession spells. Set-piece interval edges are not treated as precise restart timestamps. There are no manually selected frame exceptions or hand-corrected predictions.

## Training and diagnostic evidence

No labelled training dataset, pretrained model, external match data or API is used. Only the motion centres are fitted, without labels. Inference never reads the public or private ground truth. Development addressed the initial model's general missing-motion limitation; V2 was fixed and synthetically tested before its public diagnostic. No threshold sweep or subsequent parameter changes were made against that diagnostic.

| Public five-minute diagnostic | Initial model | Motion-aware V2 |
|---|---:|---:|
| spellF1 | 0.348718 | 0.390476 |
| macroF1 | 0.510379 | 0.808254 |
| Dead-ball F1 | 0.000000 | 0.790347 |

This window contains 17 reference possessions. It is a pipeline diagnostic, not an independent validation set or a full-match improvement claim. The full-match reference is private.

V2 may overpredict stoppages during slow live play and miss stoppages where players keep moving. Relative motion clusters vary with match activity. Track switches below the jump filter and erroneous ball-out observations can remain. Automatic tagging can be wrong. Independent evaluation on other matches is needed before claiming generalisation.

## Reproduction

Use Python 3.12 and `requirements.txt`. Put the three licensed files under `data/tactical/`, or set `MTAH_DATA_DIR` to the parent of `tactical/`.

```powershell
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python possession_v2.py
python evaluation/validate_submission.py submission/final/DEVUPWARD.csv
```

V2 imports ownership evidence and decoding from `possession.py`; the latter remains as the initial model's runnable implementation. Five synthetic tests cover motion evidence, occlusion, missing values, half windows and decoding. The official format validator passes. Two full executions reproduced the same bytes; no network or random seed is required.

Output counts: 50,651 H, 30,439 A, 77,767 D and 40,462 X. CSV SHA-256:

```text
1890a44b7fdd7e2dbb0d0d3a9c9a9effcc658141dd1303e4592c6fb56dc867ff
```

## Inspection and deliverables

`dashboard/index.html` imports the final CSV locally and displays half-specific timelines, frame states and predicted statistics. It embeds no licensed input data. Its fixed V2 diagnostic card is separate from the imported prediction data.

Generate the PDF with `python scripts/build_technical_pdf.py` after installing `scripts/requirements-report.txt`. Upload `submission/final/DEVUPWARD.csv` and `submission/final/DEVUPWARD.pdf` through the organiser form, alongside the public source repository URL. Input data and generated outputs are ignored by Git. The original organiser documentation is retained in [challenge/](challenge/README.md).
