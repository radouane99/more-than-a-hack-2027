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
