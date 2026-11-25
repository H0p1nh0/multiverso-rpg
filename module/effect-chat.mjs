import {changeList,conditionFlags} from "./condition-mechanics.mjs";
import {renderManualDamageRows,damageFlag} from './damage-cards.mjs';
import {readTracked} from './effect-tracking.mjs';
import {buildAttributeActivationPatch,isStoredAttribute} from './maintained-attributes.mjs';
import {damageTypeLabel} from './passive-bonuses.mjs';
import {availableFluxes,fluxById,normalizeFluxName} from './extra-flux.mjs';
import {usageStatus,takeUsage,restoreUsage} from './skill-uses.mjs';
// Card de execução de efeitos básicos no chat — Fase 2 v0.1.14.
// Efeitos fixos no próprio ator são aplicados após a confirmação privada da Skill.
// Casos restantes preservam os fluxos manuais de aplicação autorizada.
const ns = 'multiverso-rpg';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const keys = ['pv_atual','pm_atual','sta_atual','san_atual'];
const resourceLabel = {pv_atual:'PV',pm_atual:'PM',sta_atual:'STA',san_atual:'SAN'};
const pending = new Set();

export async function createEffectChatCard({actor,item,before,after,formulas,resistances,rolls=[],requiredCosts=[],timedEntries=[],externalTarget=null,freeRoll=false,resistanceRequest=null,reusePublicMessage=null,autoApplySelf=false,manualDamageEntries=[],instantTestEffects=[]}) {
  const changes = availableFluxes(actor).map(f=>f.key).filter(k => Number(before[k]) !== Number(after[k])).map(k => ({key:k,from:Number(before[k]),to:Number(after[k])}));
  const labels=Object.fromEntries(availableFluxes(actor).map(f=>[f.key,f.label]));
  const steps = [...formulas,...resistances];
  const targetChanges=externalTarget?.changes??[];
  const content = `<section class="mv-chat-effect" data-mv-chat-effect>
    <div class="mv-chat-effect-header"><strong>${esc(item.name)}</strong><small>Multiverso RPG • Efeito de teste</small></div>
    <div class="mv-chat-effect-body"><div class="mv-chat-effect-subtitle">${esc(actor.name)}</div>
    ${steps.length ? `<ul>${steps.map(line=>`<li>${esc(line)}</li>`).join('')}</ul>` : ''}
    ${freeRoll?'<div class="mv-chat-effect-free"><b>Rolagem livre — sem alvo vinculado.</b><p>O resultado é apenas informativo: nenhum dano ou cura será aplicado automaticamente.</p></div>':''}
    <div class="mv-chat-effect-changes">${externalTarget?`<div><b>Alvo: ${esc(externalTarget.name)}</b></div>${targetChanges.map(c=>`<div><b>${(labels?.[c.key]??resourceLabel[c.key]??c.key)}</b> ${c.from} → <strong>${c.to}</strong></div>`).join('')}`:''}${changes.length ? changes.map(c=>`<div><b>${(labels?.[c.key]??resourceLabel[c.key]??c.key)}</b> ${c.from} → <strong>${c.to}</strong></div>`).join('') : '<div>Nenhuma alteração de recurso.</div>'}</div>
    <button type="button" data-mv-apply-effect>${freeRoll ? "Confirmar uso / pagar custo" : "Aplicar efeito"}</button>
    <p class="mv-chat-effect-status" data-mv-effect-status>Não aplicado • aguardando confirmação.</p></div>
  </section>`;
  // A confirmação privada contém os dados econômicos; nunca são colocados no card público.
  const recipientIds=[...new Set([game.user.id,...game.users.filter(u=>u.isGM).map(u=>u.id)])];
  const privateMessage=await ChatMessage.create({
    speaker:ChatMessage.getSpeaker({actor}),
    whisper:recipientIds,
    content:`<div class="mv-hidden-chat-plan" data-mv-hidden-chat-plan>Dados reservados para aplicação</div>`,
    flags:{[ns]:{effectCard:{actorUuid:actor.uuid,itemUuid:item.uuid,changes,requiredCosts,timedEntries,instantTestEffects,externalTarget:externalTarget?{actorUuid:externalTarget.actorUuid,changes:targetChanges}:null,resistanceRequest,freeRoll,status:'pending',createdBy:game.user.id}}}
  });
  // Não expor PV/PM/STA/SAN nem custos via conteúdo ou flags da mensagem pública.
  const publicLines=steps.filter(line=>!/(custo|reforço opcional|PM\b|STA\b|SAN\b|PV_ATUAL|PV\b|recurso)/i.test(String(line)));
  const extraRolls=rolls.filter(r=>!manualDamageEntries.some(x=>x.roll===r));
  const rollMarkup=extraRolls.length?`<div class="mv-damage-roll-native">${(await Promise.all(extraRolls.map(r=>r.render()))).join('')}</div>`:'';
  const manualMarkup=await renderManualDamageRows(manualDamageEntries);
  // Somente condições/efeitos persistentes requerem o botão de aplicação.
  // Dano/cura imediatos já usam a aplicação pelo botão direito na rolagem.
  const needsApplication=timedEntries.length>0||instantTestEffects.length>0||requiredCosts.length>0||manualDamageEntries.length>0;
  const publicContent=`<section class="mv-chat-effect" data-mv-public-effect>
    <div class="mv-chat-effect-header"><strong>${esc(item.name)}</strong><small>Multiverso RPG • Habilidade</small></div>
    <div class="mv-chat-effect-body">${rollMarkup}${manualMarkup}${publicLines.length?`<ul>${publicLines.map(line=>`<li>${esc(line)}</li>`).join('')}</ul>`:'<p>Habilidade utilizada.</p>'}
    ${resistanceRequest?`<div class="mv-resistance-request" data-mv-resistance-request>
      <strong>Teste de resistência: ${esc(resistanceRequest.testName)}</strong>
      <span>Alvo: ${esc(resistanceRequest.targetName)} • DT ${esc(resistanceRequest.dt)}</span>
      <button type="button" data-mv-resistance-roll>Rolar resistência</button>
      <p data-mv-resistance-status>Aguardando teste do alvo.</p>
    </div>`:''}
    ${autoApplySelf?`<p class="mv-chat-effect-status" data-mv-public-status>Aplicação automática em andamento...</p>`:needsApplication?`<button type="button" data-mv-public-apply ${resistanceRequest?'disabled':''}>${timedEntries.some(e=>e.maintainedEffect?.condition)?'Aplicar condição':'Aplicar efeito'}</button><p class="mv-chat-effect-status" data-mv-public-status>Aguardando aplicação.</p>`:''}</div>
  </section>`;
  try{
    const publicMessage=reusePublicMessage ? await reusePublicMessage.update({content:publicContent,rolls,
      flags:{[ns]:{...damageFlag(manualDamageEntries),publicEffect:{privateMessageId:privateMessage.id,status:'pending',createdBy:game.user.id,resistancePending:!!resistanceRequest,resistanceResolved:null,resistancePublic:resistanceRequest?{targetUuid:resistanceRequest.targetUuid,targetName:resistanceRequest.targetName,testName:resistanceRequest.testName,dt:resistanceRequest.dt,requestId:privateMessage.id}:null}}}
    }) : await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:publicContent,rolls,flags:{[ns]:{...damageFlag(manualDamageEntries),publicEffect:{privateMessageId:privateMessage.id,status:'pending',createdBy:game.user.id,resistancePending:!!resistanceRequest,resistanceResolved:null,resistancePublic:resistanceRequest?{targetUuid:resistanceRequest.targetUuid,targetName:resistanceRequest.targetName,testName:resistanceRequest.testName,dt:resistanceRequest.dt,requestId:privateMessage.id}:null}}}});
    await privateMessage.update({[`flags.${ns}.effectCard.publicMessageId`]:publicMessage.id});
    if(autoApplySelf){
      // A janela privada "Confirmar uso" já autorizou a alteração na própria ficha.
      // Reutiliza a mesma aplicação com validação/rollback usada pelo botão manual.
      // Nunca chamar duas vezes: só esta criação de card dispara a aplicação.
      const applied=await applyCard(privateMessage,null,publicMessage,true);
      if(!applied){
        await publicMessage.update({
          content:publicContent.replace('Aplicação automática em andamento...',
            'Não foi possível aplicar automaticamente. Confira os recursos e use a habilidade novamente.'),
          [`flags.${ns}.publicEffect.status`]:'failed'
        });
        return null;
      }
      // A aplicação já foi confirmada no Actor. Uma falha posterior na
      // atualização visual do chat NÃO pode fazer o executor considerar
      // a Skill não usada e aplicar cura/custo novamente.
      try{
        await publicMessage.update({content:publicContent.replace('Aplicação automática em andamento...',
          'Efeito aplicado automaticamente à própria ficha.')});
      }catch(error){
        console.error('Multiverso RPG | aplicação concluída; falha ao atualizar visual do card',error);
        ui.notifications.warn('O efeito foi aplicado na ficha, mas o texto do chat não foi atualizado. Confira a ficha.');
      }
    }
    return publicMessage;
  }catch(error){
    // Não eliminar o registro privado quando a ficha já foi alterada.
    // Isso preserva a trilha de aplicação e impede confusão sobre custos.
    const alreadyApplied=privateMessage.getFlag(ns,'effectCard')?.status==='applied';
    if(!alreadyApplied){try{await privateMessage.delete();}catch{}}
    else ui.notifications.warn('O efeito foi aplicado, mas houve falha ao publicar o card. Confira a ficha.');
    if(alreadyApplied)return null;
    throw error;
  }

}


// Etapa de rolagem postergada: nenhum resultado é antecipado ao criar a habilidade.
// O plano (e possíveis custos) nunca fica nos flags públicos.
const damagePartsHtml=parts=>Array.isArray(parts)&&parts.length?`<div class="mv-damage-part-list">${parts.map(part=>`<div class="mv-damage-part"><span>${esc(part.source)}: <b>${esc(part.formula)}</b>${part.damageType?` <em>(${esc(damageTypeLabel(part.damageType))})</em>`:''}</span></div>`).join('')}</div>`:'';
export async function createPendingDamageCard({actor,item,formula,effectName,type,resource,operation,externalTarget,resistanceRequest,damageParts=[]}){
  const ids=[...new Set([game.user.id,...game.users.filter(u=>u.isGM).map(u=>u.id)])];
  const privateMessage=await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),whisper:ids,
    content:`<div class="mv-hidden-chat-plan" data-mv-hidden-chat-plan>Plano privado de execução</div>`,
    flags:{[ns]:{pendingDamage:{actorUuid:actor.uuid,itemUuid:item.uuid,formula,effectName,type,resource,operation,externalTarget,resistanceRequest,damageParts,used:false,createdBy:game.user.id}}}});
  const content=`<section class="mv-chat-effect" data-mv-pending-damage>
    <div class="mv-chat-effect-header"><strong>${esc(item.name)}</strong><small>Multiverso RPG • Habilidade</small></div>
    <div class="mv-chat-effect-body">${String(item.system?.description||'').trim()?`<p class="mv-damage-description">${esc(item.system.description)}</p>`:''}
    <p class="mv-damage-formula">${type==='cura'?'Cura':'Dano'}: ${esc(formula)}</p>${damagePartsHtml(damageParts)}
    <button type="button" data-mv-roll-damage>Rolar ${type==='cura'?'Cura':'Dano'} (${esc(formula)})</button>
    <p class="mv-chat-effect-status">Aguardando rolagem • uso já confirmado na janela privada.</p></div></section>`;
  try{return await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content,
    flags:{[ns]:{pendingDamagePublic:{privateMessageId:privateMessage.id,createdBy:game.user.id,status:'pending'}}}});
  }catch(error){await privateMessage.delete().catch(()=>{});throw error;}
}
const rollingDamage=new Set();
async function rollPendingDamage(message,button){
  if(rollingDamage.has(message.id))return;
  const pub=message.getFlag(ns,'pendingDamagePublic');
  if(!pub||pub.status!=='pending')return;
  if(!game.user.isGM&&pub.createdBy!==game.user.id)return ui.notifications.warn('Somente quem usou a habilidade ou o mestre pode rolar este dano.');
  const privateMessage=game.messages.get(pub.privateMessageId);
  const plan=privateMessage?.getFlag(ns,'pendingDamage');
  if(!plan||plan.used)return ui.notifications.warn('Dados privados da habilidade indisponíveis ou já utilizados.');
  rollingDamage.add(message.id);button.disabled=true;
  try{
    const actor=await fromUuid(plan.actorUuid),item=await fromUuid(plan.itemUuid);
    if(!actor||!item)throw Error('Ator ou Skill removidos antes da rolagem.');
    const roll=new Roll(plan.formula,actor.getRollData?.()??{});await roll.evaluate();
    const amount=Number(roll.total);
    if(!Number.isFinite(amount)||amount<0)throw Error('Rolagem inválida.');
    const fluxos={pv:'pv_atual',pm:'pm_atual',sta:'sta_atual',san:'san_atual'}, maxima={pv:'pv_max',pm:'pm_max',sta:'sta_max',san:'san_max'};
    const resource=plan.type==='recurso'?plan.resource:'pv',key=fluxos[resource];
    if(!key)throw Error('Recurso externo não suportado.');
    const target=plan.externalTarget?await fromUuid(plan.externalTarget.actorUuid):null;
    if(plan.externalTarget&&!target)throw Error('Alvo não encontrado.');
    const current=target?Number(target.system[key]??0):null;
    const max=target?Number(target.system[maxima[resource]]??0):null;
    const rawDelta=plan.type==='cura'?Math.abs(amount):plan.type==='dano'?-Math.abs(amount):amount*(plan.operation==='subtrair'?-1:1);
    const delta=Math.sign(rawDelta)*Math.floor(Math.abs(rawDelta));
    const next=target?Math.max(0,Math.min(max,current+delta)):null;
    const before=Object.fromEntries(Object.values(fluxos).map(k=>[k,Number(actor.system[k]??0)]));
    const request=target&&plan.resistanceRequest?{...plan.resistanceRequest,rawDelta,key,max}:null;
    if(!target){
      // Rolagem livre: um único card PÚBLICO, nenhuma segunda confirmação e nenhuma alteração de ficha.
      // Roll.render utiliza a apresentação padrão do Foundry com dados individuais e tooltip.
      const rendered=await roll.render();
      const content=`<section class="mv-chat-effect" data-mv-damage-rolled>
        <div class="mv-chat-effect-header"><strong>${esc(item.name)}</strong><small>Multiverso RPG • ${plan.type==='cura'?'Cura':'Dano'}</small></div>
        <div class="mv-chat-effect-body"><div class="mv-damage-formula">${esc(plan.effectName)} — ${esc(plan.formula)}</div>${damagePartsHtml(plan.damageParts)}
        <div class="mv-damage-roll-native">${rendered}</div></div></section>`;
      await message.update({content,rolls:[roll],[`flags.${ns}.pendingDamagePublic.status`]:'rolled'});
    }else{
      await createEffectChatCard({actor,item,before,after:{...before},formulas:[`${plan.effectName}: ${plan.type} ${amount} (${plan.formula})`],resistances:[],rolls:[roll],requiredCosts:[],
        externalTarget:{actorUuid:target.uuid,name:target.name,changes:[{key,from:current,to:next}]},
        resistanceRequest:request,reusePublicMessage:message,freeRoll:false});
    }
    await privateMessage.update({[`flags.${ns}.pendingDamage.used`]:true});
  }catch(error){console.error('Multiverso | rolar dano',error);ui.notifications.error('Não foi possível rolar o dano. Confira F12.');}
  finally{rollingDamage.delete(message.id);button.disabled=false;}
}

// Compatibilidade fiel: no original a macro "Rolar teste" calcula os dados,
// modificadores, vantagens e habilidades ativáveis. Não substituímos por um d20 fictício.
import {rollOriginalResistance} from './resistance-test.mjs';
const resistanceBusy=new Set();
async function commitResistance(publicMessage, total) {
  const record=publicMessage.getFlag(ns,'publicEffect');
  if(!record?.resistancePending||record.resistanceResolved)return false;
  const privateMessage=game.messages.get(record.privateMessageId);
  const privateData=privateMessage?.getFlag(ns,'effectCard');
  const request=privateData?.resistanceRequest;
  if(!request)throw Error('Dados privados da resistência indisponíveis. Execute com o mestre ou conjurador conectado.');
  const target=await fromUuid(request.targetUuid);
  if(!target)throw Error('Alvo da resistência não encontrado.');
  const passed=Number(total)>=Number(request.dt);
  const outcome=passed?request.success:request.failure;
  if(!['completo','metade','sem_efeito'].includes(outcome))throw Error('Consequência de resistência inválida: '+outcome);
  const scale=outcome==='completo'?1:outcome==='metade'?0.5:0;
  const old=privateData.externalTarget?.changes?.[0];
  if(!old ||old.key!==request.key)throw Error('Recurso de resistência inconsistente.');
  const delta=Math.sign(request.rawDelta)*Math.floor(Math.abs(request.rawDelta)*scale);
  const newValue=Math.max(0,Math.min(request.max,old.from+delta));
  const replacement={...privateData.externalTarget,changes:[{key:old.key,from:old.from,to:newValue}]};
  await privateMessage.update({[`flags.${ns}.effectCard.externalTarget`]:replacement,[`flags.${ns}.effectCard.resistanceRequest`]:null});
  await publicMessage.update({[`flags.${ns}.publicEffect.resistancePending`]:false,[`flags.${ns}.publicEffect.resistanceResolved`]:{total:Number(total),passed,outcome}});
  return true;
}
async function resolveResistance(publicMessage,button,rollRequested=false){
  if(resistanceBusy.has(publicMessage.id))return;
  const record=publicMessage.getFlag(ns,'publicEffect');
  if(!record?.resistancePending||record.resistanceResolved)return;
  const req=record.resistancePublic;
  if(!req)return ui.notifications.warn('Solicitação antiga sem referência pública. Gere uma nova Skill.');
  const target=await fromUuid(req.targetUuid);
  if(!target)return ui.notifications.warn('Alvo não encontrado.');
  if(!target.isOwner&&!game.user.isGM)return ui.notifications.warn('Somente o dono do alvo ou o mestre podem testar esta resistência.');
  resistanceBusy.add(publicMessage.id);button.disabled=true;
  try{
    let total;
    const result=await rollOriginalResistance(target,req.testName);
    if(!result)return;
    total=Number(result.total);
    // O alvo pode não ter permissão para modificar a mensagem do conjurador.
    // Nesse caso publica uma resposta assinada para o mestre/conjurador processar.
    if(!game.user.isGM&&record.createdBy!==game.user.id){
      await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:target}),
        content:`<section class="mv-chat-effect"><div class="mv-chat-effect-header"><strong>Resistência — ${esc(req.testName)}</strong></div><div class="mv-chat-effect-body">${esc(target.name)}: <strong>${esc(total)}</strong> contra DT ${esc(req.dt)} — ${total>=Number(req.dt)?'Sucesso':'Falha'}.<p>Resultado enviado para resolução pelo mestre/conjurador.</p></div></section>`,
        flags:{[ns]:{resistanceReply:{publicMessageId:publicMessage.id,targetUuid:target.uuid,total,requestId:req.requestId}}}});
      ui.notifications.info('Resistência enviada. O mestre ou conjurador concluirá a aplicação.');
      return;
    }
    await commitResistance(publicMessage,total);
    ui.notifications.info('Resistência resolvida. O efeito já pode ser aplicado.');
  }catch(err){console.error('Multiverso | resistência no chat',err);ui.notifications.error(err.message||'Falha na resistência; consulte F12.');}
  finally{resistanceBusy.delete(publicMessage.id);button.disabled=false;}
}
async function receiveResistanceReply(message){
  const reply=message.getFlag?.(ns,'resistanceReply');
  if(!reply)return;
  const activeGM=game.users.find(u=>u.isGM&&u.active);
  if(game.user.isGM && activeGM && activeGM.id!==game.user.id)return;
  const publicMessage=game.messages.get(reply.publicMessageId);
  const rec=publicMessage?.getFlag(ns,'publicEffect');
  if(!rec?.resistancePending||rec.resistanceResolved||reply.requestId!==rec.resistancePublic?.requestId)return;
  const actor=await fromUuid(reply.targetUuid);
  if(!actor||message.speaker?.actor!==actor.id||!actor.testUserPermission(message.author,'OWNER')||!Number.isFinite(Number(reply.total)))return;
  if(!game.user.isGM&&rec.createdBy!==game.user.id)return;
  try{await commitResistance(publicMessage,Number(reply.total));}
  catch(err){console.warn('Multiverso | resposta de resistência pendente',err);}
}
// Mesmo marcador usado na rota externa: proteções mantidas não são atributos
// numéricos. Nunca criar mudança de atributo para imunidade/vulnerabilidade.
export function maintainedMarkerData(entry){
  const data=entry?.maintainedEffect;
  if(!data)throw new Error('Registro de efeito mantido ausente.');
  const baseFlags={trackingId:entry.id,sourceUuid:entry.sourceUuid};
  if(data.protection){
    const p=data.protection;
    if(!['resistencia','vulnerabilidade','imunidade'].includes(p.natureza))throw new Error('Tipo de proteção temporária inválido.');
    if(!p.tipoDano||typeof p.tipoDano!=='string'||p.tipoDano==='outro')throw new Error('Tipo de dano da proteção não configurado.');
    if(!Number.isFinite(Number(p.valor))||(p.natureza==='resistencia'&&Number(p.valor)<=0))throw new Error('Valor de proteção temporária inválido.');
    return {name:`Proteção: ${entry.name} (${entry.source})`,disabled:false,changes:[],flags:{[ns]:{...baseFlags,protecaoDano:{...p}}}};
  }
  if(data.condition!==true && (!/^(?:[a-z]+numero|esquivabonus|bloqueiobonus|(?:pv|pm|sta|san)_max|fluxoextramax)$/.test(data.attributeKey)||!Number.isFinite(data.delta)))throw new Error('Modificador contínuo inválido.');
  if(data.condition===true && (!Array.isArray(data.mechanics??[]) || (data.mechanics??[]).length>5 || (data.mechanics??[]).some(m=>{
    if(m.blocksAction)return false;
    if(m.kind==='advantage')return !(['vantagem','desvantagem'].includes(m.mode)&&['continuous','once'].includes(m.uses)&&typeof m.scope==='string');
    const compatible=m.kind==='capacity'||(m.kind==='damage'&&['caused','received'].includes(m.direction)&&['any','melee','ranged'].includes(m.scope))||['forcanumero','agilidadenumero','resistencianumero','inteligencianumero','carismanumero','percepcaonumero','deslocamentonumero','esquivabonus','bloqueiobonus'].includes(m.attributeKey);
    return !compatible||!Number.isFinite(m.delta);
  })))throw new Error('Mecânica interna da condição inválida.');
  return {
    name:data.condition?String(data.name||entry.name):`${entry.name} (${entry.source})`,disabled:false,
    // Atributos armazenados na ficha têm marcador sem mudanças ActiveEffect para não somar duas vezes.
    changes:data.condition?changeList(data.mechanics??[]):isStoredAttribute(entry)?[]:[{key:`system.${data.attributeKey}`,mode:CONST.ACTIVE_EFFECT_MODES.ADD,value:String(data.delta),priority:20}],
    flags:{[ns]:{...baseFlags,storedAttributeDelta:isStoredAttribute(entry)?{key:data.attributeKey,delta:data.delta}:null,isCondition:data.condition===true,...conditionFlags(data.mechanics??[]),blocksAction:data.condition===true&&(data.mechanics??[]).some(m=>m.blocksAction),blockedActionTypes:data.condition===true?(data.mechanics??[]).filter(m=>m.blocksAction).flatMap(m=>m.blockedActionTypes??['todas']):[]}}
  };
}

async function applyCard(message, button, publicMessage=null, automatic=false) {
  const record = message.getFlag(ns,'effectCard');
  if(record?.resistanceRequest){ui.notifications.warn('Resolva a resistência no card público antes de aplicar.');return;}
  if(!record || record.status !== 'pending') { ui.notifications.warn('Esse efeito já foi resolvido.'); return; }
  if(pending.has(message.id))return;
  const actor=await fromUuid(record.actorUuid);
  if(!actor || actor.documentName!=='Actor') {ui.notifications.error('Personagem do card não encontrado.');return;}
  if(!actor.isOwner) {ui.notifications.warn('Você não tem permissão para alterar esse personagem.');return;}
  const externalData=record.externalTarget;
  const externalActor=externalData?await fromUuid(externalData.actorUuid):null;
  if(externalData && (!externalActor || externalActor.documentName!=='Actor' || !externalActor.isOwner)){ui.notifications.warn('Sem permissão para alterar o alvo externo; peça ao mestre para aplicar.');return;}
  // O próprio autor (ou GM) resolve o card; isso evita falhas de permissão ao atualizar a mensagem.
  if(!game.user.isGM && message.author?.id!==game.user.id){ui.notifications.warn('Apenas quem criou o card ou o mestre pode aplicá-lo.');return;}
  pending.add(message.id);if(button)button.disabled=true;
  try {
    const latest=message.getFlag(ns,'effectCard');
    if(!latest || latest.status!=='pending')return;
    const labels=Object.fromEntries(availableFluxes(actor).map(f=>[f.key,f.label]));
    const validKeys=availableFluxes(actor).map(f=>f.key);
    const changes=latest.changes || [];
    const requiredCosts=latest.requiredCosts ?? (latest.requiredCost ? [latest.requiredCost] : []);
    if(!Array.isArray(requiredCosts)||requiredCosts.some(c=>!validKeys.includes(c.key)||!Number.isFinite(c.amount)||c.amount<0||!Number.isFinite(c.atCreation)||c.label&&normalizeFluxName(c.label)!==normalizeFluxName(labels[c.key])))throw new Error('Custo do card inválido.');
    if(requiredCosts.some(c=>Number(actor.system[c.key]??0)!==c.atCreation)){ui.notifications.warn('O recurso usado no custo mudou depois da rolagem. Faça novo teste.');return;}
    if(changes.some(c=>!validKeys.includes(c.key) || !Number.isFinite(c.from) || !Number.isFinite(c.to)))throw new Error('Dados do card inválidos.');
    const targetChanges=externalData?.changes??[];
    if(externalData && (!Array.isArray(targetChanges)||targetChanges.some(c=>!validKeys.includes(c.key)||!Number.isFinite(c.from)||!Number.isFinite(c.to))))throw new Error('Dados externos inválidos.');
    if(externalActor && targetChanges.some(c=>Number(externalActor.system[c.key]??0)!==c.from)){ui.notifications.warn('O alvo mudou desde a rolagem. Faça novo teste.');return;}
    const stale=changes.find(c=>Number(actor.system[c.key]??0)!==c.from);
    if(stale){ui.notifications.warn('A ficha mudou depois da rolagem. Faça um novo teste para atualizar os valores.');return;}
    const accepted=automatic || await foundry.applications.api.DialogV2.confirm({window:{title:latest.freeRoll?'Confirmar rolagem livre':'Aplicar efeito do chat'},content:`<p>${latest.freeRoll?'Confirmar o uso da habilidade e seus eventuais custos por':'Aplicar o efeito em'} <strong>${esc(actor.name)}</strong>?</p>${latest.freeRoll?'<p><b>Sem alvo:</b> nenhum dano ou cura será aplicado a outro personagem.</p>':''}<ul>${changes.map(c=>`<li>${(labels?.[c.key]??resourceLabel[c.key]??c.key)}: ${c.from} → ${c.to}</li>`).join('')}</ul>${externalActor?`<p><b>Alvo: ${esc(externalActor.name)}</b></p><ul>${targetChanges.map(c=>`<li>${(labels?.[c.key]??resourceLabel[c.key]??c.key)}: ${c.from} → ${c.to}</li>`).join('')}</ul>`:''}<p>${latest.freeRoll?'Somente os custos listados serão cobrados da ficha; a rolagem permanece no chat.':'Esta alteração modifica a ficha do personagem.'}</p>`,rejectClose:false});
    if(!accepted)return;
    // Revalidar depois da confirmação para evitar usar PV antigo.
    const actorLatest=await fromUuid(record.actorUuid);
    if(requiredCosts.some(c=>Number(actorLatest?.system[c.key]??0)!==c.atCreation) || changes.some(c=>Number(actorLatest?.system[c.key]??0)!==c.from)) {ui.notifications.warn('Os recursos mudaram antes de aplicar. Refazer o teste.');return;}
    if(externalActor){const targetLatest=await fromUuid(externalData.actorUuid);if(!targetLatest?.isOwner||targetChanges.some(c=>Number(targetLatest.system[c.key]??0)!==c.from)){ui.notifications.warn('O alvo mudou ou não pode ser editado. Faça novo teste.');return;}}
    const patch=Object.fromEntries(changes.map(c=>[`system.${c.key}`,c.to]));
    const timedEntries=Array.isArray(latest.timedEntries)?latest.timedEntries:[];
    if(timedEntries.length){
      const combat=game.combat;
      if(timedEntries.some(e=>e.sceneBound)){
        if(combat?.started||timedEntries.some(e=>!e.sceneBound||e.sceneId!==canvas?.scene?.id)) {ui.notifications.warn('A cena ou situação de combate mudou desde a rolagem. Faça um novo teste.');return;}
      }else if(!combat?.started||timedEntries.some(e=>e.combatId!==combat.id || !combat.combatants?.get(e.combatantId))) {ui.notifications.warn('O combate mudou desde a rolagem. Faça um novo teste.');return;}
      const active=readTracked(actorLatest);
      // A duração é persistida via setFlag após a criação dos ActiveEffects.
      // Evita updates compostos que podem não preservar o registro no Foundry.
    }
    const sourceItem=await fromUuid(latest.itemUuid).catch(()=>null);
    if(!sourceItem||sourceItem.parent?.uuid!==actorLatest.uuid)throw new Error('Skill do card não existe mais na ficha.');
    const usesBefore=usageStatus(actorLatest,sourceItem);
    if(!usesBefore.ok){ui.notifications.warn(usesBefore.error??`Usos esgotados (${usesBefore.used}/${usesBefore.config.limit}).`);return false;}
    const continuous=timedEntries.filter(e=>e.maintainedEffect);
    const oneTimeTests=Array.isArray(latest.instantTestEffects)?latest.instantTestEffects:[];
    if(oneTimeTests.some(m=>!['vantagem','desvantagem'].includes(m.mode)||!/^[a-z]+numero$/.test(m.scope)||m.uses!=='once'))throw new Error('Teste temporário inválido no card.');
    const createdEffects=[];
    const beforeTracked=readTracked(actorLatest);
    let usageTaken=null;
    let valuesUpdated=false;
    let originalValues={};
    try {
      usageTaken=await takeUsage(actorLatest,sourceItem);
      if(!usageTaken.ok)throw new Error('Uso indisponível; não foi descontado nenhum recurso.');
      for(const entry of continuous){
        const created=await actorLatest.createEmbeddedDocuments('ActiveEffect',[maintainedMarkerData(entry)]);
        createdEffects.push(...created);
      }
      if(oneTimeTests.length){
        const created=await actorLatest.createEmbeddedDocuments('ActiveEffect',[{name:`${sourceItem.name} • próximo teste`,disabled:false,changes:[],flags:{[ns]:{isCondition:true,sourceUuid:sourceItem.uuid,conditionMechanics:oneTimeTests.map(m=>({kind:'advantage',...m}))}}}]);
        createdEffects.push(...created);
      }
      const stored=buildAttributeActivationPatch(actorLatest,continuous);
      originalValues={...Object.fromEntries(changes.map(c=>[c.key,c.from])),...stored.before};
      const allChanges={...patch,...stored.patch};
      if(Object.keys(allChanges).length){await actorLatest.update(allChanges);valuesUpdated=true;}
      if(externalActor && targetChanges.length){
        await externalActor.update(Object.fromEntries(targetChanges.map(c=>[`system.${c.key}`,c.to])));
      }
      if(timedEntries.length){
        await actorLatest.setFlag(ns,'trackedDurations',[...beforeTracked,...timedEntries]);
        const persisted=readTracked(actorLatest);
        if(timedEntries.some(entry=>!persisted.some(saved=>saved.id===entry.id))){
          throw new Error('Registro de duração não persistiu após setFlag.');
        }
      }
    }catch(error){
      if(usageTaken?.limited)try{await restoreUsage(actorLatest,usageTaken);}catch(rollbackError){console.error('Multiverso RPG | rollback de uso',rollbackError);}
      for(const ae of createdEffects){try{await ae.delete();}catch(rollbackError){console.error('Multiverso RPG | rollback de bônus',rollbackError);}}
      if(timedEntries.length){try{await actorLatest.setFlag(ns,'trackedDurations',beforeTracked);}catch(rollbackError){console.error('Multiverso RPG | rollback de duração',rollbackError);}}
      if(externalActor && targetChanges.length){try{await externalActor.update(Object.fromEntries(targetChanges.map(c=>[`system.${c.key}`,c.from])));}catch(rollbackError){console.error('Multiverso RPG | rollback alvo externo',rollbackError);}}
      if(valuesUpdated){try{await actorLatest.update(Object.fromEntries(Object.entries(originalValues).map(([k,v])=>[`system.${k}`,v])));}catch(rollbackError){console.error('Multiverso RPG | rollback de atributos/recursos',rollbackError);}}
      throw error;
    }
    await message.update({[`flags.${ns}.effectCard.status`]:'applied',[`flags.${ns}.effectCard.appliedBy`]:game.user.id});
    if(publicMessage)await publicMessage.update({[`flags.${ns}.publicEffect.status`]:'applied'});
    // A janela de confirmação da Skill já apresenta os custos; não duplicar o chat.
    const costNotes=requiredCosts.map(c=>`${(labels?.[c.key]??resourceLabel[c.key]??c.key)} ${c.atCreation} → ${c.atCreation-c.amount}`).join(' · ');
    const usageNote=usageTaken?.limited?` · usos restantes ${usageTaken.remaining}/${usageTaken.config.limit}`:'';
    ui.notifications.info(costNotes?`Uso confirmado. Custos privados: ${costNotes}${usageNote}`:(automatic?'Efeito aplicado automaticamente à própria ficha.':'Efeito aplicado na ficha pelo chat.'));
    return true;
  } catch(error){console.error('Multiverso RPG | erro ao aplicar card',error);ui.notifications.error('Não foi possível concluir a aplicação. Confira a ficha e o card antes de tentar novamente.');return false;}
  finally {pending.delete(message.id);if(button)button.disabled=false;}
}

function bindCard(message,html){
  const root=html instanceof HTMLElement?html:(html?.[0]??html);
  if(!root?.querySelectorAll)return;
  const pendingPublic=message.getFlag(ns,'pendingDamagePublic');
  if(pendingPublic?.status==='pending')for(const panel of root.querySelectorAll('[data-mv-pending-damage]')){
    const b=panel.querySelector('[data-mv-roll-damage]');if(!b)continue;
    b.disabled=!game.user.isGM&&pendingPublic.createdBy!==game.user.id;
    if(!b.dataset.mvBound){b.dataset.mvBound='true';b.addEventListener('click',()=>rollPendingDamage(message,b));}
  }
  const data=message.getFlag(ns,'effectCard');
  const publicRecord=message.getFlag(ns,'publicEffect');
  if(publicRecord){
    for(const panel of root.querySelectorAll('[data-mv-public-effect]')){
      const publicButton=panel.querySelector('[data-mv-public-apply]');
      const status=panel.querySelector('[data-mv-public-status]');
      if(!publicButton){
        // Para dano/cura sem efeito persistente o chat é informativo e o dado
        // permanece utilizável pelo menu de aplicação por clique direito.
        const panelResistance=panel.querySelector('[data-mv-resistance-request]');
        if(panelResistance){
          const result=publicRecord.resistanceResolved;
          if(result){
            panelResistance.innerHTML=`<strong>Resistência resolvida</strong><span>Total ${esc(result.total)} — ${result.passed?'SUCESSO':'FALHA'} — ${esc(result.outcome==='completo'?'Efeito completo':result.outcome==='metade'?'Metade do efeito':'Sem efeito')}</span>`;
          }else{
            const b=panelResistance.querySelector('[data-mv-resistance-roll]');
            if(b&&!b.dataset.mvBound){b.dataset.mvBound='true';b.addEventListener('click',()=>resolveResistance(message,b,true));}
          }
        }
        continue;
      }
      if(publicRecord.status==='applied'){
        publicButton.disabled=true;publicButton.textContent='Efeito aplicado';
        if(status)status.textContent='Aplicação concluída.';
      }else{
        const authorized=game.user.isGM||publicRecord.createdBy===game.user.id;
        publicButton.disabled=!authorized||Boolean(publicRecord.resistancePending);
        const panelResistance=panel.querySelector('[data-mv-resistance-request]');
        if(panelResistance){
          const result=publicRecord.resistanceResolved;
          if(result){
            panelResistance.innerHTML=`<strong>Resistência resolvida</strong><span>Total ${esc(result.total)} — ${result.passed?'SUCESSO':'FALHA'} — ${esc(result.outcome==='completo'?'Efeito completo':result.outcome==='metade'?'Metade do efeito':'Sem efeito')}</span>`;
          }else{
            for(const [selector,rolled] of [['[data-mv-resistance-roll]',true]]){
              const b=panelResistance.querySelector(selector);
              if(b&&!b.dataset.mvBound){b.dataset.mvBound='true';b.addEventListener('click',()=>resolveResistance(message,b,rolled));}
            }
          }
        }
        if(!publicButton.dataset.mvBound){
          publicButton.dataset.mvBound='true';
          publicButton.addEventListener('click',async()=>{
            const privateMessage=game.messages.get(publicRecord.privateMessageId);
            if(!privateMessage){ui.notifications.warn('Os detalhes privados não estão disponíveis nesta sessão. Peça ao conjurador ou mestre para aplicar.');return;}
            await applyCard(privateMessage,publicButton,message);
          });
        }
      }
    }
  }
  const cards=[...root.querySelectorAll('[data-mv-chat-effect]')];
  if(root.matches?.('[data-mv-chat-effect]'))cards.unshift(root);
  for(const card of cards){
    const button=card.querySelector('[data-mv-apply-effect]');
    const status=card.querySelector('[data-mv-effect-status]');
    if(!button)return;
    if(data?.status==='applied'){
      button.textContent=data.freeRoll?'Uso confirmado':'Efeito aplicado';button.disabled=true;
      if(status)status.textContent=data.freeRoll?'Rolagem livre confirmada; custos processados.':'Aplicado na ficha.';
    } else {
      button.disabled=!data || (!game.user.isGM && message.author?.id!==game.user.id);
      if(!button.dataset.mvBound){button.dataset.mvBound='true';button.addEventListener('click',()=>applyCard(message,button));}
    }
  }
}
export function registerEffectChatCards(){
  Hooks.on('createChatMessage', message => { void receiveResistanceReply(message); });
  Hooks.once('ready', () => { for (const message of game.messages.contents) if (message.getFlag?.(ns,'resistanceReply')) void receiveResistanceReply(message); });
  // Foundry v14 (ApplicationV2) e fallback de renderização clássica.
  Hooks.on('renderChatMessageHTML',bindCard);
  Hooks.on('renderChatMessage',bindCard);
}
