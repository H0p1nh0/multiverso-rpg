// Condições de fogo: aplicação em danos efetivamente recebidos e evolução por reaplicação.
import {resolveDamageProtection} from './damage-protection.mjs';
const NS='multiverso-rpg';
const norm = value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const STAGES=['chamuscado','queimado','em chamas'];
const rank=effect=>STAGES.indexOf(norm(effect?.name));
const busy=new Set();
const turnTicks=new Set();
function activeStages(actor){return [...(actor?.effects??[])].filter(e=>!e.disabled&&!e.isSuppressed&&rank(e)>=0);}
function bonusEntries(actor){
 const active=activeStages(actor);
 // Stages are exclusive: only the most severe grants a reaction roll.
 if(active.length)return [{formula:'1d6',type:'fogo',source:active.reduce((a,b)=>rank(a)>=rank(b)?a:b).name}];
 const entries=[];
 for(const effect of actor?.effects??[]){
  if(effect.disabled||effect.isSuppressed)continue;
  for(const m of effect.getFlag?.(NS,'conditionMechanics')??[]){
   if(m.kind!=='damage'||m.direction!=='received'||!m.diceFormula)continue;
   entries.push({formula:m.diceFormula,type:m.damageType||'fisico',source:effect.name});
  }
 }
 return entries;
}
async function additionalDamage(actor,{entries,origin}){
 if(!entries.length)return;
 const key=actor.uuid;
 if(busy.has(key))return;
 busy.add(key);
 try {
  for(const entry of entries){
   const roll=await new Roll(entry.formula,actor.getRollData?.()??{}).evaluate();
   const value=Math.max(0,Number(roll.total)||0);
   const applied=resolveDamageProtection(actor,value,entry.type,{skipConditionBonus:true});
   if(applied.blocked){ui.notifications.warn(`${actor.name}: proteção contra ${entry.type} não calculável; dano adicional não aplicado.`);continue;}
   const current=Number(actor.system?.pv_atual);
   if(!Number.isFinite(current))continue;
   const final=Math.max(0,Number(applied.final)||0);
   if(final)await actor.update({'system.pv_atual':Math.max(0,current-final)},{multiversoConditionDamage:true});
   await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:`${entry.source}: ${origin} • ${entry.type} (${final} PV após proteções)`});
  }
 }catch(error){console.error('Multiverso | dano adicional de condição',error);ui.notifications.error('Falha ao aplicar dano adicional da condição. Confira o console.');}
 finally{busy.delete(key);}
}
async function periodic(combat){
 if(!game.user.isGM||!combat?.started)return;
 const member=combat.combatant,actor=member?.actor;
 if(!actor)return;
 const tick=[combat.id,combat.round,combat.turn,member.id].join(':');
 if(turnTicks.has(tick))return;
 turnTicks.add(tick);
 if(turnTicks.size>300)turnTicks.clear();
 const stage=activeStages(actor).sort((a,b)=>rank(b)-rank(a))[0];
 if(!stage||rank(stage)<1)return;
 await additionalDamage(actor,{entries:[{formula:rank(stage)===2?'1d8':'1d6',type:'fogo',source:stage.name}],origin:'dano no início do turno'});
}
async function upgradeCondition(effect,userId){
 if(userId!==game.user.id)return;
 const actor=effect.parent;
 if(!actor?.effects||rank(effect)<0||effect.getFlag(NS,'fireStageEvolving'))return;
 const key=actor.uuid+':evolve';
 if(busy.has(key))return;
 busy.add(key);
 try{
  const others=activeStages(actor).filter(e=>e.id!==effect.id);
  if(!others.length)return;
  const previous=others.reduce((a,b)=>rank(a)>=rank(b)?a:b);
  const next=Math.min(2,Math.max(rank(effect),rank(previous)+1));
  const target=STAGES[next];
  const names=['Chamuscado','Queimado','Em Chamas'];
  // Reuse the most recent duration (newly created effect), remove older status.
  await effect.update({name:names[next],[`flags.${NS}.fireStageEvolving`]:true});
  await actor.deleteEmbeddedDocuments('ActiveEffect',others.map(e=>e.id));
  // Existing duration list may be written by creator after this event. The stale
  // entry is harmless without its ActiveEffect; cleanup on subsequent update.
  const tracked=actor.getFlag(NS,'trackedDurations');
  const removed=new Set(others.map(e=>e.getFlag(NS,'trackingId')).filter(Boolean));
  if(removed.size&&Array.isArray(tracked))await actor.setFlag(NS,'trackedDurations',tracked.filter(e=>!removed.has(e.id)));
  ui.notifications.info(`${actor.name}: condição evoluiu para ${names[next]}.`);
 }catch(error){console.error('Multiverso | evolução de fogo',error);ui.notifications.error('Falha na evolução da condição de fogo.');}
 finally{busy.delete(key);}
}
export function registerFireConditions(){
 // Hooks only see real PV changes, never a damage preview or dice-card click.
 Hooks.on('updateActor',(actor,changes,options,userId)=>{
  if(userId!==game.user.id||options?.multiversoConditionDamage||options?.multiversoNotDamage)return;
  const now=changes?.system?.pv_atual;
  if(now===undefined)return;
  const prior=Number(actor._source?.system?.pv_atual);
  // Foundry update hooks see actor after update. Track old value with preUpdate below.
  const old=options?.multiversoOldPv;
  if(!Number.isFinite(Number(old))||!Number.isFinite(Number(now))||Number(now)>=Number(old))return;
  const entries=bonusEntries(actor);
  if(entries.length)void additionalDamage(actor,{entries,origin:'dano recebido'});
 });
 Hooks.on('preUpdateActor',(actor,changes,options,userId)=>{
  if(changes?.system?.pv_atual===undefined||options?.multiversoConditionDamage)return;
  options.multiversoOldPv=actor.system?.pv_atual;
 });
 Hooks.on('createActiveEffect',(effect,options,userId)=>{void upgradeCondition(effect,userId);});
 Hooks.on('combatStart',combat=>{void periodic(combat);});
 Hooks.on('updateCombat',(combat,changes)=>{
  if('turn' in (changes??{})||'round' in (changes??{}))void periodic(combat);
 });
}
