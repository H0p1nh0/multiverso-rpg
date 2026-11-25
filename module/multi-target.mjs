import {selectedExternalTokens} from './selected-targets.mjs';
import {passiveDamage, damageTypeLabel} from './passive-bonuses.mjs';
// Experimental: múltiplos alvos / efeitos imediatos, um card público por ativação.
// Referência: motor-efeitos.js: grupoResistenciaPendente (agrupar pelo nome do teste,
// comparar cada efeito à sua própria DT), e macro Rolar teste V8.
// Não aplica dano automaticamente: a janela de aplicação genérica segue intacta.
import {rollOriginalResistance} from './resistance-test.mjs';
import {primaryCost,optionalCost,chooseReinforcement} from './native-effects.mjs';
import {confirmOriginalUse} from './confirmation-original.mjs';
import {getLastInteractedActor} from './chat-roll-apply.mjs';
import {availableFluxes,fluxById} from './extra-flux.mjs';
import {usageStatus,takeUsage,restoreUsage} from './skill-uses.mjs';
import {askActivationChoices,activationChoiceValue} from './activation-choices.mjs';
import {resolveDamageProtection} from './damage-protection.mjs';
const NS='multiverso-rpg';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const resourceMap={pv:'pv_atual',pm:'pm_atual',sta:'sta_atual',san:'san_atual'};
const pending=new Set();
const magnitude=(amount,mode)=> mode==='sem_efeito'?0:mode==='metade'?Math.floor(amount/2):amount;
function limitFor(item,effects){
  const props=item.system?.props??{};
  const values=effects.map(e=>String(props[`efeito${item.type}qtdalvos${e.index===1?'':e.index}`]??'').trim()).filter(Boolean);
  if(values.some(v=>!/^[1-9]\d*$/.test(v)))return {error:'Quantidade de Alvos precisa ser um inteiro positivo para esta execução.'};
  const numbers=values.map(Number);
  if(new Set(numbers).size>1)return {error:'Os efeitos indicam quantidades de alvos diferentes; use a mesma quantidade de alvos nos efeitos combinados.'};
  return {limit:numbers[0]??null};
}
// v0.1.68: a seleção é opcional, mas, se existir, respeita o teto cadastrado.
// Tokens marcados NÃO pré-cadastram participantes no card.
export async function validateSelectedTargetLimit(item,effects){
  const cap=limitFor(item,effects);
  // Diagnósticos de campos conflitantes permanecem sob responsabilidade do executor.
  if(cap.error)return true;
  const max=cap.limit;
  if(!Number.isInteger(max))return true;
  const marked=selectedExternalTokens(item?.parent);
  const count=marked.length;
  if(count<=max)return true;
  const exceeding=count-max;
  const noun=n=>n===1?'personagem':'personagens';
  const detail=`Esta habilidade permite atingir no máximo <strong>${max} ${noun(max)}</strong>, mas você selecionou <strong>${count}</strong>.`;
  await foundry.applications.api.DialogV2.wait({
    window:{title:'Multiverso • Limite de alvos excedido',resizable:false},
    content:`<section class="mv-diagnostic mv-target-limit" style="background:#211c25;color:#f2dfbd;border:1px solid #ba9359;border-radius:10px;padding:18px;line-height:1.5">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
        <span aria-hidden="true" style="font-size:25px;color:#efcf95">⚔</span>
        <h2 style="color:#efcf95;margin:0;font-weight:700">Limite de alvos excedido</h2>
      </div>
      <p style="margin:0 0 12px">${detail}</p>
      <div style="background:#31282a;border:1px solid #665138;border-radius:8px;padding:12px;color:#e7d0a5">Desmarque <strong>${exceeding} ${exceeding===1?'alvo':'alvos'}</strong> para continuar.</div>
    </section>`,
    buttons:[{action:'ok',label:'Entendi',default:true}]
  });
  return false;
}
function groups(effects){
  const map=new Map();
  for(const e of effects){if(!e.resistanceActive)continue;
    const k=key(e.testName);
    if(!map.has(k))map.set(k,{key:k,name:e.testName,effects:[]});
    map.get(k).effects.push(e.index);
  }
  return [...map.values()];
}
function resultFor(effect,total,rollValue){
  const success= !effect.resistanceActive ? null : Number(total)>=effect.dt;
  const outcome= !effect.resistanceActive?'completo':success?effect.success:effect.failure;
  const amount=magnitude(rollValue,outcome);
  return {amount,success,outcome};
}
function display(messageData){
  const effects=messageData.effects??[];
  const targets=messageData.targets??[];
  const allRolled=effects.every(e=>Number.isFinite(e.total));
  // One shared button for all targets. Only actors with recorded tests appear below it.
  const groupsList=messageData.groups??[];
  const limit=Number.isInteger(messageData.limit)?messageData.limit:null;
  const totalTests=targets.reduce((n,t)=>n+groupsList.filter(g=>Number.isFinite(t.tests?.[g.key])).length,0);
  const expectedTests=limit===null?null:limit*groupsList.length;
  const remaining=expectedTests===null?null:Math.max(0,expectedTests-totalTests);
  const canRegister=groupsList.length>0&&(limit===null||targets.length<limit||targets.some(t=>groupsList.some(g=>!Number.isFinite(t.tests?.[g.key]))));
  const rows=targets.map(t=>{
    const completed=groupsList.filter(g=>Number.isFinite(t.tests?.[g.key]));
    if(!completed.length&&!allRolled)return '';
    const tests=completed.map(g=>{
      const value=t.tests[g.key];
      const effectDts=effects.filter(e=>g.effects.includes(e.index)).map(e=>e.dt).join('/');
      return `<div class="mv-multi-test"><span>${esc(g.name)} • DT ${esc(effectDts)}</span><b>${esc(value)}</b> — concluído</div>`;
    }).join('');
    const outcomes=allRolled?effects.map(e=>{
      const total=e.resistanceActive?t.tests?.[key(e.testName)]:0;
      if(e.resistanceActive&&!Number.isFinite(total))return `<div>${esc(e.name)}: aguardando resistência</div>`;
      const r=resultFor(e,total,e.total);
      const protection=t.protections?.[String(e.index)];
      const amount=protection?.blocked?"Indisponível":protection&&Number.isFinite(protection.final)?protection.final:r.amount;
      const protectionText=protection?.blocked?' • Proteção não suportada':protection?.imune?' • Imune':protection?.vulneravel?' • Vulnerabilidade ×2':protection?.resistenciaFixa||protection?.resistenciaPercentual?' • Proteção aplicada':'';
      const text=r.outcome==='metade'?'metade':r.outcome==='sem_efeito'?'anulado':'completo';
      return `<div>${esc(e.name)}: <strong class="mv-multi-amount" data-mv-multi-amount data-mv-target="${esc(t.uuid)}" data-mv-effect="${esc(e.index)}" title="Clique direito para abrir a aplicação">${esc(amount)}</strong> ${esc(e.type==='cura'?'cura':'dano')} (${text}${esc(protectionText)})</div>`;
    }).join(''):'';
    return `<div class="mv-multi-target" style="border-top:1px solid #907043;padding:9px 0"><strong>${esc(t.name)}</strong>${tests}${outcomes?`<div class="mv-multi-outcome">${outcomes}</div>`:''}</div>`;
  }).join('');
  const testControls=groupsList.length?`<div class="mv-multi-shared"><small>Resistências registradas: ${totalTests}${expectedTests===null?'':`/${expectedTests}`} ${limit===null?'• Sem limite de alvos definido':`• Vagas para novos personagens: ${Math.max(0,limit-targets.length)}`}</small>${canRegister?`<button type="button" data-mv-multi-resist-shared ${!allRolled?'disabled':''} style="background:#98713a!important;color:#fff1ca!important;border:1px solid #d6ab60!important;opacity:1!important;font-weight:700!important">Rolar resistência</button>`:'<small>Limite atingido e todos os testes concluídos.</small>'}</div>`:'';
  return `<section class="mv-chat-effect" data-mv-multi-card>
    <div class="mv-chat-effect-header"><strong>${esc(messageData.itemName)}</strong><small>Multiverso RPG • ${limit===null?"Alvos livres":`${limit} alvo(s) máx.`}, ${effects.length} efeito(s)</small></div>
    <div class="mv-chat-effect-body">${effects.map(e=>`<div class="mv-damage-parts"><strong>${esc(e.name)} — ${esc(e.type==='cura'?'Cura':'Dano')}: ${esc(e.formula)}</strong>${Number.isFinite(e.total)?` <b> = ${esc(e.total)}</b>`:''}
      ${e.parts?.length?`<div class="mv-damage-part-list">${e.parts.map(part=>`<div class="mv-damage-part"><span>${esc(part.source)}: <b>${esc(part.formula)}</b>${part.damageType?` <em>(${esc(damageTypeLabel(part.damageType))})</em>`:''}</span><strong>${esc(part.total)}</strong></div>`).join('')}</div>`:`${e.damageType?`<small>Tipo: ${esc(damageTypeLabel(e.damageType))}</small>`:''}`}</div>`).join('')}
    ${!allRolled?'<button type="button" data-mv-multi-damage style="background:#98713a!important;color:#fff1ca!important;border:1px solid #d6ab60!important;opacity:1!important;font-weight:700!important">Rolar Dano</button>':'<div data-mv-multi-rolls></div>'}
    ${testControls}${rows}<small>Valores individuais calculados por resistência. A aplicação por clique direito ainda é manual nesta fase experimental.</small></div></section>`;
}
async function updateRendered(message,state,rolls=[]){
  let html=display(state);
  if(rolls.length){const markup=(await Promise.all(rolls.map(r=>r.render()))).join('');html=html.replace('<div data-mv-multi-rolls></div>',`<div class="mv-damage-roll-native">${markup}</div>`);}
  else if(state.rolledHtml)html=html.replace('<div data-mv-multi-rolls></div>',`<div class="mv-damage-roll-native">${state.rolledHtml}</div>`);
  await message.update({content:html,...(rolls.length?{rolls}:{}),[`flags.${NS}.multiTarget`]:state});
}
export async function executeMultiTarget(item,source,allEffects){
  const problems=[];const picked=selectedExternalTokens(source);
  const optionalPlan=optionalCost(item,allEffects.length,source);
  problems.push(...optionalPlan.errors);
  if(problems.length){ui.notifications.warn(problems.join(' '));return false;}
  const chosenExtras=await chooseReinforcement(optionalPlan,source);
  if(chosenExtras===null)return false;
  const activated=new Set(chosenExtras.flatMap(g=>g.slots));
  const props=item.system.props??{};
  const substituted=new Set();
  for(const e of allEffects.filter(e=>activated.has(e.index) && props[`mvOptionalOnly${e.index}`]==='sim')){
    const mode=String(props[`mvOptionalMode${e.index}`]??'somar');
    if(mode==='substituir'){
      const raw=String(props[`mvOptionalReplace${e.index}`]??'');const target=Number(raw);
      if(!/^\d+$/.test(raw)||!Number.isInteger(target)||target<1||target>allEffects.length||target===e.index||props[`mvOptionalOnly${target}`]==='sim'||substituted.has(target))problems.push(`Efeito ${e.index}: substituição opcional inválida.`);
      else substituted.add(target);
    }else if(mode!=='somar')problems.push(`Efeito ${e.index}: modo de reforço desconhecido.`);
  }
  const effects=allEffects.filter(e=>(props[`mvOptionalOnly${e.index}`]!=='sim'||activated.has(e.index))&&!substituted.has(e.index));
  if(!effects.length)problems.push('Nenhum efeito selecionado para executar; nenhum custo será cobrado.');
  const capped=limitFor(item,effects);if(capped.error)problems.push(capped.error);
  if(!(await validateSelectedTargetLimit(item,effects)))return false;
  for(const e of effects){
    if(!['alvo','aliado','inimigo'].includes(e.receiver))problems.push(`Efeito ${e.index}: receptor incompatível com múltiplos alvos.`);
    if(!['dano','cura'].includes(e.type))problems.push(`Efeito ${e.index}: esta configuração aceita apenas dano e cura imediatos em múltiplos alvos.`);
    if(!['pv','pv_atual',''].includes(e.affected))problems.push(`Efeito ${e.index}: somente PV é suportado neste teste.`);
    if(e.cadence!=='once'||!['instant','unspecified'].includes(e.duration.kind))problems.push(`Efeito ${e.index}: configure uma aplicação imediata para múltiplos alvos.`);
    if(e.errors?.some(err=>err!=='O receptor selecionado não é compatível com esta execução.' && !err.includes('Quantidade de Alvos')))problems.push(...e.errors.filter(err=>err!=='O receptor selecionado não é compatível com esta execução.' && !err.includes('Quantidade de Alvos')).map(err=>`Efeito ${e.index}: ${err}`));
    if(!e.diceFormula&&!Number.isFinite(e.value))problems.push(`Efeito ${e.index}: valor inválido.`);
  }

  const cost=primaryCost(item,allEffects.length,source);problems.push(...cost.errors);
  if(problems.length){await foundry.applications.api.DialogV2.wait({window:{title:'Multiverso • Configuração da habilidade'},content:`<section class="mv-diagnostic" style="background:#211c25;color:#f2dfbd;border:1px solid #ba9359;border-radius:10px;padding:18px"><h2 style="color:#efcf95;margin-top:0">⚠ Configuração precisa de atenção</h2><p>Confira estes pontos antes de utilizar a habilidade:</p><ul>${problems.map(p=>`<li style="margin:8px 0">${esc(p)}</li>`).join('')}</ul><small>Nenhum recurso foi gasto e nenhuma rolagem foi realizada.</small></section>`,buttons:[{action:'ok',label:'Entendi'}]});return false;}
  let activationChoices;
  try{activationChoices=await askActivationChoices(item,effects);}catch(error){ui.notifications.warn(error.message);return false;}
  if(activationChoices===null)return false;
  for(const e of effects){
    const choice=activationChoices.get(e.index);
    if(e.dynamicValue&&choice)e.value=activationChoiceValue(choice);
    if(choice?.damageType)e.chosenDamageType=choice.damageType;
  }
  const usage=usageStatus(source,item);if(!usage.ok){ui.notifications.warn(usage.error??`Usos esgotados (${usage.used}/${usage.config.limit}).`);return false;}
  const confirmed=await confirmOriginalUse(item,source,cost.options,chosenExtras.flatMap(g=>g.chosen.costs));if(!confirmed)return false;
  const before=Object.fromEntries(availableFluxes(source).map(f=>[f.key,Number(source.system[f.key]??0)]));
  const patch={};for(const c of confirmed.costs){const k=fluxById(source,c.resource)?.key;if(!k)throw Error('Custo inválido ou Fluxo Extra inativo.');patch[k]=(patch[k]??before[k])-c.amount;}
  if(Object.values(patch).some(v=>v<0||!Number.isFinite(v))){ui.notifications.warn('Recursos insuficientes.');return false;}
  const state={version:1,itemUuid:item.uuid,actorUuid:source.uuid,itemName:item.name,createdBy:game.user.id,
    effects:effects.map(e=>({index:e.index,name:String(item.system.props?.[`mvEffectTitle${e.index}`]??'').trim()||`Efeito ${e.index}`,type:e.type,formula:e.diceFormula??String(e.value),resistanceActive:e.resistanceActive,testName:e.testName,dt:e.dt,success:e.success,failure:e.failure,damageType:String(e.chosenDamageType??item.system.props?.[`efeito${item.type}tipodano${e.index===1?'':e.index}`]??''),total:null})),
    limit:capped.limit,targets:[],groups:groups(effects),rolledHtml:''};
  let usageTaken=null;
  try{
    usageTaken=await takeUsage(source,item);if(!usageTaken.ok)throw Error('Usos esgotados.');
    if(Object.keys(patch).length)await source.update(Object.fromEntries(Object.entries(patch).map(([k,v])=>[`system.${k}`,v])));
    const card=await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:source}),content:display(state),flags:{[NS]:{multiTarget:state}}});
    return !!card;
  }catch(error){if(usageTaken?.limited)await restoreUsage(source,usageTaken).catch(console.error);if(Object.keys(patch).length)await source.update(Object.fromEntries(Object.keys(patch).map(k=>[`system.${k}`,before[k]]))).catch(console.error);throw error;}
}
async function rollDamage(message,button){
  const state=message.getFlag(NS,'multiTarget');if(!state||state.effects.every(e=>Number.isFinite(e.total)))return;
  if(!game.user.isGM&&state.createdBy!==game.user.id)return ui.notifications.warn('Somente o conjurador ou mestre pode rolar este dano.');
  if(pending.has(message.id))return;pending.add(message.id);button.disabled=true;
  try{const actor=await fromUuid(state.actorUuid);if(!actor)throw Error('Conjurador não encontrado.');
    const rolls=[];const skill=await fromUuid(state.itemUuid);if(!skill)throw Error('Skill original não encontrada.');
    for(const e of state.effects){
      const pass=e.type==='dano'?passiveDamage(actor,skill,e.damageType):{bonuses:[],errors:[]};
      if(pass.errors.length)throw Error(pass.errors.join(' '));
      const pieces=[{source:e.name,formula:e.formula,damageType:e.damageType},...pass.bonuses.map(b=>({source:b.source,formula:b.formula,damageType:b.damageType}))];
      const formula=pieces.map(p=>`(${p.formula})`).join(' + ');
      const r=new Roll(formula,actor.getRollData?.()??{});
      await r.evaluate();
      if(!Number.isFinite(r.total)||r.total<0)throw Error('Dano inválido.');
      // Each parenthetical in the combined Foundry Roll retains its own evaluated
      // nested Roll; do not reroll dice just to discover the component totals.
      const terms=(r.terms??[]).filter(t=>t?.roll&&Number.isFinite(t.roll.total));
      if(terms.length===pieces.length)e.parts=pieces.map((part,i)=>({...part,total:Number(terms[i].roll.total)}));
      else {
        // Foundry normally retains nested rolls for each parenthetical. If a
        // future parser changes that, preserve single-type damage behavior.
        // Mixed types MUST NOT silently share one mitigation pool.
        if(new Set(pieces.map(p=>String(p.damageType??'').toLowerCase())).size>1)
          throw Error('Não foi possível separar os tipos de dano nesta versão do Foundry; nenhuma proteção foi calculada.');
        e.parts=[{source:'Dano total',formula,damageType:e.damageType,total:Number(r.total)}];
      }
      if(e.parts.some(p=>!Number.isFinite(p.total)||p.total<0))throw Error('Parcela de dano inválida.');
      rolls.push(r);e.total=Number(r.total);
    }
    state.rolledHtml=(await Promise.all(rolls.map(r=>r.render()))).join('');await updateRendered(message,state,rolls);
  }catch(e){console.error('Multiverso | múltiplos alvos dano',e);ui.notifications.error(e.message);}finally{pending.delete(message.id);button.disabled=false;}
}
async function calculateTargetProtections(target,state){
  const actor=await fromUuid(target.uuid);
  if(!actor)return;
  target.protections={};
  for(const e of state.effects){
    if(e.type!=='dano'||!Number.isFinite(e.total))continue;
    const test=e.resistanceActive?target.tests?.[key(e.testName)]:0;
    if(e.resistanceActive&&!Number.isFinite(test))continue;
    const r=resultFor(e,test,e.total);
    // Protect each DAMAGE TYPE independently, grouping equal types before
    // halving/mitigation. Same-type bonuses retain pre-v0.1.77 exact totals.
    const components=e.type==='dano'&&e.parts?.length?e.parts:[{total:e.total,damageType:e.damageType}];
    const byType=new Map();
    for(const part of components){
      const type=String(part.damageType??e.damageType??'').toLowerCase();
      const previous=byType.get(type)??0;
      byType.set(type,previous+Number(part.total));
    }
    const partProtections=[...byType].map(([damageType,rolled])=>{
      const affected=magnitude(rolled,r.outcome);
      return resolveDamageProtection(actor,affected,damageType);
    });
    if(partProtections.length===1)target.protections[String(e.index)]=partProtections[0];
    else target.protections[String(e.index)]={
      original:partProtections.reduce((n,p)=>n+Number(p.original??0),0),
      final:partProtections.reduce((n,p)=>n+Number(p.final??0),0),
      blocked:partProtections.some(p=>p.blocked),
      imune:partProtections.every(p=>p.imune),
      vulneravel:partProtections.some(p=>p.vulneravel),
      resistenciaFixa:partProtections.reduce((n,p)=>n+Number(p.resistenciaFixa??0),0),
      resistenciaPercentual:partProtections.reduce((n,p)=>n+Number(p.resistenciaPercentual??0),0),
      parts:partProtections
    };
  }
}
async function rollResistance(message,button){
  const state=message.getFlag(NS,'multiTarget');
  if(!state||!state.effects.every(e=>Number.isFinite(e.total)))return;
  // The selected actor is deliberately the most recently interacted sheet, NOT the
  // first target or a random token. This matches the validated application workflow.
  const actor=await getLastInteractedActor();
  if(!actor)return ui.notifications.warn('Abra ou interaja com a ficha que realizará a resistência antes de clicar.');
  const target=state.targets.find(t=>t.uuid===actor.uuid);
  if(!target&&Number.isInteger(state.limit)&&state.targets.length>=state.limit)return ui.notifications.warn(`O limite de ${state.limit} personagem(ns) desta habilidade já foi atingido.`);
  if(!game.user.isGM&&!actor.testUserPermission(game.user,'OWNER'))return ui.notifications.warn('Você não possui permissão para rolar por essa ficha.');
  if(actor.uuid===state.actorUuid)return ui.notifications.warn('O conjurador não pode resistir ao próprio efeito nesta execução.');
  const group=state.groups.find(g=>!Number.isFinite(target?.tests?.[g.key]));
  if(!group)return ui.notifications.warn(`${actor.name} já concluiu todos os testes desta habilidade.`);
  const targetUuid=actor.uuid,testKey=group.key;
  const lock=message.id+':'+targetUuid+':'+testKey;
  if(pending.has(lock))return;
  pending.add(lock);button.disabled=true;
  try{
    // Recheck the shared card before a potentially long interactive roll dialog.
    const current=message.getFlag(NS,'multiTarget');
    if(Number.isFinite(current?.targets?.find(t=>t.uuid===targetUuid)?.tests?.[testKey]))return;
    if(!current?.targets?.some(t=>t.uuid===targetUuid)&&Number.isInteger(current?.limit)&&current.targets.length>=current.limit)return ui.notifications.warn('Limite de alvos atingido.');
    const result=await rollOriginalResistance(actor,group.name);
    if(!result)return;
    if(!game.user.isGM&&state.createdBy!==game.user.id){
      await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`Resistência de ${esc(actor.name)} registrada para ${esc(state.itemName)}.`,flags:{[NS]:{multiReply:{cardId:message.id,targetUuid,testKey,total:Number(result.total),rolledMessageId:result.messageId}}}});
      return;
    }
    const latest=message.getFlag(NS,'multiTarget');
    if(!latest)return;
    let latestTarget=latest.targets.find(t=>t.uuid===targetUuid);
    if(!latestTarget){if(Number.isInteger(latest.limit)&&latest.targets.length>=latest.limit)return ui.notifications.warn('Limite de alvos atingido.');latestTarget={uuid:targetUuid,name:actor.name,tests:{}};latest.targets.push(latestTarget);}
    if(Number.isFinite(latestTarget.tests?.[testKey]))return;
    latestTarget.tests[testKey]=Number(result.total);
    await calculateTargetProtections(latestTarget,latest);
    await updateRendered(message,latest);
  }catch(e){console.error('Multiverso | múltiplos alvos resistência',e);ui.notifications.error(e.message);}
  finally{pending.delete(lock);button.disabled=false;}
}
async function acceptReply(message){
  const reply=message.getFlag(NS,'multiReply');if(!reply)return;
  const liveGM=game.users.find(u=>u.isGM&&u.active);if(game.user.isGM&&liveGM&&liveGM.id!==game.user.id)return;
  const card=game.messages.get(reply.cardId),state=card?.getFlag(NS,'multiTarget');if(!state)return;
  if(!game.user.isGM&&state.createdBy!==game.user.id)return;
  let target=state.targets.find(t=>t.uuid===reply.targetUuid);if(Number.isFinite(target?.tests?.[reply.testKey])||!state.groups.some(g=>g.key===reply.testKey))return;
  if(!target&&Number.isInteger(state.limit)&&state.targets.length>=state.limit)return;
  const actor=await fromUuid(reply.targetUuid);
  const originalRoll=game.messages.get(reply.rolledMessageId);
  if(!actor||message.speaker?.actor!==actor.id||!actor.testUserPermission(message.author,'OWNER')||!Number.isFinite(reply.total))return;
  if(!originalRoll||originalRoll.author?.id!==message.author?.id||originalRoll.speaker?.actor!==actor.id||!originalRoll.rolls?.length||Number(originalRoll.rolls[0].total)!==Number(reply.total))return;
  if(reply.targetUuid===state.actorUuid)return;
  if(!target){target={uuid:actor.uuid,name:actor.name,tests:{}};state.targets.push(target);}
  target.tests[reply.testKey]=reply.total;
  await calculateTargetProtections(target,state);
  await updateRendered(card,state);
}
function bind(message,html){
  const root=html instanceof HTMLElement?html:(html?.[0]??html);if(!root?.querySelectorAll||!message.getFlag(NS,'multiTarget'))return;
  for(const panel of root.querySelectorAll('[data-mv-multi-card]')){
    const damage=panel.querySelector('[data-mv-multi-damage]');if(damage&&!damage.dataset.mvReady){damage.dataset.mvReady='yes';damage.addEventListener('click',()=>rollDamage(message,damage));}
    const shared=panel.querySelector('[data-mv-multi-resist-shared]');
    if(shared&&!shared.dataset.mvReady){shared.dataset.mvReady='yes';shared.addEventListener('click',()=>rollResistance(message,shared));}
  }
}
export function registerMultiTarget(){
  Hooks.on('renderChatMessageHTML',bind);Hooks.on('renderChatMessage',bind);
  Hooks.on('createChatMessage',m=>{void acceptReply(m).catch(e=>console.warn('Multiverso | resposta múltipla',e));});
  Hooks.once('ready',()=>{for(const m of game.messages.contents)if(m.getFlag?.(NS,'multiReply'))void acceptReply(m).catch(console.warn);});
}
