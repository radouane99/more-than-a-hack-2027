# DEVUPWARD submission

Initial offline possession pipeline using the organisers' tactical tracking and automatic tactical phases. See TECHNICAL_REPORT_DEVUPWARD.md for the method and limitations.

## Install and run (Windows PowerShell)

```powershell
py -3.12 -m venv .venv312
.\.venv312\Scripts\python.exe -m pip install -r requirements-devupward.txt
.\.venv312\Scripts\python.exe possession.py
.\.venv312\Scripts\python.exe evaluation/validate_submission.py submission/DEVUPWARD.csv
```

Required files in data/tactical (download separately after registration):
- BAR-ATH_tactical_atd.txt
- BAR-ATH_tactical_atd.xml
- BAR-ATH_tactical_smart_tagging.xml

Alternatively set `$env:MTAH_DATA_DIR` to the parent directory of tactical. Videos are unnecessary.

## Deliverables

- submission/DEVUPWARD.csv
- TECHNICAL_REPORT_DEVUPWARD.md
- Public repository containing this source and the supplied evaluation/starter helpers

The manifest records the exact submission hash. Licensed data and generated submissions are ignored by Git. No private reference labels are used. Public diagnostics cannot establish the full-match rank. Registration, team eligibility and the submission form must be handled with the organisers; generating these files does not register or submit an entry.

## Interactive dashboard

Open `dashboard/index.html` in a browser and import `submission/DEVUPWARD_v2.csv`. All CSV parsing happens locally in your browser. Alternatively serve the project root with `python -m http.server 8765 --bind 127.0.0.1` and visit http://127.0.0.1:8765/dashboard/ to load the local submission automatically. Keep this server bound to loopback because the project contains licensed match files.

The dashboard offers half selection, clickable possession timelines, frame inspection, live-play possession shares, spell duration statistics, and explicit model limitations. It displays model predictions, not official match statistics. The validation snapshot is the fixed V2 diagnostic, not a score computed for newly imported CSV files. No tracking coordinates or video are embedded in the dashboard source.

## Motion-aware V2 candidate

V1 is retained unchanged. Generate the V2 candidate with:

```powershell
.\.venv312\Scripts\python.exe -m unittest test_possession_v2 -v
.\.venv312\Scripts\python.exe possession_v2.py --out submission/DEVUPWARD_v2.csv
.\.venv312\Scripts\python.exe evaluation/validate_submission.py submission/DEVUPWARD_v2.csv
```

V2 combines ball proximity, tactical phases and unlabeled collective-motion clustering to distinguish occlusion from stoppages. See the V2 section of the technical report for every threshold, the fixed diagnostic and limitations. The dashboard now loads `submission/DEVUPWARD_v2.csv` by default when served locally; when opened as a file, import that CSV explicitly. Its diagnostic card is fixed to V2, including when importing another file. V1 remains reproducible with `possession.py`.

For a team-named V2 submission, generate `python possession_v2.py --out submission/final/DEVUPWARD.csv`. Its manifest identifies the V2 method; only that CSV belongs in the final V2 upload. The exploratory `_v2.csv` filename is for local version separation.

## Submission PDF

The short V2 technical report is generated with `python scripts/build_technical_pdf.py` (requires `reportlab` for report authoring only). It writes `output/pdf/DEVUPWARD.pdf` and copies it to `submission/final/DEVUPWARD.pdf`. The upload pair is `submission/final/DEVUPWARD.csv` plus `submission/final/DEVUPWARD.pdf`. Generated report files remain local and ignored by Git.
