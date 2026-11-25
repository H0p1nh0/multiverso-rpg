// v0.1.88 — Descansos nativos restaurados de scripts(2).zip/ficha-skills.js,
// funções aplicarDescansoCurto, aplicarDescansoIntensivo, abrirDescansoCurto,
// abrirDescansoIntensivo e montarDescansosGlobais.
import {registerRecharge,usageStatus} from './skill-uses.mjs';
import {sendPrivateUsageCard} from './usage-card.mjs';
import {extraRestResource,extraIntensiveRestResource,extraRestEnabled} from './rest-extra-config.mjs';

const NS='multiverso-rpg';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const numeric=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
const display=value=>{const n=numeric(value);return Number.isInteger(n)?String(n):n.toFixed(2).replace(/0+$/,'').replace(/\.$/,'').replace('.',',');};

export const SHORT_FOOD=Object.freeze({
  nenhuma:{name:'Nenhuma',formula:'1d6',reference:false},
  fraca:{name:'Fraca',formula:'1d8 + 1',reference:false},
  comum:{name:'Comum',formula:'2d6',reference:true},
  banquete:{name:'Banquete',formula:'2d8',reference:true}
});
export const REST_RESOURCES=Object.freeze([
  {label:'Vida',current:'pv_atual',max:'pv_max',reference:'resistencianumero',referenceName:'Resistência'},
  {label:'Mana',current:'pm_atual',max:'pm_max',reference:'arcananumero',referenceName:'Arcana'},
  {label:'Sanidade',current:'san_atual',max:'san_max',reference:'vontadenumero',referenceName:'Vontade'},
  {label:'Stamina',current:'sta_atual',max:'sta_max',reference:'atletismonumero',referenceName:'Atletismo'}
]);

// Cálculos isolados para serem comparados com o motor legado e testados sem Foundry.
export function shortRestCalculation(system,food,rolls){
 const choice=SHORT_FOOD[food];
 const resources=[...REST_RESOURCES];
 const extra=extraRestResource(system);
 if(extra)resources.push(extra);
 if(!choice||!Array.isArray(rolls)||rolls.length!==resources.length||rolls.some(n=>!Number.isFinite(Number(n))))throw new Error('Alimentação ou rolagens inválidas.');
 const patch={};
 const results=resources.map((r,i)=>{
  const base=numeric(rolls[i]),current=numeric(system[r.current]),max=numeric(system[r.max],current);
  const referenceValue=choice.reference?numeric(system[r.reference]):0;
  const referenceBonus=choice.reference?referenceValue/4:0;
  const result=Math.min(max,current+base+referenceBonus);
  const regained=Math.max(0,result-current);
  patch[`system.${r.current}`]=result;
  return {...r,base,referenceValue,referenceBonus,before:current,after:result,max,regained};
 });
 return {patch,results,food:choice.name,usesReference:choice.reference};
}
export function intensiveRestCalculation(system,sanDie){
 if(!Number.isFinite(Number(sanDie)))throw new Error('Rolagem inválida de Sanidade.');
 const sanBefore=numeric(system.san_atual);
 const sanMax=numeric(system.san_max,sanBefore);
 const sanAfter=Math.min(sanMax,sanBefore+numeric(sanDie));
 const patch={
  'system.pv_atual':numeric(system.pv_max),
  'system.pm_atual':numeric(system.pm_max),
  'system.sta_atual':numeric(system.sta_max),
  'system.san_atual':sanAfter
 };
 let extraResult=null;
 const extra=extraIntensiveRestResource(system);
 if(extra){
  const before=numeric(system[extra.current]),max=numeric(system[extra.max]);
  patch[`system.${extra.current}`]=max;
  extraResult={...extra,before,max,after:max,regained:Math.max(0,max-before)};
 }
 return {patch,sanBefore,sanAfter,sanMax,sanRegained:Math.max(0,sanAfter-sanBefore),sanDie:Number(sanDie),extraResult};
}
function trackedItems(actor){return Array.from(actor.items??[]).filter(item=>['skill','tecnica'].includes(item.type));}
function snapshotUsages(actor){return new Map(trackedItems(actor).map(item=>[item.id,usageStatus(actor,item)]));}
function restoredUsages(actor,before){return trackedItems(actor).flatMap(item=>{
 const old=before.get(item.id),now=usageStatus(actor,item);
 return old?.limited&&old.remaining<old.config.limit&&now.limited&&now.remaining>old.remaining?[{name:item.name,remaining:now.remaining,limit:now.config.limit}]:[];
});}

function shortCard(actor,calculation,sanityMarkup=''){
 const detail=calculation.results.map(r=>`<div class="mv-rest-item"><strong>${esc(r.label)}</strong><span>+${display(r.regained)} <small>(${display(r.before)} → ${display(r.after)} / ${display(r.max)})</small>${calculation.usesReference?`<small>¼ de ${esc(r.referenceName)} (${display(r.referenceValue)}): +${display(r.referenceBonus)}</small>`:''}</span></div>`).join('');
 return `<section class="mv-rest-chat"><header><strong>Descanso Curto — ${esc(calculation.food)}</strong><small>${esc(actor.name)} • 30 minutos a 1 hora</small></header><div class="mv-rest-chat-grid">${detail}</div>${sanityMarkup?`<div class="mv-rest-san-roll"><b>Sanidade — rolagem</b>${sanityMarkup}</div>`:''}</section>`;
}
function longCard(actor,result,newDay,sanityMarkup=''){
 const details=[['Vida',result.patch['system.pv_atual']],['Mana',result.patch['system.pm_atual']],['Stamina',result.patch['system.sta_atual']]].map(([label,value])=>`<div class="mv-rest-item"><strong>${label}</strong><span>Restaurada ao máximo (${display(value)})</span></div>`).join('');
 const extra=result.extraResult?`<div class="mv-rest-item"><strong>${esc(result.extraResult.label)}</strong><span>Restaurado ao máximo (${display(result.extraResult.before)} → ${display(result.extraResult.after)})</span></div>`:'';
 return `<section class="mv-rest-chat"><header><strong>Descanso Intensivo</strong><small>${esc(actor.name)} • recuperação completa + 1d12 SAN</small></header><div class="mv-rest-chat-grid">${details}<div class="mv-rest-item"><strong>Sanidade</strong><span>+${display(result.sanRegained)} <small>(${display(result.sanBefore)} → ${display(result.sanAfter)} / ${display(result.sanMax)})</small></span></div>${extra}${newDay?'<div class="mv-rest-chat-day">Novo dia também registrado (recargas diárias).</div>':''}</div>${sanityMarkup?`<div class="mv-rest-san-roll"><b>Sanidade — 1d12 = ${display(result.sanDie)} · recuperado +${display(result.sanRegained)}</b>${sanityMarkup}</div>`:''}</section>`;
}

async function rollForRest(formula,actor){const roll=new Roll(formula,actor.getRollData?.()??{});await roll.evaluate();if(!Number.isFinite(Number(roll.total)))throw new Error('Rolagem de descanso inválida.');return {roll,total:Number(roll.total)};}
const working=new Set();
export async function performRest(actor,kind,{food='nenhuma',newDay=false}={}){
 if(!actor||!['curto','intensivo'].includes(kind))throw new Error('Descanso inválido.');
 if(working.has(actor.uuid))throw new Error('Já existe um descanso em andamento para este personagem.');
 if(!actor.isOwner&&!game.user?.isGM)throw new Error('Você não tem permissão para descansar com este personagem.');
 working.add(actor.uuid);
 try{
  const before=snapshotUsages(actor);
  let result,content,sanityRoll;
  if(kind==='curto'){
   const choice=SHORT_FOOD[food];if(!choice)throw new Error('Alimentação inválida.');
   const rolls=[];const resources=[...REST_RESOURCES];if(extraRestResource(actor.system))resources.push(extraRestResource(actor.system));
   for(const resource of resources){const rolled=await rollForRest(choice.formula,actor);rolls.push(rolled.total);if(resource.label==='Sanidade')sanityRoll=rolled.roll;}
   result=shortRestCalculation(actor.system,food,rolls);
   content=shortCard(actor,result,sanityRoll?await sanityRoll.render():'');
  }else{
   sanityRoll=(await rollForRest('1d12',actor)).roll;
   result=intensiveRestCalculation(actor.system,Number(sanityRoll.total));
   content=longCard(actor,result,!!newDay,sanityRoll?await sanityRoll.render():'');
  }
  // Só dispara eventos e recargas APÓS a recuperação real ter sido salva.
  await actor.update(result.patch);
  const event=kind==='curto'?'descanso_curto':'descanso_longo';
  let rechargeSuccess=false;
  try{
   await registerRecharge(actor,event);
   if(kind==='intensivo'&&newDay)await registerRecharge(actor,'novo_dia');
   rechargeSuccess=true;
  }catch(e){console.error('Multiverso | Recuperação concluída, mas a recarga falhou:',e);ui.notifications?.warn?.('Recursos recuperados, mas houve falha na recarga de habilidades. Confira F12.');}
  const timestamp=Date.now();
  // Hooks originais preservados para futuros consumidores da automação antiga.
  if(kind==='curto')Hooks.callAll?.('multiversoDescansoCurto',actor,{timestamp});
  else{
   Hooks.callAll?.('multiversoDescansoLongo',actor,{novoDia:!!newDay,timestamp});
   if(newDay){
    // Sem actor.getFlag('multiverso'): o Foundry 14 rejeita escopo legado inativo.
    const seq=numeric(actor.flags?.[NS]?.recargaSequenciasV58?.novo_dia);
    Hooks.callAll?.('multiversoNovoDia',actor,{origem:'descanso-intensivo',sequencia:seq,timestamp});
   }
  }
  // UMA mensagem reúne o resultado de todos os recursos e a Roll real de SAN.
  // A Roll permanece inspecionável nos dados nativos da mensagem, sem outro card.
  try{await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content,rolls:sanityRoll?[sanityRoll]:[]});}
  catch(e){console.error('Multiverso | Descanso registrado, mas falhou a publicação do card:',e);ui.notifications?.warn?.('Descanso concluído, mas o card do chat não pôde ser publicado.');}
  if(rechargeSuccess){
   const restored=restoredUsages(actor,before);
   void sendPrivateUsageCard(actor,{kind:'recarga',event,restored,newDay:kind==='intensivo'&&!!newDay}).catch(e=>console.error('Multiverso | Card privado da recarga:',e));
  }
  ui.notifications?.info?.(`${kind==='curto'?'Descanso Curto':'Descanso Intensivo'} concluído para ${actor.name}.`);
  actor.sheet?.render?.(false);
  return {kind,result,rechargeSuccess,newDay:kind==='intensivo'&&!!newDay};
 }finally{working.delete(actor.uuid);}
}

export function restDialogOptions(kind,actor=null){
 const extra=extraRestResource(actor?.system);
 const intensiveExtra=extraIntensiveRestResource(actor?.system);
 if(kind==='curto')return {window:{title:'Descanso Curto'},content:`<div class="mv-rest-dialog"><p>Escolha a alimentação. Vida, Mana, Sanidade e Stamina${extra?` e ${esc(extra.label)}`:''} recebem <strong>rolagens independentes</strong>.</p><div class="mv-rest-food">${Object.entries(SHORT_FOOD).map(([id,x],i)=>`<label><input type="radio" name="mv-rest-food" value="${id}" ${i===0?'checked':''}><span><strong>${esc(x.name)}</strong><small>${x.formula}${x.reference?' + ¼ do atributo correspondente':''} por recurso</small></span></label>`).join('')}</div><p class="mv-rest-help">Referências: Vida = Resistência; Mana = Arcana; Sanidade = Vontade; Stamina = Atletismo.${extra?` ${esc(extra.label)} = ${esc(extra.referenceName)}.`:' Fluxos Extras só recuperam aqui quando habilitados nas Configurações da Ficha.'}</p></div>`};
 return {window:{title:'Descanso Intensivo'},content:`<div class="mv-rest-dialog"><p>Recupera <strong>Vida, Mana e Stamina ao máximo</strong> e <strong>1d12 de Sanidade</strong>.${intensiveExtra?` Também recupera ${esc(intensiveExtra.label)} ao máximo.`:''}</p><label class="mv-rest-day"><input type="checkbox" name="mvRestNewDay" data-mv-rest-new-day><span><strong>Este descanso inicia um novo dia</strong><small>Opcional. Recarrega Skills configuradas com recarga por Novo dia; não substitui recargas de Turno ou Cena.</small></span></label></div>`};
}
export async function openRestDialog(actor,kind){
 if(!actor)return;
 const options=restDialogOptions(kind,actor);
 const selected=await foundry.applications.api.DialogV2.wait({
  ...options,buttons:[
   {action:'cancel',label:'Cancelar',callback:()=>null},
   {action:'confirm',label:'Descansar',default:true,callback:(_e,_button,dialog)=>{
    const form=_button?.form;
    // Use os inputs do próprio formulário do DialogV2. Ler dialog.element
    // pode perder o estado marcado dependendo do ciclo de submissão do Foundry.
    const foodControl=form?.elements?.namedItem?.('mv-rest-food');
    const foodSelected=foodControl?.value || 'nenhuma';
    const dayControl=dialog?.element?.querySelector?.('input[name="mvRestNewDay"]')
      ??form?.elements?.namedItem?.('mvRestNewDay');
    return kind==='curto'?{food:foodSelected}:{newDay:dayControl?.checked===true};
   }}
  ],rejectClose:false
 });
 if(!selected)return null;
 return performRest(actor,kind,selected);
}
