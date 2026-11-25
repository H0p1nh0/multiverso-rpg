// Teste contestado narrativo no chat: inicia pela ficha, responde pela última ficha interagida.
// A resposta não executa automaticamente consequências narrativas no defensor.
import {getLastInteractedActor} from './chat-roll-apply.mjs';
import {rollOriginalResistance} from './resistance-test.mjs';
const NS='multiverso-rpg';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const locks=new Set();
function markup(state){
 const rows=state.rolls.map((r,i)=>{
   const reply=state.responses?.[i];
   const summary=reply?`<div style="margin-top:8px;padding:10px;border:1px solid #84683d;border-radius:8px"><b>${esc(reply.name)}</b> • ${esc(r.targetSkill)}: <b>${esc(reply.total)}</b><br><strong>${r.total>reply.total?'Conjurador venceu':'Alvo resistiu ou empatou'}</strong>. Consequências resolvidas pelo mestre.</div>`:
     `<button type="button" data-mv-opposed-resist="${i}" style="background:#98713a;color:#fff1ca;border:1px solid #d6ab60;border-radius:7px;margin-top:8px;padding:8px 12px;font-weight:700">Resistir: ${esc(r.targetSkill)}</button><small style="display:block;margin-top:5px">Abra a ficha do defensor antes de clicar. Não é necessário token.</small>`;
   return `<div style="padding:10px 0;border-top:1px solid #6b5438"><b>Teste contestado ${state.rolls.length>1?i+1:''}</b><p style="margin:5px 0">${esc(state.actorName)} • ${esc(r.own)}: <b>${esc(r.total)}</b> contra ${esc(r.targetSkill)} do defensor</p>${summary}</div>`;
 }).join('');
 return `<section class="mv-ability-descriptive mv-opposed-card" style="padding:12px;background:#201b25;border:1px solid #a78349;border-radius:10px;color:#f1dfbd"><div>${state.content}</div><section style="margin-top:12px"><h4 style="color:#edc987;margin-bottom:9px">Teste Contestado</h4>${rows}</section></section>`;
}
export async function createOpposedCard({actor,item,content,rolls}){
 const state={actorUuid:actor.uuid,actorName:actor.name,itemName:item.name,ownerId:game.user.id,content,rolls, responses:{}};
 return ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:markup(state),flags:{[NS]:{opposedCard:state}}});
}
async function resolveCard(message,index,actor,total){
 const current=message.getFlag(NS,'opposedCard');
 if(!current?.rolls?.[index]||current.responses?.[index])return;
 const next=foundry.utils.deepClone(current);
 next.responses??={};next.responses[index]={uuid:actor.uuid,name:actor.name,total:Number(total)};
 await message.update({content:markup(next),[`flags.${NS}.opposedCard`]:next});
}
async function resist(message,index,button){
 const state=message.getFlag(NS,'opposedCard');
 if(!state?.rolls?.[index]||state.responses?.[index])return;
 const actor=await getLastInteractedActor()??game.user.character;
 if(!actor)return ui.notifications.warn('Abra a ficha do personagem defensor antes de resistir.');
 if(!game.user.isGM&&!actor.testUserPermission(game.user,'OWNER'))return ui.notifications.warn('Você não controla essa ficha.');
 if(actor.uuid===state.actorUuid)return ui.notifications.warn('O conjurador não pode resistir à própria habilidade.');
 const lock=`${message.id}:${index}:${actor.uuid}`;
 if(locks.has(lock))return;
 locks.add(lock);button.disabled=true;
 try{
  if(message.getFlag(NS,'opposedCard')?.responses?.[index])return;
  const roll=await rollOriginalResistance(actor,state.rolls[index].targetSkill);
  if(!roll)return;
  if(game.user.isGM||state.ownerId===game.user.id){
   await resolveCard(message,index,actor,roll.total);
  }else{
   // A mensagem de resposta é validada pelo cliente autor do card (ou GM).
   await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),
    content:`<p>Resistência de <b>${esc(actor.name)}</b> enviada para <b>${esc(state.itemName)}</b>. Aguarde a atualização do card.</p>`,
    flags:{[NS]:{opposedReply:{cardId:message.id,index,actorUuid:actor.uuid,total:Number(roll.total),rolledMessageId:roll.messageId}}}});
  }
 }catch(e){console.error('Multiverso | Resistência contestada',e);ui.notifications.error('Não foi possível registrar a resistência.');}
 finally{locks.delete(lock);button.disabled=false;}
}
async function acceptReply(message){
 const reply=message.getFlag(NS,'opposedReply');if(!reply)return;
 const card=game.messages.get(reply.cardId),state=card?.getFlag(NS,'opposedCard');
 if(!state?.rolls?.[reply.index]||state.responses?.[reply.index])return;
 const activeGM=game.users.find(u=>u.isGM&&u.active);
 const responsible=activeGM?.id??state.ownerId;
 if(responsible!==game.user.id)return;
 const actor=await fromUuid(reply.actorUuid).catch(()=>null);
 const rolled=game.messages.get(reply.rolledMessageId);
 if(!actor||actor.documentName!=='Actor'||actor.uuid===state.actorUuid)return;
 if(!message.author||(!message.author.isGM&&!actor.testUserPermission(message.author,'OWNER')))return;
 if(message.speaker?.actor!==actor.id||!rolled?.rolls?.length||rolled.author?.id!==message.author.id||rolled.speaker?.actor!==actor.id)return;
 if(!Number.isFinite(reply.total)||Number(rolled.rolls[0].total)!==Number(reply.total))return;
 await resolveCard(card,reply.index,actor,reply.total);
}
function bind(message,html){
 if(!message.getFlag?.(NS,'opposedCard'))return;
 const root=html instanceof HTMLElement?html:html?.[0]??html;
 if(!root?.querySelectorAll)return;
 for(const button of root.querySelectorAll('[data-mv-opposed-resist]')){
  if(button.dataset.mvReady)return;button.dataset.mvReady='1';
  button.addEventListener('click',()=>void resist(message,Number(button.dataset.mvOpposedResist),button));
 }
}
export function registerOpposedChat(){
 Hooks.on('renderChatMessageHTML',bind);Hooks.on('renderChatMessage',bind);
 Hooks.on('createChatMessage',m=>{void acceptReply(m).catch(e=>console.error('Multiverso | resposta contestada',e));});
 Hooks.once('ready',()=>{for(const m of game.messages.contents)if(m.getFlag?.(NS,'opposedReply'))void acceptReply(m).catch(console.error);});
}
