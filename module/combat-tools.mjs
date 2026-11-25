// v0.1.93 — Comandos da aba Combate: preserva a localização do combate-mental.js.
// Nova Cena é ação EXPLÍCITA do GM, independente da troca de mapa.
import {registerRecharge,rechargeVerifiedEvent} from './skill-uses.mjs';
import {triggerCombatEvent} from './advanced-motor.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const SIDEBAR_BUTTON_ID='mv-native-new-scene';
const OUTCOME_BUTTON_ID='mv-native-attack-outcome';
const DEFEAT_BUTTON_ID='mv-native-confirm-defeat';
const working=new Set();
export function initiativeFormula(agility,bonus=0,mode='normal'){
  const die=mode==='vantagem'?'2d20kh1':mode==='desvantagem'?'2d20kl1':'1d20';
  const a=Number(agility),b=Number(bonus);
  if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isInteger(b))throw new Error('Agilidade ou bônus de iniciativa inválidos.');
  const suffix=n=>n>0?` + ${n}`:n<0?` - ${Math.abs(n)}`:'';
  return die+suffix(a)+suffix(b);
}
export async function registerNewScene({confirm=true}={}){
  if(!game.user?.isGM){ui.notifications.warn('Somente o mestre pode iniciar uma nova cena.');return {ok:false,reason:'not-gm'};}
  if(working.has('scene'))return {ok:false,reason:'busy'};
  if(confirm){
    const yes=await foundry.applications.api.DialogV2.confirm({
      window:{title:'Iniciar Nova Cena'},
      content:'<p>Iniciar uma nova cena narrativa? As Skills e Técnicas com recarga <strong>Nova Cena</strong> serão restauradas, sem mudar o mapa nem encerrar o combate.</p>',
      yes:{label:'Iniciar Nova Cena'},no:{label:'Cancelar',default:true},rejectClose:false
    });
    if(!yes)return {ok:false,reason:'cancel'};
  }
  working.add('scene');
  const affected=[],failed=[];
  try{
    const actors=Array.from(game.actors?.contents??[]).filter(a=>a?.documentName==='Actor'&&a?.setFlag);
    for(const actor of actors){
      try{await registerRecharge(actor,'cena');affected.push(actor);actor.sheet?.render?.(false);}
      catch(error){failed.push({actor:actor.name,error});console.error('Multiverso | Recarga de nova cena:',actor.name,error);}
    }
    Hooks.callAll?.('multiversoNovaCena',{atoresAtualizados:affected.length,falhas:failed.length,manual:true});
    if(failed.length)ui.notifications.warn(`Nova Cena: ${affected.length} fichas atualizadas, ${failed.length} falharam. Confira F12.`);
    else ui.notifications.info(`Nova Cena iniciada: recargas por cena atualizadas em ${affected.length} fichas.`);
    return {ok:failed.length===0,updated:affected.length,failed};
  }finally{working.delete('scene');}
}
export async function rollCharacterInitiative(actor,{prompt=true,choice=null}={}){
  if(!actor?.isOwner&&!game.user?.isGM)throw new Error('Sem permissão para rolar iniciativa desse personagem.');
  const combat=game.combat;
  if(!combat)throw new Error('Crie um encontro no Foundry antes de rolar iniciativa.');
  const agility=Number(actor.system?.agilidadenumero??0);
  if(!Number.isFinite(agility))throw new Error('Agilidade inválida na ficha.');
  let selected=choice;
  if(prompt){
    selected=await foundry.applications.api.DialogV2.wait({
      classes:['mv-combat-prompt-window'],window:{title:`Iniciativa — ${esc(actor.name)}`,resizable:true},
      content:`<div class="mv-combat-prompt mv-combat-prompt--initiative mv-init-form">
        <header class="mv-prompt-head">
          <span class="mv-prompt-emblem" aria-hidden="true"><i class="fas fa-bolt"></i></span>
          <div><span class="mv-prompt-kicker">MULTIVERSO RPG · COMBATE</span><h3>Iniciativa</h3><p>Prepare sua entrada na ordem de combate.</p></div>
        </header>
        <div class="mv-prompt-stats"><div class="mv-prompt-stat"><small>DADO BASE</small><strong>1d20</strong></div><div class="mv-prompt-stat"><small>AGILIDADE</small><strong>${esc(agility)}</strong></div><div class="mv-prompt-stat"><small>BÔNUS EXTRA</small><strong>Personalizável</strong></div></div>
        <div class="mv-prompt-fields"><label><span>Bônus extra <small>Somado à iniciativa</small></span><input type="number" name="bonus" value="0" step="1" /></label>
        <label><span>Tipo de rolagem</span><select name="mode"><option value="normal">Normal · 1d20</option><option value="vantagem">Vantagem · maior de 2d20</option><option value="desvantagem">Desvantagem · menor de 2d20</option></select></label></div>
        <p class="mv-prompt-note"><i class="fas fa-dice-d20" aria-hidden="true"></i> A rolagem será enviada ao chat e registrada na iniciativa do personagem.</p>
      </div>`,
      buttons:[{action:'cancel',label:'Cancelar',callback:()=>null},{action:'roll',label:'Rolar iniciativa',default:true,callback:(_event,button,dialog)=>{
        const form=dialog?.element?.querySelector('.mv-init-form')??button?.form;
        return {bonus:Number(form?.querySelector('[name="bonus"]')?.value??0),mode:form?.querySelector('[name="mode"]')?.value??'normal'};
      }}],rejectClose:false});
  }
  if(!selected)return {ok:false,cancelled:true};
  if(!['normal','vantagem','desvantagem'].includes(selected.mode))throw new Error('Tipo de rolagem inválido.');
  const formula=initiativeFormula(agility,selected.bonus,selected.mode);
  // Um combatente já cadastrado pode ser rolado pelo jogador, sem adicionar todos os tokens.
  let combatant=Array.from(combat.combatants??[]).find(c=>c.actorId===actor.id);
  if(!combatant){
    if(!game.user?.isGM)throw new Error('O mestre precisa adicionar o personagem ao combate antes da rolagem.');
    const token=Array.from(canvas?.tokens?.controlled??[]).find(t=>t.actor?.id===actor.id);
    const [created]=await combat.createEmbeddedDocuments('Combatant',[{actorId:actor.id,...(token?.document?{tokenId:token.document.id,sceneId:token.document.parent?.id}:{})}]);
    combatant=created;
  }
  if(!combatant)throw new Error('Não foi possível encontrar ou criar o combatente.');
  const roll=new Roll(formula);await roll.evaluate();
  if(!Number.isFinite(Number(roll.total)))throw new Error('A rolagem de iniciativa não gerou resultado válido.');
  await combat.setInitiative(combatant.id,Number(roll.total));
  // Publica o dado verdadeiro, incluindo vantagem/desvantagem, não só o número.
  try{await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:`Iniciativa — ${esc(actor.name)} · Agilidade ${agility} · ${selected.mode}`});}
  catch(error){console.warn('Multiverso | iniciativa lançada, mas não publicada',error);ui.notifications.warn('Iniciativa registrada, mas a rolagem não apareceu no chat.');}
  return {ok:true,total:Number(roll.total),formula};
}

// Não calcula acerto automaticamente: o mestre confirma o resultado de um
// ataque que já foi resolvido. Uma rolagem de dano não equivale a acerto.
// DialogV2 (Foundry 14) encapsula o conteúdo num formulário próprio.
// A forma suportada de obter valores é button.form.elements. Evitar <form>
// aninhado e consulta exclusiva a dialog.element: ela falhava no cliente real.
export function readAttackOutcomeSelection(button,dialog){
 const form=button?.form??dialog?.form;
 const read=name=>String(form?.elements?.namedItem?.(name)?.value
   ??form?.querySelector?.(`[name="${name}"]`)?.value
   ??dialog?.element?.querySelector?.(`.mv-attack-result [name="${name}"]`)?.value
   ??'').trim();
 return {source:read('source'),target:read('target'),result:read('result')};
}
export async function registerAttackOutcome({choice=null}={}){
 if(!game.user?.isGM)throw Error('Somente o mestre pode confirmar resultados de ataques.');
 if(working.has('attack'))return {ok:false,reason:'busy'};
 working.add('attack');
 try{
 const combat=game.combat;
 if(!combat?.started)throw Error('Inicie o combate antes de registrar resultados de ataques.');
 const members=Array.from(combat.combatants??[]).filter(c=>c.actor);
 if(!members.length)throw Error('Nenhum personagem válido participa deste combate.');
 const opts=members.map(c=>`<option value="${esc(c.id)}">${esc(c.actor.name)}</option>`).join('');
 let selected=choice;
 if(!selected){
  selected=await foundry.applications.api.DialogV2.wait({window:{title:'Resultado de ataque — Mestre'},content:
   `<div class="mv-attack-result"><p>Confirme o resultado de um ataque já resolvido. Isso não rola dados nem aplica dano.</p><label>Atacante<select name="source">${opts}</select></label><label>Alvo<select name="target"><option value="">Nenhum / não informar</option>${opts}</select></label><label>Resultado<select name="result"><option value="hit">Acerto</option><option value="miss">Erro</option><option value="critical">Crítico</option></select></label></div>`,
   buttons:[{action:'cancel',label:'Cancelar',callback:()=>null},{action:'confirm',label:'Confirmar resultado',default:true,callback:(_event,button,dialog)=>readAttackOutcomeSelection(button,dialog)}],rejectClose:false});
 }
 if(!selected)return {ok:false,cancelled:true};
 if(!['hit','miss','critical'].includes(selected.result))throw Error('Não foi possível ler o resultado do ataque. Feche a janela e tente novamente.');
 const source=members.find(c=>c.id===selected.source);
 const target=members.find(c=>c.id===selected.target);
 if(!source?.actor)throw Error('Atacante não pertence ao combate.');
 if(selected.target&&!target?.actor)throw Error('Alvo não pertence ao combate.');
 const events=selected.result==='miss'?['attack_miss']:selected.result==='critical'?['attack_hit','attack_critical']:['attack_hit'];
 // Publicar confirmação visível antes dos gatilhos de recursos.
 const confirmedMessage=await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:source.actor}),content:
  `<section class="mv-chat-effect mv-chat-automatic"><div class="mv-chat-effect-header"><strong>Resultado de ataque confirmado</strong><small>Multiverso RPG • Mestre</small></div><div class="mv-chat-effect-body"><p><b>${esc(source.actor.name)}</b> → ${esc(target?.actor?.name??'sem alvo')}</p><p><strong>${selected.result==='hit'?'ACERTO':selected.result==='miss'?'ERRO':'CRÍTICO'}</strong></p><small>Gatilhos passivos serão executados. Nenhum dano ou ação foi presumido.</small></div></section>`});
 for(const event of events)await triggerCombatEvent(source.actor,event);
 const special=selected.result==='miss'?null:selected.result==='critical'?'ataque_critico':'ataque_acertado';
 if(special)await rechargeVerifiedEvent(source.actor,special,{eventId:`ataque:${confirmedMessage.id}:${special}`});
 // Crítico também é acerto: permite que Skills com recarga por acerto funcionem após crítico.
 if(selected.result==='critical')await rechargeVerifiedEvent(source.actor,'ataque_acertado',{eventId:`ataque:${confirmedMessage.id}:ataque_acertado`});
 if(selected.result==='critical'&&target?.actor)await triggerCombatEvent(target.actor,'critical_received');
 return {ok:true,events,sourceId:source.id,targetId:target?.id??null};
 }finally{working.delete('attack');}
}

// Derrota NÃO é inferida do valor atual de PV, nem de um card de dano publicado.
// O mestre confirma explicitamente o derrotador e o alvo participante do encontro.
export function readDefeatSelection(button,dialog){
 const form=button?.form??dialog?.form;
 const get=name=>String(form?.elements?.namedItem?.(name)?.value??form?.querySelector?.(`[name="${name}"]`)?.value??'').trim();
 return {source:get('source'),target:get('target')};
}
export async function registerConfirmedDefeat({choice=null}={}){
 if(!game.user?.isGM)throw Error('Somente o mestre pode confirmar derrotas.');
 if(working.has('defeat'))return {ok:false,reason:'busy'};
 working.add('defeat');
 try{
  const combat=game.combat;
  if(!combat?.started)throw Error('Inicie um encontro para confirmar uma derrota.');
  const members=[...(combat.combatants??[])].filter(c=>c.actor);
  if(members.length<2)throw Error('A confirmação de derrota precisa de pelo menos dois combatentes.');
  const options=members.map(c=>`<option value="${esc(c.id)}">${esc(c.actor.name)}</option>`).join('');
  const selected=choice??await foundry.applications.api.DialogV2.wait({window:{title:'Confirmar derrota — Mestre'},content:`<div class="mv-attack-result"><p>Confirme a derrota que aconteceu na narrativa. Nenhum PV será alterado. O derrotador poderá recuperar usos de habilidades configuradas para este evento.</p><label>Quem derrotou?<select name="source"><option value="">Selecionar...</option>${options}</select></label><label>Quem foi derrotado?<select name="target"><option value="">Selecionar...</option>${options}</select></label></div>`,buttons:[{action:'cancel',label:'Cancelar',callback:()=>null},{action:'confirm',label:'Confirmar derrota',default:true,callback:(_ev,button,dialog)=>readDefeatSelection(button,dialog)}],rejectClose:false});
  if(!selected)return {ok:false,cancelled:true};
  const winner=members.find(c=>c.id===selected.source),defeated=members.find(c=>c.id===selected.target);
  if(!winner?.actor||!defeated?.actor||winner.id===defeated.id)throw Error('Selecione dois participantes diferentes do encontro.');
  // Publicar primeiro: só um evento persistido permite recarga posterior.
  const msg=await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:winner.actor}),content:`<section class="mv-chat-effect mv-chat-automatic"><div class="mv-chat-effect-header"><strong>Derrota confirmada</strong><small>Multiverso RPG • Mestre</small></div><div class="mv-chat-effect-body"><strong>${esc(winner.actor.name)}</strong> derrotou <strong>${esc(defeated.actor.name)}</strong>.<p>Nenhum dano foi aplicado automaticamente.</p></div></section>`});
  const restored=await rechargeVerifiedEvent(winner.actor,'inimigo_derrotado',{eventId:`derrota:${msg.id}`,target:defeated.actor});
  if(restored.length)ui.notifications.info(`${winner.actor.name}: ${restored.length} habilidade(s) recarregada(s) após derrota confirmada.`);
  return {ok:true,restored,sourceId:winner.id,targetId:defeated.id};
 }finally{working.delete('defeat');}
}

function removeUnusedLegacyCombatButtons(root){
  // Comandos Iniciar Combate e Adicionar Inimigo foram retirados a pedido de Hope.
  // A v0.2.01 os injetava no rastreador em toda renderização, multiplicando-os.
  const selectors = [
    '#mv-combate-mental-iniciar-btn',
    '#mv-combate-mental-inimigo-btn',
    '.mv-combate-mental-wrap'
  ];
  for (const button of root?.querySelectorAll?.(selectors.join(',')) ?? []) {
    if (button.closest('.mv-combate-mental-wrap') && !button.matches('.mv-combate-mental-wrap')) continue;
    button.remove();
  }
}
function addCombatSidebarButton(root){
  removeUnusedLegacyCombatButtons(root);
  if(!game.user?.isGM)return;
  const node=root?.querySelector?.('#combat-tracker, .combat-tracker, [data-application-part="tracker"]')??root;
  if(!node?.querySelector)return;
  if(!node.querySelector(`#${SIDEBAR_BUTTON_ID}`)){
  const button=document.createElement('button');button.type='button';button.id=SIDEBAR_BUTTON_ID;
  button.className='mv-new-scene-sidebar';button.innerHTML='<i class="fas fa-film"></i> Iniciar Nova Cena';
  button.title='Avança a cena narrativa e restaura habilidades com recarga por Nova Cena.';
  button.addEventListener('click',ev=>{ev.preventDefault();void registerNewScene().catch(e=>{console.error(e);ui.notifications.error(e.message);});});
  // Posição original: na aba Combate / rastreador, não na aba de efeitos da ficha.
  const toolbar=node.querySelector('.combat-controls, .encounter-controls, [data-application-part="controls"], .combat-tracker-header');
  if(toolbar)toolbar.insertAdjacentElement('afterend',button);else node.prepend(button);
  }
  if(!node.querySelector(`#${OUTCOME_BUTTON_ID}`)){
   const button=document.createElement('button');button.type='button';button.id=OUTCOME_BUTTON_ID;
   button.className='mv-new-scene-sidebar';button.innerHTML='<i class="fas fa-crosshairs"></i> Confirmar Ataque';
   button.title='Mestre: registrar um ataque acertado, errado ou crítico para disparar gatilhos passivos.';
   button.addEventListener('click',event=>{event.preventDefault();void registerAttackOutcome().catch(error=>{console.error('Multiverso | ataque confirmado',error);ui.notifications.error(error.message);});});
   const sceneButton=node.querySelector(`#${SIDEBAR_BUTTON_ID}`);if(sceneButton)sceneButton.insertAdjacentElement('afterend',button);else node.prepend(button);
  }
  if(!node.querySelector(`#${DEFEAT_BUTTON_ID}`)){
   const button=document.createElement('button');button.type='button';button.id=DEFEAT_BUTTON_ID;
   button.className='mv-new-scene-sidebar';button.innerHTML='<i class="fas fa-flag-checkered"></i> Confirmar Derrota';
   button.title='Mestre: confirmar quem derrotou o alvo; recarrega usos especiais sem alterar PV.';
   button.addEventListener('click',event=>{event.preventDefault();void registerConfirmedDefeat().catch(error=>{console.error('Multiverso | derrota confirmada',error);ui.notifications.error(error.message);});});
   const previous=node.querySelector(`#${OUTCOME_BUTTON_ID}`);if(previous)previous.insertAdjacentElement('afterend',button);else node.prepend(button);
  }
}
// O rastreador nativo usa o nome do token (que pode ser um apelido antigo).
// Apresentamos o nome do Actor sem renomear tokens, cenas ou registros do combate.
function syncCombatTrackerActorNames(root){
  const combat=game.combat;
  if(!combat || !root?.querySelectorAll)return;
  for(const row of root.querySelectorAll('[data-combatant-id]')){
    const id=row.dataset.combatantId;
    const combatant=combat.combatants?.get?.(id);
    if(!combatant?.actor?.name)continue;
    // Preservar nomes ocultos ou disfarces explicitamente configurados pelo mestre.
    if((combatant.hidden && !game.user?.isGM)||combatant.getFlag?.('multiverso-rpg','hiddenEnemyName'))continue;
    const label=row.querySelector('.token-name, .combatant-name, [data-role="combatant-name"]');
    if(label && label.textContent!==combatant.actor.name){
      label.textContent=combatant.actor.name;
      label.title=combatant.actor.name;
    }
  }
}
export function registerCombatTools(){
  Hooks.on('updateActor',(actor,change)=>{
    if(!Object.hasOwn(change??{},'name'))return;
    if(!game.combat?.combatants?.some?.(member=>member.actorId===actor.id))return;
    ui.combat?.render?.({force:true});
  });
  // Fórmula padrão do rastreador, além do botão de rolagem na ficha.
  CONFIG.Combat.initiative.formula='1d20 + @system.agilidadenumero';
  Hooks.on('renderCombatTracker',(_app,element)=>{
    const root=element?.[0]??element;
    addCombatSidebarButton(root);
    syncCombatTrackerActorNames(root);
  });
}
