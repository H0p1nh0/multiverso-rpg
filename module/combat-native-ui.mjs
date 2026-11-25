import {conditionTestModifiers,consumeConditionTestModifiers} from './condition-mechanics.mjs';
import {itemDefenseBonus} from './item-motor.mjs';
import {passiveAttributeBonuses} from './passive-attributes.mjs';
// Combate nativo com aparência e comandos do combate-mental.js / ficha-skills.js legados.
// Usa as MESMAS flags de Skill/Técnica: não carregar o módulo CSB antigo em paralelo.
import {combatActionState,actionStatus,reserveAction,manuallyRefundAction,combatTick,isActionBlocked} from './action-economy.mjs';
import {reactionStatus,spendReaction,refundReaction,manuallyRefundReaction,belongsToCombat} from './reaction-combat.mjs';
import {rollCharacterInitiative} from './combat-tools.mjs';
import {getLastInteractedActor} from './chat-roll-apply.mjs';
const NS='multiverso-rpg', MOVEMENT='combatMovementV201';
const oldTokenPositions=new Map(),tokenQueues=new Map();
// A captura pertence à própria ficha V2. Não depende do document nem de mapa global
// de elementos, que pode deixar de corresponder à árvore após o rerender.
// Mantidos entre rerenders. Uma ação física de mouse deve gerar UMA recuperação.
const recoveryInFlight=new Set();
const alreadyBoundControls=new WeakSet(),alreadyBoundRoots=new WeakSet();
const fmt=v=>Number(v).toLocaleString('pt-BR',{maximumFractionDigits:2});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const combatActive=()=>game.combat?.started?game.combat:null;
const minmax=(n,max)=>Math.max(0,Math.min(max,Number(n)||0));
const strength=actor=>Number(actor?.system?.resistencianumero??0);
const agility=actor=>Number(actor?.system?.agilidadenumero??0);
const speed=actor=>Math.max(0,Number(actor?.system?.deslocamentonumero??9)||0);

export function movementStatus(actor,combat=game.combat){
 const old=actor?.getFlag?.(NS,MOVEMENT);
 const adjustment=old?.combatId===combat?.id&&Number.isFinite(Number(old?.manualOffset))?Number(old.manualOffset):0;
 const max=Math.max(0,speed(actor)+adjustment);
 if(!combat?.started||old?.combatId!==combat.id)return {remaining:max,max,spent:0,turnKey:'',manualOffset:0};
 const spent=Math.max(0,Number(old.max??max)-Number(old.remaining??max));
 // Alteração temporária de deslocamento no motor afeta o limite sem perder passos gastos.
 return {remaining:minmax(max-spent,max),max,spent,turnKey:old.turnKey??'',manualOffset:adjustment};
}
export async function resetMovement(actor,combat=game.combat){
 if(!actor?.setFlag||!combat?.started)return;
 const tick=combatTick(combat);
 const old=actor.getFlag(NS,MOVEMENT);
 if(old?.combatId===combat.id&&old.turnKey===tick)return;
 const adjustment=old?.combatId===combat.id&&Number.isFinite(Number(old.manualOffset))?Number(old.manualOffset):0;
 const max=Math.max(0,speed(actor)+adjustment);
 await actor.setFlag(NS,MOVEMENT,{combatId:combat.id,turnKey:tick,max,remaining:max,manualOffset:adjustment});
}
async function storeMovement(actor,remaining,max,combat=game.combat,{manualOffset=null}={}){
 if(!combat?.started||!belongsToCombat(actor,combat))throw Error('O personagem precisa participar do combate.');
 const old=actor.getFlag(NS,MOVEMENT);
 const adjustment=manualOffset===null?(old?.combatId===combat.id?Number(old.manualOffset??0):0):manualOffset;
 await actor.setFlag(NS,MOVEMENT,{combatId:combat.id,turnKey:old?.combatId===combat.id?old.turnKey:'',max,remaining:minmax(remaining,max),manualOffset:adjustment});
 actor.sheet?.render?.(false);
}
function rollMode(mode){return mode==='vantagem'?'2d20kh1':mode==='desvantagem'?'2d20kl1':'1d20';}
async function askDialog(title,content,label,read){
 return foundry.applications.api.DialogV2.wait({classes:['mv-combat-prompt-window'],window:{title,resizable:true},content,
  buttons:[{action:'cancel',label:'Cancelar',callback:()=>null},{action:'confirm',label,default:true,callback:(_ev,button,dialog)=>{
   const form=button?.form??dialog?.form;
   const get=name=>form?.elements?.namedItem(name)?.value??form?.querySelector(`[name="${name}"]`)?.value??'';
   return read(get,form);
  }}],rejectClose:false});
}
// Valores fixos de defesa dos NPCs: atributos, passivas e equipamentos ativos.
// Usado tanto pelos cartões quanto pela rolagem; evita números divergentes.
export function npcDefenseSummary(actor){
 const p=passiveAttributeBonuses(actor);
 const one=(type,attr,field)=>{
  const rawBase=Number(actor.system?.[attr]??0);
  const base=rawBase+Number(p[attr]??0);
  const passive=Number(p[field]??0);
  const equipment=itemDefenseBonus(actor,type);
  const bonus=Number(actor.system?.[field]??0)+passive+equipment;
  return {base,bonus,total:base+bonus,equipment,passive:passive+Number(p[attr]??0)};
 };
 return {esquiva:one('esquiva','agilidadenumero','esquivabonus'),
         bloqueio:one('bloqueio','resistencianumero','bloqueiobonus')};
}
export async function rollDefense(actor,type,{attack=null}={}){
 const combat=combatActive();
 // NPCs de apoio não possuem iniciativa, mas podem sofrer ataques e defender-se.
 if(!combat||(!belongsToCombat(actor,combat)&&actor?.type!=='npc'))throw Error('Entre no combate para usar Esquiva ou Bloqueio.');
 if(!actor.isOwner&&!game.user.isGM)throw Error('Sem permissão para defender esse personagem.');
 if(isActionBlocked(actor,'reacao'))throw Error('Uma condição ativa impede Reações.');
 if(reactionStatus(actor,combat).current<1)throw Error('Reações esgotadas até o início do próximo turno próprio.');
 const dodge=type==='esquiva';
 const title=dodge?'Esquiva':'Bloqueio';
 const npcDefense=actor.type==='npc'?npcDefenseSummary(actor)[type]:null;
 const base=npcDefense?npcDefense.base:(dodge?agility(actor):strength(actor));
 const bonus=npcDefense?npcDefense.bonus:(dodge?Number(actor.system?.esquivabonus??0):Number(actor.system?.bloqueiobonus??0))+itemDefenseBonus(actor,type);
 const choice=await askDialog(`${title}: ${actor.name}`,`<div class="mv-combat-prompt mv-combat-prompt--defense mv-combate-native-dialog">
   <header class="mv-prompt-head">
     <span class="mv-prompt-emblem" aria-hidden="true"><i class="fas ${dodge?'fa-person-running':'fa-shield-alt'}"></i></span>
     <div><span class="mv-prompt-kicker">MULTIVERSO RPG · REAÇÃO</span><h3>${title}</h3><p>${dodge?'Evite o ataque com seus reflexos.':'Resista ao ataque com sua defesa.'}</p></div>
   </header>
   <div class="mv-prompt-stats"><div class="mv-prompt-stat"><small>${dodge?'AGILIDADE':'RESISTÊNCIA'}</small><strong>${esc(base)}</strong></div><div class="mv-prompt-stat"><small>BÔNUS DE ${title.toUpperCase()}</small><strong>${esc(bonus)}</strong></div><div class="mv-prompt-stat"><small>REAÇÕES ATUAIS</small><strong>${esc(reactionStatus(actor,combat).current)} / ${esc(reactionStatus(actor,combat).max)}</strong></div></div>
   <div class="mv-prompt-fields"><label><span>Ajuste do Mestre / efeito narrativo <small>Aceita número ou fórmula de dados</small></span><input name="bonus" type="text" value="0" placeholder="Ex.: +2 ou 1d4" /></label>
   <label><span>Tipo de rolagem</span><select name="modo"><option value="normal">Normal · 1d20</option><option value="vantagem">Vantagem · maior de 2d20</option><option value="desvantagem">Desvantagem · menor de 2d20</option></select></label></div>
   <p class="mv-prompt-note"><i class="fas fa-shield-alt" aria-hidden="true"></i> A Reação será consumida somente depois da rolagem válida e será registrada no chat.</p>
  </div>`,`Rolar ${title}`,(get)=>({bonus:String(get('bonus')||'0').trim(),mode:get('modo')||'normal'}));
 if(!choice)return {ok:false,cancelled:true};
 if(!['normal','vantagem','desvantagem'].includes(choice.mode)||!/^[-+*/() d0-9khl.]+$/i.test(choice.bonus))throw Error('Ajuste inválido para o teste de defesa.');
 const conditionModes=conditionTestModifiers(actor,dodge?'agilidadenumero':'resistencianumero');
 const advantages=choice.mode==='vantagem'||conditionModes.some(m=>m.mode==='vantagem');
 const disadvantages=choice.mode==='desvantagem'||conditionModes.some(m=>m.mode==='desvantagem');
 const actualMode=advantages&&disadvantages?'normal':advantages?'vantagem':disadvantages?'desvantagem':'normal';
 const roll=new Roll(`(${rollMode(actualMode)}) + (${base}) + (${bonus}) + (${choice.bonus})`);
 await roll.evaluate();
 if(!Number.isFinite(Number(roll.total)))throw Error('A rolagem de defesa não retornou resultado válido.');
 const receipt=await spendReaction(actor,{combat});
 if(!receipt.ok)throw Error('A reação não está disponível.');
 try{
  const total=Number(roll.total);
  const against=Number.isFinite(Number(attack))&&attack!==null?Number(attack):null;
  const succeeded=against===null?null:dodge?total>against:total>=against;
  const partial=against!==null&&!succeeded&&against-total===1;
  const outcome=succeeded?'SUCESSO':partial?'PARCIAL':'FALHA';
  const guidance=succeeded?(dodge?'O ataque foi evitado.':'O dano foi negado pelo bloqueio.'):
    partial?(dodge?'Esquiva parcial: receba metade do dano.':'Bloqueio parcial: aplique a redução correspondente.'):
    (dodge?'A esquiva falhou: receba o dano normalmente.':'O bloqueio falhou: aplique a redução de bloqueio correspondente.');
  if(succeeded===true){for(const item of actor.items??[]){if(item.type==='equipamento'&&item.system?.equipado)Hooks.callAll('multiversoItemGatilho',item,dodge?'esquiva':'bloqueio');}}
  await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:`<section class="mv-chat-effect mv-chat-automatic"><div class="mv-chat-effect-header"><strong>${title} — ${esc(actor.name)}</strong><small>Multiverso RPG • Defesa</small></div><div class="mv-chat-effect-body"><p>${dodge?'Agilidade':'Resistência'} ${esc(base)} • Bônus ${esc(bonus)} • ${esc(actualMode)} • Ajuste ${esc(choice.bonus)}</p>${against===null?'':`<p>Ataque recebido: <b>${against}</b> • Defesa: <b>${total}</b><br><strong>${outcome}</strong> — ${guidance}</p>`}<p>Reações restantes: ${receipt.current}/${receipt.max}</p></div></section>`});
  try{await consumeConditionTestModifiers(conditionModes);}catch(err){console.error('Multiverso | Falha ao consumir condição',err);ui.notifications.warn('A condição de uso único não pôde ser consumida.');}
 }catch(e){await refundReaction(actor,receipt,{combat});throw e;}
 // Defesa publicada com reação efetivamente consumida: evento de sucesso verificável.
 // Erro de atualização da flag não desfaz a reação já gasta/publicada.
 try{await actor.setFlag('multiverso-rpg','reactionSuccessEventV1',{nonce:foundry.utils.randomID(),combatId:combat.id,round:Number(combat.round)});}
 catch(error){console.error('Multiverso | gatilho de defesa',error);ui.notifications.warn('A defesa foi registrada, mas o gatilho de recarga não pôde ser salvo.');}
 return {ok:true,total:Number(roll.total)};
}
export async function editMovement(actor){
 const combat=combatActive();if(!combat||!belongsToCombat(actor,combat))throw Error('É necessário participar de um combate iniciado.');
 if(!actor.isOwner&&!game.user.isGM)throw Error('Sem permissão para editar o deslocamento.');
 const s=movementStatus(actor,combat);
 const values=await askDialog(`Deslocamento: ${actor.name}`,`<div class="mv-combate-native-dialog"><p>O restante diminui ao mover o token. A base vem da ficha e dos efeitos ativos.</p><label>Deslocamento restante (m)<input type="number" name="atual" value="${s.remaining}" min="0" step="0.5"></label><label>Deslocamento máximo/base (m)<input type="number" name="max" value="${s.max}" min="0" step="0.5"></label></div>`,'Salvar',(get)=>({atual:Number(get('atual')),max:Number(get('max'))}));
 if(!values)return {ok:false,cancelled:true};
 if(!Number.isFinite(values.max)||!Number.isFinite(values.atual)||values.max<0||values.atual<0)throw Error('Valores de deslocamento inválidos.');
 // O campo manual define a base do combate (legado), sem alterar diretamente
 // o atributo que o motor de Efeitos está mantendo/restaurando.
 const manualOffset=values.max-speed(actor);
 await storeMovement(actor,values.atual,values.max,combat,{manualOffset});
 return {ok:true};
}
function combatOrder(combat){
 if(!combat)return [];
 return Array.from(combat.turns??combat.combatants??[]).filter(c=>(game.user.isGM||!c.hidden)&&Number.isFinite(Number(c.initiative)));
}
export function combatUiContext(actor,combat=game.combat){
 const inCombat=Boolean(combat?.started&&belongsToCombat(actor,combat));
 const state=combatActionState(actor,combat),reaction=reactionStatus(actor,combat),mv=movementStatus(actor,combat);
 return {
  active:inCombat,hasCombat:Boolean(combat),reak:reaction, movement:mv,
  reacoes:`${reaction.current} / ${reaction.max}`,
  deslocamento:`${fmt(mv.remaining)} m`,speedSubtitle:`de ${fmt(mv.max)} m`,
  acao:`${inCombat?state.acao:1} / 1`,movimento:`${inCombat?state.movimento:1} / 1`,bonus:`${inCombat?state.bonus:1} / 1`,
  completa:inCombat&&actionStatus(actor,'completa',combat).ok?'OK':'Indisp.',
  acaoOff:inCombat&&state.acao===0,movimentoOff:inCombat&&!actionStatus(actor,'movimento',combat).ok,
  bonusOff:inCombat&&state.bonus===0,completaOff:!inCombat||!actionStatus(actor,'completa',combat).ok,
  order:combatOrder(combat).map((c,i)=>({pos:i+1,id:c.id,name:c.getFlag?.(NS,'hiddenEnemyName')??c.actor?.name??c.name??'Combatente',img:c.token?.texture?.src??c.actor?.img??'icons/svg/mystery-man.svg',initiative:c.initiative,active:c.id===combat.combatant?.id})),
  round:combat?.round??0
 };
}
export function bindCombatUi(sheet,root){
 if(!root)return;
 const actor=sheet.actor;
 const execute=async fn=>{try{await fn();sheet.render(false);}catch(e){console.error('Multiverso | Controle de combate',e);ui.notifications.error(e?.message??'Falha no controle de combate. Confira F12.');}};
 root.querySelectorAll('[data-mv-combate-acao],[data-mv-native-acao]').forEach(btn=>{
  if(alreadyBoundControls.has(btn))return;
  alreadyBoundControls.add(btn);
  btn.addEventListener('click',event=>{
   if(event.button!==0)return;
   event.preventDefault();
   const kind=btn.dataset.mvCombateAcao,type=btn.dataset.mvNativeAcao;
   if(kind==='iniciativa')return void execute(()=>rollCharacterInitiative(actor));
   if(kind==='esquiva'||kind==='bloqueio')return void execute(()=>rollDefense(actor,kind));
   if(kind==='deslocamento')return void execute(()=>editMovement(actor));
   if(kind==='reacao')return void execute(async()=>{
    if(!combatActive())throw Error('Inicie o combate antes de consumir reações.');
    if(isActionBlocked(actor,'reacao'))throw Error('Uma condição ativa impede Reações.');
    const r=await spendReaction(actor);if(!r.ok)throw Error('Reações esgotadas ou personagem fora do encontro.');
    ui.notifications.info(`${actor.name}: reação utilizada (${r.current}/${r.max}).`);
   });
   if(type)return void execute(async()=>{
    if(!combatActive())throw Error('Inicie um combate antes de gastar ações.');
    const action=type==='padrao'?'acao':type;
    const r=await reserveAction(actor,action);if(!r.ok)throw Error(r.reason);
   });
  });
  if(btn.getAttribute('role')==='button')btn.addEventListener('keydown',event=>{
   if(event.key==='Enter'||event.key===' '){event.preventDefault();btn.click();}
  });
 });
 // Bind uma única vez por árvore de controles, inclusive nos rerenders parciais do Foundry v14.
 if(alreadyBoundRoots.has(root))return;
 alreadyBoundRoots.add(root);
 const selector='[data-mv-native-acao],[data-mv-combate-acao="reacao"]';
 const findControl=event=>{
  const target=event.target?.nodeType===1?event.target:event.target?.parentElement;
  const control=target?.closest?.(selector);
  return control&&root.contains(control)?control:null;
 };
 const recover=async control=>{
  const type=control.dataset.mvNativeAcao,kind=control.dataset.mvCombateAcao;
  const code=kind==='reacao'?'reacao':type==='padrao'?'acao':type;
  if(!['reacao','acao','movimento','completa','bonus'].includes(code))return;
  const signature=`${actor.uuid||actor.id}:${code}`;
  // Rerender pode recriar o botão antes que outro evento do mesmo gesto chegue.
  // A assinatura não depende do nó DOM antigo.
  if(recoveryInFlight.has(signature))return;
  recoveryInFlight.add(signature);
  try{
   if(!combatActive())throw Error('Não há combate iniciado.');
   if(!actor.isOwner&&!game.user?.isGM)throw Error('Sem permissão para recuperar ações.');
   const recovered=code==='reacao'?await manuallyRefundReaction(actor):await manuallyRefundAction(actor,code);
   if(recovered){
    ui.notifications.info(`${actor.name}: ${code==='acao'?'Ação Padrão':code==='reacao'?'Reação':code==='bonus'?'Ação Bônus':code==='movimento'?'Movimento':'Ação Completa'} recuperada.`);
    sheet.render(false);
   }else ui.notifications.warn('Nenhum gasto deste controle para recuperar.');
  }catch(error){console.error('Multiverso | recuperar ação',error);ui.notifications.error(error?.message??'Não foi possível recuperar a ação.');}
  finally{recoveryInFlight.delete(signature);}
 };
 // Um único evento executa a recuperação: não processar pointerdown + contextmenu.
 // contextmenu SOMENTE suprime o menu nativo; Shift+clique usa o mesmo caminho.
 root.addEventListener('pointerdown',event=>{
  if(event.button!==2)return;
  const control=findControl(event);if(!control)return;
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
  void recover(control);
 },true);
 root.addEventListener('contextmenu',event=>{
  if(!findControl(event))return;
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
 },true);
 root.addEventListener('click',event=>{
  if(event.button!==0||!event.shiftKey)return;
  const control=findControl(event);if(!control)return;
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
  void recover(control);
 },true);
}
const locKey=doc=>doc?.uuid||doc?.id;
function pathLength(old,doc){
 const dx=Number(doc.x)-old.x,dy=Number(doc.y)-old.y;
 if(!dx&&!dy)return 0;
 const size=Number(canvas?.grid?.size??100)||100;
 const pt1={x:old.x+Number(doc.width??1)*size/2,y:old.y+Number(doc.height??1)*size/2};
 const pt2={x:Number(doc.x)+Number(doc.width??1)*size/2,y:Number(doc.y)+Number(doc.height??1)*size/2};
 try{const measured=Number(canvas?.grid?.measurePath?.([pt1,pt2])?.distance);if(Number.isFinite(measured))return Math.max(0,measured);}catch(_e){}
 return Math.hypot(dx,dy)/size*(Number(canvas?.scene?.grid?.distance??1)||1);
}
async function consumeTokenDistance(token,previous,changedBy){
 if(changedBy&&changedBy!==game.user.id)return;
 const actor=token?.actor,combat=combatActive();
 if(!actor||!combat||!belongsToCombat(actor,combat))return;
 const distance=Math.round(pathLength(previous,token)*100)/100;
 if(distance<=0)return;
 const before=movementStatus(actor,combat);
 await storeMovement(actor,Math.max(0,before.remaining-distance),before.max,combat);
 Hooks.callAll?.('multiversoDeslocamentoGasto',actor,{distancia:distance,antes:before.remaining,depois:Math.max(0,before.remaining-distance),combatId:combat.id});
 if(distance>before.remaining+.001)ui.notifications.warn(`${actor.name} percorreu ${fmt(distance)} m, excedendo o deslocamento restante em ${fmt(distance-before.remaining)} m.`);
}
let combatQueue=Promise.resolve();
export function registerCombatNativeUi(){
 Hooks.on('combatStart',combat=>{
  if(game.user.isGM&&combat.combatant?.actor)combatQueue=combatQueue.then(()=>resetMovement(combat.combatant.actor,combat)).catch(console.error);
 });
 Hooks.on('updateCombat',(combat,changes)=>{
  if(!Object.hasOwn(changes??{},'round')&&!Object.hasOwn(changes??{},'turn'))return;
  if(game.user.isGM&&combat.started&&combat.combatant?.actor)combatQueue=combatQueue.then(()=>resetMovement(combat.combatant.actor,combat)).catch(console.error);
  for(const c of combat.combatants??[])c.actor?.sheet?.render?.(false);
 });
 // Cards de ataque antigos já existentes no histórico do chat ainda poderão
 // acionar Esquiva/Bloqueio, mas a resolução e o consumo serão 100% nativos.
 Hooks.on('renderChatMessage',(_message,html)=>{
  const root=html?.[0]??html;
  if(!root?.addEventListener||!root.querySelector?.('.mv-chat-defesa'))return;
  root.addEventListener('click',event=>{
   const button=event.target?.closest?.('.mv-chat-defesa');
   if(!button)return;
   event.preventDefault();
   void (async()=>{
    const controlled=(canvas?.tokens?.controlled??[]).filter(t=>t?.actor&&(game.user.isGM||t.actor.isOwner));
    const actor=controlled.length===1?controlled[0].actor:await getLastInteractedActor()??game.user.character;
    if(!actor)throw Error('Selecione um token ou interaja com a sua ficha para usar uma defesa.');
    const attack=Number(button.dataset.ataque);
    if(!Number.isFinite(attack))throw Error('O card não possui total de ataque válido.');
    const type=button.dataset.tipoDefesa==='bloqueio'?'bloqueio':'esquiva';
    await rollDefense(actor,type,{attack});
   })().catch(error=>{console.error('Multiverso | Defesa pelo chat',error);ui.notifications.error(error?.message??'Falha ao rolar defesa.');});
  });
 });
 Hooks.on('preUpdateToken',(doc,change)=>{
  if(!('x' in (change??{}))&&!('y' in (change??{})))return;
  oldTokenPositions.set(locKey(doc),{x:Number(doc.x),y:Number(doc.y)});
 });
 Hooks.on('updateToken',(doc,change,_options,userId)=>{
  if(!('x' in (change??{}))&&!('y' in (change??{})))return;
  const k=locKey(doc),old=oldTokenPositions.get(k);oldTokenPositions.delete(k);
  if(!old)return;
  const previous=tokenQueues.get(doc.actor?.uuid)??Promise.resolve();
  const run=previous.then(()=>consumeTokenDistance(doc,old,userId)).catch(error=>console.error('Multiverso | Deslocamento de token',error));
  tokenQueues.set(doc.actor?.uuid,run);
 });
}
