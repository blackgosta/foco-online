'use strict';
// FOCO V6.1: módulo isolado e 100% estático. Não modifica a API nem o Windows.
// Os dados ficam criptografados (AES-GCM) no localStorage deste navegador.
const STORAGE_KEY = 'foco_boletim_cifrado_v1';
const STORAGE_VERSION = 1;
const INITIAL_YEAR = 2026;
const INITIAL_SUBJECTS = [
  'Artes','Biologia','Corrente','Educação Física','Filosofia','Física',
  'Geografia','História','Instalações Elétricas (IEP)','Matemática',
  'Português','Química','Tópicos de Matemática'
];
const $ = id => document.getElementById(id);
let documentData = null;
let key = '';
let saveChain = Promise.resolve();
let editingSubject = null;
let timeoutId;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const one = n => (n / 10).toFixed(1).replace('.',',');
const id = () => (crypto.randomUUID ? crypto.randomUUID() : `foco-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function notify(message){
  const box=$('toast');box.textContent=message;box.classList.add('show');
  clearTimeout(timeoutId);timeoutId=setTimeout(()=>box.classList.remove('show'),3500);
}
function makeSubject(name){return {id:id(),name,grades:[null,null,null]};}
function initialData(){return {version:STORAGE_VERSION,currentYear:INITIAL_YEAR,years:{[INITIAL_YEAR]:INITIAL_SUBJECTS.map(makeSubject)}};}
function hasOwn(object,property){return Object.prototype.hasOwnProperty.call(object,property);}
function assertData(raw){
  if(!raw || raw.version!==STORAGE_VERSION || !raw.years || typeof raw.years!=='object' || !Number.isInteger(raw.currentYear))throw new Error('Backup não pertence a esta versão do boletim.');
  for(const [year,items] of Object.entries(raw.years)){
    if(!/^20\d\d$/.test(year)||!Array.isArray(items)||items.length>150)throw new Error('Ano ou matérias inválidos no backup.');
    for(const row of items){
      if(!row||typeof row.id!=='string'||typeof row.name!=='string'||row.name.length>70||!Array.isArray(row.grades)||row.grades.length!==3)throw new Error('Estrutura de notas inválida.');
      for(const v of row.grades)if(v!==null&&(!Number.isInteger(v)||v<0||v>100))throw new Error('Nota fora de 0 a 10 no backup.');
    }
  }
  if(!hasOwn(raw.years,String(raw.currentYear)))throw new Error('Ano letivo não encontrado no backup.');
  return raw;
}
function toBase64(bytes){
  let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);return btoa(binary);
}
function fromBase64(s){
  if(typeof s!=='string'||s.length>500000)throw new Error('Backup inválido.');
  return Uint8Array.from(atob(s),c=>c.charCodeAt(0));
}
async function keyFromSalt(salt){
  const source = await crypto.subtle.importKey('raw',encoder.encode(key),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:180000,hash:'SHA-256'},source,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function seal(plaintext){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const secret=await keyFromSalt(salt);
  const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv},secret,encoder.encode(plaintext));
  return JSON.stringify({format:'FOCO-NOTAS-ENCRYPTED',version:1,salt:toBase64(salt),iv:toBase64(iv),ciphertext:toBase64(new Uint8Array(bytes))});
}
async function unseal(content){
  const packet=JSON.parse(content);
  if(!packet||packet.format!=='FOCO-NOTAS-ENCRYPTED'||packet.version!==1)throw new Error('Formato de backup incompatível.');
  const salt=fromBase64(packet.salt),iv=fromBase64(packet.iv);
  if(salt.length!==16||iv.length!==12)throw new Error('Formato de criptografia inválido.');
  const secret=await keyFromSalt(salt);
  const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv},secret,fromBase64(packet.ciphertext));
  return assertData(JSON.parse(decoder.decode(clear)));
}
function setSaveStatus(txt, warning=false){
  const el=$('saveStatus');el.textContent=txt;el.style.color=warning?'#ffa8ad':'#93939a';
}
function save(){
  const snapshot=JSON.stringify(documentData);
  setSaveStatus('Salvando notas criptografadas…');
  saveChain=saveChain.then(async()=>{
    const cipher=await seal(snapshot);
    localStorage.setItem(STORAGE_KEY,cipher);
    setSaveStatus('Salvo neste navegador • armazenamento criptografado');
  }).catch(err=>{
    setSaveStatus('Não foi possível salvar. Exporte um backup.',true);
    notify('Falha ao salvar notas: '+err.message);
  });
  return saveChain;
}
// Notas são armazenadas em décimos inteiros; evita erros de ponto flutuante.
function evaluate(grades){
  const values=grades.filter(v=>v!==null);
  const sum=values.reduce((a,b)=>a+b,0); // décimos; 210 = soma 21,0
  const count=values.length;
  const left=3-count;
  const to21=Math.max(0,210-sum);
  if(count<3){
    if(count===0)return {count,sum,type:'pending',label:'Sem notas',detail:'Preencha os trimestres.',to21};
    if(to21>left*100)return {count,sum,type:'impossible',label:'Exame necessário',detail:`Faltam ${one(to21)} pts para 21; máximo restante ${one(left*100)}.`,to21};
    return {count,sum,type:'pending',label:`Faltam ${one(to21)} pts`,detail:`Meta 21: média ${one(Math.ceil(to21/left))} nos ${left} tri restante${left===1?'':'s'}.`,to21};
  }
  // A tabela IFRS calcula a média efetiva com 1 decimal e aprova diretamente
  // com soma 20,9 (média efetiva = 7,0).
  const effective=Math.round(sum/3); // média anual efetiva em décimos
  if(effective>=70)return {count,sum,effective,type:'pass',label:'Aprovado direto',detail:`Média efetiva ${one(effective)} · sem exame.`,to21};
  // Aprovação em exame: 0,6*média_efetiva + 0,4*exame >= 5,0.
  // Trabalha em décimos: 6*mediaDecimos + 4*exameDecimos >= 500.
  const required=Math.ceil((500-6*effective)/4);
  if(required>100)return {count,sum,effective,required,type:'impossible',label:'Exame não suficiente',detail:`Exigiria ${one(required)} no exame (> 10,0).`,to21};
  return {count,sum,effective,required,type:'exam',label:`Exame: ${one(required)}`,detail:`Média efetiva ${one(effective)} · nota mínima no exame.`,to21};
}
function setCell(tag,className,text){
  const cell=document.createElement(tag);if(className)cell.className=className;if(text!==undefined)cell.textContent=text;return cell;
}
function listSubjects(){return documentData.years[String(documentData.currentYear)];}
function renderYears(){
  const selector=$('yearSelect');selector.replaceChildren();
  for(const year of Object.keys(documentData.years).map(Number).sort((a,b)=>b-a)){
    const option=new Option(String(year),String(year));selector.add(option);
  }
  selector.value=String(documentData.currentYear);
}
function render(){
  renderYears();
  const subjects=listSubjects(), body=$('gradesBody');body.replaceChildren();
  let passed=0,exam=0,missing=0;
  for(const subject of subjects){
    const result=evaluate(subject.grades);
    if(result.count<3)missing++;else if(result.type==='pass')passed++;else exam++;
    const tr=document.createElement('tr');
    const name=setCell('td','name-cell');name.append(setCell('strong','',subject.name),setCell('small','',`Ano ${documentData.currentYear}`));tr.append(name);
    for(let quarter=0;quarter<3;quarter++){
      const td=setCell('td','grade-td');td.dataset.label=`${quarter+1}º TRIMESTRE`;
      const input=document.createElement('input');input.className='grade-input';input.type='text';input.inputMode='decimal';input.autocomplete='off';input.spellcheck=false;input.maxLength=4;
      input.placeholder='—';input.value=subject.grades[quarter]===null?'':one(subject.grades[quarter]);
      input.setAttribute('aria-label',`${subject.name}, ${quarter+1}º trimestre`);
      input.addEventListener('change',()=>{
        const current=input.value.trim();let value=null;
        if(current!==''){
          const text=current.replace('.',',');
          if(!/^(?:10(?:,0)?|[0-9](?:,[0-9])?)$/.test(text)){
            input.classList.add('invalid');notify('Nota inválida. Digite de 0,0 a 10,0, com no máximo 1 decimal.');return;
          }
          value=Math.round(Number(text.replace(',','.'))*10);
        }
        input.classList.remove('invalid');
        subject.grades[quarter]=value;save();render();
      });
      input.addEventListener('input',()=>input.classList.remove('invalid'));
      td.append(input);tr.append(td);
    }
    const total=setCell('td','sum-cell');
    total.append(setCell('b','',`${one(result.sum)} / 21,0`),setCell('small','',result.count===3?`Média ${one(result.effective)}`:`${result.count}/3 notas`));
    const track=setCell('div','sum-track');const fill=document.createElement('div');fill.style.width=`${Math.min(100,Math.max(0,result.sum/210*100))}%`;track.append(fill);total.append(track);tr.append(total);
    const status=setCell('td','result-cell');status.append(setCell('span',`pill ${result.type}`,result.label),setCell('small','',result.detail));tr.append(status);
    const actions=setCell('td','action-cell');const group=setCell('div','mini-actions');
    const edit=setCell('button','','✎');edit.type='button';edit.title=`Renomear ${subject.name}`;edit.setAttribute('aria-label',edit.title);edit.addEventListener('click',()=>openSubject(subject));
    const remove=setCell('button','remove','×');remove.type='button';remove.title=`Excluir ${subject.name}`;remove.setAttribute('aria-label',remove.title);remove.addEventListener('click',()=>{
      if(!confirm(`Excluir a matéria "${subject.name}" e as notas dela apenas no ano ${documentData.currentYear}?`))return;
      documentData.years[String(documentData.currentYear)]=subjects.filter(s=>s.id!==subject.id);save();render();notify('Matéria removida.');
    });
    group.append(edit,remove);actions.append(group);tr.append(actions);body.append(tr);
  }
  if(!subjects.length){const tr=document.createElement('tr');const td=setCell('td','','Nenhuma matéria cadastrada. Clique em + Matéria.');td.colSpan=7;tr.append(td);body.append(tr);}
  $('subjectCount').textContent=subjects.length;
  $('directCount').textContent=passed;
  $('examCount').textContent=exam;
  $('missingCount').textContent=missing;
}
function openSubject(subject){
  editingSubject=subject?.id||null;$('dialogHeading').textContent=subject?'Renomear matéria':'Nova matéria';$('subjectName').value=subject?.name||'';
  $('subjectDialog').showModal();$('subjectName').focus();
}
$('addSubject').addEventListener('click',()=>openSubject(null));
$('closeSubject').addEventListener('click',()=>$('subjectDialog').close());
$('cancelSubject').addEventListener('click',()=>$('subjectDialog').close());
$('subjectForm').addEventListener('submit',event=>{
  event.preventDefault();const name=$('subjectName').value.trim();
  if(name.length<2||name.length>70){notify('Nome da matéria inválido.');return;}
  const subjects=listSubjects(),exists=subjects.find(s=>s.name.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR')&&s.id!==editingSubject);
  if(exists){notify('Essa matéria já foi cadastrada.');return;}
  if(editingSubject){const subject=subjects.find(s=>s.id===editingSubject);if(subject)subject.name=name;}
  else subjects.push(makeSubject(name));
  $('subjectDialog').close();save();render();notify('Matéria salva.');
});
$('yearSelect').addEventListener('change',()=>{documentData.currentYear=Number($('yearSelect').value);save();render();});
$('newYear').addEventListener('click',()=>{
  const year=prompt('Ano letivo a adicionar (ex.: 2027):',String(documentData.currentYear+1));
  if(year===null)return;
  if(!/^20\d\d$/.test(year.trim())){notify('Informe um ano entre 2000 e 2099.');return;}
  if(hasOwn(documentData.years,year.trim())){documentData.currentYear=Number(year.trim());save();render();return;}
  const names=listSubjects().map(s=>s.name);
  documentData.years[year.trim()]=names.map(makeSubject);documentData.currentYear=Number(year.trim());
  save();render();notify(`Ano ${year.trim()} criado com notas vazias.`);
});
$('exportBtn').addEventListener('click',async()=>{
  await saveChain;
  const data=localStorage.getItem(STORAGE_KEY);
  if(!data){notify('Não há dados para exportar.');return;}
  const blob=new Blob([data],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`FOCO_boletim_privado_${documentData.currentYear}.json`;document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);
  notify('Backup criptografado exportado.');
});
$('importBtn').addEventListener('click',()=>$('importFile').click());
$('importFile').addEventListener('change',async()=>{
  const file=$('importFile').files?.[0];$('importFile').value='';if(!file)return;
  if(file.size>500000){notify('Arquivo muito grande para um boletim.');return;}
  try{
    const raw=await file.text();
    const recovered=await unseal(raw);
    if(!confirm('Importar este backup? Isso substitui as notas guardadas neste navegador (não afeta o FOCO e os estudos).'))return;
    await saveChain;documentData=recovered;localStorage.setItem(STORAGE_KEY,raw);render();setSaveStatus('Backup importado e guardado neste navegador');notify('Backup importado com sucesso.');
  }catch(e){notify('Não foi possível importar: confira o arquivo e a chave de acesso.');}
});

(async function init(){
  try{
    key=sessionStorage.getItem('focoCloudKey')||'';
    if(!key){$('authGate').hidden=false;return;}
    if(!globalThis.crypto?.subtle){$('authGate').hidden=false;$('authGate').querySelector('p').textContent='Use a versão HTTPS do painel online ou o localhost (navegador seguro) para acessar as notas.';return;}
    const saved=localStorage.getItem(STORAGE_KEY);
    documentData=saved?await unseal(saved):initialData();
    $('gradeApp').hidden=false;render();
    if(!saved)await save();
    else setSaveStatus('Salvo neste navegador • armazenamento criptografado');
  }catch(e){
    $('authGate').hidden=false;
    $('authGate').querySelector('p').textContent='Não consegui abrir as notas deste navegador. Confere se tua chave de acesso é a mesma usada ao salvar. Nenhum dado foi apagado.';
  }
})();
