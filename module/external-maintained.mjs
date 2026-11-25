import {selectedExternalTokens} from './selected-targets.mjs';
import {changeList,conditionFlags} from "./condition-mechanics.mjs";
// v0.1.94 — efeitos mantidos em UM alvo externo explicitamente marcado.
// A origem paga custos e usos; o alvo guarda marcadores, modificadores e durações.
// Não altera o caminho aprovado de dano/cura imediatos ou múltiplos alvos.
import {primaryCost,optionalCost,chooseReinforcement} from './native-effects.mjs';
import {confirmOriginalUse} from './confirmation-original.mjs';
import {planTrackedEntries,readTracked} from './effect-tracking.mjs';
import {buildAttributeActivationPatch} from './maintained-attributes.mjs';
import {usageStatus,takeUsage,restoreUsage} from './skill-uses.mjs';
import {fluxById} from './extra-flux.mjs';
import {advancedMode,predicateCheck} from './advanced-motor.mjs';

import {availablePericias} from './pericia-fields.mjs';
const NS='multiverso-rpg';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ATTRIBUTE_KEYS=new Set(['forcanumero','agilidadenumero','resistencianumero','inteligencianumero','carismanumero','percepcaonumero','deslocamentonumero','esquivabonus','bloqueiobonus',...availablePericias().map(x=>x.key)]);
const receiverError='O receptor selecionado não é compatível com esta execução.';
const activeExecution=new Set();
export function externalMaintainedIssues(effects,{marked=[],source=null,sceneId=null,item=null}={}){
 const issues=[];
 if(!effects.length)issues.push('Não há efeitos configurados.');
 if(marked.length!==1)issues.push('Marque exatamente UM token como alvo; não serão aplicados efeitos em todos os tokens da cena.');
 const token=marked[0];
 if(token && sceneId && token.document?.parent?.id && token.document.parent.id!==sceneId)issues.push('O alvo marcado pertence a outra cena.');
 const target=token?.actor;
 if(token && (!target||target.documentName!=='Actor'))issues.push('O token não possui uma ficha válida.');
 if(target?.uuid===source?.uuid)issues.push('Para a própria ficha, escolha O próprio personagem no editor.');
 if(target&&!target.isOwner)issues.push('Sem permissão para alterar a ficha do alvo. Peça ao mestre para executar a Skill.');
 for(const effect of effects){
   const tag=`Efeito ${effect.index}`;
   if(!['alvo'].includes(effect.receiver))issues.push(`${tag}: escolha Alvo escolhido, Aliado ou Inimigo.`);
   if(effect.cadence!=='maintained'||!['atributo','bonus','penalidade','deslocamento','defesa','teste','condicao'].includes(effect.type))issues.push(`${tag}: somente alteração de atributo ou condição mantida é suportada nesta rota.`);
   if(!['turns','rounds'].includes(effect.duration?.kind))issues.push(`${tag}: informe duração em turnos ou rodadas.`);
   if(effect.resistanceActive)issues.push(`${tag}: esta resistência não pode ser mantida em um alvo externo com esta configuração.`);
   if(effect.dynamicValue||effect.diceFormula)issues.push(`${tag}: esta escolha de valores não pode ser mantida em um alvo externo com esta configuração.`);
   // O teto de alvos é usado também com um único token; validar seu formato.
   // Não ignorar indiscriminadamente diagnósticos de campos não portados.
   const rawLimit=String(item?.system?.props?.[`efeito${item.type}qtdalvos${effect.index===1?'':effect.index}`]??'').trim();
   if(rawLimit && !/^[1-9]\d*$/.test(rawLimit))issues.push(`${tag}: Quantidade de Alvos deve ser um número inteiro positivo.`);
   issues.push(...(effect.errors??[]).filter(x=>x!==receiverError && !(x==='Configuração indisponível nesta execução: Quantidade de Alvos.' && rawLimit && /^[1-9]\d*$/.test(rawLimit))).map(x=>`${tag}: ${x}`));
 }
 return {issues,target};
}
async function blocked(issues){
 await foundry.applications.api.DialogV2.wait({window:{title:'Efeitos mantidos — alvo externo'},content:`<h3>Execução bloqueada</h3><p>Nenhum uso nem recurso foi consumido.</p><ul>${issues.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>`,buttons:[{action:'ok',label:'Entendi',default:true}]});
 return false;
}
function buildEffects(entries){
 return entries.map(entry=>{
  const data=entry.maintainedEffect;
  if(!data)throw new Error('Registro mantido ausente.');
  if(data.condition){
   const mechanics=data.mechanics??[];
   if(!Array.isArray(mechanics)||mechanics.some(m=>!m.blocksAction&&(!(m.kind==='capacity'||(m.kind==='damage'&&['caused','received'].includes(m.direction)&&['any','melee','ranged'].includes(m.scope))||ATTRIBUTE_KEYS.has(m.attributeKey))||!Number.isFinite(m.delta))))throw new Error('Condição interna inválida.');
   return {name:String(data.name||entry.name),disabled:false,changes:changeList(mechanics),flags:{[NS]:{trackingId:entry.id,sourceUuid:entry.sourceUuid,isCondition:true,...conditionFlags(mechanics),blocksAction:mechanics.some(m=>m.blocksAction),blockedActionTypes:mechanics.filter(m=>m.blocksAction).flatMap(m=>m.blockedActionTypes??['todas'])}}};
  }
  if(!ATTRIBUTE_KEYS.has(data.attributeKey)||!Number.isFinite(data.delta))throw new Error('Alteração de atributo inválida.');
  return {name:`${entry.name} (${entry.source})`,disabled:false,changes:[],flags:{[NS]:{trackingId:entry.id,sourceUuid:entry.sourceUuid,storedAttributeDelta:{key:data.attributeKey,delta:data.delta}}}};
 });
}
export async function executeExternalMaintained(item,source,allEffects){
 const marked=selectedExternalTokens(source);
 // Não inferir alvo a partir de fichas abertas ou de tokens não controlados.
 const {issues,target}=externalMaintainedIssues(allEffects,{marked,source,sceneId:canvas?.scene?.id,item});
 if(!source?.isOwner)issues.push('Sem permissão para executar essa Skill.');
 if(!game.user?.isGM && target && !target.isOwner)issues.push('O mestre precisa aplicar esse efeito no alvo.');
 if(issues.length)return blocked(issues);
 if(activeExecution.has(source.uuid))return blocked(['Outra execução deste personagem está em andamento.']);
 activeExecution.add(source.uuid);
 try{
  const props=item.system.props??{};
  const costPlan=primaryCost(item,allEffects.length,source);
  const extraPlan=optionalCost(item,allEffects.length,source);
  const errors=[...costPlan.errors,...extraPlan.errors];
  if(errors.length)return blocked(errors);
  const extras=await chooseReinforcement(extraPlan,source);
  if(extras===null)return false;
  const enabled=new Set(extras.flatMap(x=>x.slots));
  const replaced=new Set();
  for(const e of allEffects.filter(x=>enabled.has(x.index)&&props[`mvOptionalOnly${x.index}`]==='sim')){
   if(String(props[`mvOptionalMode${e.index}`]??'somar')==='substituir'){
    const raw=String(props[`mvOptionalReplace${e.index}`]??'');const index=Number(raw);
    if(!/^\d+$/.test(raw)||index===e.index||!allEffects.some(y=>y.index===index)||props[`mvOptionalOnly${index}`]==='sim'||replaced.has(index))errors.push(`Efeito ${e.index}: substituição inválida.`);
    else replaced.add(index);
   }
  }
  const effects=allEffects.filter(e=>(props[`mvOptionalOnly${e.index}`]!=='sim'||enabled.has(e.index))&&!replaced.has(e.index));
  if(!effects.length)errors.push('Não há efeitos ativados.');
  for(const e of effects){
   if(advancedMode(item,e.index,'mvSustainCost'))errors.push(`Efeito ${e.index}: custo de sustentação no alvo externo ainda não é suportado.`);
   if(advancedMode(item,e.index,'mvTrigger'))errors.push(`Efeito ${e.index}: execução por gatilho externo ainda não suportada.`);
   try{if(!predicateCheck(props,e.index,source.system))errors.push(`Efeito ${e.index}: condição de ativação não cumprida.`);}catch(err){errors.push(err.message);}
  }
  if(errors.length)return blocked(errors);
  const status=usageStatus(source,item);if(!status.ok)return blocked([status.error??'Usos esgotados.']);
  const accepted=await confirmOriginalUse(item,source,costPlan.options,extras.flatMap(g=>g.chosen.costs));
  if(!accepted)return false;
  const costMap=new Map();
  for(const cost of accepted.costs){
   const flux=fluxById(source,cost.resource);if(!flux)return blocked(['Fluxo Extra não encontrado ou inativo.']);
   const amount=Number(cost.amount);costMap.set(flux.key,(costMap.get(flux.key)??0)+amount);
  }
  const originalResources=Object.fromEntries([...costMap.keys()].map(k=>[k,Number(source.system[k])]));
  if([...costMap.entries()].some(([key,amount])=>!Number.isFinite(amount)||amount<0||!Number.isFinite(originalResources[key])||originalResources[key]<amount))return blocked(['Recursos insuficientes. Nenhum custo foi consumido.']);
  // Gera e valida ANTES de debitar o custo. O ator de referência é o alvo.
  let entries;try{entries=planTrackedEntries({actor:target,item,effects});}catch(err){return blocked([err.message]);}
  if(entries.length!==effects.length)return blocked(['Nem todos os efeitos geraram registro de duração.']);
  const markerData=buildEffects(entries);
  const attr=buildAttributeActivationPatch(target,entries);
  const previousTracked=readTracked(target);
  const costPatch=Object.fromEntries([...costMap].map(([key,amount])=>[`system.${key}`,originalResources[key]-amount]));
  let usageTaken=null,costSaved=false,targetSaved=false,trackingSaved=false,created=[];
  try{
   // A ficha de origem é a única a pagar os custos e gastar uso.
   usageTaken=await takeUsage(source,item);if(!usageTaken.ok)throw new Error('Limite de usos atingido.');
   if(Object.keys(costPatch).length){await source.update(costPatch);costSaved=true;}
   for(const data of markerData){const made=await target.createEmbeddedDocuments('ActiveEffect',[data]);created.push(...made);}
   if(Object.keys(attr.patch).length){await target.update(attr.patch);targetSaved=true;}
   await target.setFlag(NS,'trackedDurations',[...previousTracked,...entries]);trackingSaved=true;
   if(entries.some(entry=>!readTracked(target).some(saved=>saved.id===entry.id)))throw new Error('Não foi possível persistir a duração no alvo.');
   const rows=entries.map(e=>`<div class="mv-auto-note"><b>${esc(e.name)}</b> · ${esc(e.total)} ${e.mode==='rounds'?'rodadas':'turnos'} · ${e.maintainedEffect?.condition?'Condição ativa':`${e.maintainedEffect?.delta>=0?'+':''}${esc(e.maintainedEffect?.delta)} no atributo`}</div>`).join('');
   const content=`<section class="mv-chat-effect mv-chat-automatic"><div class="mv-chat-effect-header"><strong>${esc(item.name)}</strong><small>Multiverso RPG • Efeito externo aplicado</small></div><div class="mv-chat-effect-body"><div class="mv-auto-trigger-reason"><span class="mv-auto-trigger-dot">✦</span>${esc(source.name)} → ${esc(target.name)}<span class="mv-auto-trigger-state">Aplicado</span></div><div class="mv-auto-change">${rows}</div><p class="mv-auto-status">O efeito está registrado na ficha do alvo e termina automaticamente na duração configurada.</p></div></section>`;
   // Uma única mensagem da Skill, sem segundo card de pagamento/uso.
   try{await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:source}),content});}
   catch(err){console.warn('Multiverso RPG | efeito aplicado, falha ao mostrar card',err);ui.notifications.warn('Efeito aplicado ao alvo, mas não foi possível mostrar o card. Confira a ficha.');}
   return true;
  }catch(err){
   console.error('Multiverso RPG | falha em efeito externo mantido',err);
   // Restituição completa, inclusive se alguma criação de ActiveEffect falhar.
   if(trackingSaved)try{await target.setFlag(NS,'trackedDurations',previousTracked);}catch(e){console.error('rollback duração externa',e);}
   if(targetSaved)try{await target.update(Object.fromEntries(Object.entries(attr.before).map(([key,v])=>[`system.${key}`,v])));}catch(e){console.error('rollback atributo externo',e);}
   for(const effect of created.reverse())try{await effect.delete();}catch(e){console.error('rollback marcador externo',e);}
   if(costSaved)try{await source.update(Object.fromEntries(Object.entries(originalResources).map(([key,v])=>[`system.${key}`,v])));}catch(e){console.error('rollback custo externo',e);}
   if(usageTaken?.limited)try{await restoreUsage(source,usageTaken);}catch(e){console.error('rollback uso externo',e);}
   ui.notifications.error(`A aplicação no alvo falhou: ${err.message}. Confira a ficha.`);return false;
  }
 }finally{activeExecution.delete(source.uuid);}
}
