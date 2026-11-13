# DEVUPWARD

### Ball possession from tactical tracking

Submission for **More Than A Hack 2027 - Phase 1**. The system combines ball-player geometry, automatic tactical phases and collective player motion to infer possession throughout Barcelona vs Athletic Club. An offline Viterbi decoder produces a coherent sequence of **H** (home), **A** (away), **D** (dead ball) and **X** (no answer).

**Entry point:** `possession_v2.py`

**Submission:** `submission/final/DEVUPWARD.csv`

**Technical report:** [method and reproduction](docs/TECHNICAL_REPORT.md)

## Quick start

Python **3.12** is the tested environment. Run all commands from the repository root.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

On macOS/Linux, create the environment with `python3.12 -m venv .venv` and activate it with `source .venv/bin/activate`.

Place the licensed organiser files in this layout:

```text
data/
└── tactical/
    ├── BAR-ATH_tactical_atd.txt
    ├── BAR-ATH_tactical_atd.xml
    └── BAR-ATH_tactical_smart_tagging.xml
```

Only these three assets are required. Videos, broadcast assets and homographies are not used. If the data is stored elsewhere, set `MTAH_DATA_DIR` to the directory containing `tactical/`:

```powershell
$env:MTAH_DATA_DIR = "D:\mtah2027"
```

Generate and validate the team-named CSV:

```powershell
python possession_v2.py
python evaluation/validate_submission.py submission/final/DEVUPWARD.csv
```

The default command writes **199,319 ordered rows** with header `frame,label`, plus a manifest identifying the method, label counts, fitted motion centres and CSV SHA-256. No network access or random seed is required for inference.

## Method

1. **Ownership:** compare each team's nearest player to the ball, then add soft automatic phase evidence. Defensive phases name the defending side, so their possession evidence is inverted.
2. **Stoppages:** combine collective player movement, ball movement, missing observations and pitch-boundary evidence. Two motion levels are fitted to unlabeled tracking observations; no reference labels are used to fit them.
3. **Temporal decoding:** use a three-state Viterbi decoder within each published half. A transition penalty limits transient switches; frames outside the half windows receive X.

The algorithm does not identify individual players or interpret set-piece interval edges as exact restart times. The [technical report](docs/TECHNICAL_REPORT.md) documents thresholds, limitations and reproduction details.

## Public diagnostic

| Metric | Initial model | Motion-aware V2 |
|---|---:|---:|
| spellF1 | 0.348718 | 0.390476 |
| macroF1 | 0.510379 | 0.808254 |
| Dead-ball F1 | 0.000000 | 0.790347 |

These are diagnostics on the organiser's **five-minute public window: 17 possessions**, not independent validation or a full-match ranking claim. The private full-match reference is unavailable. No public-label threshold sweep was performed. Slow live play, moving players during stoppages and tracking errors remain failure modes.

To run the organiser's diagnostic on the final CSV:

```powershell
python evaluation/run_evaluation.py --results submission/final --out submission/diagnostics --no-detail
```

Use the public window to inspect pipeline correctness; do not use it for supervised training or parameter tuning.

## Tests and reproducibility

```powershell
python -m unittest discover -s tests -v
node dashboard/test.cjs
```

Python tests cover physical motion invariants, missing observations, published half windows and decoding. The optional dashboard tests require Node.js and cover CSV validation and timeline statistics. Node.js is not required for prediction.

The submitted V2 CSV was reproduced byte-for-byte in two full executions:

```text
SHA-256  1890a44b7fdd7e2dbb0d0d3a9c9a9effcc658141dd1303e4592c6fb56dc867ff
```

The earlier implementation in `possession.py` is retained because V2 imports its team-evidence and decoding functions. It also reproduces the initial model when executed directly; it is not the submission entry point.

## Local dashboard

Open [dashboard/index.html](dashboard/index.html) in a browser and import `submission/final/DEVUPWARD.csv`. Parsing and analysis happen locally; no licensed data is embedded in the dashboard source.

The interface includes half selection, an interactive possession timeline, frame inspection and predicted possession statistics. Its diagnostic card shows the fixed V2 result, regardless of which CSV is imported. Predictions are not official match statistics.

For automatic loading of the local final CSV:

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/dashboard/`. Keep the server bound to loopback: the checkout contains licensed input files.

## Technical PDF and submission

Report generation is separate from inference:

```powershell
python -m pip install -r scripts/requirements-report.txt
python scripts/build_technical_pdf.py
```

The generator writes `output/pdf/DEVUPWARD.pdf` and copies it beside the final CSV. The submission form requires:

| Field | Deliverable |
|---|---|
| Team name | DEVUPWARD |
| Possession file | `submission/final/DEVUPWARD.csv` |
| Technical document | `submission/final/DEVUPWARD.pdf` |
| Public source repository | https://github.com/radouane99/more-than-a-hack-2027 |

Input assets and generated submission files stay local and are excluded from Git. Upload the CSV and PDF directly through the organiser's form. Generating files or pushing source does not submit the entry.

## Repository layout

```text
possession_v2.py           Final motion-aware inference entry point
possession.py              Shared ownership/decoding functions and initial model
games.py                  Organiser match metadata and asset paths
requirements.txt           Pinned inference and evaluation dependencies
dashboard/                 Local interactive prediction explorer
docs/
  TECHNICAL_REPORT.md       Final method, evidence and reproduction
  challenge/               Organiser challenge and rule documentation
evaluation/                Organiser scorer, validator and public references
starter/                   Organiser loaders, baselines and example notebooks
tests/                     Synthetic inference tests; no reference-label fitting
scripts/                   PDF report generator and authoring dependencies
data/                      Licensed assets; ignored except setup README
submission/final/          Generated CSV, manifest and PDF; ignored
```

## Attribution and data terms

Built on the organiser's [More Than A Hack 2027 starter repository](https://github.com/metrica-sports/more-than-a-hack-2027). Organiser evaluation code, loaders, reference baselines, citation metadata and [MIT licence](LICENSE) are retained. Optional organiser notebooks use `requirements-starter.txt`; they are not needed for this entry.

Match assets are separately licensed and must not be redistributed. See the retained [competition rules](docs/challenge/RULES.md), [data guide](docs/challenge/DATA.md) and [submission contract](docs/challenge/SUBMISSION.md).
