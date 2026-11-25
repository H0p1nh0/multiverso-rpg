import {changeList,conditionFlags} from "./condition-mechanics.mjs";
// Áreas persistentes: a entrada/saída é acompanhada por token, não por rolagens
// automáticas de PV. O GM é a única autoridade sobre disparos de auras.
import {pointInsideArea,snapAreaCenter} from './area-targeting.mjs';
import {planTrackedEntries,readTracked} from './effect-tracking.mjs';
import {buildAttributeActivationPatch,endMaintainedEffect} from './maintained-attributes.mjs';
import {rollOriginalResistance} from './resistance-test.mjs';
import {manualDamageEntry,renderManualDamageRows,damageFlag} from './damage-cards.mjs';
import {fluxByName} from './extra-flux.mjs';
import {sustainCosts} from './advanced-motor.mjs';
import {planPriority,equivalentMaintained} from './effect-priority.mjs';
const NS='multiverso-rpg';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const running=new Set(),closing=new Set(),pending=new Map(),beforeMovement=new Map(),lastKnownPositions=new Map();
// Authorized map movements are tracked locally on the GM client. This avoids
// depending solely on Document update options, which can be normalized by core.
const approvedAuraMoves=new Map();
// Relocation is a document replacement, not the end of a spell. The GM
// suppresses only the deletion cleanup for the single relocated template.
const relocatingAuraTemplates=new Set();
export function protectAuraRelocation(sceneId,templateId){
 const key=`${sceneId}:${templateId}`;
 relocatingAuraTemplates.add(key);
 return ()=>relocatingAuraTemplates.delete(key);
}

const moveKey=template=>`${template?.parent?.id}:${template?.id}`;
export function approveAuraMovement(template,end){
 const key=moveKey(template);
 approvedAuraMoves.set(key,{x:Number(end.x),y:Number(end.y)});
 return ()=>approvedAuraMoves.delete(key);
}
const approvedDestination=(template,change)=>{
 const allowed=approvedAuraMoves.get(moveKey(template));
 if(!allowed)return false;
 return Math.abs(Number(change.x??template.x)-allowed.x)<.01&&Math.abs(Number(change.y??template.y)-allowed.y)<.01;
};

// Cada movimento verdadeiro recebe um identificador distinto, inclusive se o
// personagem entrar duas vezes no mesmo turno. Refreshes nunca criam IDs.
let movementSequence=0;
const movementSession=Date.now().toString(36);
const newMovementId=()=>`${movementSession}:${++movementSequence}`;
// Mesmo que o Foundry solicite uma nova atualização antes de gravar as flags,
// uma rolagem já iniciada no ciclo atual não pode ser iniciada novamente.
const claimedDamage=new Map();
// TokenDocument.width/height are measured in grid spaces; Token placeables expose
// width/height in pixels. Aura calculations always use Scene token documents.
const tokenCenter=t=>{const size=Number(t.parent?.grid?.size??canvas?.scene?.grid?.size??100);return {x:Number(t.x)+Number(t.width??1)*size/2,y:Number(t.y)+Number(t.height??1)*size/2};};
// Foundry fires preUpdateToken only on the client which started the change.
// The GM must recognize movements performed by other connected players, too.
// updateToken can also receive a still-stale TokenDocument during animation, so
// the destination MUST come from the explicit `change` coordinates.
export function movementCentersFromUpdate(doc,change={},last=null){
 const size=Number(doc.parent?.grid?.size??globalThis.canvas?.scene?.grid?.size??100);
 const center=(x,y,width=doc.width,height=doc.height)=>({x:Number(x)+Number(width??1)*size/2,y:Number(y)+Number(height??1)*size/2});
 const to=center(change.x??doc.x,change.y??doc.y,change.width??doc.width,change.height??doc.height);
 const current=center(doc.x,doc.y);
 const from=last??current;
 return {from,to,moved:('x' in change||'y' in change)&&Math.hypot(to.x-from.x,to.y-from.y)>.001};
}
function seedPositions(scene,clear=false){
 if(clear)lastKnownPositions.clear();
 for(const token of scene?.tokens?.contents??[])lastKnownPositions.set(token.uuid??token.id,tokenCenter(token));
}
export function segmentTouchesArea(start,end,area){if(!start||!end)return false;const steps=Math.min(160,Math.max(1,Math.ceil(Math.hypot(end.x-start.x,end.y-start.y)/Math.max(4,area.radius/12))));for(let i=0;i<=steps;i++){const t=i/steps;if(pointInsideArea({x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t},area))return true;}return false;}
export function ownDamageTick(combat,token){if(!combat?.started||!token?.actor)return null;const member=combat.combatant;const actor=member?.actor;if(!member)return null;const correctToken=member.tokenId?member.tokenId===token.id:((actor&&actor.uuid===token.actor.uuid)||member.actorId===token.actor.id);if(!correctToken)return null;return `${combat.id}:${combat.round}:${member.id}`;}
const combatTurns=combat=>Array.from(combat?.turns??combat?.combatants?.contents??[]);
export function casterTurnIndex(combat,data){
 const turns=combatTurns(combat);
 return turns.findIndex(c=>c.id===data.combatantId || (data.sourceActorId&&c.actor?.id===data.sourceActorId) || (data.sourceActorId&&c.actorId===data.sourceActorId));
}
export function ownTurnOrdinal(round,turn,casterIndex){
 return Number(round)-(Number(turn)<casterIndex?1:0);
}
function auraOwnTurnCount(combat,data){
 const index=casterTurnIndex(combat,data);if(index<0)return null;
 if(data.duration==='rounds'){
  const now=Number(combat.round),last=Number(data.lastCountedRound??data.createdRound);
  return {now,last,elapsed:Math.max(0,now-last),index};
 }
 const now=ownTurnOrdinal(combat.round,combat.turn,index);
 const created=ownTurnOrdinal(data.createdRound,data.createdTurn,index);
 const last=Number.isFinite(Number(data.lastOwnOrdinal))&&data.lastOwnOrdinal!==null?Number(data.lastOwnOrdinal):created;
 return {now,last,elapsed:Math.max(0,now-last),index};
}
// Visual refinement is client-side; the area remains a native measured template.
// Foundry creates a separate grid-highlighting layer, which is the blocky orange
// overlay in screenshots. Hide *only* auras' grid layers, not other templates.
export function softenAuraTemplate(template){
 const doc=template?.document??template;const data=doc?.getFlag?.(NS,'persistentArea');
 if(!data||doc?.parent?.id!==canvas?.scene?.id)return false;
 const view=canvas?.templates?.get?.(doc.id)??canvas?.templates?.placeables?.find?.(t=>t.document?.id===doc.id)??(template?.highlightId?template:null);
 const names=[view?.highlightId,`MeasuredTemplate.${doc.id}`,`MeasuredTemplate.${view?.id}`].filter(Boolean);
 // v14 can redraw highlights after refresh. Disable only the area's own
 // highlightGrid routine and clear its existing geometry. Keep the exact
 // measured circle outline/region itself selectable on the canvas.
 if(view&&typeof view.highlightGrid==='function'&&!view._mvAuraHighlightSuppressed){
   view._mvAuraHighlightSuppressed=true;view.highlightGrid=()=>{for(const layerHost of [canvas?.interface?.grid,canvas?.grid]){for(const name of names){layerHost?.clearHighlightLayer?.(name);const layer=layerHost?.getHighlightLayer?.(name);if(layer)layer.visible=false;}}};
 }
 for(const grid of [canvas?.interface?.grid,canvas?.grid]){
  for(const name of names){grid?.clearHighlightLayer?.(name);const layer=grid?.getHighlightLayer?.(name)??grid?.highlightLayers?.[name];if(layer)layer.visible=false;}
 }
 return true;
}
const refreshAuraVisual=doc=>{softenAuraTemplate(doc);if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>softenAuraTemplate(doc));};
const clean=s=>JSON.parse(JSON.stringify(s));
export const areaMatchesDisposition=(disposition,mode='all')=>mode==='all'||Number(disposition)===(mode==='friendly'?1:-1);
export const eligibleAuraToken=(token,data)=>{const own=token?.actor&&(token.actor.uuid===data.sourceUuid||token.actor.id===data.sourceActorId);return own?data.includeCaster!==false:areaMatchesDisposition(token?.disposition??token?.document?.disposition,data.targetMode??'all');};
// Histórico por Actor UUID: sair/reentrar com outro token não concede o mesmo
// Inspirado uma segunda vez. O registro só é apagado com a conjuração.
export const mayApplyAuraCondition=(actorUuid,history=[],mode='once',active=false)=>{
 if(active)return false;
 if(mode==='renew')return true;
 if(mode==='after_expire')return true;
 return !history.includes(actorUuid);
};

export function shouldPersistArea(effects){return effects.some(e=>['turns','rounds','sustained'].includes(e.duration?.kind)&&e.cadence!=='once');}
export function validatePersistentArea(effects,source){
 if(game.combat?.started&&!game.combat.combatants?.some(c=>c.actor?.id===source.id))return 'Em combate, o conjurador precisa participar da iniciativa para manter esta área.';
 if(!game.combat?.started&&effects.some(e=>e.duration?.kind!=='sustained'&&e.duration?.kind!=='scene'))return 'Fora do combate, use duração Sustentação ou Cena para a área.';
 const duration=effects.filter(e=>e.cadence!=='once').map(e=>e.duration).filter(Boolean);
 if(!duration.length||duration.some(d=>!['turns','rounds','sustained'].includes(d.kind)))return 'Configure duração de todos os efeitos da aura em turnos, rodadas ou sustentação.';
 if(new Set(duration.map(d=>`${d.kind}:${d.kind==='sustained'?'sem limite':d.amount}`)).size>1)return 'Os efeitos da mesma aura devem ter uma duração em comum.';
 if(effects.some(e=>e.cadence==='once'))return 'Para manter uma área, configure os efeitos externos como Manter ou Repetir. Efeitos instantâneos externos misturados ainda não são suportados.';
 if(effects.some(e=>e.cadence==='periodic'?!['dano','recurso','cura'].includes(e.type):!['atributo','bonus','penalidade','teste','condicao','deslocamento','defesa','resistencia','vulnerabilidade','imunidade'].includes(e.type)))return 'Aura: use bônus, condição ou proteção mantida, ou Dano/Fluxo periódico.';
 if(effects.some(e=>e.resistanceActive||e.dynamicValue))return 'Auras com resistência ou escolha dinâmica por entrada ainda não são suportadas. Use efeito direto.';
 if(effects.some(e=>e.chainMode))return 'Encadeamento de aura ainda não é permitido.';
 return null;
}
export function persistentTemplateData({area,scene,item,source,castId,effects,initialTargets,createdLinks,sharedSustain=null}){
 const d=area.definition,combat=game.combat;
 const member=combat?.combatant;
 const casterId=combat?.combatants?.find?.(c=>c.actor?.id===source.id || c.actorId===source.id)?.id;
 const currentData={combatantId:casterId,sourceActorId:source.id};
 const casterIndex=casterTurnIndex(combat,currentData);
 const ordinal=casterIndex>=0?ownTurnOrdinal(combat.round,combat.turn,casterIndex):null;
 // If cast before the caster's own turn, don't count its first arrival.
 const seen=casterIndex>=0?Number(combat.turn)>=casterIndex:member?.actor?.id===source.id;
 const center=snapAreaCenter(area.center,scene);
 const cleanArea={...area,center};
 const modes=[...new Set(effects.map(e=>String(item.system?.props?.[`mvAreaTargetMode${e.index}`]??'all')).filter(v=>v!=='all'))];
 const reapply=[...new Set(effects.map(e=>String(item.system?.props?.[`mvAreaReapplyMode${e.index}`]??'once')))];
 const moveLimits=effects.map(e=>String(item.system?.props?.[`mvAreaMoveMeters${e.index}`]??'').trim()).filter(Boolean).map(Number).filter(n=>Number.isFinite(n)&&n>=0);
 const maxMove=moveLimits.length?Math.min(...moveLimits):-1;
 const targetMode=modes.length===1?modes[0]:'all';
 const reapplyMode=reapply.length===1?reapply[0]:'once';
 const includeCaster=!effects.some(e=>String(item.system?.props?.[`mvAreaIncludeCaster${e.index}`]??'yes')==='no');
 const inCombat=!!combat?.started;

 return {t:area.type,x:center.x,y:center.y,direction:area.direction??0,distance:sceneDistanceSafe(d,scene),angle:area.type==='cone'?area.angle:undefined,width:area.type==='ray'?area.width/(Number(scene.grid.size)/Number(scene.grid.distance)):undefined,
  fillColor:'#53426d',borderColor:'#e8be72',flags:{[NS]:{persistentArea:{castId,sourceUuid:source.uuid,sourceActorId:source.id,itemUuid:item.uuid,sceneId:scene.id,combatId:inCombat?combat.id:null,combatantId:casterId,remaining:effects[0].duration.kind==='sustained'?null:effects[0].duration.amount,duration:effects[0].duration.kind,lastDamageTicks:{},lastDamageEntries:{},conditionRecipients:createdLinks.filter(link=>link.ids?.length&&effects.some(e=>e.type==='condicao'&&e.cadence==='maintained')).map(link=>link.actorUuid),targetMode,reapplyMode,includeCaster,maxMoveMeters:maxMove,lastMoveRound:inCombat?combat.round:0,roundStartPosition:center,sharedSustain,createdRound:inCombat?combat.round:0,createdTurn:inCombat?combat.turn:0,createdCombatantId:member?.id??null,firstOwnStartSeen:effects[0].duration.kind==='rounds'?true:seen,lastOwnOrdinal:ordinal,lastCountedRound:inCombat?combat.round:0,area:{type:cleanArea.type,center:cleanArea.center,radius:cleanArea.radius,direction:cleanArea.direction,angle:cleanArea.angle,width:cleanArea.width},effects:clean(effects.map(e=>({...e,chainMode:null,sustainCost:null}))),insideTokenIds:initialTargets.map(t=>t.id),maxTargets:Math.min(...effects.map(e=>Number(item.system?.props?.[`efeito${item.type}qtdalvos${e.index===1?'':e.index}`])).filter(x=>Number.isInteger(x)&&x>0),25),links:createdLinks}}}};
}
function sceneDistanceSafe(d,scene){const units=String(scene?.grid?.units??'m').toLowerCase(),feet=units.includes('ft')||units.includes('pés')||units.includes('pes');return d.value*(d.unit==='m'&&feet?3.280839895:d.unit==='ft'&&!feet?1/3.280839895:1);}
const trackedIds=a=>readTracked(a).map(e=>e.id);
async function cleanupLinks(links){
 for(const link of links??[]){
  let actor;try{actor=await fromUuid(link.actorUuid);}catch(_){}if(!actor)continue;
  const old=readTracked(actor),ending=old.filter(e=>(link.ids??[]).includes(e.id));
  if(!ending.length)continue;
  for(const entry of ending)if(entry.maintainedEffect)await endMaintainedEffect(actor,entry);
  await actor.setFlag(NS,'trackedDurations',old.filter(e=>!ending.some(x=>x.id===e.id)));
 }
}
async function cleanupCasterControl(data){
 let source;try{source=await fromUuid(data.sourceUuid);}catch(_){}if(!source)return;
 const nsEntries=readTracked(source),owned=nsEntries.filter(e=>e.auraController&&e.areaOwner===data.castId);
 // Remove the marker even if its linked tracked entry was manually removed.
 const markers=Array.from(source.effects??[]).filter(e=>e.getFlag(NS,'persistentAreaCastId')===data.castId);
 for(const marker of markers)await marker.delete();
 if(owned.length)await source.setFlag(NS,'trackedDurations',nsEntries.filter(e=>!owned.some(x=>x.id===e.id)));
}
export async function finishPersistentArea(template,{remove=true}={}){
 if(!game.user?.isGM||!template)return;
 const data=template.getFlag(NS,'persistentArea');if(!data||closing.has(template.uuid))return;
 closing.add(template.uuid);claimedDamage.delete(template.uuid);pending.delete(template.uuid);
 try{
  await cleanupLinks(data.links);
  await cleanupCasterControl(data);
  if(remove&&template.parent?.getEmbeddedDocument?.('MeasuredTemplate',template.id))await template.delete();
 }catch(error){console.error('Multiverso | encerramento de aura',error);ui.notifications.error(`Não foi possível encerrar a aura ${template.id}; confira efeitos ativos.`);}
 finally{closing.delete(template.uuid);}
}
function currentInside(template,data,movement=null){
 const result=[];
 for(const token of template.parent?.tokens?.contents??[]){
  if(!token.actor||!eligibleAuraToken(token,data))continue;
  const center=movement?.tokenId===token.id?movement.to:tokenCenter(token);
  if(pointInsideArea(center,data.area))result.push(token);
 }
 return result;
}
// Aplicar prioridades também nas ENTRADAS POSTERIORES. Na ativação inicial,
// a rota external-advanced já chama planPriority; os dois caminhos devem
// preservar a mesma regra sem recadastrar o mesmo bônus indefinidamente.
export function planAuraEntryPriority(item,effects,oldTracked){
 const mode=e=>String(item.system?.props?.[`efeito${item.type}acumulo${e.index===1?'':e.index}`]??'').trim()||'acumula';
 // "Não acumula" ignora apenas o efeito já representado. Não impede o alvo
 // de receber os outros efeitos não conflitantes da mesma aura.
 const eligible=effects.filter(e=>mode(e)!=='nao'||!oldTracked.some(old=>equivalentMaintained(old,e)));
 return planPriority({oldTracked,steps:eligible.map(effect=>({effect})),getMode:mode});
}
async function enterArea(data,token){
 const actor=token.actor,item=await fromUuid(data.itemUuid);
 if(!item||!actor||!actor.isOwner)throw Error('Aura sem Skill ou permissão do ator.');
 const old=readTracked(actor),effects=data.effects,tracked=effects.filter(e=>e.cadence==='maintained');
 const history=data.conditionRecipients??[];
 const activeSameCast=old.some(e=>e.areaOwner===data.castId&&e.maintainedEffect?.condition);
 const canCondition=mayApplyAuraCondition(actor.uuid,history,data.reapplyMode,activeSameCast);
 const eligibleTracked=tracked.filter(e=>e.type!=='condicao'||canCondition);
 const priority=planAuraEntryPriority(item,eligibleTracked,old);
 const entries=planTrackedEntries({actor,item,effects:priority.included.map(s=>s.effect),externalSustainOwner:data.sharedSustain?data.sourceUuid:null});
 for(const entry of entries){
  entry.areaOwner=data.castId;
  // Entrar com aura próxima do fim nunca reabre sua duração original.
  if(data.duration!=='sustained')entry.remaining=Math.min(Number(entry.remaining),Number(data.remaining));
 }
 const replaced=priority.removals.map(entry=>{
  const marker=[...(actor.effects??[])].find(x=>x.getFlag(NS,'trackingId')===entry.id);
  if(!marker)throw Error(`${actor.name}: o efeito substituído já não tem marcador ativo.`);
  return {entry,marker:marker.toObject()};
 });
 const changedKeys=new Set([...entries,...replaced.map(x=>x.entry)].filter(x=>x.maintainedEffect?.storedOnSheet).map(x=>x.maintainedEffect.attributeKey));
 const maxToCurrent={pv_max:'pv_atual',pm_max:'pm_atual',sta_max:'sta_atual',san_max:'san_atual',fluxoextramax:'fluxoextraatual'};
 for(const key of [...changedKeys])if(maxToCurrent[key])changedKeys.add(maxToCurrent[key]);
 const previous=Object.fromEntries([...changedKeys].map(key=>[`system.${key}`,Number(actor._source?.system?.[key]??actor.system?.[key])]));
 if(Object.values(previous).some(x=>!Number.isFinite(x)))throw Error('Atributo anterior inválido ao entrar na aura.');
 const created=[],removed=[];let flagsSaved=false,valuesSaved=false;
 try{
  for(const item of replaced){await endMaintainedEffect(actor,item.entry);removed.push(item);}
  for(const entry of entries.filter(e=>e.maintainedEffect)){
   const effect=entry.maintainedEffect;
   const marker=effect.protection?{name:`Proteção: ${entry.name}`,disabled:false,changes:[],flags:{[NS]:{trackingId:entry.id,sourceUuid:data.sourceUuid,protecaoDano:{...effect.protection}}}}:effect.condition?{name:effect.name||entry.name,disabled:false,changes:changeList(effect.mechanics??[]),flags:{[NS]:{trackingId:entry.id,sourceUuid:data.sourceUuid,isCondition:true,...conditionFlags(effect.mechanics??[]),blocksAction:(effect.mechanics??[]).some(x=>x.blocksAction),blockedActionTypes:(effect.mechanics??[]).filter(x=>x.blocksAction).flatMap(x=>x.blockedActionTypes??['todas'])}}}:{name:`${entry.name} (${entry.source})`,disabled:false,changes:[],flags:{[NS]:{trackingId:entry.id,sourceUuid:data.sourceUuid,storedAttributeDelta:{key:effect.attributeKey,delta:effect.delta}}}};
   created.push(...await actor.createEmbeddedDocuments('ActiveEffect',[marker]));
  }
  const attrs=buildAttributeActivationPatch(actor,entries);
  if(Object.keys(attrs.patch).length){await actor.update(attrs.patch);valuesSaved=true;}
  if(entries.length||removed.length){
   const removedIds=new Set(removed.map(x=>x.entry.id));
   await actor.setFlag(NS,'trackedDurations',[...old.filter(x=>!removedIds.has(x.id)),...entries]);flagsSaved=true;
  }
  return {actorUuid:actor.uuid,tokenId:token.id,ids:entries.map(e=>e.id),conditionGranted:entries.some(e=>e.maintainedEffect?.condition)};
 }catch(error){
  for(const marker of created.reverse())try{await marker.delete();}catch(e){console.error('Multiverso | rollback do marcador de aura',e);}
  if(removed.length||valuesSaved)try{if(Object.keys(previous).length)await actor.update(previous);}catch(e){console.error('Multiverso | rollback dos atributos da aura',e);}
  for(const record of removed)try{await actor.createEmbeddedDocuments('ActiveEffect',[record.marker]);}catch(e){console.error('Multiverso | rollback de proteção/atributo substituído',e);}
  if(removed.length||flagsSaved)try{await actor.setFlag(NS,'trackedDurations',old);}catch(e){console.error('Multiverso | rollback da duração da aura',e);}
  throw error;
 }
}

function reserveDamage(template,token,tick,stored){
 const id=template.uuid,claimed=claimedDamage.get(id)??new Map();
 if(stored?.[token.id]===tick||claimed.get(token.id)===tick)return false;
 claimed.set(token.id,tick);claimedDamage.set(id,claimed);return true;
}
function releaseDamage(template,token,tick){
 const claimed=claimedDamage.get(template.uuid);if(claimed?.get(token.id)===tick)claimed.delete(token.id);
}
// Turno próprio: uma aplicação no começo do turno afetado; sem refreshes.
export function shouldTriggerAuraDamage({turnStart=false,ownTick=null,previousTick=null}={}){
 return !!ownTick&&turnStart&&previousTick!==ownTick;
}
// Entrada: o centro veio de FORA e chegou dentro OU atravessou a área.
// Sair, circular no interior ou receber refresh não constitui nova entrada.
export function shouldTriggerAuraEntry({from=null,to=null,area=null}={}){
 return !!from&&!!to&&!!area&&!pointInsideArea(from,area)
  &&(pointInsideArea(to,area)||segmentTouchesArea(from,to,area));
}
export async function rollAuraDamageOnce(template,token,data,tick,reason='turno'){
 const periodic=(data.effects??[]).filter(e=>e.type==='dano'||(reason!=='entrada'&&e.cadence==='periodic'&&['cura','recurso'].includes(e.type)));
 if(!tick||!periodic.length)return false;
 if(!reserveDamage(template,token,tick,data.lastDamageTicks))return false;
 try{
  const actor=token.actor,item=await fromUuid(data.itemUuid);
  if(!actor||!item||!actor.isOwner)throw Error('Aura sem Skill ou permissão do personagem.');
  const manual=[],rolls=[],patch={},notes=[];
  for(const effect of periodic){
   let amount=Number(effect.value??0),roll=null;
   if(effect.diceFormula){roll=new Roll(effect.diceFormula,actor.getRollData?.()??{});await roll.evaluate();amount=Number(roll.total);rolls.push(roll);}
   if(!Number.isFinite(amount)||amount<0)throw Error('Valor de efeito periódico inválido.');
   if(effect.type==='dano'){
    manual.push(manualDamageEntry({actor,effect:`${item.name} • Aura`,amount,formula:effect.diceFormula||`${amount} (fixo)`,damageType:effect.chosenDamageType||'',roll,source:item.name,index:effect.index}));
    continue;
   }
   const resource=fluxByName(actor,effect.type==='cura'?'pv':effect.affected);
   if(!resource)throw Error('Fluxo de aura inválido no personagem.');
   const before=Number(patch[resource.key]??actor.system[resource.key]);const max=Number(actor.system[resource.max]);
   if(!Number.isFinite(before)||!Number.isFinite(max))throw Error('Valor ou máximo do Fluxo inválido.');
   const delta=amount*(effect.type==='recurso'&&effect.op==='subtrair'?-1:1);
   const after=Math.max(0,Math.min(max,before+delta));patch[resource.key]=after;
   // Usar o MESMO HTML de Roll que o Foundry usa em seus cards padrão.
   // O valor já foi aplicado à ficha; o clique direito não pode aplicar cura dupla.
   const detail=roll?`<div class="mv-damage-roll-native mv-aura-auto-applied" data-mv-aura-heal-auto="true" title="Rolagem nativa. O Fluxo já foi atualizado automaticamente.">${await roll.render()}</div>`:'';
   notes.push(`<p>${esc(resource.label)}: ${esc(before)} → ${esc(after)}</p>${detail}`);
  }
  const caption=reason==='conjuracao'?'Ativação da aura':reason==='entrada'?'Entrada na área':'Turno do afetado';
  const before=Object.fromEntries(Object.keys(patch).map(k=>[k,Number(actor.system[k])]));
  let saved=false;
  try{
   if(Object.keys(patch).length){await actor.update(Object.fromEntries(Object.entries(patch).map(([k,v])=>[`system.${k}`,v])));saved=true;}
   await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<section class="mv-chat-effect"><div class="mv-chat-effect-header"><strong>${esc(item.name)} • Aura</strong><small>${esc(actor.name)} • ${caption}</small></div><div class="mv-chat-effect-body">${notes.join('')}${await renderManualDamageRows(manual)}<small>Aplica na conjuração, a cada entrada real e no início do turno próprio. Dano em PV exclusivamente por botão direito.</small></div></section>`,rolls,flags:{[NS]:damageFlag(manual)}});
  }catch(error){if(saved)try{await actor.update(Object.fromEntries(Object.entries(before).map(([k,v])=>[`system.${k}`,v])));}catch(revert){console.error('Aura | falha no rollback',revert);}throw error;}
  return true;
 }catch(err){releaseDamage(template,token,tick);throw err;}
}

// A ativação atinge IMEDIATAMENTE todos que já estão dentro da área.
// Não é um evento de movimento: é uma operação explícita, executada uma vez
// após a Skill ter sido registrada e os custos contabilizados.
export async function rollInitialAuraDamage(template,targets){
 if(!game.user?.isGM||!template)return;
 const data=template.getFlag(NS,'persistentArea');
 if(!data?.effects?.some(e=>e.type==='dano'||(e.cadence==='periodic'&&['recurso','cura'].includes(e.type))))return;
 const ticks={...(data.lastDamageTicks??{})};let changed=false;
 for(const target of targets??[]){
  const token=target?.document??target;
  if(!token?.id||!token.actor||!pointInsideArea(tokenCenter(token),data.area))continue;
  const tick=ownDamageTick(game.combat,token)??`conjuracao:${data.castId}`;
  if(ticks[token.id]===tick)continue;
  try{if(await rollAuraDamageOnce(template,token,{...data,lastDamageTicks:ticks},tick,'conjuracao')){ticks[token.id]=tick;changed=true;}}
  catch(err){console.error('Multiverso | rolagem inicial de aura',err);ui.notifications.error(`A aura foi criada, mas não foi possível publicar o dano inicial de ${token.actor.name}.`);}
 }
 if(changed){
  // Entrada/saída e contagem de duração podem ser atualizadas enquanto o chat
  // publica os dados. Nunca sobrescrever esses campos com um snapshot antigo.
  const current=template.getFlag(NS,'persistentArea')??data;
  await template.setFlag(NS,'persistentArea',{...current,lastDamageTicks:{...(current.lastDamageTicks??{}),...ticks}});
 }
}

export async function reconcilePersistentArea(template,{movement=null,turnStart=false}={}){
 if(!game.user?.isGM||!template)return;
 const uuid=template.uuid;
 if(running.has(uuid)){
  const old=pending.get(uuid)??{movements:[],turnStart:false};
  if(movement&&!old.movements.some(m=>m.id===movement.id))old.movements.push(movement);
  old.turnStart ||= turnStart;
  pending.set(uuid,old);
  return;
 }
 if(closing.has(uuid))return;
 const data=template.getFlag(NS,'persistentArea');if(!data||data.sceneId!==canvas?.scene?.id)return;
 running.add(uuid);
 try{
  // Use the explicit destination before TokenDocument animation has finished.
  const tokens=currentInside(template,data,movement),inside=new Set(tokens.map(t=>t.id));
  const previous=new Set(data.insideTokenIds??[]),leave=[...previous].filter(id=>!inside.has(id));
  const links=[...(data.links??[])];const damageTicks={...(data.lastDamageTicks??{})};
  const conditionRecipients=new Set(data.conditionRecipients??[]);
  const entryTicks={...(data.lastDamageEntries??{})};
  for(const id of leave){const outgoing=links.filter(l=>l.tokenId===id);if(outgoing.length)await cleanupLinks(outgoing);for(let i=links.length-1;i>=0;i--)if(links[i].tokenId===id)links.splice(i,1);}
  const kept=new Set([...previous].filter(id=>inside.has(id)));
  for(const token of tokens){if(kept.has(token.id))continue;if(kept.size>=Number(data.maxTargets??25))continue;try{const link=await enterArea(data,token);links.push(link);kept.add(token.id);if(link.conditionGranted)conditionRecipients.add(link.actorUuid);}catch(e){console.error('Multiverso | entrada em aura',e);ui.notifications.error(`Aura: ${token.actor?.name??'Alvo'} — ${e.message}`);}}
  // Dano pode ocorrer APENAS em eventos explícitos: conjuração, início de turno
  // próprio ou uma entrada real (inclusive reentrada no mesmo turno). Refresh,
  // saída e movimento que começa dentro da área NÃO rolam dados.
  const active=game.combat;
  if(turnStart){
   for(const token of tokens){
    if(!kept.has(token.id))continue;
    const tick=ownDamageTick(active,token);
    if(!shouldTriggerAuraDamage({turnStart:true,ownTick:tick,previousTick:damageTicks[token.id]}))continue;
    try{if(await rollAuraDamageOnce(template,token,{...data,lastDamageTicks:damageTicks},tick))damageTicks[token.id]=tick;}
    catch(e){console.error('Multiverso | início do turno em aura',e);ui.notifications.error(`Dano da aura não registrado para ${token.actor?.name}.`);}
   }
  }
  if(movement&&shouldTriggerAuraEntry({from:movement.from,to:movement.to,area:data.area})){
   const token=template.parent?.tokens?.get?.(movement.tokenId);
   const validTarget=!!token?.actor;
   const validDisposition=eligibleAuraToken(token,data);
   // Se o token terminou fora, cruzou a área no trajeto: conta como entrada.
   // Em ambos os casos, respeite o limite de alvos se a área estiver cheia.
   const allowed=inside.has(token?.id)?kept.has(token.id):kept.size<Number(data.maxTargets??25);
   if(validTarget&&validDisposition&&allowed&&entryTicks[token.id]!==movement.id){
    const tick=`entrada:${data.castId}:${movement.id}`;
    try{
     if(await rollAuraDamageOnce(template,token,{...data,lastDamageTicks:{}},tick,'entrada'))
      entryTicks[token.id]=movement.id;
    }catch(e){console.error('Multiverso | entrada em aura',e);ui.notifications.error(`Dano da aura não registrado para ${token.actor?.name}.`);}
   }
  }
  // TokenDocument IDs, not actor IDs, are tracked. Two placed tokens sharing
  // a world actor must not create duplicate applied attribute entries.
  const nextIds=[...kept];
  // Refreshes happen even without movement. Avoid a document update when
  // neither occupancy, links nor per-turn damage has changed.
  const current=template.getFlag(NS,'persistentArea')??data;
  const mergedTicks={...(current.lastDamageTicks??{}),...damageTicks};
  const mergedEntries={...(current.lastDamageEntries??{}),...entryTicks};
  const unchanged=conditionRecipients.size===(current.conditionRecipients??[]).length && [...conditionRecipients].every(x=>(current.conditionRecipients??[]).includes(x)) && nextIds.length===(current.insideTokenIds??[]).length
   &&nextIds.every(id=>(current.insideTokenIds??[]).includes(id))
   &&JSON.stringify(links)===JSON.stringify(current.links??[])
   &&JSON.stringify(mergedTicks)===JSON.stringify(current.lastDamageTicks??{})
   &&JSON.stringify(mergedEntries)===JSON.stringify(current.lastDamageEntries??{});
  if(!unchanged)await template.setFlag(NS,'persistentArea',{...current,insideTokenIds:nextIds,links,conditionRecipients:[...conditionRecipients],lastDamageTicks:mergedTicks,lastDamageEntries:mergedEntries});
 }finally{
  running.delete(uuid);
  const queued=pending.get(uuid);pending.delete(uuid);
  if(queued&&!closing.has(uuid))queueMicrotask(()=>{
   // Não perder duas entradas rápidas por sobrescrever um único movement.
   void (async()=>{
    if(queued.turnStart)await reconcilePersistentArea(template,{turnStart:true});
    for(const event of queued.movements)await reconcilePersistentArea(template,{movement:event});
    if(!queued.turnStart&&!queued.movements.length)await reconcilePersistentArea(template);
   })().catch(e=>console.error('Multiverso | fila de movimentações da aura',e));
  });
 }
}
async function syncCasterCounter(data,remaining){
 let actor;try{actor=await fromUuid(data.sourceUuid);}catch(_){}if(!actor)return;
 const entries=readTracked(actor);
 if(entries.some(e=>e.auraController&&e.areaOwner===data.castId&&Number(e.remaining)!==remaining))
  await actor.setFlag(NS,'trackedDurations',entries.map(e=>e.auraController&&e.areaOwner===data.castId?{...e,remaining}:e));
}
async function syncAuraLinkedCounters(data,remaining){
 const grouped=new Map();
 for(const link of data.links??[]){
  if(!link.actorUuid||!(link.ids??[]).length)continue;
  if(!grouped.has(link.actorUuid))grouped.set(link.actorUuid,new Set());
  for(const id of link.ids)grouped.get(link.actorUuid).add(id);
 }
 for(const [uuid,ids] of grouped){
  const actor=await fromUuid(uuid);if(!actor)continue;
  const entries=readTracked(actor);
  if(entries.some(e=>ids.has(e.id)&&Number(e.remaining)!==remaining)){
   await actor.setFlag(NS,'trackedDurations',entries.map(e=>ids.has(e.id)?{...e,remaining:Math.min(Number(e.remaining),remaining)}:e));
  }
 }
}
export async function updatePersistentAreaTurn(combat){
 if(!game.user?.isGM||!combat?.started)return;
 for(const scene of game.scenes??[]){for(const t of [...(scene.templates?.contents??[])]){
  const data=t.getFlag(NS,'persistentArea');if(!data||data.combatId!==combat.id)continue;
  const state=auraOwnTurnCount(combat,data);
  if(!state){await finishPersistentArea(t);continue;} // conjurador saiu do combate
  if(state.elapsed<=0)continue;
  // Use chronological round/turn position, not member.actor identity. Foundry
  // can have a Token actor with a different UUID for the same combatant.
  let elapsed=state.elapsed,seen=!!data.firstOwnStartSeen;
  if(!seen){seen=true;elapsed-=1;}
  if(data.duration!=='sustained'&&elapsed>=Number(data.remaining)){await finishPersistentArea(t);continue;}
  const remaining=data.duration==='sustained'?null:Number(data.remaining)-Math.max(0,elapsed);
  if(data.sharedSustain){
   const caster=await fromUuid(data.sourceUuid);const costs=caster?sustainCosts(data.sharedSustain,caster):[];
   const totals=new Map();for(const c of costs)totals.set(c.key,(totals.get(c.key)??0)+Number(c.amount));
   if(!caster||!costs.length||costs.some(c=>!c.key||!Number.isSafeInteger(c.amount)||c.amount<=0)||[...totals].some(([key,value])=>!Number.isFinite(Number(caster.system[key]))||Number(caster.system[key])<value)){
    await finishPersistentArea(t);continue;
   }
   const old=Object.fromEntries([...totals.keys()].map(key=>[key,Number(caster.system[key])]));
   try{await caster.update(Object.fromEntries([...totals].map(([key,value])=>[`system.${key}`,old[key]-value])));}
   catch(error){console.error('Falha no pagamento da sustentação da aura',error);ui.notifications.error('Falha na sustentação da aura; duração não avançada.');continue;}
  }
  await t.setFlag(NS,'persistentArea',{...data,firstOwnStartSeen:seen,lastOwnOrdinal:state.now,lastCountedRound:combat.round,remaining});
  if(data.duration!=='sustained'){await syncAuraLinkedCounters(data,remaining);await syncCasterCounter(data,remaining);}
 }}
}
const safelyReconcile=(template,options={})=>void reconcilePersistentArea(template,options).catch(error=>{console.error('Multiverso | detectar entrada/saída da aura',error);ui.notifications.error('Falha ao atualizar a aura. Confira as fichas antes de continuar.');});
export function registerPersistentAreas(){
 Hooks.on('canvasReady',()=>{
  seedPositions(canvas?.scene,true);
  for(const template of canvas?.scene?.templates?.contents??[])if(template.getFlag(NS,'persistentArea')){
   refreshAuraVisual(template);
   if(game.user?.isGM)safelyReconcile(template);
  }
 });
 Hooks.once('ready',()=>seedPositions(canvas?.scene));
 for(const event of ['drawMeasuredTemplate','refreshMeasuredTemplate','createMeasuredTemplate'])Hooks.on(event,object=>refreshAuraVisual(object));
 const refreshAll=(scene,{movement=null,turnStart=false}={})=>{
  if(!game.user?.isGM||scene?.id!==canvas?.scene?.id)return;
  for(const template of scene.templates?.contents??[])if(template.getFlag(NS,'persistentArea'))safelyReconcile(template,{movement,turnStart});
 };
 Hooks.on('preUpdateToken',(doc,change)=>{
  if('x' in (change??{})||'y' in (change??{}))beforeMovement.set(doc.uuid??doc.id,tokenCenter(doc));
 });
 Hooks.on('updateToken',(doc,change)=>{
  if(!('x' in change||'y' in change||'hidden' in change||'width' in change||'height' in change))return;
  const key=doc.uuid??doc.id;
  const last=beforeMovement.get(key)??lastKnownPositions.get(key)??null;
  const position=movementCentersFromUpdate(doc,change,last);
  // Cache the destination even on non-GM clients. Future movements don't
  // depend on the pre-update hook, which remote clients cannot trigger here.
  lastKnownPositions.set(key,position.to);
  beforeMovement.delete(key);
  refreshAll(doc.parent,{movement:position.moved?{id:newMovementId(),tokenId:doc.id,from:position.from,to:position.to}:null});
 });
 // Refreshing a token is NOT a movement. It can happen many times during
 // animations and would reconcile a stale document between entry and exit.
 Hooks.on('createToken',doc=>{lastKnownPositions.set(doc.uuid??doc.id,tokenCenter(doc));refreshAll(doc.parent);});
 Hooks.on('deleteToken',doc=>{lastKnownPositions.delete(doc.uuid??doc.id);beforeMovement.delete(doc.uuid??doc.id);refreshAll(doc.parent);});
 Hooks.on('preUpdateMeasuredTemplate',(template,changes,options,userId)=>{
  const data=template.getFlag(NS,'persistentArea');
  if(!data||!('x' in (changes??{})||'y' in (changes??{})))return;
  const max=Number(data.maxMoveMeters??0);
  const scene=template.parent;
  // The command has already verified ownership, grid snapping and max range.
  // Never cancel its document update with a second, stale round check.
  if(approvedDestination(template,changes))return;
  // O comando Mover Área foi validado antes de chamar a atualização. Conferimos
  // o mesmo destino aqui para não submetê-lo a duas verificações conflitantes.
  const verified=options?.mvAreaVerifiedMove;
  if(verified && game.user?.isGM &&
      verified.sceneId===scene?.id && verified.templateId===template.id &&
      Number(verified.to?.x)===Number(changes.x??template.x) &&
      Number(verified.to?.y)===Number(changes.y??template.y)){
   const anchor=verified.anchor;
   const meters=Math.hypot(Number(changes.x??template.x)-anchor.x,Number(changes.y??template.y)-anchor.y)*Number(scene.grid.distance)/Number(scene.grid.size);
   if(Number.isFinite(meters)&&meters<=max+.001)return;
   ui.notifications.warn(`A área pode se mover no máximo ${max} m por rodada.`);
   return false;
  }
  if(!game.combat?.started)return;
  if(max<0)return;
  if(max===0){ui.notifications.warn('Esta área não permite deslocamento.');return false;}
  const round=Number(game.combat?.round??0);
  const anchor=Number(data.lastMoveRound)===round?data.roundStartPosition:{x:template.x,y:template.y};
  if(!anchor||!Number.isFinite(Number(anchor.x))||!Number.isFinite(Number(anchor.y)))return;
  const end={x:Number(changes.x??template.x),y:Number(changes.y??template.y)};
  const meters=Math.hypot(end.x-anchor.x,end.y-anchor.y)*Number(scene.grid.distance)/Number(scene.grid.size);
  if(meters>max+0.001){ui.notifications.warn(`A área pode se mover no máximo ${max} m por rodada.`);return false;}
 });
 Hooks.on('updateMeasuredTemplate',(template,changes)=>{
  const data=template.getFlag(NS,'persistentArea');if(!data)return;
  refreshAuraVisual(template);
  if(!game.user?.isGM||!['x','y','direction','distance','width','angle'].some(k=>k in (changes??{})))return;
  const grid=template.parent?.grid;if(!grid)return;
  const approved=approvedAuraMoves.get(moveKey(template));
  const snap=approved?{x:Number(template.x),y:Number(template.y)}:snapAreaCenter({x:Number(template.x),y:Number(template.y)},template.parent);
  if((Math.abs(snap.x-template.x)>0.01||Math.abs(snap.y-template.y)>0.01)&&typeof template.update==='function'){
   void template.update({x:snap.x,y:snap.y}).catch(e=>console.error('Multiverso | alinhar aura',e));return;
  }
  const scale=Number(grid.size)/Number(grid.distance);
  const area={...data.area,center:snap,direction:Number(template.direction??0),radius:Number(template.distance)*scale,
   width:data.area.type==='ray'?Number(template.width??1)*scale:data.area.width,angle:data.area.type==='cone'?Number(template.angle??90):data.area.angle};
  void template.setFlag(NS,'persistentArea',{...data,area,lastMoveRound:Number(game.combat?.round??0),roundStartPosition:Number(data.lastMoveRound)===Number(game.combat?.round??0)?data.roundStartPosition:data.area.center}).then(()=>reconcilePersistentArea(template)).catch(e=>console.error('Multiverso | mover aura',e));
 });
 Hooks.on('deleteMeasuredTemplate',template=>{if(relocatingAuraTemplates.has(moveKey(template)))return;if(game.user?.isGM&&template.getFlag(NS,'persistentArea'))void finishPersistentArea(template,{remove:false});});
 // A conjuror who owns their Actor may delete their own aura marker even if
 // only the GM can modify the scene template. The GM closes the linked area.
 Hooks.on('deleteActiveEffect',effect=>{if(!game.user?.isGM)return;const castId=effect.getFlag(NS,'persistentAreaCastId');if(!castId)return;for(const scene of game.scenes??[])for(const template of scene.templates?.contents??[])if(template.getFlag(NS,'persistentArea')?.castId===castId)void finishPersistentArea(template);});
 const handled=new Map();
 Hooks.on('updateCombat',(combat,changes)=>{
  if(!game.user?.isGM||(!('turn' in (changes??{}))&&!('round' in (changes??{}))))return;
  const tick=`${combat.round}:${combat.turn}`;
  if(handled.get(combat.id)===tick)return;handled.set(combat.id,tick);
  void updatePersistentAreaTurn(combat).then(()=>{const scene=canvas?.scene;if(scene)refreshAll(scene,{turnStart:true});}).catch(err=>{console.error('Multiverso | tempo das auras',err);ui.notifications.error('Não foi possível atualizar a duração das auras.');});
 });
 Hooks.on('deleteCombatant',(combatant)=>{
  if(!game.user?.isGM)return;
  for(const scene of game.scenes??[])for(const template of scene.templates?.contents??[])if(template.getFlag(NS,'persistentArea')?.combatantId===combatant.id)void finishPersistentArea(template);
 });
 // A mesma rotina de encerramento manual é usada nas transições de combate
 // e cena. Não dependa de combat.scene (pode estar ausente durante hooks).
 const combatSceneId=combat=>{
  const scene=combat?.scene;
  return (typeof scene==='string'?scene:scene?.id)??combat?.sceneId??combat?.parent?.id
   ??combat?.combatants?.contents?.find(c=>c.token?.parent?.id)?.token?.parent?.id??null;
 };
 const closeSceneAuras=(sceneId,reason)=>{
  if(!game.user?.isGM||!sceneId)return;
  const scene=game.scenes?.get(sceneId);
  if(!scene)return;
  for(const template of [...(scene.templates?.contents??[])]){
   if(!template.getFlag(NS,'persistentArea'))continue;
   void finishPersistentArea(template).catch(error=>console.error(`Multiverso | encerrar aura (${reason})`,error));
  }
 };
 const closeCombatAuras=(combat,reason)=>{
  const sceneId=combatSceneId(combat);
  if(sceneId)closeSceneAuras(sceneId,reason);
  else if(game.user?.isGM){
   // Compatibilidade com combates antigos sem sceneId: use a identidade do combate.
   for(const scene of game.scenes??[])for(const template of [...(scene.templates?.contents??[])])
    if(template.getFlag(NS,'persistentArea')?.combatId===combat?.id)
     void finishPersistentArea(template).catch(error=>console.error('Multiverso | encerrar aura do combate',error));
  }
 };
 const hasStarted=combat=>Boolean(combat?.started||Number(combat?.round)>0);
 const combatStates=new Map();
 Hooks.once('ready',()=>{
  for(const combat of game.combats??[])combatStates.set(combat.id,hasStarted(combat));
 });
 // Ao iniciar o combate, termina a cena anterior, inclusive áreas conjuradas
 // antes de iniciar a iniciativa. Ao encerrar, termina as áreas do combate.
 Hooks.on('combatStart',combat=>{
  combatStates.set(combat.id,true);
  closeCombatAuras(combat,'início do combate');
 });
 Hooks.on('createCombat',combat=>{
  const started=hasStarted(combat);
  combatStates.set(combat.id,started);
  if(started)closeCombatAuras(combat,'combate criado já iniciado');
 });
 Hooks.on('updateCombat',(combat,changes)=>{
  const started=hasStarted(combat);
  const previously=combatStates.get(combat.id)??false;
  combatStates.set(combat.id,started);
  if(!previously&&started)closeCombatAuras(combat,'início do combate');
  else if(previously&&!started)closeCombatAuras(combat,'fim do combate');
  else if(changes?.started===false||changes?.active===false)closeCombatAuras(combat,'combate encerrado');
 });
 Hooks.on('deleteCombat',combat=>{
  combatStates.delete(combat.id);
  closeCombatAuras(combat,'combate excluído');
 });
 // Ao trocar a cena ativa, encerra também as áreas da cena anterior.
 let activeSceneId=null;
 Hooks.once('ready',()=>{activeSceneId=game.scenes?.active?.id??canvas?.scene?.id??null;});
 Hooks.on('updateScene',(scene,changes)=>{
  if(!game.user?.isGM)return;
  if(changes?.active===false)closeSceneAuras(scene.id,'cena desativada');
  if(changes?.active===true){
   if(activeSceneId&&activeSceneId!==scene.id)closeSceneAuras(activeSceneId,'troca de cena');
   activeSceneId=scene.id;
  }
 });
 Hooks.on('canvasReady',()=>{
  if(!game.user?.isGM)return;
  const current=canvas?.scene?.id??null;
  if(activeSceneId&&current&&current!==activeSceneId)closeSceneAuras(activeSceneId,'troca de canvas');
  if(current)activeSceneId=current;
 });
}
