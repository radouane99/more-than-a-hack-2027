"""Build the short V2 submission report. Requires reportlab (authoring only)."""
from pathlib import Path
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Preformatted
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
import hashlib
import json
import shutil

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/pdf/DEVUPWARD.pdf'
OUT.parent.mkdir(parents=True,exist_ok=True)
green=colors.HexColor('#173b2e'); grey=colors.HexColor('#65756b')
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='TitleD',fontName='Helvetica-Bold',fontSize=28,leading=32,textColor=green,spaceAfter=12))
styles.add(ParagraphStyle(name='SubD',fontSize=11,leading=16,textColor=grey,spaceAfter=18))
styles.add(ParagraphStyle(name='HeadD',fontName='Helvetica-Bold',fontSize=13,leading=17,textColor=green,spaceBefore=16,spaceAfter=8))
styles.add(ParagraphStyle(name='BodyD',fontSize=10,leading=14,spaceAfter=8))
styles.add(ParagraphStyle(name='SmallD',fontSize=8,leading=11,textColor=grey,spaceAfter=7))
styles.add(ParagraphStyle(name='CodeD',fontName='Courier',fontSize=8,leading=12,backColor=colors.HexColor('#f1f5ef'),borderPadding=10,spaceBefore=7,spaceAfter=12))
story=[]
def p(text,style='BodyD'): story.append(Paragraph(text,styles[style]))
def head(text): p(text,'HeadD')
def table(rows,widths):
    data=[[Paragraph(str(v),styles['SmallD'] if i else styles['BodyD']) for v in row] for i,row in enumerate(rows)]
    t=Table(data,colWidths=widths,hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e8efdf')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),5),('LINEBELOW',(0,0),(-1,-1),.4,colors.HexColor('#dfe6df'))]))
    story.append(t)
def page(c,doc):
    w,h=A4;c.setFillColor(green);c.rect(0,h-12,w,12,fill=1,stroke=0)
    c.setStrokeColor(colors.HexColor('#dfe6df'));c.line(45,43,w-45,43)
    c.setFont('Helvetica',8);c.setFillColor(grey);c.drawString(45,28,'DEVUPWARD  /  More Than A Hack 2027  /  V2 technical report')
    c.drawRightString(w-45,28,f'{doc.page}')

p('DEVUPWARD','TitleD')
p('Ball possession from tactical tracking<br/>More Than A Hack 2027 - Phase 1 | Method and reproducibility | 13 November 2026','SubD')
head('1. Task and delivered system')
p('The system labels every tactical-video frame as home possession (H), away possession (A), dead ball (D), or no answer (X). The submitted V2 file contains 199,319 ordered frames. H is Barcelona; A is Athletic Club. Temporal decoding targets coherent possession spells, consistent with the competition ranking metric.')
p('The method combines geometric team evidence, automatic tactical phases and collective motion, then decodes a stable sequence with Viterbi. No video, hosted API, pretrained model, external match data or human annotations are used. The dashboard is an optional local inspection tool; the algorithm and CSV are the competition output.')
head('2. Assets and alignment')
table([['Asset','Role'],['BAR-ATH_tactical_atd.txt','Player and ball positions for every tactical frame.'],['BAR-ATH_tactical_atd.xml','Track-to-team membership; track slots are not player identities.'],['BAR-ATH_tactical_smart_tagging.xml','Soft team and phase evidence from automatic tagging.'],['Published games.py metadata','105.3 x 68.0 m pitch; frame rate and half boundaries.']],[228,277])
p('Not used: both videos, broadcast tracking and both homographies. Broadcast has a different timeline; homography is unnecessary for distances already expressed in pitch coordinates. Licensed input assets are excluded from the public repository.','SmallD')
head('3. Preprocessing and team ownership')
p('Map one-based ATD frame IDs to zero-based submission frames by subtracting one. Scale normalised positions by the pitch dimensions. Reject incomplete timelines, duplicate frames and unexpected channel counts. Missing player or ball coordinates remain missing.')
p('For each visible ball, find the nearest player in each team. Relative distances provide bounded ownership evidence, weakened when the nearest player is far away. Smart Tagging phase votes provide soft additional evidence. Defensive phases are inverted to the opposing team; unknown team tags are ignored. Overlapping votes are normalised. Set pieces, goals and players-in-box phases are excluded from team ownership evidence because their intervals are not reliable possession boundaries.')
story.append(PageBreak())
p('Stoppage inference','TitleD')
p('Collective motion distinguishes likely stoppages from missing ball observations.','SubD')
head('4. Collective motion without human labels')
p('Estimate player motion from position displacement across one second (25 frames). Discard missing endpoints and apparent speeds above 12 m/s to limit slot-switch artefacts. Require at least eight usable tracks; use their 75th-percentile speed as collective activity. A centred mean with a 25-frame radius is computed separately within each published half.')
p('Fit two deterministic one-dimensional motion clusters using only unlabeled observations inside the halves. Initialise at the 25th and 75th percentiles; stop after 50 iterations or a centre change below 1e-6. Fitted centres are approximately 1.5021 and 3.6414 m/s. The slow-motion feature is the clipped position between those centres. Missing motion receives a neutral value of 0.5. This is unsupervised adaptation, not label-supervised training.')
head('5. Ball motion and stoppage evidence')
p('Ball displacement across 0.4 seconds requires all 11 intervening observations. Discard apparent speeds above 45 m/s. Stationary evidence falls linearly from 1 at rest to 0 at 1 m/s. Moving evidence rises from 0 at 2 m/s to 1 at 5 m/s. These are fixed physical heuristics; they are not calibrated using the public labels.')
story.append(Preformatted('pD = clip(0.10 + 0.50*slow + 0.25*stationary\n          - 0.25*moving + 0.15*missing_ball\n          - 0.10*phase_support, 0.02, 0.95)',styles['CodeD']))
p('Phase support means presence of an automatic phase excluding set pieces, goals and players-in-box. A visible ball outside the normalised pitch raises pD to at least 0.8. A missing ball alone does not declare a stoppage. These scores are heuristic evidence, not calibrated probabilities.')
head('6. Sequence decoding and possession rules')
p('Normalise geometric and phase ownership scores to conditional team log-probabilities. Use log(1-pD) + log(pTeam) for H/A and log(pD) for D. The three-state Viterbi decoder applies a cost of 18 to every state change, independently within each half. It uses future observations because this is offline inference.')
p('A transient touch must accumulate enough evidence to transfer possession. Occlusion can preserve the previous team through temporal continuity. A predicted D stretch splits possession spells. Frames outside the published half windows are X; no manually chosen exceptions or frame-specific corrections are added. Half windows are 11,185-90,651 and 110,808-190,197 inclusive.')
story.append(PageBreak())
p('Results and reproducibility','TitleD')
p('Public-window diagnostics, validation checks and execution instructions.','SubD')
head('7. Training, diagnostics and limitations')
p('No human-labelled training dataset is used. The only fitted quantities are the two unlabeled motion centres. The pipeline never loads reference labels. The motion features address the inability of the initial proximity-based model to distinguish occlusion from stoppage. The method was fixed and synthetically tested before its public diagnostic, without a threshold sweep or subsequent parameter changes. The public window is a pipeline check, not an independent validation set.')
table([['Public 5-minute diagnostic','Initial model','Motion-aware model'],['spellF1','0.348718','0.390476'],['macroF1','0.510379','0.808254'],['Dead-ball F1','0.000000','0.790347']],[285,110,110])
p('Only 17 reference possessions are covered. The full-match reference is private, so these results do not establish a full-match improvement or expected rank. V2 may declare slow live play dead, miss stoppages while players keep moving, or inherit erroneous ball-out and tactical tags. Identity switches below the jump threshold remain possible. Validation on other matches is the appropriate next step.')
head('8. Reproduction and checks')
p('Source repository: <link href="https://github.com/radouane99/more-than-a-hack-2027" color="#24745c">github.com/radouane99/more-than-a-hack-2027</link><br/>Implementation: possession_v2.py, importing ownership and decoding from possession.py. Use Python 3.12 and the pinned requirements-devupward.txt. Put the three licensed tactical files under data/tactical/ or set MTAH_DATA_DIR to their parent root.')
story.append(Preformatted('python -m pip install -r requirements-devupward.txt\npython -m unittest test_possession_v2 -v\npython possession_v2.py --out submission/final/DEVUPWARD.csv\npython evaluation/validate_submission.py submission/final/DEVUPWARD.csv',styles['CodeD']))
p('Five synthetic tests cover motion, occlusion, missing values, half-window isolation and decoder behaviour. The official format validator passes. Two full V2 executions produced identical CSV bytes. The output has 50,651 H, 30,439 A, 77,767 D and 40,462 X frames.')
p('CSV SHA-256:','SmallD')
p('1890a44b7fdd7e2dbb0d0d3a9c9a9eff<br/>cc658141dd1303e4592c6fb56dc867ff','SmallD')
head('9. Local inspection dashboard')
p('dashboard/index.html imports a prediction CSV entirely inside the browser. It offers half selection, an interactive timeline, frame inspection and predicted possession statistics. It embeds no licensed tracking data and labels its diagnostic separately from imported predictions. It is for explanation and debugging, not an additional scoring component.')
SimpleDocTemplate(str(OUT),pagesize=A4,rightMargin=45,leftMargin=45,topMargin=40,bottomMargin=60,title='DEVUPWARD - V2 technical report',author='DEVUPWARD').build(story,onFirstPage=page,onLaterPages=page)
final=ROOT/'submission/final/DEVUPWARD.pdf';final.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(OUT,final)
print(str(final))
