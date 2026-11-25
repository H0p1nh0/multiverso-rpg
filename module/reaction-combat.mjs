// Reações do combate nativo — adaptação pontual das regras originais do combate-mental.js.
// No legado eram 2 reações por rodada. Por decisão de Hope na v0.2.03,
// são restauradas apenas no início do turno do próprio personagem.
const NS='multiverso-rpg';
const FLAG='combatReactionsV1';
export const BASE_REACTIONS=2;
const locks=new Set();
const number=v=>Number.isFinite(Number(v))?Number(v):0;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const keyOf=actor=>actor?.uuid||actor?.id||'';
export function belongsToCombat(actor,combat){
 if(!actor||!combat)return false;
 return Array.from(combat.combatants??[]).some(c=>c.actor?.uuid===actor.uuid||c.actor?.id===actor.id||c.actorId===actor.id);
}
export function reactionActivity(item){
 if(!item||!['skill','tecnica'].includes(item.type))return false;
 const props=item.system?.props??{};
 // O editor guarda atividade por efeito, mas toda a Skill/Técnica tem um só custo de ativação.
 // Não cobrar várias reações quando a mesma habilidade contém vários efeitos.
 return Array.from({length:5},(_,i)=>i+1).some(i=>String(props[`${item.type==='skill'?'ativacaotempotiposkill':'ativacaotempotipotecnica'}${i===1?'':i}`]??'').trim().toLowerCase()==='reacao');
}
// Identificador somente do turno próprio. Nulo enquanto outro personagem age.
function ownTurnKey(actor,combat){
 const c=combat?.combatant;
 if(!combat?.started||!c||!(c.actor?.uuid===actor?.uuid||c.actor?.id===actor?.id||c.actorId===actor?.id))return null;
 return `${combat.id}:${combat.round}:${combat.turn}:${c.id}`;
}
export function reactionStatus(actor,combat=game.combat){
 const baseline={current:BASE_REACTIONS,max:BASE_REACTIONS,combatId:combat?.id??'',round:number(combat?.round),active:Boolean(combat?.started)};
 if(!combat?.started)return {...baseline,ok:true,outside:true};
 // NPC de apoio: atua no combate sem turno próprio. Mantém as mesmas duas
 // reações individuais, recuperadas no começo da rodada seguinte (sem iniciativa).
 // NPC que participa do rastreador mantém a regra original de turno próprio.
 if(actor?.type==='npc'&&!belongsToCombat(actor,combat)){
  const raw=actor?.getFlag?.(NS,FLAG)??actor?.flags?.[NS]?.[FLAG];
  const hasRecord=raw?.combatId===combat.id;
  const max=hasRecord?clamp(Math.trunc(number(raw.max)||BASE_REACTIONS),0,100):BASE_REACTIONS;
  const turnKey=`npc:${combat.id}:${number(combat.round)}`;
  const fresh=!hasRecord||raw.turnKey!==turnKey;
  const current=fresh?max:clamp(Math.trunc(number(raw.current)),0,max);
  return {...baseline,current,max,combatId:combat.id,turnKey,round:number(combat.round),
   active:true,ok:current>0,outside:false,reason:current>0?null:'empty',fresh,indirectNPC:true};
 }
 if(!belongsToCombat(actor,combat))return {...baseline,ok:false,reason:'not-combatant'};
 const raw=actor?.getFlag?.(NS,FLAG)??actor?.flags?.[NS]?.[FLAG];
 const hasRecord=raw?.combatId===combat.id;
 const max=hasRecord?clamp(Math.trunc(number(raw.max)||BASE_REACTIONS),0,100):BASE_REACTIONS;
 const ownKey=ownTurnKey(actor,combat);
 // A próxima rodada não restaura nada. Somente a ENTRADA no próprio turno
 // é uma recarga: antes disso, preservamos o valor gasto até mesmo entre rodadas.
 const fresh=Boolean(ownKey&&(!hasRecord||raw.turnKey!==ownKey));
 const current=hasRecord&&!fresh?clamp(Math.trunc(number(raw.current)),0,max):max;
 return {current,max,combatId:combat.id,round:number(combat.round),turnKey:fresh?ownKey:(hasRecord?raw.turnKey??null:null),active:true,ok:current>0,outside:false,reason:current>0?null:'empty',fresh};
}
export async function spendReaction(actor,{combat=game.combat}={}){
 const status=reactionStatus(actor,combat);
 if(status.outside)return {...status,ok:true,consumed:false};
 if(!status.ok)return {...status,consumed:false};
 if(!actor?.setFlag)throw new Error('Não é possível salvar as reações deste personagem.');
 const key=keyOf(actor);
 if(locks.has(key))return {...status,ok:false,reason:'busy',consumed:false};
 locks.add(key);
 try{
  const latest=reactionStatus(actor,combat);
  if(!latest.ok)return {...latest,consumed:false};
  const after={combatId:combat.id,round:number(combat.round),turnKey:latest.turnKey,max:latest.max,current:latest.current-1};
  await actor.setFlag(NS,FLAG,after);
  actor.sheet?.render?.(false);
  Hooks.callAll?.('multiversoReacaoConsumida',actor,{antes:latest.current,depois:after.current,combatId:combat.id,round:after.round});
  return {...latest,current:after.current,ok:true,consumed:true,previous:latest.current,turnKey:after.turnKey};
 }finally{locks.delete(key);}
}
export async function refundReaction(actor,receipt,{combat=game.combat}={}){
 if(!receipt?.consumed||!combat?.started||combat.id!==receipt.combatId)return false;
 const key=keyOf(actor);
 if(locks.has(key))return false;
 locks.add(key);
 try{
  const raw=actor.getFlag(NS,FLAG);
  // Protege um turno novo: não devolve uma reação de um ciclo antigo.
  if(raw?.combatId!==combat.id||(raw.turnKey??null)!==(receipt.turnKey??null))return false;
  const status=reactionStatus(actor,combat);
  if(status.fresh)return false;
  const next=clamp(status.current+1,0,status.max);
  if(next===status.current)return false;
  await actor.setFlag(NS,FLAG,{combatId:combat.id,round:status.round,turnKey:status.turnKey,max:status.max,current:next});
  actor.sheet?.render?.(false);
  Hooks.callAll?.('multiversoReacaoRecuperada',actor,{antes:status.current,depois:next,motivo:'Ativação cancelada',combatId:combat.id});
  return true;
 }finally{locks.delete(key);}
}
// Devolução manual do controle legado: mesma reserva da Skill/Técnica, sem contador paralelo.
export async function manuallyRefundReaction(actor,{combat=game.combat}={}){
 const status=reactionStatus(actor,combat);
 if(status.outside||status.reason==='not-combatant'||status.current>=status.max)return false;
 const key=keyOf(actor);
 if(locks.has(key))return false;
 locks.add(key);
 try{
  const latest=reactionStatus(actor,combat);
  if(latest.current>=latest.max)return false;
  await actor.setFlag(NS,FLAG,{combatId:combat.id,round:latest.round,turnKey:latest.turnKey,max:latest.max,current:latest.current+1});
  actor.sheet?.render?.(false);
  Hooks.callAll?.('multiversoReacaoRecuperada',actor,{antes:latest.current,depois:latest.current+1,motivo:'Recuperação manual',combatId:combat.id});
  return true;
 }finally{locks.delete(key);}
}
let turnTasks=Promise.resolve();
async function syncOwnTurn(combat){
 if(!game.user?.isGM||!combat?.started||!combat.combatant?.actor?.setFlag)return;
 const actor=combat.combatant.actor,marker=ownTurnKey(actor,combat);
 if(!marker)return;
 const old=actor.getFlag?.(NS,FLAG)??actor.flags?.[NS]?.[FLAG];
 if(old?.combatId===combat.id&&old.turnKey===marker)return;
 const max=old?.combatId===combat.id?clamp(Math.trunc(number(old.max)||BASE_REACTIONS),0,100):BASE_REACTIONS;
 await actor.setFlag(NS,FLAG,{combatId:combat.id,round:number(combat.round),turnKey:marker,max,current:max});
 actor.sheet?.render?.(false);
}
export function registerReactionCombat(){
 Hooks.on('combatStart',combat=>{if(game.user?.isGM)turnTasks=turnTasks.then(()=>syncOwnTurn(combat)).catch(e=>console.error('Multiverso | reações ao iniciar combate',e));});
 Hooks.on('updateCombat',(combat,changes)=>{
  if(game.user?.isGM&&(Object.hasOwn(changes??{},'turn')||Object.hasOwn(changes??{},'round')))
   turnTasks=turnTasks.then(()=>syncOwnTurn(combat)).catch(e=>console.error('Multiverso | reações no início do próprio turno',e));
 });
 Hooks.on('createCombatant',combatant=>{const combat=combatant.parent;
  if(game.user?.isGM&&combat?.started&&combat.combatant?.id===combatant.id)
   turnTasks=turnTasks.then(()=>syncOwnTurn(combat)).catch(e=>console.error('Multiverso | novo combatente',e));
 });
}
