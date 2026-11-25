// Resistência postergada do executor composto (um alvo, DT fixa).
// Nenhum custo ou efeito é registrado antes da resposta do defensor.
import {rollOriginalResistance} from './resistance-test.mjs';
import {diagnose} from './native-effects.mjs';
import {executeExternalAdvanced} from './external-advanced.mjs';
const NS='multiverso-rpg';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const working=new Set();
function html(s){
 const state=s.status==='done'?'Resistência resolvida e habilidade executada.':s.status==='processing'?'Aplicando o resultado...':s.status==='failed'?'Falha na execução; confira o console.':'Aguardando a resistência do alvo.';
 return `<section class="mv-chat-effect mv-cast-story"><div class="mv-chat-effect-header"><strong>${esc(s.itemName)}</strong><small>${esc(s.casterName)} • Habilidade</small></div><div class="mv-chat-effect-body">${s.description?`<p class="mv-cast-story-description">${esc(s.description)}</p>`:''}<div class="mv-cast-story-targets"><strong>✦ Afetados</strong><div>${esc(s.targetName)}</div></div><p>Resistência: <b>${esc(s.testName)}</b> • DT ${esc(s.dt)}</p>${s.status==='pending'?'<button type="button" data-mv-external-resist>Resistir</button>':''}<small>${state}</small></div></section>`;
}
export async function queueExternalResistance({item,source,target,effects}){
 const testSpecs=[...new Map(effects.filter(e=>e.resistanceActive).map(e=>[`${e.testName}|${e.dt}`,{testName:e.testName,dt:e.dt}])).values()];
 if(testSpecs.length!==1)throw Error('O card de resistência para efeitos compostos exige um único teste e uma DT fixa.');
 const spec=testSpecs[0];if(!Number.isFinite(Number(spec.dt)))throw Error('DT de resistência inválida.');
 const p=item.system?.props??{};
 const description=String(p[item.type==='tecnica'?'descricaotecnica':'descricaoskill']||item.system?.descricao||'').trim();
 const state={itemUuid:item.uuid,itemName:item.name,casterUuid:source.uuid,casterName:source.name,targetUuid:target.actor.uuid,targetName:target.actor.name,tokenId:target.token.id,sceneId:canvas.scene?.id,testName:spec.testName,dt:Number(spec.dt),description,status:'pending',createdBy:game.user.id};
 return ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:source}),content:html(state),flags:{[NS]:{externalResistanceCard:state}}});
}
async function resist(message,button){
 const s=message.getFlag(NS,'externalResistanceCard');if(s?.status!=='pending')return;
 const actor=await fromUuid(s.targetUuid);if(!actor)return ui.notifications.warn('Alvo não encontrado.');
 if(!game.user.isGM&&!actor.testUserPermission(game.user,'OWNER'))return ui.notifications.warn('Somente o defensor ou o mestre podem clicar para resistir.');
 const lock=`${message.id}:${game.user.id}`;if(working.has(lock))return;
 working.add(lock);button.disabled=true;
 try{
  const result=await rollOriginalResistance(actor,s.testName);if(!result)return;
  await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<p><b>${esc(actor.name)}</b> resistiu a <b>${esc(s.itemName)}</b>.</p>`,flags:{[NS]:{externalResistanceReply:{cardId:message.id,targetUuid:actor.uuid,total:Number(result.total),rollMessageId:result.messageId}}}});
 }catch(e){console.error('Multiverso | resistência externa no chat',e);ui.notifications.error('Não foi possível registrar a resistência.');}
 finally{working.delete(lock);button.disabled=false;}
}
async function processReply(replyMessage){
 const reply=replyMessage.getFlag(NS,'externalResistanceReply');if(!reply)return;
 const card=game.messages?.get(reply.cardId),s=card?.getFlag(NS,'externalResistanceCard');if(!s||s.status!=='pending'||s.targetUuid!==reply.targetUuid)return;
 // Somente quem criou a conjuração ou um mestre ativo conclui a execução.
 const activeGM=game.users.find(u=>u.isGM&&u.active);
 const responsible=activeGM?.id??s.createdBy;
 if(game.user.id!==responsible)return;
 const actor=await fromUuid(reply.targetUuid);
 const rollMessage=game.messages.get(reply.rollMessageId);
 if(!actor||actor.documentName!=='Actor'||(!replyMessage.author?.isGM&&!actor.testUserPermission(replyMessage.author,'OWNER')))return;
 if(replyMessage.speaker?.actor!==actor.id||!rollMessage?.rolls?.length||rollMessage.author?.id!==replyMessage.author.id||rollMessage.speaker?.actor!==actor.id||Number(rollMessage.rolls[0].total)!==Number(reply.total))return;
 const source=await fromUuid(s.casterUuid),item=await fromUuid(s.itemUuid);
 const token=canvas?.scene?.id===s.sceneId?canvas.tokens?.get(s.tokenId):null;
 if(!source||!item||!token||token.actor?.uuid!==s.targetUuid){ui.notifications.warn('Cena, habilidade ou alvo mudou. Faça a conjuração novamente.');return;}
 if(!source.isOwner||!actor.isOwner){ui.notifications.warn('O mestre precisa executar a aplicação da condição.');return;}
 const key=`${card.id}:process`;
 if(working.has(key))return;working.add(key);
 try{
  await card.update({[`flags.${NS}.externalResistanceCard.status`]:'processing',content:html({...s,status:'processing'})});
  const result=await executeExternalAdvanced(item,source,diagnose(item),{targetTokens:[token],resistanceTotals:{[`${s.testName}|${s.dt}`]:Number(reply.total)},reuseMessage:card});
  if(!result){await card.update({[`flags.${NS}.externalResistanceCard.status`]:'failed',content:html({...s,status:'failed'})});return;}
  await card.update({[`flags.${NS}.externalResistanceCard.status`]:'done'});
 }catch(e){console.error('Multiverso | aplicar resistência postergada',e);await card.update({[`flags.${NS}.externalResistanceCard.status`]:'failed',content:html({...s,status:'failed'})}).catch(()=>{});}
 finally{working.delete(key);}
}
function bind(message,htmlElement){
 if(!message.getFlag?.(NS,'externalResistanceCard'))return;
 const root=htmlElement instanceof HTMLElement?htmlElement:htmlElement?.[0]??htmlElement;
 const button=root?.querySelector?.('[data-mv-external-resist]');if(!button||button.dataset.mvReady)return;
 button.dataset.mvReady='1';button.addEventListener('click',()=>void resist(message,button));
}
export function registerExternalResistanceChat(){
 Hooks.on('renderChatMessageHTML',bind);Hooks.on('renderChatMessage',bind);
 Hooks.on('createChatMessage',m=>{void processReply(m).catch(e=>console.error('Multiverso | resposta externa',e));});
 Hooks.once('ready',()=>{for(const m of game.messages.contents)if(m.getFlag?.(NS,'externalResistanceReply'))void processReply(m).catch(console.error);});
}
