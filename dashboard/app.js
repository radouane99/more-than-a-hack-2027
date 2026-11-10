'use strict';
const BLOCKS = [[11185,90651],[110808,190197]];
const COLORS = {H:'#24745c',A:'#ed936c',D:'#c9cfca',X:'#eaece9'};
const NAMES = {H:'Barcelona · H',A:'Athletic Club · A',D:'Dead ball · D',X:'No answer · X'};
let labels=null, half=0, spells=[];
const $=id=>document.getElementById(id);
function parseCSV(text){
 const rows=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
 if(rows.shift().trim().toLowerCase()!=='frame,label')throw Error('Expected CSV header: frame,label');
 if(rows.length!==199319)throw Error('Expected exactly 199,319 prediction rows.');
 return rows.map((row,i)=>{const p=row.split(',');const label=(p[1]||'').trim().toUpperCase();if(p.length!==2||p[0].trim()!==String(i)||!Object.hasOwn(COLORS,label))throw Error(`Invalid frame or label at row ${i+2}.`);return label;});
}
function analyse(data){
 const count={H:0,A:0,D:0,X:0},runs=[];
 for(const [start,end]of BLOCKS){let a=start;for(let i=start;i<=end;i++){count[data[i]]++;if(i===end||data[i+1]!==data[a]){runs.push({start:a,end:i,label:data[a]});a=i+1;}}}
 return {count,runs,spells:runs.filter(r=>r.label==='H'||r.label==='A')};
}
function duration(frames){const s=Math.round(frames/25);return `${Math.floor(s/60)}m ${String(s%60).padStart(2,'0')}s`;}
function timecode(frame){let s=Math.floor(frame/25);return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}.${String((frame%25)*40).padStart(3,'0')}`;}
function loadData(text,name){
 const parsed=parseCSV(text),result=analyse(parsed);labels=parsed;spells=result.runs;
 const {H,A,D,X}=result.count, live=H+A, pct=v=>live?`${(100*v/live).toFixed(1)}%`:'—';
 $('homeShare').textContent=$('balanceHome').textContent=pct(H);$('awayShare').textContent=$('balanceAway').textContent=pct(A);
 $('balanceBar').style.width=live?`${100*H/live}%`:'0%';$('spells').textContent=result.spells.length;
 $('deadTime').textContent=duration(D);$('abstained').textContent=duration(X);
 $('mean').textContent=result.spells.length?`${(live/25/result.spells.length).toFixed(1)}s`:'—';
 $('longest').textContent=result.spells.length?duration(Math.max(...result.spells.map(r=>r.end-r.start+1))):'—';
 $('source').textContent=name;$('status').textContent='✓ Valid prediction file · 199,319 ordered frames · Statistics use the two published half windows.';
 setHalf(half);
}
function setHalf(value){half=value;document.querySelectorAll('[data-half]').forEach(b=>{b.classList.toggle('selected',Number(b.dataset.half)===half+1);b.setAttribute('aria-pressed',String(Number(b.dataset.half)===half+1));});const[a,b]=BLOCKS[half];$('scrub').min=a;$('scrub').max=b;$('scrub').value=a;inspect();}
function inspect(){if(!labels)return;const frame=Number($('scrub').value),run=spells.find(r=>frame>=r.start&&frame<=r.end);$('timecode').textContent=timecode(frame);$('frame').textContent=frame.toLocaleString('en-US');$('state').textContent=NAMES[labels[frame]];$('state').style.color=labels[frame]==='A'?'#bd6a46':labels[frame]==='H'?COLORS.H:'#738076';$('spellDuration').textContent=run?duration(run.end-run.start+1):'—';draw(frame);}
function draw(frame){const canvas=$('timelineCanvas'),ratio=window.devicePixelRatio||1,width=canvas.clientWidth,height=85;canvas.width=width*ratio;canvas.height=height*ratio;const c=canvas.getContext('2d');c.scale(ratio,ratio);const[a,b]=BLOCKS[half],length=b-a+1;for(const r of spells){if(r.end<a||r.start>b)continue;const x=(Math.max(a,r.start)-a)/length*width,end=(Math.min(b,r.end)+1-a)/length*width;c.fillStyle=COLORS[r.label];c.fillRect(x,10,Math.max(.4,end-x),58);}const x=(frame-a)/length*width;c.strokeStyle='#122d25';c.lineWidth=1.5;c.beginPath();c.moveTo(x,2);c.lineTo(x,78);c.stroke();c.fillStyle='#122d25';c.beginPath();c.moveTo(x-4,0);c.lineTo(x+4,0);c.lineTo(x,6);c.fill();}
if(typeof document!=='undefined'){
 $('file').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{loadData(await file.text(),file.name);}catch(error){$('status').textContent=`Import rejected: ${error.message} Previous data retained.`;}event.target.value='';});
 document.querySelectorAll('[data-half]').forEach(b=>b.addEventListener('click',()=>setHalf(Number(b.dataset.half)-1)));
 $('scrub').addEventListener('input',inspect);window.addEventListener('resize',inspect);
 $('timelineCanvas').addEventListener('click',e=>{if(!labels)return;const rect=e.currentTarget.getBoundingClientRect(),[a,b]=BLOCKS[half];$('scrub').value=Math.round(a+Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width))*(b-a));inspect();});
 if(location.protocol==='http:'||location.protocol==='https:')fetch('../submission/DEVUPWARD_v2.csv').then(r=>{if(!r.ok)throw Error('No local prediction file');return r.text();}).then(t=>loadData(t,'DEVUPWARD_v2.csv · local model output')).catch(()=>{$('status').textContent='Import DEVUPWARD_v2.csv to explore your predictions. Processing stays in this browser.';});
 else $('status').textContent='Import DEVUPWARD_v2.csv to explore your predictions. Processing stays in this browser.';
}
if(typeof module!=='undefined')module.exports={parseCSV,analyse,duration,timecode};
