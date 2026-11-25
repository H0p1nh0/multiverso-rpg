// v0.1.93 — As escolhas valem apenas para UMA ativação; não alteram o Item.
const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
const DAMAGE_TYPES=[['fisico','Físico'],['elemental','Elemental'],['fogo','Fogo'],['frio','Frio'],['eletrico','Elétrico'],['quimico','Químico'],['psiquico','Psíquico'],['sagrado','Sagrado'],['sombrio','Sombrio'],['verdadeiro','Verdadeiro']];
const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const optionList=raw=>String(raw??'').split(/[,;\n|]+/).map(s=>s.trim()).filter(Boolean);
export function activationChoiceConfig(item,effects){
 const props=item.system?.props??{};
 return effects.map(e=>{
  const i=e.index,s=i===1?'':String(i),prefix=`efeito${item.type}`;
  const field=k=>String(props[`${prefix}${k}${s}`]??'').trim();
  const numberChoice=field('definicao')==='escolhido';
  const damageChoice=field('tipodanomodo')==='escolhido'&&e.type==='dano';
  const custom=optionList(field('escolhaopcoes'));
  const rawQty=field('escolhaquantidade');
  const count=rawQty?Number(rawQty):1;
  const repeat=field('escolharepetir')==='sim';
  return {index:i,title:String(props[`mvEffectTitle${i}`]??`Efeito ${i}`),numberChoice,damageChoice,custom,count,repeat,type:e.type};
 }).filter(e=>e.numberChoice||e.damageChoice);
}
export function validateActivationChoice(config,choice){
 if(config.numberChoice){
  const values=Array.isArray(choice?.values)?choice.values:[];
  if(!Number.isInteger(config.count)||config.count<1||config.count>10)return 'Quantidade de escolhas deve estar entre 1 e 10.';
  if(values.length!==config.count || values.some(v=>!String(v).trim()))return `Preencha todas as ${config.count} escolhas.`;
  if(!config.repeat&&new Set(values.map(normalize)).size!==values.length)return 'Esta habilidade não permite escolhas repetidas.';
  if(config.custom.length&&values.some(v=>!config.custom.includes(String(v))))return 'Uma escolha não está entre as opções permitidas.';
  if(['recurso','cura','dano'].includes(config.type)&&values.some(v=>!Number.isFinite(Number(String(v).replace(',','.')))||Number(String(v).replace(',','.'))<0))return 'Este tipo de efeito exige valor numérico não negativo.';
 }
 if(config.damageChoice&&!DAMAGE_TYPES.some(([id])=>id===choice?.damageType))return 'Selecione um tipo de dano válido.';
 return null;
}
export async function askActivationChoices(item,effects){
 const configs=activationChoiceConfig(item,effects);
 if(!configs.length)return new Map();
 for(const c of configs){
  if(c.numberChoice&&(!Number.isInteger(c.count)||c.count<1||c.count>10))throw Error(`Efeito ${c.index}: quantidade de escolhas deve ser 1 a 10.`);
 }
 const forms=configs.map(c=>{
  const slots=c.numberChoice?Array.from({length:c.count},(_,j)=>{
   const options=c.custom.length?`<select data-mv-choice="${c.index}" data-pos="${j}"><option value="">Selecionar...</option>${c.custom.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select>`:`<input type="number" min="0" step="any" data-mv-choice="${c.index}" data-pos="${j}" placeholder="Valor" />`;
   return `<label>Escolha ${j+1} ${options}</label>`;
  }).join(''):'';
  const die=c.damageChoice?`<label>Tipo de dano<select data-mv-damage="${c.index}"><option value="">Selecionar...</option>${DAMAGE_TYPES.map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></label>`:'';
  return `<fieldset style="margin:10px 0;padding:12px;border:1px solid #967c4b;border-radius:7px"><legend>${esc(c.title)}</legend>${slots}${die}</fieldset>`;
 }).join('');
 const result=await foundry.applications.api.DialogV2.wait({window:{title:`Escolhas na ativação — ${item.name}`},
  content:`<form class="mv-activation-choices" style="background:#1f1b22;color:#eadab4;padding:12px">${forms}<small>As escolhas só valem para este uso.</small></form>`,
  buttons:[{action:'cancel',label:'Cancelar',callback:()=>null},{action:'confirm',label:'Continuar',default:true,callback:(_event,button,dialog)=>{
   const root=dialog?.element??button?.form;if(!root)return null;
   const map=[];
   for(const c of configs){
    const choice={values:[],damageType:''};
    for(let j=0;j<(c.numberChoice?c.count:0);j++)choice.values.push(String(root.querySelector(`[data-mv-choice="${c.index}"][data-pos="${j}"]`)?.value??'').trim());
    if(c.damageChoice)choice.damageType=root.querySelector(`[data-mv-damage="${c.index}"]`)?.value??'';
    const error=validateActivationChoice(c,choice);
    if(error){ui.notifications.warn(`${c.title}: ${error}`);return null;}
    map.push([c.index,choice]);
   }
   return map;
  }}],rejectClose:false});
 return Array.isArray(result)?new Map(result):null;
}
export function activationChoiceValue(choice){
 const values=(choice?.values??[]).map(x=>Number(String(x).replace(',','.')));
 return values.length?values.reduce((a,b)=>a+b,0):null;
}
