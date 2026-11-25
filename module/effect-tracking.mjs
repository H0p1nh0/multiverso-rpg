import {processExternalSustains} from './external-advanced.mjs';
import {parseSustain,sustainCosts,advancedMode,performTurnStartAutomatic} from './advanced-motor.mjs';
import {endMaintainedEffect} from './maintained-attributes.mjs';
import {renderTurnEventCard} from './turn-event-card.mjs';
import {manualDamageEntry,renderManualDamageRows,damageFlag} from './damage-cards.mjs';
import {fluxByName,fluxById} from './extra-flux.mjs';
// Multiverso RPG v0.1.24: a ativação é o primeiro ciclo do efeito periódico.
// Próximas aplicações ocorrem na ENTRADA do turno do personagem afetado.
const NS='multiverso-rpg';
export const readTracked=actor=>Array.isArray(actor.getFlag(NS,'trackedDurations'))?actor.getFlag(NS,'trackedDurations'):[];
const RES_KEYS={pv:'pv_atual',pm:'pm_atual',sta:'sta_atual',san:'san_atual'};
const MAX_KEYS={pv_atual:'pv_max',pm_atual:'pm_max',sta_atual:'sta_max',san_atual:'san_max'};
function entryNameForTest(item,index){return String(item.system?.props?.[`mvEffectTitle${index}`]??'').trim()||item.name;}
export function planTrackedEntries({actor,item,effects,combat=game.combat,externalSustainOwner=null}){
  const result=[];
  for(const e of effects){
    if(!['turns','rounds','scene','sustained'].includes(e.duration?.kind))continue;
    const amount=e.duration.kind==='sustained'?1000000000:e.duration.kind==='scene'?1:e.duration.amount;
    if(!Number.isInteger(amount)||amount<1)throw new Error(`Duração inválida no efeito ${e.index}.`);
    const member=combat?.combatants?.find(c=>c.actor?.id===actor.id);
    const outside=!combat?.started||e.duration.kind==='scene';
    const scene=canvas?.scene;
    if(outside && !scene?.id)throw new Error('Ative uma cena antes de usar efeitos com duração fora de combate.');
    if(!outside && !member)throw new Error('O personagem precisa participar do combate iniciado.');
    const periodic=e.cadence==='periodic';
    if(outside && periodic)throw new Error('Efeitos periódicos fora de combate ainda exigem uma regra de repetição por cena. Nenhum efeito será executado.');
    const maintained=e.cadence==='maintained';
    const externalMaintainedOwner=maintained?externalSustainOwner:null;
    const sustaining=advancedMode(item,e.index,'mvSustainCost');
    // Em alvos externos a sustentação pertence ao conjurador; não anexar
    // custos locais ao afetado nem tentar validar Fluxo Extra em sua ficha.
    const sustain=sustaining&&!externalMaintainedOwner?parseSustain(sustaining,actor):null;
    if(sustaining&&!sustain&&!externalMaintainedOwner)throw new Error(`Efeito ${e.index}: custo periódico de sustentação inválido.`);
    if(sustain&&!maintained)throw new Error(`Efeito ${e.index}: sustentação requer efeito mantido.`);
    if(sustain&&outside)throw new Error(`Efeito ${e.index}: custo por turno exige combate ativo e o personagem participando do combate.`);
    const resource=e.type==='recurso'?(e.extraResource||e.affected):'pv';
    const def=fluxByName(actor,resource);
    const key=def?.key;
    if(periodic&&(!key||!Number.isFinite(e.value)||e.value<0))throw new Error(`Efeito periódico ${e.index}: recurso/valor inválido.`);
    const delta=e.type==='cura'?Math.abs(e.value):e.type==='dano'?-Math.abs(e.value):e.value*(e.op==='subtrair'?-1:1);
    // O primeiro dos N ciclos é consumido na aplicação pelo chat.
    if(periodic && amount===1)continue;
    const trackingId=foundry.utils.randomID();
    const maintainedEffect=maintained?(e.type==='teste'&&['vantagem','desvantagem'].includes(e.op)?{trackingId,condition:true,name:entryNameForTest(item,e.index),mechanics:[{kind:'advantage',mode:e.op,scope:e.attributeKey,uses:'continuous',name:item.name}]}:e.type==='condicao'?{trackingId,condition:true,name:e.conditionName,mechanics:e.conditionMechanics??[]}:e.protection?{trackingId,protection:e.protection}:{trackingId,attributeKey:e.attributeKey,delta:(e.op==='subtrair'?-1:1)*e.value,storedOnSheet:true}):null;
    result.push({id:trackingId,maintainedEffect,name:String(item.system.props?.[`mvEffectTitle${e.index}`]??'').trim()||`Efeito ${e.index}`,source:item.name,sourceUuid:item.uuid,combatId:outside?null:combat.id,sceneId:outside?scene.id:null,sceneBound:outside,combatantId:outside?null:member.id,remaining:outside?null:(periodic?amount-1:amount),total:amount,mode:e.duration.kind,cadence:e.cadence??'once',sustain,externalOwner:externalMaintainedOwner,periodic:periodic?{key,maxKey:def?.max,delta,diceFormula:e.diceFormula||null,type:e.type,op:e.op,itemUuid:item.uuid,damageType:e.chosenDamageType||item.system.props?.[`efeito${item.type}tipodano${e.index===1?'':e.index}`]||''}:null,createdRound:outside?null:combat.round,createdTurn:outside?null:combat.turn,createdCombatantId:outside?null:(combat.combatant?.id??null)});
  }
  return result;
}
// Os ciclos são contados EXCLUSIVAMENTE na entrada do turno próprio.
// A ativação é o primeiro turno. Nos turnos seguintes, avançamos a duração
// antes da sustentação. Um efeito mantido de 3 turnos, por exemplo, dura
// pela ativação, pelo 2º e pelo 3º turno; encerra no começo do 4º.
let runQueue=Promise.resolve();

export async function advanceDurationsAtTurnStart(combat,member,tick){
  const tokenActor=member.actor;
  const baseActor=game.actors?.get(member.actorId??tokenActor?.id);
  const actors=[...new Map([tokenActor,baseActor].filter(Boolean).map(actor=>[actor.uuid,actor])).values()];
  for(const actor of actors){
    const active=readTracked(actor);
    if(!active.length)continue;
    const kept=[],patch={},notes=[],rolled=[],manual=[];
    let changed=false;
    for(const entry of active){
      if(entry.externalOwner||entry.areaOwner||entry.combatId!==combat.id||entry.combatantId!==member.id){kept.push(entry);continue;}
      if(entry.lastProcessedTick===tick){kept.push(entry);continue;}
      // Uma Skill ativada durante o turno de OUTRO combatente só inicia seu
      // primeiro ciclo próprio quando o dono finalmente começa a agir.
      if(entry.createdCombatantId!==member.id && !entry.firstOwnStartSeen){
        kept.push({...entry,firstOwnStartSeen:true,activationOwnTick:tick,lastProcessedTick:tick});changed=true;continue;
      }
      const remaining=Number(entry.remaining);
      if(!Number.isInteger(remaining)||remaining<0){
        kept.push(entry);ui.notifications.error(`Duração inválida em ${entry.name}.`);continue;
      }
      // Contínuos com 1 turno restante expiraram ao COMEÇAR o próximo turno:
      // não cobrar sustentação nem reaplicar o bônus neste instante.
      if(entry.maintainedEffect&&remaining<=1){
        try{await endMaintainedEffect(actor,entry);notes.push({kind:'ended',name:entry.name,source:entry.source,maintainedAttribute:entry.maintainedEffect?.storedOnSheet===true,maintainedCondition:entry.maintainedEffect?.condition===true});changed=true;}
        catch(error){kept.push(entry);console.error(error);ui.notifications.error(`Falha ao encerrar ${entry.name}.`);}
        continue;
      }
      if(entry.cadence==='periodic'&&entry.periodic&&remaining>0){
        const {key,diceFormula,type,op}=entry.periodic;
        const maxKey=entry.periodic.maxKey??MAX_KEYS[key];
        if(!maxKey){kept.push(entry);ui.notifications.error(`Recurso inválido em ${entry.name}.`);continue;}
        let delta=entry.periodic.delta??0;
        if(diceFormula){
          try{
            const roll=new Roll(diceFormula,actor.getRollData?.()??{});await roll.evaluate();
            const amount=Number(roll.total);
            if(!Number.isFinite(amount)||amount<0)throw Error('Total inválido');
            delta=type==='cura'?amount:type==='dano'?-amount:amount*(op==='subtrair'?-1:1);
            rolled.push({name:entry.name,roll});
          }catch(error){kept.push(entry);console.error('Multiverso RPG | rolagem periódica',error);ui.notifications.error(`Não foi possível rolar ${entry.name}; ciclo não consumido.`);continue;}
        }
        if(type==='dano'){
          const amount=Math.abs(delta);
          const existingRoll=diceFormula?rolled[rolled.length-1]?.roll:null;
          // Não mexer em PV: o mestre/jogador decide o valor ao clicar com o
          // direito no card, após resistências, imunidades e circunstâncias.
          manual.push(manualDamageEntry({actor,effect:entry.name,source:entry.source,amount,formula:diceFormula||`${amount} (fixo)`,damageType:entry.periodic.damageType??'',roll:existingRoll}));
        }else{
          const before=Number(patch[key]??actor.system[key]??0);
          const max=Math.max(0,Number(actor.system[maxKey]??0));
          const after=Math.min(max,Math.max(0,before+delta));
          patch[key]=after;
          notes.push({kind:'change',name:entry.name,source:entry.source,resource:key,before,after});
        }
      }
      changed=true;
      if(remaining>1)kept.push({...entry,remaining:remaining-1,lastProcessedTick:tick});
      else notes.push({kind:'ended',name:entry.name,source:entry.source,maintainedAttribute:false,maintainedCondition:false});
    }
    if(!changed)continue;
    if(Object.keys(patch).length)await actor.update(Object.fromEntries(Object.entries(patch).map(([key,val])=>[`system.${key}`,val])));
    await actor.setFlag(NS,'trackedDurations',kept);
    if(notes.length||manual.length){
      try{
       for(const entry of manual){const tracked=active.find(t=>t.name===entry.name&&t.periodic?.itemUuid);if(tracked)entry.itemUuid=tracked.periodic.itemUuid;}
       const periodicContent=await renderManualDamageRows(manual);
       const regular=notes.length?renderTurnEventCard({actorName:actor.name,events:notes}):'';
       const html=manual.length?`<section class="mv-chat-effect mv-chat-automatic mv-turn-event"><div class="mv-chat-effect-header"><strong>Dano periódico</strong><small>${actor.name} • Início do turno</small></div><div class="mv-chat-effect-body">${periodicContent}<small>Nenhum PV descontado automaticamente.</small></div></section>`:'';
       await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:regular+html,rolls:rolled.map(x=>x.roll),flags:{[NS]:damageFlag(manual)}});
      }catch(err){console.error('Multiverso RPG | mensagem periódica',err);ui.notifications.error('Não foi possível publicar o dano periódico. Confira o console.');}
    }
  }
}
// O custo de continuidade deve ser pago no INÍCIO do turno próprio.
// Duração e sustentação acontecem na entrada, em sequência; os passivos vêm depois.
const startedTicks=new Map();
async function processEnteringTurn(combat,arrival={round:combat?.round,turn:combat?.turn,member:combat?.combatant}){
 if(!combat?.started)return;
 const member=arrival.member;
 if(!member?.id)return;
 const tick=`${arrival.round}:${arrival.turn}:${member.id}`;
 if(startedTicks.get(combat.id)===tick)return;
 startedTicks.set(combat.id,tick);
 // Todos os ciclos avançam somente aqui, nunca ao sair do turno.
  await advanceDurationsAtTurnStart(combat,member,tick);
  const tokenActor=member.actor,baseActor=game.actors?.get(member.actorId??tokenActor?.id);
 const actors=[...new Map([tokenActor,baseActor].filter(Boolean).map(a=>[a.uuid,a])).values()];
 for(const actor of actors){
  const existing=readTracked(actor);
  if(!existing.some(e=>!e.externalOwner&&e.combatId===combat.id&&e.combatantId===member.id&&e.sustain))continue;
  const kept=[];const patch={};const notes=[];const terminate=[];
  for(const entry of existing){
   if(entry.externalOwner||entry.combatId!==combat.id||entry.combatantId!==member.id||!entry.sustain){kept.push(entry);continue;}
   if(entry.lastSustainTick===tick){kept.push(entry);continue;}
   // Se ativada fora do turno próprio, o primeiro turno do dono não é continuidade.
   if(entry.activationOwnTick===tick){kept.push(entry);continue;}
   // Não cobrar em uma ativação que acabou de ocorrer no mesmo turno.
   if(entry.createdRound===arrival.round&&entry.createdTurn===arrival.turn&&entry.createdCombatantId===member.id){kept.push(entry);continue;}
   const costs=sustainCosts(entry.sustain,actor);
   if(!costs.length||costs.some(c=>!Number.isSafeInteger(c.amount)||c.amount<=0)){
    kept.push(entry);ui.notifications.error(`${entry.name}: custo de sustentação inválido. Nenhum recurso foi descontado.`);continue;
   }
   const noFunds=costs.find(c=>!c.key)||costs.find(c=>{
    const balance=Number(patch[c.key]??actor.system[c.key]);
    return !Number.isFinite(balance)||balance<c.amount;
   });
   if(noFunds){
    const ae=entry.maintainedEffect?actor.effects.find(x=>x.getFlag(NS,'trackingId')===entry.id):null;
    if(entry.maintainedEffect&&!ae){kept.push(entry);ui.notifications.error(`${entry.name}: efeito ativo não encontrado; encerramento requer revisão.`);continue;}
    if(ae){
     try{await endMaintainedEffect(actor,entry);}
     catch(err){kept.push(entry);console.error('Multiverso | efeito mantido',err);ui.notifications.error(`Não foi possível encerrar ${entry.name}.`);continue;}
    }
    terminate.push(entry);notes.push(`${entry.name}: encerrado por falta de ${(noFunds.label||noFunds.resource.toUpperCase())}.`);
    continue;
   }
   for(const cost of costs)patch[cost.key]=Number(patch[cost.key]??actor.system[cost.key])-cost.amount;
   notes.push(`${entry.name}: custo de continuidade ${costs.map(c=>`${c.amount} ${c.resource.toUpperCase()}`).join(' + ')}.`);
   kept.push({...entry,lastSustainTick:tick});
  }
  if(!Object.keys(patch).length&&!terminate.length)continue;
  const previous=Object.fromEntries(Object.keys(patch).map(k=>[k,actor.system[k]]));
  try{
   if(Object.keys(patch).length)await actor.update(Object.fromEntries(Object.entries(patch).map(([k,v])=>[`system.${k}`,v])));
   await actor.setFlag(NS,'trackedDurations',kept);
  }catch(err){
   console.error('Multiverso | falha ao processar sustentação na entrada do turno',err);
   if(Object.keys(previous).length)try{await actor.update(Object.fromEntries(Object.entries(previous).map(([k,v])=>[`system.${k}`,v])));}catch(rollback){console.error('Multiverso | rollback sustentação',rollback);}
   ui.notifications.error('Sustentação não foi registrada corretamente. Confira a ficha.');
   continue;
  }
  if(notes.length)try{
   await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<section class="mv-chat-effect mv-chat-automatic"><div class="mv-chat-effect-header"><strong>Sustentação — ${foundry.utils.escapeHTML(actor.name)}</strong><small>Multiverso RPG • Início do turno</small></div><div class="mv-chat-effect-body"><div class="mv-auto-trigger-reason"><span class="mv-auto-trigger-dot" aria-hidden="true">✦</span>Continuidade das habilidades<span class="mv-auto-trigger-state">Processado</span></div><div class="mv-auto-change">${notes.map(n=>`<div class="mv-auto-note">${foundry.utils.escapeHTML(n)}</div>`).join('')}</div><p class="mv-auto-status">Custos de sustentação avaliados antes dos efeitos passivos deste turno.</p></div></section>`});
  }catch(err){console.error('Multiverso | mensagem de sustentação',err);}
 }
 // Sustentação externa compartilha UM custo por Skill no turno do conjurador.
 for(const sourceActor of [...new Map([member.actor,game.actors?.get?.(member.actorId??member.actor?.id)].filter(Boolean).map(a=>[a.uuid,a])).values()])
   await processExternalSustains(combat,{...member,actor:sourceActor},tick);
 // Manter a ordem: primeiro processar sustentação, depois passivas de início de turno.
 if(member.actor)await performTurnStartAutomatic(member.actor);
}

// Fim de cena: Foundry não possui um evento universal de encerramento narrativo.
// Encerramos quando a cena é desativada/trocada, quando é apagada ou quando
// um combate é iniciado nela; o GM também pode encerrar manualmente pela ficha.
async function finishSceneEntries(sceneId, reason){
  if(!game.user.isGM||!sceneId)return;
  const actors=new Map();
  for(const actor of game.actors?.contents??[])actors.set(actor.uuid,actor);
  const scene=game.scenes?.get(sceneId);
  for(const token of scene?.tokens?.contents??[]){
    try { const a=token.actor;if(a)actors.set(a.uuid,a); }catch(e){console.warn('Multiverso RPG | token sem ator',e);}
  }
  for(const actor of actors.values()){
    const tracked=readTracked(actor); const ending=tracked.filter(e=>e.sceneBound===true&&e.sceneId===sceneId);
    if(!ending.length)continue;
    const kept=tracked.filter(e=>!ending.some(x=>x.id===e.id));
    let failures=false;
    for(const entry of ending){
      if(!entry.maintainedEffect)continue;
      try{await endMaintainedEffect(actor,entry);}catch(err){failures=true;console.error('Multiverso RPG | falha ao encerrar bônus da cena',err);kept.push(entry);}
    }
    try{await actor.setFlag(NS,'trackedDurations',kept);}catch(err){console.error('Multiverso RPG | falha ao encerrar cena',err);}
    if(failures)ui.notifications.error('Não foi possível encerrar todos os bônus da cena. Revise os efeitos ativos.');
    else console.info('Multiverso RPG | efeitos de cena encerrados',actor.name,reason,ending.length);
  }
}
const closingScenes=new Set();
function resolveCombatSceneId(combat){
  // Foundry may expose a Scene document, a scene id, or a parent scene.
  // For an active combat with no explicit scene pointer, use the active canvas scene.
  const direct=combat?.scene?.id ?? combat?.sceneId ?? combat?.scene?._id ?? combat?.parent?.id;
  if(direct)return direct;
  if(combat?.started && canvas?.scene?.id)return canvas.scene.id;
  return null;
}
function queueSceneClosing(sceneId,reason){
  if(!game.user.isGM||!sceneId||closingScenes.has(sceneId))return;
  closingScenes.add(sceneId);
  runQueue=runQueue.then(()=>finishSceneEntries(sceneId,reason)).catch(err=>console.error('Multiverso RPG | encerramento da cena',err)).finally(()=>closingScenes.delete(sceneId));
}
function closeOnCombatStart(combat, reason){
  if(!game.user.isGM||!combat?.started)return;
  const sceneId=resolveCombatSceneId(combat);
  if(sceneId){ console.info('Multiverso RPG 0.1.33 | combate iniciado, encerrando efeitos de cena',{combatId:combat.id,sceneId,reason});queueSceneClosing(sceneId,reason); }
  else console.warn('Multiverso RPG 0.1.33 | combate iniciado sem cena identificável',combat.id);
}
export function registerDurationTracking(){
  Hooks.on('combatStart', combat=>{closeOnCombatStart(combat,'combatStart');const arrival={round:combat.round,turn:combat.turn,member:combat.combatant};if(game.user.isGM)runQueue=runQueue.then(()=>processEnteringTurn(combat,arrival)).catch(err=>console.error('Multiverso | primeiro turno',err));});
  Hooks.on('createCombat',combat=>closeOnCombatStart(combat,'createCombat'));
  Hooks.on('updateCombat',(combat,changes)=>{
    // `started` is a derived property on some Foundry versions. Start Combat
    // commonly changes `round` from 0 to 1 instead of updating `started`.
    if(!game.user.isGM)return;
    if(combat.started && ('round' in (changes??{}) || 'started' in (changes??{})))
      closeOnCombatStart(combat,'updateCombat');
  });
  Hooks.on('updateScene',(scene,changes)=>{if(game.user.isGM&&changes.active===false)queueSceneClosing(scene.id,'cena desativada');});
  Hooks.on('deleteScene',scene=>{if(game.user.isGM)queueSceneClosing(scene.id,'cena excluída');});

  Hooks.on('updateCombat',(combat,changes)=>{
    if(!game.user.isGM||(!('turn' in (changes??{}))&&!('round' in (changes??{}))))return;
    // Captura a chegada AGORA: avanços rápidos não devem pular turnos na fila.
    const arrival={round:combat.round,turn:combat.turn,member:combat.combatant};
    runQueue=runQueue.then(()=>processEnteringTurn(combat,arrival)).catch(err=>console.error('Multiverso RPG | início do turno',err));
  });
}
