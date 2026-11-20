'use strict';
const $ = (id) => document.getElementById(id);
const state = {key:sessionStorage.getItem('focoCloudKey')||'', data:null, selectedDay:null, toastTimeout:null};
const shortDays = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const longDays = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
const months = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const pad = (n) => String(n).padStart(2,'0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const localDate = (s) => new Date(`${s}T12:00:00`);
const addDays = (d,n) => {const x = new Date(d); x.setDate(x.getDate()+n);return x;};
const pretty = (s) => localDate(s).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'});
const tracked = (r) => r && r.choice === 'yes' && Number.isInteger(r.studyMinutes) && r.studyMinutes > 0 ? r.studyMinutes : 0;
function formatTime(min) {
 const h=Math.floor(min/60),m=min%60;
 if(!min)return '0 min';
 return h ? `${h}h${m?` ${pad(m)}min`:''}` : `${m} min`;
}
const el = (tag,cls,text) => {const x = document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=text;return x;};
function toast(message) { const x=$('toast');x.textContent=message;x.classList.add('show');clearTimeout(state.toastTimeout);state.toastTimeout=setTimeout(()=>x.classList.remove('show'),3400); }
async function request(path,body,overrideKey) {
  const opts = {method:body===undefined?'GET':'POST',headers:{'X-Foco-Key':overrideKey===undefined?state.key:overrideKey}};
  if (body!==undefined) {opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body);}
  const apiBase=String(window.FOCO_API_URL||'').replace(/\/$/,'');
  if(!/^https:\/\/[^/]+$/.test(apiBase))throw new Error('Configure a URL HTTPS do Worker em config.js.');
  const response=await fetch(apiBase+path,opts);
  let data;try{data=await response.json();}catch{data={error:'Resposta inesperada do servidor.'};}
  if(!response.ok) {const err=new Error(data.error||`Erro ${response.status}`);err.status=response.status;throw err;}
  return data;
}
function signOut(message='') {state.key='';state.data=null;sessionStorage.removeItem('focoCloudKey');$('app').hidden=true;$('loginScreen').hidden=false;$('loginError').textContent=message;}
async function load() {
  if(!state.key){signOut();return;}
  try {
    state.data=await request('/api/status');
    $('loginScreen').hidden=true;$('app').hidden=false;
    renderAll();
  } catch (e) {
    if(e.status===401)signOut('Chave inválida. Digite a chave atual.');
    else { $('connection').textContent='Sem conexão com a nuvem';toast('Falha ao carregar: '+e.message); }
  }
}
function summaries(){
 const m=new Map();
 for(const r of (state.data?.records||[])){
   if(!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.date))continue;
   if(!m.has(r.date))m.set(r.date,{yes:0,no:0,records:[]});
   const v=m.get(r.date);if(r.choice==='yes')v.yes++;else if(r.choice==='no')v.no++;v.records.push(r);
 }
 return m;
}
function dayStatus(info){return info?(info.no>0?'no':info.yes>0?'yes':'none'):'none';}
function calculateStreak(m,today){
 let cursor=localDate(today),key=iso(cursor);
 if(!m.has(key))cursor=addDays(cursor,-1);
 let current=0;
 while(dayStatus(m.get(iso(cursor)))==='yes'){current++;cursor=addDays(cursor,-1);}
 let best=0,run=0,prev=null;
 for(const date of [...m.keys()].filter(d=>d<=today).sort()){
   const d=localDate(date);
   if(dayStatus(m.get(date))==='yes'){
     run=prev && iso(addDays(prev,1))===date ? run+1 : 1;
     best=Math.max(best,run);
   }else run=0;
   prev=d;
 }
 return {current,best};
}
function renderStats(m) {
  const r=calculateStreak(m,state.data.today);
  $('currentStreak').textContent=r.current;
  $('bestStreak').textContent=r.best;
  $('allStudied').textContent=[...m.values()].filter(x=>dayStatus(x)==='yes').length;
  $('activeSchedules').textContent=(state.data.schedules||[]).filter(x=>x.active).length;
  $('allHours').textContent=formatTime((state.data.records||[]).reduce((total,x)=>total+tracked(x),0));
  $('heroBadge').textContent=r.current?`${r.current} DIA${r.current===1?'':'S'} SEGUIDO${r.current===1?'':'S'}`:'SEM SEQUÊNCIA';
  $('todayLabel').textContent=localDate(state.data.today).toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'});
}
function renderCalendar(m) {
 const container=$('calendar'),header=$('monthLabels');container.replaceChildren();header.replaceChildren();
 const end=localDate(state.data.today);end.setDate(end.getDate()+(6-end.getDay()));
 const start=addDays(end,-370);
 let oldMonth=-1;let selected=state.selectedDay;
 for(let i=0;i<371;i++) {
   const d=addDays(start,i),date=iso(d),info=m.get(date),status=dayStatus(info),btn=el('button',`day ${status==='yes'?`yes-${Math.min(4,info.yes)}`:status}${date>state.data.today?' future':''}${selected===date?' selected':''}`);
   const minutes=(info?.records||[]).reduce((sum,r)=>sum+tracked(r),0);
   const description=status==='yes'?`${info.yes} decisão(ões) de estudar${minutes?' · '+formatTime(minutes)+' registrado(s)':''}`:status==='no'?'falta declarada':'sem registro';
   btn.type='button';btn.title=`${pretty(date)} — ${description}`;btn.setAttribute('aria-label',btn.title);btn.setAttribute('role','gridcell');
   btn.addEventListener('click',()=>{state.selectedDay=date;renderDayDetail(m,date);for(const x of container.children)x.classList.toggle('selected',x.dataset.date===date);});
   btn.dataset.date=date;container.append(btn);
   if(d.getMonth()!==oldMonth && d.getDate()<=7) {
     const label=el('span','',months[d.getMonth()]);label.style.left=`${Math.floor(i/7)*18}px`;header.append(label);oldMonth=d.getMonth();
   }
 }
 header.style.width=`${Math.ceil(371/7)*18}px`;
 if(!state.selectedDay)state.selectedDay=state.data.today;
 renderDayDetail(m,state.selectedDay);
}
function renderDayDetail(m,date) {
 const container=$('dayDetail');container.replaceChildren();
 const data=m.get(date),st=dayStatus(data);
 container.append(el('strong','',`${pretty(date)} · ${st==='yes'?'Estudo registrado':st==='no'?'Dia com falta declarada':'Sem registro'}`));
 if(!data){container.append(el('div','detail-row','Nenhuma decisão foi registrada neste dia.'));return;}
 for(const r of data.records){
   const line=el('div','detail-entry');
   const label=`${r.scheduledTime||'--:--'} · ${r.name||'Estudo'} · ${r.choice==='yes'?'Vou estudar':'Não vou estudar'}${r.reason?' — Motivo: '+r.reason:''}${tracked(r)?' · '+formatTime(tracked(r)):''}`;
   line.append(el('span',`detail-pill ${r.choice==='yes'?'good':'bad'}`,label));
   if(r.choice==='yes'){
     const btn=el('button','record-btn',tracked(r)?'Editar tempo':'Registrar tempo');btn.type='button';
     btn.addEventListener('click',()=>openStudy(r));line.append(btn);
     if(r.studyNotes)line.append(el('span','detail-notes',r.studyNotes));
   }
   const del=el('button','record-btn record-delete','Excluir');del.type='button';del.title='Excluir apenas este registro';
   del.addEventListener('click',()=>deleteRecord(r));line.append(del);
   container.append(line);
 }
}
function renderMonth(m) {
 const selector=$('monthInput');
 if(!selector.value)selector.value=state.data.today.substring(0,7);
 const [year,month]=selector.value.split('-').map(Number);
 if(!year||!month)return;
 const daysInMonth=new Date(year,month,0).getDate();
 let yes=0,no=0,empty=0,considered=0,studyMinutes=0;
 const start = (state.data.startedAt && /^\d{4}-\d{2}-\d{2}$/.test(state.data.startedAt))?state.data.startedAt : ([...m.keys()].sort()[0]||state.data.today);
 const allDates=[...m.keys()].sort();const firstRecord=allDates[0];
 const threshold = firstRecord && firstRecord<start?firstRecord:start;
 for(let day=1;day<=daysInMonth;day++){
   const date=`${year}-${pad(month)}-${pad(day)}`;
   if(date<threshold||date>state.data.today)continue;
   const value=dayStatus(m.get(date));
   if(date===state.data.today&&value==='none')continue;
   considered++;
   if(value==='yes')yes++;else if(value==='no')no++;else empty++;
   studyMinutes+=(m.get(date)?.records||[]).reduce((sum,r)=>sum+tracked(r),0);
 }
 $('monthYes').textContent=yes;$('monthNo').textContent=no;$('monthEmpty').textContent=empty;
 const percent=considered?Math.round(yes/considered*100):0;
 $('monthPercent').textContent=`${percent}%`;$('progressFill').style.width=`${percent}%`;
 $('monthTime').textContent=formatTime(studyMinutes);
}
function getNextSchedule(){
 const active=(state.data.schedules||[]).filter(x=>x.active);
 if(!active.length)return null;
 const now=new Date(state.data.now);let nearest=null;
 for(let offset=0;offset<=7;offset++){
   const d=addDays(now,offset);
   for(const s of active){
     if(!(s.days||[]).includes(d.getDay()))continue;
     const [hours,minutes]=s.time.split(':').map(Number);
     const dt=new Date(d);dt.setHours(hours,minutes,0,0);
     if(dt<now)continue;
     if(!nearest||dt<nearest.when)nearest={slot:s,when:dt};
   }
 }
 return nearest;
}
function renderNext(){
 const n=getNextSchedule();
 if(!n){document.querySelector('.glow-star').textContent='--:--';$('nextName').textContent='Sem horários ativos';$('nextTime').textContent='—';$('nextWhen').textContent='Crie uma sessão';return;}
 document.querySelector('.glow-star').textContent=n.slot.time;$('nextName').textContent=n.slot.name;$('nextTime').textContent=n.slot.time;
 const date=iso(n.when);$('nextWhen').textContent=date===state.data.today?'Hoje':date===iso(addDays(localDate(state.data.today),1))?'Amanhã':longDays[n.when.getDay()];
}
function daysDescription(days){
 const sorted=[...days].map(Number).sort();
 if(sorted.length===7)return'Todos os dias';
 if(sorted.join(',')==='1,2,3,4,5')return'Seg a sex';
 if(sorted.join(',')==='0,6')return'Fim de semana';
 return sorted.map(i=>shortDays[i]).join(', ');
}
function renderSchedules(){
 const list=$('scheduleList');list.replaceChildren();
 const ss=[...(state.data.schedules||[])].sort((a,b)=>a.time.localeCompare(b.time));
 if(!ss.length){list.append(el('div','empty-list','Nenhuma sessão cadastrada. Crie seu primeiro horário.'));return;}
 for(const s of ss){
   const item=el('div',`schedule-item ${s.active?'':'inactive'}`);
   const left=el('div','schedule-left'),clock=el('div','time-tile',s.time),description=el('div','schedule-data');
   description.append(el('strong','',s.name),el('p','',`${daysDescription(s.days||[])} · ${s.active?'Ativo':'Pausado'}`));
   left.append(clock,description);
   const actions=el('div','schedule-actions');
   const edit=el('button','','Editar'),toggle=el('button','toggle',s.active?'Pausar':'Ativar'),remove=el('button','delete','Excluir');
   edit.type=toggle.type=remove.type='button';
   edit.addEventListener('click',()=>openSchedule(s));
   toggle.addEventListener('click',()=>changeSchedule({action:'toggle',id:s.id,active:!s.active}));
   remove.addEventListener('click',()=>{if(confirm(`Excluir "${s.name}"? O histórico já registrado será mantido.`))changeSchedule({action:'delete',id:s.id});});
   actions.append(edit,toggle,remove);item.append(left,actions);list.append(item);
 }
}
function renderDiary(){
 const target=$('diaryList');target.replaceChildren();
 const records=(state.data.records||[]).filter(r=>r.choice==='yes')
   .sort((a,b)=>(b.timestamp||b.date).localeCompare(a.timestamp||a.date));
 const pending=records.filter(r=>!tracked(r));
 const badge=$('pendingCount');badge.textContent=`${pending.length} pendente${pending.length===1?'':'s'}`;
 badge.classList.toggle('done',!pending.length);
 if(!records.length){target.append(el('div','diary-empty','Quando você marcar “Vou estudar”, a sessão aparecerá aqui para registrar quanto tempo estudou.'));return;}
 for(const r of [...pending,...records.filter(x=>tracked(x))].slice(0,60)){
   const item=el('article','diary-card'),head=el('div','diary-head');
   const info=el('div');info.append(el('div','diary-date',pretty(r.date)+' · '+(r.scheduledTime||'--:--')),el('div','diary-name',r.name||'Estudo'));
   head.append(info,el('span','diary-time',tracked(r)?'✓ '+formatTime(tracked(r)):'⏳ Tempo pendente'));
   item.append(head);
   if(r.studyNotes)item.append(el('p','diary-notes',r.studyNotes));
   const btn=el('button',`record-btn ${tracked(r)?'outline':''}`,tracked(r)?'Editar registro':'＋ Registrar tempo');btn.type='button';
   btn.addEventListener('click',()=>openStudy(r));item.append(btn);target.append(item);
 }
}
async function deleteRecord(r){
 if(!r?.id){toast('Este registro antigo não pode ser excluído pelo painel.');return;}
 const choice=r.choice==='yes'?'VOU ESTUDAR':'NÃO VOU ESTUDAR';
 const date=pretty(r.date);
 if(!confirm(`Excluir definitivamente este registro?\n\n${date} · ${r.scheduledTime||'--:--'} · ${r.name||'Estudo'}\nResposta: ${choice}\n\nA exclusão atualiza o calendário, a sequência e as estatísticas.`))return;
 try { await request('/api/records/delete',{id:r.id}); await load(); toast('Registro excluído. Histórico e estatísticas atualizados.'); }
 catch(e){if(e.status===401)signOut('Sessão expirada.');else toast('Erro ao excluir: '+e.message);}
}
function renderRecords(){
 const target=$('recordRows');target.replaceChildren();
 const ss=[...(state.data.records||[])].sort((a,b)=>(b.timestamp||b.date).localeCompare(a.timestamp||a.date));
 if(!ss.length){const tr=el('tr');const td=el('td','','Ainda não há respostas registradas.');td.colSpan=6;tr.append(td);target.append(tr);return;}
 for(const r of ss.slice(0,300)){
   const tr=el('tr'),date=el('td','',pretty(r.date)),name=el('td','',`${r.scheduledTime||'--:--'} · ${r.name||'Estudo'}`),choice=el('td');
   choice.append(el('span',`tag ${r.choice==='yes'?'good':'bad'}`,r.choice==='yes'?'✓ Vou estudar':'× Não vou estudar'));
   const time=el('td','',r.choice==='yes'?(tracked(r)?formatTime(tracked(r)):'Pendente'):'—');
   const note=el('td','record-note',r.choice==='no'?(r.reason||'—'):(r.studyNotes||'—'));
   const action=el('td');
   if(r.choice==='yes'){const btn=el('button','record-btn outline',tracked(r)?'Editar':'Registrar');btn.type='button';btn.addEventListener('click',()=>openStudy(r));action.append(btn);}
   const del=el('button','record-btn record-delete','Excluir');del.type='button';del.title='Excluir apenas este registro, sem apagar o horário';
   del.addEventListener('click',()=>deleteRecord(r));
   action.append(del);
   tr.append(date,name,choice,time,note,action);target.append(tr);
 }
}
function renderAll(){if(!state.data)return;const m=summaries();renderStats(m);renderCalendar(m);renderMonth(m);renderNext();renderSchedules();renderDiary();renderRecords();$('connection').textContent='Conectado à nuvem';}
function openSchedule(s=null){
 $('editId').value=s?.id||'';$('dialogTitle').textContent=s?'Editar horário':'Novo horário';
 $('scheduleName').value=s?.name||'';$('scheduleTime').value=s?.time||'20:30';
 const days=s?.days||[0,1,2,3,4,5,6];
 for(const inp of $('daysGroup').querySelectorAll('input'))inp.checked=days.includes(Number(inp.value));
 $('scheduleError').textContent='';$('scheduleDialog').showModal();
}
async function changeSchedule(body){
 try{await request('/api/schedules',body);await load();toast('Horários atualizados com sucesso!');}
 catch(e){if(e.status===401)signOut('Sessão expirada.');else toast(e.message);}
}
function openStudy(r){
 if(!r||r.choice!=='yes')return;
 $('studyRecordId').value=r.id;
 $('studyDialogTitle').textContent=tracked(r)?'Editar tempo de estudo':'Registrar tempo de estudo';
 $('studyContext').textContent=`${pretty(r.date)} · ${r.scheduledTime||'--:--'} · ${r.name||'Estudo'}`;
 const minutes=tracked(r);
 $('studyHours').value=String(Math.floor(minutes/60));
 $('studyMinutes').value=String(minutes%60);
 $('studyNotes').value=r.studyNotes||'';
 $('studyError').textContent='';
 $('studyDialog').showModal();
}
$('closeStudy').addEventListener('click',()=>$('studyDialog').close());
$('cancelStudy').addEventListener('click',()=>$('studyDialog').close());
$('studyDialog').addEventListener('click',e=>{if(e.target===$('studyDialog'))$('studyDialog').close();});
$('studyForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const h=Number($('studyHours').value),m=Number($('studyMinutes').value),total=h*60+m;
 if(!Number.isInteger(h)||!Number.isInteger(m)||h<0||h>24||m<0||m>59||total<1||total>1440){
   $('studyError').textContent='Informe entre 1 minuto e 24 horas (ex.: 1 hora e 30 minutos).';return;
 }
 const btn=$('saveStudy');btn.disabled=true;
 try{
   await request('/api/study',{recordId:$('studyRecordId').value,hours:h,minutes:m,notes:$('studyNotes').value});
   $('studyDialog').close();await load();toast('Tempo de estudo salvo no diário! ✓');
 }catch(err){$('studyError').textContent=err.message;}finally{btn.disabled=false;}
});
$('loginForm').addEventListener('submit',async e=>{
 e.preventDefault();const key=$('keyInput').value.trim();$('loginError').textContent='';
 try{await request('/api/login',{key},'');state.key=key;sessionStorage.setItem('focoCloudKey',key);$('keyInput').value='';await load();}
 catch(err){$('loginError').textContent=err.message;}
});
$('logout').addEventListener('click',()=>signOut());
$('monthInput').addEventListener('change',()=>{if(state.data)renderMonth(summaries());});
$('newSchedule').addEventListener('click',()=>openSchedule());
$('closeDialog').addEventListener('click',()=>$('scheduleDialog').close());
$('cancelDialog').addEventListener('click',()=>$('scheduleDialog').close());
$('scheduleDialog').addEventListener('click',e=>{if(e.target===$('scheduleDialog'))$('scheduleDialog').close();});
$('scheduleForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const days=[...$('daysGroup').querySelectorAll('input:checked')].map(x=>Number(x.value));
 if(!days.length){$('scheduleError').textContent='Selecione pelo menos um dia.';return;}
 const body={action:$('editId').value?'update':'add',id:$('editId').value,name:$('scheduleName').value.trim(),time:$('scheduleTime').value,days};
 if(!body.name){$('scheduleError').textContent='Informe o nome da sessão.';return;}
 try{await request('/api/schedules',body);$('scheduleDialog').close();await load();toast('Horário salvo!');}
 catch(err){$('scheduleError').textContent=err.message;}
});
load();
// Atualiza o resumo quando o app continuar aberto durante um lembrete.
setInterval(()=>{if(state.key&&document.visibilityState==='visible')load();},60000);
