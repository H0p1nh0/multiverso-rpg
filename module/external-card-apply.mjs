// Aplicação de cura + condição mantida no chat (sem token obrigatório).
// Reaproveita a duração de cena/turnos/rodadas e marcadores nativos.
import {primaryCost,optionalCost,chooseReinforcement} from './native-effects.mjs';
import {confirmOriginalUse} from './confirmation-original.mjs';
import {usageStatus,takeUsage,restoreUsage} from './skill-uses.mjs';
import {fluxById} from './extra-flux.mjs';
import {getLastInteractedActor} from './chat-roll-apply.mjs';
import {planTrackedEntries,readTracked} from './effect-tracking.mjs';
import {changeList,conditionFlags} from './condition-mechanics.mjs';
const NS='multiverso-rpg';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const busy=new Set();
const isOwner=a=>!!a&&(game.user.isGM||a.testUserPermission(game.user,'OWNER'));
export const allowedExternalCardErrors=new Set([
  'O receptor selecionado não é compatível com esta execução.',
  'Configuração indisponível nesta execução: Alcance.',
  'Configuração indisponível nesta execução: Quantidade de Alvos.'
]);
export function canUseExternalCard(effects){
 return effects.length>0&&effects.length<=5&&effects.every(e=>
  ['alvo','aliado'].includes(e.receiver)&&!e.resistanceActive&&!e.dynamicValue&&!e.protection&&
  ((e.type==='recurso'&&e.affected==='pv'&&e.op==='somar'&&e.cadence==='once'&&['instant','unspecified','scene'].includes(e.duration?.kind)) ||
  (e.type==='cura'&&e.cadence==='once'&&['instant','unspecified','scene'].includes(e.duration?.kind)) ||
  (e.type==='condicao'&&e.cadence==='maintained'&&['scene','turns','rounds'].includes(e.duration?.kind)))
 );
}
async function warn(message){ui.notifications.warn(message);return false;}
function resultCard(item,source,effects,cardId){
 const description=String(item.system?.props?.descricaoskill??item.system?.props?.descricaotecnica??item.system?.descricao??'');
 const summary=effects.map(e=>e.type==='condicao'
  ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:#29212a;border:1px solid #5e4b37;border-radius:7px"><span style="color:#f0dab3">✦ ${esc(e.conditionName)}</span><small style="color:#d6bc90">${esc(e.duration?.label||'Duração cadastrada')}</small></div>`
  : `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:#29212a;border:1px solid #5e4b37;border-radius:7px"><span style="color:#f0dab3">✚ Recuperação de PV</span><strong style="color:#f8dca6">${esc(e.diceFormula||e.value)} PV</strong></div>`).join('');
 return `<section class="mv-chat-effect mv-external-card" data-mv-card-id="${esc(cardId)}" style="box-sizing:border-box;background:#1d1923;color:#f3e2c5;border:1px solid #b58a4d;border-radius:11px;padding:13px 12px;font-family:inherit;line-height:1.4">
 <header style="border-bottom:1px solid #826540;padding-bottom:8px;margin-bottom:10px"><div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#c8a66d;font-weight:700">Multiverso RPG • Habilidade</div><h3 style="font-size:21px;line-height:1.2;color:#f4d49a;margin:4px 0 0;font-weight:750">${esc(item.name)}</h3></header>
 ${description?`<p style="font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;color:#e6d1b0;margin:0 0 11px">${esc(description)}</p>`:''}
 <div style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#d9b87e;font-weight:700;margin:10px 0 7px">Efeitos disponíveis</div>
 <div style="display:grid;gap:5px">${summary}</div>
 <div class="mv-external-card-result"></div>
 <div class="mv-external-card-action" style="margin-top:12px"><button type="button" class="mv-apply-external-card" data-mv-external-id="${esc(cardId)}" style="width:100%;border-radius:7px;padding:9px 10px;background:#79532e;color:#ffe8b9;border:1px solid #d3a35f;font-weight:700;cursor:pointer">Aplicar Efeito</button><small style="display:block;text-align:center;color:#bda98d;font-size:10px;margin-top:7px">Abra a ficha do destinatário antes de aplicar.</small></div>
 </section>`;
}
function rollDetails(roll){
 const dice=(roll?.dice??[]).flatMap(d=>(d.results??[]).filter(r=>r.active!==false&&!r.discarded).map(r=>Number(r.result))).filter(Number.isFinite);
 const faces=dice.length?`<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:7px">${dice.map(n=>`<span style="display:inline-flex;align-items:center;justify-content:center;min-width:28px;min-height:28px;border:1px solid #be9258;border-radius:6px;background:#3f302b;color:#ffe2a1;font-size:16px;font-weight:700">${n}</span>`).join('')}</div>`:'';
 return `<div style="border:1px solid #796044;border-radius:8px;background:#17151d;padding:10px;margin-top:8px"><div style="font-size:11px;color:#d9b87e;font-weight:700;margin-bottom:4px">Rolagem de cura</div><div style="color:#dec9a4;font-size:12px">${esc(roll.formula)}</div>${faces}<div style="margin-top:6px;font-size:20px;font-weight:800;color:#f9dfa2">${esc(roll.total)} <small style="font-size:11px;color:#d6c1a0">PV rolados</small></div></div>`;
}
async function publishAppliedResult(message,actor,rolls,healedAmount,conditions){
 const bits=rolls.map(rollDetails).join('');
 const conditionHtml=conditions.length?`<div style="margin-top:8px;color:#e8d1a9;font-size:12px">✦ ${conditions.map(esc).join(', ')} aplicado${conditions.length>1?'s':''}</div>`:'';
 const result=`<div style="border-top:1px solid #796044;margin-top:12px;padding-top:10px"><div style="font-size:11px;color:#d9b87e;font-weight:700">Aplicado em ${esc(actor.name)}</div>${bits}<div style="font-size:12px;margin-top:8px;color:#ebd5b2">PV recuperados: <strong style="color:#f8dea7">${healedAmount}</strong></div>${conditionHtml}</div>`;
 // Só modificar uma mensagem quando o usuário atual tiver permissão; o destinatário pode ser outro jogador.
 const canUpdate=game.user.isGM||message.isOwner;
 if(canUpdate){
  const old=String(message.content??'');
  const replaced=old.replace('<div class="mv-external-card-result"></div>',`<div class="mv-external-card-result">${result}</div>`)
   .replace(/<div class="mv-external-card-action"[\s\S]*?<\/div>\s*<\/section>/, '</section>');
  if(replaced!==old){try{await message.update({content:replaced});return;}catch(err){console.warn('Multiverso | não foi possível atualizar card; publicando resultado separado',err);}}
 }
 // Sem permissão de alterar o card original, a aplicação permanece válida e o resultado é publicado no chat.
 await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<section class="mv-chat-effect" style="background:#1d1923;color:#f3e2c5;border:1px solid #b58a4d;border-radius:10px;padding:12px"><h3 style="color:#f4d49a;margin:0">${esc(message.speaker?.alias||'Habilidade')} • Resultado</h3>${result}</section>`});
}
export async function executeExternalCard(item,source,effects){
 const selected=[...(game.user.targets??[])];
 if(selected.length>1)return warn('Selecione somente um alvo para esta habilidade.');
 const actor=selected[0]?.actor??null;
 if(actor&&!isOwner(actor))return warn('Sem permissão para aplicar na ficha do token. Use o card com a ficha do destinatário.');
 if(effects.some(e=>e.errors?.some(err=>!allowedExternalCardErrors.has(err))))return warn('Existe um erro de configuração além da seleção do alvo. Confira Testar Habilidade.');
 if(effects.some(e=>e.type==='condicao'&&!e.conditionName))return warn('Condição sem nome.');
 const usage=usageStatus(source,item);if(!usage.ok)return warn(usage.error||'Limite de usos atingido.');
 const count=Number(item.system?.props?.mvEffectCount||effects.length);
 const cost=primaryCost(item,count,source),opt=optionalCost(item,count,source);
 if(cost.errors.length||opt.errors.length)return warn([...cost.errors,...opt.errors].join(' | '));
 const extras=await chooseReinforcement(opt,source);if(extras===null)return false;
 // Não interpretar silenciosamente reforços que substituem efeitos.
 if(extras.some(x=>x.chosen?.effects?.length))return warn('Reforço com efeito condicional ainda exige executor completo.');
 const confirmed=await confirmOriginalUse(item,source,cost.options,extras.flatMap(x=>x.chosen.costs));if(!confirmed)return false;
 const before={},patch={};
 for(const c of confirmed.costs){const f=fluxById(source,c.resource);if(!f)return warn('Recurso de custo desconhecido.');const current=Number(source.system[f.key]);before[f.key]=current;patch[`system.${f.key}`]=(patch[`system.${f.key}`]??current)-Number(c.amount);}
 if(Object.values(patch).some(n=>!Number.isFinite(n)||n<0))return warn('Recursos insuficientes.');
 const cardId=foundry.utils.randomID();let taken=null;
 try{
  taken=await takeUsage(source,item);if(!taken.ok)return warn('Limite de usos atingido.');
  if(Object.keys(patch).length)await source.update(patch);
  const message=await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:source}),content:resultCard(item,source,effects,cardId),flags:{[NS]:{externalCardV1:{cardId,itemUuid:item.uuid,sourceUuid:source.uuid,effects:effects.map(e=>({index:e.index,type:e.type,op:e.op,value:e.value,diceFormula:e.diceFormula,affected:e.affected,conditionName:e.conditionName,conditionMechanics:e.conditionMechanics??[],duration:e.duration,cadence:e.cadence}))}}}});
  if(!message)throw new Error('Falha ao publicar card.');
  if(actor)await applyToActor(message,actor); // Token marcado: mesmo caminho da aplicação via card.
  return true;
 }catch(error){console.error('Multiverso | aplicar efeito externo',error);
  if(!actor){if(taken?.limited)await restoreUsage(source,taken).catch(console.error);if(Object.keys(before).length)await source.update(Object.fromEntries(Object.entries(before).map(([k,v])=>[`system.${k}`,v]))).catch(console.error);}
  return warn('Falha na aplicação. Confira o console e os recursos antes de repetir.');}
}
async function applyToActor(message,actor){
 const info=message.getFlag(NS,'externalCardV1');
 if(!info||!isOwner(actor))return warn('Abra uma ficha que você pode editar antes de aplicar.');
 const key=`${message.id}:${info.cardId}`;
 if(busy.has(key))return warn('Aplicação já em andamento.');
 busy.add(key);
 try{
  const receipts=actor.getFlag(NS,'externalCardReceipts')??[];
  if(receipts.includes(info.cardId))return warn('Este personagem já recebeu esse card.');
  const item=await fromUuid(info.itemUuid);
  if(!item)return warn('Habilidade original não encontrada.');
  const oldPV=Number(actor.system.pv_atual),maxPV=Number(actor.system.pv_max);
  if(!Number.isFinite(oldPV)||!Number.isFinite(maxPV))return warn('PV inválidos no destinatário.');
  const details=[];const cureRolls=[];const conditionNames=[];let healed=oldPV,entries=[],markers=[];
  for(const e of info.effects){
   if(['cura','recurso'].includes(e.type)){
    let value=Number(e.value);
    if(e.diceFormula){const r=new Roll(e.diceFormula,actor.getRollData?.()??{});await r.evaluate();value=Number(r.total);details.push(`Cura rolada: ${r.formula} = ${value}`);cureRolls.push(r);}
    if(!Number.isFinite(value)||value<0)return warn('Fórmula de cura inválida.');
    healed=Math.min(maxPV,Math.max(0,healed+value));
   }else if(e.type==='condicao'){
    conditionNames.push(e.conditionName);
    const planned=planTrackedEntries({actor,item,effects:[{...e,value:0}]});
    entries.push(...planned);
    for(const en of planned){markers.push({name:e.conditionName,disabled:false,changes:changeList(e.conditionMechanics??[]),flags:{[NS]:{trackingId:en.id,sourceUuid:info.sourceUuid,isCondition:true,...conditionFlags(e.conditionMechanics??[]),blocksAction:(e.conditionMechanics??[]).some(m=>m.blocksAction),blockedActionTypes:(e.conditionMechanics??[]).filter(m=>m.blocksAction).flatMap(m=>m.blockedActionTypes??['todas'])}}});}
   }
  }
  const oldTracked=readTracked(actor);let created=[];
  try{
   if(markers.length)created=await actor.createEmbeddedDocuments('ActiveEffect',markers);
   const patch={'system.pv_atual':healed};
   await actor.update(patch);
   if(entries.length)await actor.setFlag(NS,'trackedDurations',[...oldTracked,...entries]);
   await actor.setFlag(NS,'externalCardReceipts',[...receipts,info.cardId].slice(-100));
  }catch(err){
   console.error('Multiverso | falha ao atualizar destinatário',err);
   if(created.length)await actor.deleteEmbeddedDocuments('ActiveEffect',created.map(x=>x.id)).catch(console.error);
   await actor.update({'system.pv_atual':oldPV}).catch(console.error);
   await actor.setFlag(NS,'trackedDurations',oldTracked).catch(console.error);
   throw err;
  }
  try{await publishAppliedResult(message,actor,cureRolls,healed-oldPV,conditionNames);}catch(cardError){console.error('Multiverso | efeitos aplicados, mas falhou o resultado do chat',cardError);ui.notifications.warn('Efeito aplicado na ficha, mas não foi possível atualizar o chat.');}
  ui.notifications.info(`${actor.name}: recuperou ${healed-oldPV} PV${conditionNames.length?' e recebeu '+conditionNames.join(', '):''}.`);
  return true;
 }finally{busy.delete(key);}
}
export function registerExternalCardApply(){
 const attach=(message,html)=>{
  const root=html instanceof HTMLElement?html:html?.[0];if(!root||root.dataset.mvExternalApplyBound)return;
  root.dataset.mvExternalApplyBound='1';
  root.addEventListener('click',event=>{
   if(!event.target?.closest?.('.mv-apply-external-card'))return;
   event.preventDefault();event.stopPropagation();
   void (async()=>{
    const actor=await getLastInteractedActor()??game.user.character;
    if(!actor)return warn('Abra a ficha do personagem que receberá os efeitos.');
    await applyToActor(message,actor);
   })().catch(err=>{console.error('Multiverso | aplicação pelo chat',err);ui.notifications.error('Falha ao aplicar efeito. Confira o console.');});
  });
 };
 Hooks.on('renderChatMessageHTML',attach);
 Hooks.on('renderChatMessage',attach);
}
