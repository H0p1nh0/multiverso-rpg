// Card de habilidade sem alvo marcado com T. O destinatário é o personagem
// do usuário que solicita a aplicação; nenhuma seleção de token é presumida.
import {rollOriginalResistance} from './resistance-test.mjs';
import {getLastInteractedActor} from './chat-roll-apply.mjs';
import {diagnose} from './native-effects.mjs';
import {executeExternalAdvanced} from './external-advanced.mjs';
const NS='multiverso-rpg';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const busy=new Set();
function paint(s){
 const state=s.status==='processing'?'Processando aplicação...':s.status==='done'?`Aplicado em ${esc(s.recipientName||'destinatário')}.`:s.status==='failed'?'Falha de aplicação. Consulte o console e a ficha.':'Sem alvo marcado. Clique para receber o efeito no seu personagem.';
 return `<section class="mv-chat-effect mv-cast-story"><div class="mv-chat-effect-header"><strong>${esc(s.itemName)}</strong><small>${esc(s.casterName)} • Habilidade</small></div><div class="mv-chat-effect-body">${s.description?`<p class="mv-cast-story-description">${esc(s.description)}</p>`:''}${s.status==='pending'?'<button type="button" data-mv-open-apply style="display:block;width:100%;color:#ffe5b1;background:#76512e;border:1px solid #c69c5a;border-radius:7px;padding:9px;font-weight:bold;cursor:pointer">Aplicar efeito</button>':''}<small>${state}</small></div></section>`;
}
export async function queueOpenEffect({item,source,prepaid=false}){
 const props=item.system?.props??{};
 const description=String(props[item.type==='tecnica'?'descricaotecnica':'descricaoskill']||item.system?.descricao||'').trim();
 const state={itemUuid:item.uuid,itemName:item.name,casterUuid:source.uuid,casterName:source.name,sceneId:canvas.scene?.id,description,status:'pending',prepaid:Boolean(prepaid),createdBy:game.user.id};
 return ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:source}),content:paint(state),flags:{[NS]:{openEffectCard:state}}});
}
async function request(message,button){
 const s=message.getFlag(NS,'openEffectCard');if(s?.status!=='pending')return;
 const actor=game.user.character??await getLastInteractedActor();
 if(!actor||!actor.testUserPermission(game.user,'OWNER'))return ui.notifications.warn('Designe um personagem ao seu usuário ou abra uma ficha sua antes de clicar.');
 const token=(canvas.tokens?.placeables??[]).find(t=>t.actor?.uuid===actor.uuid);
 if(!token||canvas.scene?.id!==s.sceneId)return ui.notifications.warn('O personagem precisa ter um token na cena onde a habilidade foi usada.');
 const item=await fromUuid(s.itemUuid);if(!item)return ui.notifications.warn('Habilidade não encontrada.');
 const effects=diagnose(item).filter(e=>e.receiver!=='proprio'&&e.resistanceActive);
 const resist=[...new Map(effects.map(e=>[`${e.testName}|${e.dt}`,{name:e.testName,dt:e.dt}])).values()];
 if(resist.length>1)return ui.notifications.warn('Esta habilidade tem múltiplos testes diferentes; aplique com um alvo marcado com T.');
 const key=`${message.id}:${game.user.id}`;if(busy.has(key))return;busy.add(key);button.disabled=true;
 try{
  let resistance=null,rollMessageId=null;
  if(resist.length){const roll=await rollOriginalResistance(actor,resist[0].name);if(!roll)return;resistance={name:resist[0].name,dt:resist[0].dt,total:Number(roll.total)};rollMessageId=roll.messageId;}
  await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<p>${esc(actor.name)} solicitou aplicação de ${esc(item.name)}.</p>`,flags:{[NS]:{openEffectClaim:{cardId:message.id,actorUuid:actor.uuid,tokenId:token.id,sceneId:s.sceneId,resistance,rollMessageId}}}});
  ui.notifications.info('Solicitação enviada. O mestre conectado concluirá a aplicação.');
 }catch(e){console.error('Multiverso | solicitar efeito sem T',e);ui.notifications.error('Falha ao solicitar o efeito no chat.');}
 finally{busy.delete(key);if(button.isConnected)button.disabled=false;}
}
async function process(message){
 const claim=message.getFlag(NS,'openEffectClaim');if(!claim)return;
 const card=game.messages?.get(claim.cardId),s=card?.getFlag(NS,'openEffectCard');if(!s||s.status!=='pending'||claim.sceneId!==s.sceneId)return;
 const gm=game.users.find(u=>u.isGM&&u.active);if(game.user.id!==(gm?.id??s.createdBy))return;
 const user=message.author;
 const actor=await fromUuid(claim.actorUuid);
 if(!user||!actor||!actor.testUserPermission(user,'OWNER')||message.speaker?.actor!==actor.id)return;
 if(claim.resistance){
  const roll=game.messages?.get(claim.rollMessageId);
  if(!roll||roll.author?.id!==user.id||roll.speaker?.actor!==actor.id||!roll.rolls?.length||Number(roll.rolls[0].total)!==Number(claim.resistance.total))return;
 }
 const token=canvas.scene?.id===s.sceneId?canvas.tokens?.get(claim.tokenId):null;
 const source=await fromUuid(s.casterUuid),item=await fromUuid(s.itemUuid);
 if(!token||token.actor?.uuid!==actor.uuid||!source||!item||!source.isOwner||!actor.isOwner)return;
 const key=`${card.id}:process`;if(busy.has(key))return;busy.add(key);
 try{
  await card.update({[`flags.${NS}.openEffectCard.status`]:'processing',content:paint({...s,status:'processing'})});
  const effects=diagnose(item);
  const options={targetTokens:[token],prepaid:Boolean(s.prepaid)};
  if(claim.resistance)options.resistanceTotals={[`${claim.resistance.name}|${claim.resistance.dt}`]:claim.resistance.total};
  const ok=await executeExternalAdvanced(item,source,effects,options);
  const status=ok?'done':'failed';
  await card.update({[`flags.${NS}.openEffectCard.status`]:status,[`flags.${NS}.openEffectCard.recipientName`]:actor.name,content:paint({...s,status,recipientName:actor.name})});
 }catch(e){console.error('Multiverso | aplicar efeito sem T',e);await card.update({[`flags.${NS}.openEffectCard.status`]:'failed',content:paint({...s,status:'failed'})}).catch(()=>{});}
 finally{busy.delete(key);}
}
function bind(message,html){
 if(!message.getFlag?.(NS,'openEffectCard'))return;
 const root=html instanceof HTMLElement?html:html?.[0]??html;
 const button=root?.querySelector?.('[data-mv-open-apply]');if(!button||button.dataset.mvReady)return;
 button.dataset.mvReady='1';button.addEventListener('click',()=>void request(message,button));
}
export function registerOpenEffectChat(){
 Hooks.on('renderChatMessageHTML',bind);Hooks.on('renderChatMessage',bind);
 Hooks.on('createChatMessage',m=>{void process(m).catch(e=>console.error('Multiverso | efeito sem T',e));});
 Hooks.once('ready',()=>{for(const m of game.messages.contents)if(m.getFlag?.(NS,'openEffectClaim'))void process(m).catch(console.error);});
}
