import {applyDeferredMaintained} from './deferred-effects.mjs';
import {resolveDamageProtection} from './damage-protection.mjs';
import {grantTemporaryResource,totalTemporaryResource,spendWithTemporaryResource} from "./temporary-resource.mjs";
import {grantTemporaryPv,temporaryTotal,applyPvDamage,planPvUpdate} from "./temporary-pv.mjs";
import {availableFluxes,normalizeFluxName} from './extra-flux.mjs';
// Multiverso v0.1.55 — aplicação por clique direito, adaptada de dano-chat.js original.
// Seleção de alvos: tokens controlados > última ficha interagida > personagem designado.
const ESC = (s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const RES={pv:['pv_atual','pv_max','PV'],pm:['pm_atual','pm_max','PM'],sta:['sta_atual','sta_max','STA'],san:['san_atual','san_max','SAN']};
const DMG_TYPES=[['','Genérico / sem tipo'],['fisico','Físico universal'],['cortante','Cortante'],['perfurante','Perfurante'],['impacto','Impacto/Contundente'],['magico','Mágico universal'],['arcano','Arcano'],['elemental','Elemental'],['fogo','Fogo'],['frio','Frio/Gelo'],['eletrico','Elétrico'],['quimico','Químico/Ácido'],['veneno','Veneno'],['sonoro','Sonoro'],['psiquico','Psíquico'],['sagrado','Sagrado'],['sombrio','Sombrio/Necrótico'],['verdadeiro','Verdadeiro'],['__outro__','Outro / Tipo personalizado']];
let lastActorUuid=null;
const canEdit=(a)=>!!a && (game.user.isGM || a.testUserPermission(game.user,'OWNER'));
const dedupe=(a)=>[...new Map(a.filter(Boolean).map(x=>[x.uuid,x])).values()];
export async function getLastInteractedActor(){
  if(!lastActorUuid)return null;
  const actor=await fromUuid(lastActorUuid).catch(()=>null);
  return actor?.documentName==='Actor'?actor:null;
}
export function rememberLastActor(actor){if(actor?.documentName==='Actor') lastActorUuid=actor.uuid;}
function actorFromSheet(app){const a=app?.actor??app?.document??app?.object;return a?.documentName==='Actor'?a:null;}
async function targets(){
  // Nunca usar todos os tokens do mapa como fallback. Considerar somente
  // tokens realmente controlados na cena atual; sem seleção, usar a última ficha.
  const selected=dedupe((canvas?.tokens?.controlled??[]).filter(t=>
    t?.controlled===true && (!t.document?.parent?.id||!canvas?.scene?.id||t.document.parent.id===canvas.scene.id)
  ).map(t=>t.actor).filter(a=>a?.documentName==='Actor'));
  if(selected.length)return {actors:selected,mode:`${selected.length} token(s) controlado(s) explicitamente`};
  if(lastActorUuid){const a=await fromUuid(lastActorUuid).catch(()=>null);if(a?.documentName==='Actor')return {actors:[a],mode:'última ficha interagida'};lastActorUuid=null;}
  return {actors:game.user.character?[game.user.character]:[],mode:'ficha designada'};
}
function num(actor,key){const n=Number(actor.system?.[key]);return Number.isFinite(n)?n:null;}
function extractForm(button,dialog){const root=dialog?.element instanceof HTMLElement?dialog.element:dialog?.element?.[0];const container=root?.querySelector('.mv-apply-roll');const form=button?.form??root?.querySelector('form');if(!container)return null;const data=new FormData();for(const field of container.querySelectorAll('[name]'))data.set(field.name,field.value);return data;}
async function openApply(rollTotal, override=null, context=null){
  const {actors,mode}=override??await targets();
  if(!actors.length)return ui.notifications.warn('Selecione tokens, interaja com uma ficha ou designe seu personagem.');
  const denied=actors.filter(a=>!canEdit(a));
  if(denied.length)return ui.notifications.warn('Sem permissão para alterar: '+denied.map(a=>a.name).join(', '));
  const safeTotal=Math.max(0,Math.floor(Number(rollTotal)));
  const fixedDamageType=context?.damageType??null;
  // Pré-seleção segura: "v" é o valor da opção; "key" existia apenas
  // dentro de .some() e causava ReferenceError ao aplicar dano de itens.
  const selectedDamageType=fixedDamageType===null?null:
    DMG_TYPES.some(([value])=>value===fixedDamageType)?fixedDamageType:'__outro__';
  // Só oferecer o fluxo extra quando TODOS os destinatários o possuem com o mesmo nome.
  const extras=actors.map(a=>availableFluxes(a).find(f=>f.id==='extra'));
  const commonExtra=extras.length&&extras.every(f=>f&&normalizeFluxName(f.label)===normalizeFluxName(extras[0].label))?extras[0]:null;
  const activeResources={...RES,...(commonExtra?{extra:[commonExtra.key,commonExtra.max,commonExtra.label]}:{})};
  if(!Number.isFinite(safeTotal))return ui.notifications.warn('Rolagem inválida.');
  const content=`<div class="mv-apply-roll" ${context?.onlyDamage?'data-mv-damage-only="1"':''}><div class="mv-roll-target"><div class="mv-roll-target-name"><b>Ficha${actors.length>1?'s':''}:</b> ${actors.map(a=>ESC(a.name)).join(', ')}</div><small>Origem: ${ESC(mode)}</small></div>
  <div class="mv-roll-total">Total da rolagem: <b>${safeTotal}</b></div>
  <div class="form-group"><label>Valor a aplicar</label><input type="number" step="1" min="0" name="amount" value="${safeTotal}" required></div>
  <div class="form-group" ${context?.onlyDamage?'hidden':''}><label>Recurso</label><select name="resource"><option value="pv">PV</option><option value="pm">PM</option><option value="sta">STA</option><option value="san">SAN</option>${commonExtra?`<option value="extra">${ESC(commonExtra.label)}</option>`:''}</select></div>
  <div class="form-group"><label>Operação</label><select name="operation"><option value="damage">Aplicar dano</option><option value="half">Meio dano</option><option value="heal">Curar</option><option value="temp">PV temporário (até o fim da cena)</option></select></div>
  <div class="form-group mv-damage-type-row"><label>Tipo de dano</label><select name="damageType">${DMG_TYPES.map(([v,n])=>`<option value="${v}" ${(selectedDamageType!==null && v===selectedDamageType)?'selected':''}>${n}</option>`).join('')}</select></div>
  <div class="form-group mv-custom-damage-row" hidden><label>Tipo personalizado</label><input type="text" name="customDamageType" maxlength="80" value="${fixedDamageType!==null&&!DMG_TYPES.some(([k])=>k===fixedDamageType)?ESC(fixedDamageType):''}" placeholder="Ex.: energia astral"></div>
  <p class="mv-roll-warning">Proteções calculadas pela regra original (resistência fixa, percentual, imunidade e vulnerabilidade). Confira o valor final antes de confirmar.</p>
  </div>`;
  // Inicializa o estado dos campos após o conteúdo da janela existir.
  const chosen=await foundry.applications.api.DialogV2.wait({window:{title:'Aplicar rolagem • Multiverso',width:720,height:480,resizable:false},content,
    render:(_event,dialog)=>attachOperationControls(dialog),
    buttons:[{action:'cancel',label:'Cancelar'},{action:'apply',label:'Aplicar na ficha',default:true,callback:(_ev,button,dialog)=>{
      const fd=extractForm(button,dialog);return fd?{amount:Number(fd.get('amount')),operation:String(fd.get('operation')),resource:String(fd.get('resource')),damageType:String(fd.get('damageType'))==='__outro__'?String(fd.get('customDamageType')??'').trim():String(fd.get('damageType')),customTypeSelected:String(fd.get('damageType'))==='__outro__'}:null;
    }}],rejectClose:false});
  if(!chosen)return;
  if(!Number.isInteger(chosen.amount)||chosen.amount<0)return ui.notifications.warn('O valor precisa ser um inteiro não negativo.');
  if(!['damage','half','heal','restore','spend','temp','tempResource'].includes(chosen.operation))return;
  if(context?.onlyDamage&&(chosen.resource!=='pv'||!['damage','half'].includes(chosen.operation)))return ui.notifications.warn('Esta rolagem é para dano de PV.');
  if(chosen.customTypeSelected && ['damage','half'].includes(chosen.operation) && (!chosen.damageType || !/^[\p{L}\p{N} _-]{1,80}$/u.test(chosen.damageType)))return ui.notifications.warn('Informe um tipo personalizado válido (letras, números, espaços, _ ou -).');
  const isPv=chosen.resource==='pv';
  if(!activeResources[chosen.resource])return;
  if(isPv&&!['damage','half','heal','temp'].includes(chosen.operation))return ui.notifications.warn('Operação incompatível com PV.');
  if(!isPv&&!['restore','spend','tempResource'].includes(chosen.operation))return ui.notifications.warn('Operação incompatível com o recurso selecionado.');
  if(['temp','tempResource'].includes(chosen.operation)&&!canvas?.scene?.id)return ui.notifications.warn('Ative uma cena para conceder PV temporário manual (duração até o fim da cena).');

  const r=chosen.resource;
  if(!activeResources[r])return;
  const [currentKey,maxKey,label]=activeResources[r];
  const value=chosen.operation==='half'?Math.floor(chosen.amount/2):chosen.amount;
  const sign=['damage','half','spend'].includes(chosen.operation)?-1:1;
  const plans=[];
  for(const actor of actors){
    if(!canEdit(actor))return ui.notifications.warn('Permissão alterada: '+actor.name);
    const current=num(actor,currentKey),max=num(actor,maxKey);
    if(current===null||max===null)return ui.notifications.error('Fluxos inválidos em '+actor.name+'. Nenhuma ficha alterada.');
    const protection=isPv&&['damage','half'].includes(chosen.operation)&&!context?.alreadyProtected?resolveDamageProtection(actor,value,chosen.damageType):null;
    if(protection?.blocked)return ui.notifications.warn('Proteção não suportada em '+actor.name+': '+protection.unsupported.map(e=>e.source).join(', ')+'. Nenhuma ficha alterada.');
    const appliedValue=protection?protection.final:value;
    const otherTemp=!isPv?totalTemporaryResource(actor,r):0;
    const preview=['damage','half','heal','temp'].includes(chosen.operation)?planPvUpdate(actor,chosen.operation,appliedValue):{before:current,after:chosen.operation==='tempResource'?current+value:Math.max(0,Math.min(max+otherTemp,current+sign*value)),max};
    plans.push({actor,before:current,after:preview.after,max,temp:temporaryTotal(actor),otherTemp:!isPv?totalTemporaryResource(actor,r):0,appliedValue,protection});
  }
  const isDamage=['damage','half'].includes(chosen.operation);
  const isTemporary=['temp','tempResource'].includes(chosen.operation);
  const operationLabel=isDamage?'Dano recebido':isTemporary?'Recurso temporário':chosen.operation==='heal'||chosen.operation==='restore'?'Recuperação':'Redução de recurso';
  const details=plans.map(p=>{
    const pr=p.protection;
    const immune=!!pr?.imune;
    const vulnerable=!!pr?.vulneravel&&!immune;
    const reduced=!!pr&&!immune&&(pr.resistenciaFixa>0||pr.resistenciaPercentual>0);
    const explanation=immune?'Imunidade: nenhum dano recebido.':vulnerable?'Vulnerabilidade: dano aumentado.' :reduced?'Resistência: dano reduzido.':'';
    return `<div class="mv-apply-preview-target"><strong>${ESC(p.actor.name)}</strong>${isDamage?`<div class="mv-apply-preview-numbers"><span>Dano original: <b>${value}</b></span><span>Dano efetivo: <b>${p.appliedValue}</b></span></div>`:`<div>Valor: <b>${value}</b> ${ESC(label)}</div>`}${explanation?`<div class="mv-apply-preview-note">${ESC(explanation)}</div>`:''}<div class="mv-apply-preview-balance">${ESC(label)}: ${p.before} → <b>${p.after}</b> / ${p.max}</div></div>`;
  }).join('');
  const confirmContent=`<section class="mv-apply-confirm"><div class="mv-apply-confirm-title">${ESC(operationLabel)}</div><p>Confira o resultado antes de aplicar na ficha.</p>${details}</section>`;
  const ok=await foundry.applications.api.DialogV2.wait({window:{title:'Multiverso • Confirmar aplicação',width:560},content:confirmContent,buttons:[{action:'cancelar',label:'Cancelar',callback:()=>false},{action:'confirmar',label:'Aplicar na ficha',default:true,callback:()=>true}],rejectClose:false});
  if(!ok)return;
  // Revalidação, antes de qualquer escrita, para evitar aplicar em saldos desatualizados.
  for(const p of plans){if(!canEdit(p.actor)||num(p.actor,currentKey)!==p.before||temporaryTotal(p.actor)!==p.temp||(!isPv&&totalTemporaryResource(p.actor,r)!==p.otherTemp))return ui.notifications.warn('A ficha de '+p.actor.name+' mudou. Reabra a aplicação.');}
  const changed=[];
  try{
    for(const p of plans){
      if(chosen.operation==='temp')await grantTemporaryPv(p.actor,value,canvas.scene.id);
      else if(chosen.operation==='tempResource')await grantTemporaryResource(p.actor,r,value,canvas.scene.id);
      else if(chosen.operation==='spend')await spendWithTemporaryResource(p.actor,r,value);
      else if(chosen.operation==='damage'||chosen.operation==='half')await applyPvDamage(p.actor,p.appliedValue);
      else await p.actor.update({[`system.${currentKey}`]:p.after});
      changed.push(p);
    }
  }catch(error){console.error('Multiverso | aplicação de rolagem',error);ui.notifications.error('Falha ao aplicar. Confira as fichas antes de repetir.');return;}
  // Sem saldos privados ou fontes ocultas de passivos no chat público.
  const resultCards=changed.map(p=>{
    const pr=p.protection;
    const isDamage=['damage','half'].includes(chosen.operation);
    const note=isDamage&&pr?.imune?'Imune a este tipo de dano':isDamage&&pr?.vulneravel?'Dano aumentado por vulnerabilidade':isDamage&&pr&&(pr.resistenciaFixa>0||pr.resistenciaPercentual>0)?'Dano reduzido por resistência':'';
    const verb=isDamage?'Dano efetivo':isTemporary?'Recurso temporário':chosen.operation==='heal'||chosen.operation==='restore'?'Recurso recuperado':'Recurso reduzido';
    return `<div class="mv-roll-applied-entry"><div class="mv-roll-applied-name">${ESC(p.actor.name)}</div>${isDamage?`<div class="mv-roll-applied-line"><span>Valor original</span><b>${value}</b></div>`:''}<div class="mv-roll-applied-total"><span>${ESC(verb)} (${ESC(label)})</span><strong>${isDamage?p.appliedValue:value}</strong></div>${note?`<div class="mv-roll-applied-note">${ESC(note)}</div>`:''}</div>`;
  }).join('');
  try{await ChatMessage.create({speaker:ChatMessage.getSpeaker(),content:`<section class="mv-chat-effect mv-roll-applied"><div class="mv-chat-effect-header"><strong>${ESC(operationLabel)}</strong><small>Multiverso RPG • Aplicação de rolagem</small></div><div class="mv-chat-effect-body">${resultCards}</div></section>`});}
  catch(error){console.error('Multiverso | aviso de aplicação',error);ui.notifications.warn('Dano aplicado, mas falhou a mensagem de confirmação.');}
  return {operation:chosen.operation,resource:chosen.resource,changed};
}
const pendingManual=new Set();
function handler(message,html){
  const root=html instanceof HTMLElement?html:html?.[0];if(!root||root.dataset.mvRollContextBound)return;
  root.dataset.mvRollContextBound='true';
  root.addEventListener('contextmenu',event=>{
    // Rolagens dos itens já possuem controles próprios. Não aplicar o ATAQUE como dano
    // nem abrir dois diálogos para a mensagem nativa de dano.
    if(message.getFlag?.('multiverso-rpg','itemAttackRollV2') || message.getFlag?.('multiverso-rpg','itemDamageRollV2'))return;
    // Dano do executor avançado e de turnos periódicos: NÃO descontar automaticamente.
    const manual=event.target?.closest?.('[data-mv-manual-damage], [data-mv-manual-damage-entry]');
    if(manual&&root.contains(manual)){
      const entryId=manual.dataset.mvManualDamage??manual.dataset.mvManualDamageEntry;
      const entry=(message.getFlag?.('multiverso-rpg','manualDamage')??[]).find(x=>x.id===entryId);
      if(!entry||!Number.isFinite(entry.amount)||entry.amount<0)return;
      if(entry.applied||pendingManual.has(`${message.id}:${entry.id}`)){event.preventDefault();return ui.notifications.info('Esta rolagem já foi aplicada ou está sendo conferida.');}
      event.preventDefault();event.stopPropagation();
      const ticket=`${message.id}:${entry.id}`;
      pendingManual.add(ticket);
      void (async()=>{
        try{
          const actor=await fromUuid(entry.actorUuid);
          if(!actor||actor.documentName!=='Actor')return ui.notifications.warn('O personagem do dano não foi encontrado.');
          {
            const result=await openApply(entry.amount,{actors:[actor],mode:`dano de ${entry.name} para ${actor.name}`},{damageType:entry.damageType||null});
            if(!result)return;
            const realDamage=['damage','half'].includes(result.operation)&&result.resource==='pv'&&result.changed.some(p=>p.appliedValue>0&&(p.before>0||p.temp>0));
            if(realDamage&&entry.deferred?.length){
              const item=await fromUuid(entry.itemUuid);
              const destination=entry.deferredTargetUuid?await fromUuid(entry.deferredTargetUuid):actor;
              await applyDeferredMaintained(destination,item,entry.deferred);
            }
            // Persistir o status para impedir segunda aplicação do mesmo dano.
            const all=(message.getFlag('multiverso-rpg','manualDamage')??[]).map(x=>x.id===entry.id?{...x,applied:true,appliedDamage:realDamage}:x);
            try{await message.setFlag('multiverso-rpg','manualDamage',all);}catch(err){console.warn('Multiverso | não salvou aplicação do card',err);ui.notifications.warn('Dano aplicado, mas não foi possível marcar o card como usado. Não aplique novamente.');}
          }
        }catch(error){console.error('Multiverso | aplicação manual de dano',error);ui.notifications.error(`Não foi possível completar a aplicação: ${error.message}`);}
        finally{pendingManual.delete(ticket);}
      })();
      return;
    }
    // Valores individuais de múltiplos alvos: calcula do estado assinado do card,
    // nunca de atributos HTML editáveis pelo cliente. O alvo fica pré-definido.
    const individual=event.target?.closest?.('[data-mv-multi-amount]');
    if(individual&&root.contains(individual)){
      const card=message.getFlag?.('multiverso-rpg','multiTarget');
      const target=card?.targets?.find(t=>t.uuid===individual.dataset.mvTarget);
      const effect=card?.effects?.find(e=>e.index===Number(individual.dataset.mvEffect));
      if(!target||!effect||!Number.isFinite(effect.total))return;
      const test=effect.resistanceActive?target.tests?.[String(effect.testName??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()]:null;
      if(effect.resistanceActive&&!Number.isFinite(test))return;
      const outcome=!effect.resistanceActive?'completo':Number(test)>=effect.dt?effect.success:effect.failure;
      const amount=outcome==='sem_efeito'?0:outcome==='metade'?Math.floor(effect.total/2):effect.total;
      const protection=target.protections?.[String(effect.index)];
      if(protection?.blocked){event.preventDefault();return ui.notifications.warn('Não foi possível calcular a proteção deste alvo. O dano não foi aplicado.');}
      const finalAmount=effect.type==='dano'&&protection&&Number.isFinite(protection.final)?protection.final:amount;
      event.preventDefault();event.stopPropagation();
      void (async()=>{const actor=await fromUuid(target.uuid);if(!actor)return ui.notifications.warn('Alvo não encontrado.');
        if(effect.type==='dano'&&protection){const live=resolveDamageProtection(actor,amount,effect.damageType);if(live.blocked||live.final!==protection.final)return ui.notifications.warn('As proteções do alvo mudaram desde a resistência. Não aplique um valor desatualizado; refaça a execução.');}
        await openApply(finalAmount,{actors:[actor],mode:'resultado ajustado para '+actor.name},{damageType:'',alreadyProtected:true});})();
      return;
    }
    // Cura periódica de aura já atualizou o PV. Exibir a rolagem nativa,
    // mas nunca permitir que o mesmo total seja aplicado uma segunda vez.
    const appliedAuraHeal=event.target?.closest?.('[data-mv-aura-heal-auto]');
    if(appliedAuraHeal&&root.contains(appliedAuraHeal)){
      event.preventDefault();event.stopPropagation();
      return ui.notifications.info('Esta cura da aura já foi aplicada automaticamente à ficha.');
    }
    // Rolagens nativas e cards do Multiverso com resultado rolado.
    const dice=event.target?.closest?.('.dice-roll, .mv-damage-roll-native, [data-mv-damage-rolled]');
    if(!dice||!root.contains(dice))return;
    const rolls=message.rolls??[];if(!rolls.length)return;
    const clickedRoll=event.target?.closest?.('.dice-roll');
    const allRolls=[...root.querySelectorAll('.mv-damage-roll-native .dice-roll')];
    const index=clickedRoll?allRolls.indexOf(clickedRoll):-1;
    const total=index>=0&&rolls[index] ? Number(rolls[index].total) : rolls.length===1?Number(rolls[0].total):NaN;
    if(!Number.isFinite(total))return;
    event.preventDefault();event.stopPropagation();void openApply(total);
  });
}
export function registerChatRollApply(){
  registerRollFormDelegation();
  Hooks.on('renderDialogV2',attachOperationControls);
  Hooks.on('renderApplicationV2',attachOperationControls);
  Hooks.on('renderChatMessageHTML',handler);Hooks.on('renderChatMessage',handler);
  Hooks.on('renderActorSheet',app=>rememberLastActor(actorFromSheet(app)));
  Hooks.on('renderActorSheetV2',app=>rememberLastActor(actorFromSheet(app)));
  Hooks.on('renderApplicationV2',app=>{
    const actor=actorFromSheet(app);
    if(!actor)return;
    rememberLastActor(actor);
    const root=app.element instanceof HTMLElement?app.element:app.element?.[0];
    if(root&&!root.dataset.mvLastActorBound){
      root.dataset.mvLastActorBound='1';
      root.addEventListener('pointerdown',()=>rememberLastActor(actor),true);
      root.addEventListener('focusin',()=>rememberLastActor(actor),true);
    }
  });
}

// Delegação no documento: cobre também DialogV2 com conteúdo montado depois do hook de renderização.
// Não depende de scripts inline (bloqueados pela política CSP do Foundry).
function refreshOperationControls(form, reset=false){
  if(!form)return;
  const resource=form.querySelector('[name="resource"]');
  const operation=form.querySelector('[name="operation"]');
  if(!resource||!operation)return;
  const isPv=resource.value==='pv';
  const rows=form.dataset.mvDamageOnly==='1'?[['damage','Aplicar dano'],['half','Meio dano']]:isPv?[['damage','Aplicar dano'],['half','Meio dano'],['heal','Curar'],['temp','PV temporário (até o fim da cena)']]:[['spend','Diminuir recurso'],['restore','Aumentar recurso'],['tempResource','Recurso temporário (até o fim da cena)']];
  const previous=reset?null:operation.value;
  operation.replaceChildren(...rows.map(([id,label])=>new Option(label,id)));
  if(previous&&rows.some(([id])=>id===previous))operation.value=previous;
  const isDamage=isPv&&['damage','half'].includes(operation.value);
  const dmgRow=form.querySelector('.mv-damage-type-row');
  const warning=form.querySelector('.mv-roll-warning');
  if(dmgRow){dmgRow.hidden=!isDamage;dmgRow.style.display=isDamage?'':'none';}
  if(warning){warning.hidden=!isDamage;warning.style.display=isDamage?'':'none';}
  const customRow=form.querySelector('.mv-custom-damage-row');
  if(customRow){const custom=isDamage&&form.querySelector('[name="damageType"]')?.value==='__outro__';customRow.hidden=!custom;customRow.style.display=custom?'':'none';}
}
function attachOperationControls(dialog){
  const root=dialog?.element instanceof HTMLElement?dialog.element:dialog?.element?.[0];
  const wrapper=root?.querySelector('.mv-apply-roll');
  if(!wrapper||wrapper.dataset.mvOperationsAttached)return;
  wrapper.dataset.mvOperationsAttached='1';
  wrapper.addEventListener('change',event=>{
    if(event.target?.name==='resource')refreshOperationControls(wrapper,true);
    if(event.target?.name==='operation'||event.target?.name==='damageType')refreshOperationControls(wrapper,false);
  });
  refreshOperationControls(wrapper,true);
}
let delegationRegistered=false;
function registerRollFormDelegation(){
  if(delegationRegistered)return;
  delegationRegistered=true;
  document.addEventListener('change',event=>{
    const field=event.target;
    if(!field?.matches?.('.mv-apply-roll [name="resource"], .mv-apply-roll [name="operation"], .mv-apply-roll [name="damageType"]'))return;
    const form=field.closest('.mv-apply-roll');
    if(field.name==='resource')refreshOperationControls(form,true);
    else refreshOperationControls(form,false);
  },true);
}

// Reutiliza a aplicação de rolagem já aprovada no chat (PV temporário e proteções incluídos).
// Prioridade para dano de item: alvo vinculado ao ataque > última ficha de personagem
// aberta/interagida > personagem designado. NÃO exigir seleção de token.
// O nome da ficha sempre é exibido para conferência e nada muda antes da confirmação.
export async function applyItemAttackDamage(total,{target=null,damageType=null}={}){
  let selected;
  if(target){
    if(target.documentName!=='Actor')return ui.notifications.warn('O alvo do ataque não é um personagem válido.');
    selected={actors:[target],mode:`alvo do ataque: ${target.name}`};
  }else{
    const last=await getLastInteractedActor();
    const fallback=game.user?.character?.documentName==='Actor'?game.user.character:null;
    const actor=last??fallback;
    if(!actor)return ui.notifications.warn('Abra a ficha do personagem que receberá o dano antes de aplicar a rolagem.');
    selected={actors:[actor],mode:last?'última ficha aberta/interagida':'ficha designada'};
  }
  return openApply(total,selected,{damageType,onlyDamage:true});
}
