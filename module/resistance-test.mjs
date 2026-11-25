import {conditionTestModifiers,consumeConditionTestModifiers} from './condition-mechanics.mjs';
import {passiveTests} from './passive-bonuses.mjs';
import {resolveTestKey} from './pericia-fields.mjs';
import {resolveTestMarks} from './test-marks.mjs';
import {activityOf,actionStatus,reserveAction,refundAction,ACTION_LABELS} from './action-economy.mjs';
import {reactionStatus,spendReaction,refundReaction} from './reaction-combat.mjs';
// Multiverso V8 — motor nativo do teste. Regras da macro original fornecida por Hope.
const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=x=>{const v=(x&&typeof x==='object'&&'value'in x)?x.value:x;const n=Number(String(v??0).replace(',','.'));return Number.isFinite(n)?n:0;};
const active=x=>{const v=x&&typeof x==='object'&&'value'in x?x.value:x;return v===true||['true','1','on','checked'].includes(String(v).toLowerCase());};

// Skills marcadas como "Escolhido ao usar" são escolhas da própria rolagem,
// não precisam ter criado um ActiveEffect antes de exibir a checkbox.
// Restringir ao teste próprio de uso único, para não executar por engano
// habilidades que exigem alvo, resistência, duração ou efeitos encadeados.
export function rollChoicesFromAbilities(actor,testKey){
 const choices=[];
 const seen=new Set();
 const get=(p,key)=>{const v=p[key];return v&&typeof v==='object'&&'value'in v?v.value:v;};
 for(const item of actor?.items??[]){
  if(!['skill','tecnica'].includes(item.type))continue;
  const p=item.system?.props??{},prefix=`efeito${item.type}`;
  for(let index=1;index<=5;index++){
   const suffix=index===1?'':String(index);
   const val=key=>String(get(p,prefix+key+suffix)??'').trim();
   const type=normalize(val('tipo'));
   const operation=normalize(val('operacao'));
   const definition=normalize(val('definicao'));
   const receiver=normalize(val('receptor')||'proprio');
   const scope=resolveTestKey(val('alvo'));
   if(type!=='teste'||!['vantagem','desvantagem'].includes(operation)||definition!=='escolhido')continue;
   if(!['proprio','o proprio personagem'].includes(receiver)||scope!==testKey)continue;
   const activity=normalize(get(p,`ativacaotempotipo${item.type}${suffix}`)||get(p,`ativacaotempotipo${item.type}`)||'');
   if(activity==='passiva')continue; // Passivos continuam no motor original.
   // A ficha pode registrar a mesma Skill como vínculo de item e como cópia.
   if(item.getFlag?.('multiverso-rpg','itemCastCloneV1')||item.getFlag?.('multiverso-rpg','itemAbilityTemplateV1'))continue;
   const k=`${item.uuid}:${index}`;
   if(seen.has(k))continue;
   seen.add(k);
   choices.push({tipo:operation,formula:'',item:item.name,definicao:'escolhido',
     sourceId:item.id,originItemId:item.id,directRollChoice:true,
     effectIndex:index,originAbilityUuid:item.uuid});
  }
 }
 return choices;
}

export async function rollOriginalResistance(actor,name,forcedKey=null,{silent=false}={}){
  const props=actor.system?.props??actor.system??{};
  const keys=Object.keys(props);
  const input=normalize(name);
  const key=(forcedKey&&keys.includes(forcedKey)?forcedKey:null)||keys.find(k=>normalize(k)===input)||keys.find(k=>normalize(k.replace(/numero$/i,''))===input)||({resistencia:'resistencianumero',forca:'forcanumero',agilidade:'agilidadenumero',inteligencia:'inteligencianumero',carisma:'carismanumero',percepcao:'percepcaonumero'}[input]);
  if(!key || !(key in props)){ui.notifications.error(`Teste "${name}" não encontrado na ficha de ${actor.name}.`);return null;}
  const base=num(props[key]);const baseLimitada=actor.type==='npc'?base:Math.min(base,15);
  const prof=[1,2,3].filter(n=>active(props[`${key}_prof${n}`])).length;
  const impasse=['','2'].filter(s=>active(props[`${key}_impasse${s}`])).length;
  // Compatibilidade com os efeitos originais quando o motor antigo estiver presente.
  const passive=globalThis.MultiversoEfeitos?.modoTestePassivo?.(actor,key)??globalThis.MultiversoEfeitos?.modoTestePassivo?.(actor,name)??{};
  const native=passiveTests(actor,name);
  if(native.errors.length){ui.notifications.error(native.errors.join(' '));return null;}
  const sources=[...(passive.fontes??[]),...(passive.modificadores??[]),...native.fixed,...native.optional];
  // Efeitos temporários e condições participam da MESMA lista de escolhas
  // usada há tempos por itens e passivos. Uso único deve ser opt-in.
  const conditions=conditionTestModifiers(actor,key);
  const conditionSources=conditions.map(m=>({tipo:m.mode,item:m.name,formula:'',
    definicao:m.uses==='once'?'escolhido':'fixo',conditionModifier:m,alreadyActivated:true,originAbilityUuid:m.effect?.getFlag?.('multiverso-rpg','sourceUuid')??''}));
  sources.push(...conditionSources);
  // Uma vantagem ainda não ativada aparece diretamente como escolha no teste.
  // Não duplicar se o mesmo benefício já foi aplicado como ActiveEffect.
  const activeOrigins=new Set(conditionSources.map(s=>s.originAbilityUuid).filter(Boolean));
  sources.push(...rollChoicesFromAbilities(actor,key).filter(s=>!activeOrigins.has(s.originAbilityUuid)));
  const fixed=sources.filter(s=>String(s.definicao??'fixo')!=='escolhido'&&!s.escolhidoAoUsar);
  const optional=sources.filter(s=>!fixed.includes(s));
  const marks=resolveTestMarks(prof,impasse);
  const id='mv-res-'+foundry.utils.randomID();
  const labelFor=s=>{const kind=normalize(s.tipo);const type={vantagem:'Vantagem',desvantagem:'Desvantagem',bonus:'Bônus',penalidade:'Penalidade'}[kind]??String(s.tipo??'Efeito');
    const formula=String(s.formula??'').trim();
    return `<strong>${esc(type)}${formula?' '+esc(formula):''}</strong><span class="mv-test-source">${esc(s.item??'Efeito')}</span>`;};
  const fixedHTML=fixed.map(s=>`<div class="mv-test-source-row"><i class="fa-solid fa-lock" aria-hidden="true"></i><div>${labelFor(s)}</div><small>Ativo</small></div>`).join('');
  // Effects from the same item share one opt-in checkbox: +3 and advantage
  // are granted together only when the player chooses to use that item.
  const optionGroups=[];
  const byGroup=new Map();
  optional.forEach((source,index)=>{
    const key=source.directRollChoice?`skill:${source.sourceId}:${source.effectIndex}`:source.originItemId?`item:${source.originItemId}`:`effect:${index}`;
    let group=byGroup.get(key);
    if(!group){group={key,item:source.item,indices:[],equipment:!!source.originItemId};byGroup.set(key,group);optionGroups.push(group);}
    group.indices.push(index);
  });
  // Only an optional source that comes directly from a Skill/Técnica charges an
  // action here. An already-applied condition has paid for its activation and
  // must not be charged again when its benefit is used later.
  const optionAction=group=>{
    const rows=group.indices.map(index=>optional[index]);
    const items=rows.filter(row=>!row.alreadyActivated).map(row=>row.sourceId?actor.items?.get(row.sourceId):null).filter(Boolean);
    const kinds=[...new Set(items.map(activityOf).filter(Boolean))];
    return kinds.length>1?'incompativel':kinds[0]??'';
  };
  const optionStatus=group=>{
    const activity=optionAction(group);
    if(!activity)return {ok:true,activity:''};
    if(activity==='incompativel')return {ok:false,activity,reason:'Efeitos com ações incompatíveis.'};
    if(!game.combat?.started)return {ok:true,activity};
    if(activity==='reacao'){
      const reaction=reactionStatus(actor);
      return {ok:reaction.ok,activity,reason:reaction.ok?'':reaction.reason==='not-combatant'?'O personagem não participa do combate.':'Reações indisponíveis.'};
    }
    const status=actionStatus(actor,activity);
    return {ok:status.ok,activity,reason:status.reason??''};
  };
  const optionRows=group=>group.indices.map(index=>optional[index]);
  const optionLabel=group=>{
    const action=optionStatus(group);
    if(action.activity)return ACTION_LABELS[action.activity]??'Ação';
    const already=optionRows(group).find(r=>r.alreadyActivated&&r.originAbilityUuid);
    if(already){
      const skill=[...(actor.items??[])].find(item=>item.uuid===already.originAbilityUuid);
      const kind=activityOf(skill);
      if(kind)return `${ACTION_LABELS[kind]??'Ação'} • já ativada`;
    }
    return 'Ativar';
  };
  const groupDescription=group=>optionRows(group).map(s=>{
    const t=normalize(s.tipo);const formula=String(s.formula??'').trim();
    return t==='bonus'?`+${formula}`:t==='penalidade'?`−${formula}`:t==='vantagem'?'Vantagem':t==='desvantagem'?'Desvantagem':String(s.tipo??'Efeito');
  }).join(' e ');
  const optionalHTML=optionGroups.map((group,index)=>`<label class="mv-test-source-row mv-test-source-optional mv-test-equipment-choice"><input type="checkbox" data-mv-option="${index}" ${optionStatus(group).ok?'':'disabled'}/><div><strong>${esc(group.item)}</strong><span class="mv-test-source">${esc(groupDescription(group))}</span></div><small title="${esc(optionStatus(group).reason??'')}">${esc(optionLabel(group))}${optionStatus(group).ok?'':' • Indisponível'}</small></label>`).join('');
  const summaryMark=marks.remainingProf?`<span class="mv-test-positive">+${marks.profBonus} Proficiência</span>`:marks.remainingImp?`<span class="mv-test-negative">−${marks.impPenalty} Impasse</span>`:'<span>Sem bônus de marcas</span>';
  const content=`<div class="mv-res-test-dialog" id="${id}">
    <div class="mv-test-heading"><i class="fa-solid fa-dice-d20" aria-hidden="true"></i><div><small>MULTIVERSO RPG • TESTE</small><h2>${esc(name)}</h2><span>Configure sua rolagem antes de lançar os dados.</span></div></div>
    ${sources.length?`<section class="mv-test-section"><h3><i class="fa-solid fa-sparkles" aria-hidden="true"></i> Efeitos deste teste</h3><div class="mv-test-source-list">${fixedHTML}${optionalHTML}</div></section>`:''}
    <section class="mv-test-section"><h3><i class="fa-solid fa-sliders" aria-hidden="true"></i> Configuração da rolagem</h3>
      <div class="mv-test-fields"><label><span>Tipo de rolagem</span><select name="mv-modo"><option value="normal">Normal</option><option value="vantagem">Vantagem</option><option value="desvantagem">Desvantagem</option></select></label>
      <label><span>Modificador extra</span><input type="text" name="mv-extra" placeholder="Ex.: +2, -3, 1d4, 2d6" autocomplete="off"/></label></div>
      <div class="mv-test-marks"><div><span>Base</span><strong>${base}${base>15?` → ${baseLimitada}`:''}</strong></div><div><span>Proficiências / Impasses</span><strong>${prof} P / ${impasse} I</strong></div><div><span>Resultado das marcas</span><strong>${summaryMark}</strong></div></div>
      ${marks.canceled?`<p class="mv-test-rule"><i class="fa-solid fa-scale-balanced" aria-hidden="true"></i> ${marks.canceled} ${marks.canceled===1?'Proficiência e Impasse se anularam':'Proficiências e Impasses se anularam'}.</p>`:''}
    </section>
    <div class="mv-test-result"><span>Resultado final da rolagem</span><strong data-mv-test-final>Normal</strong><small data-mv-test-formula>1d20</small></div>
  </div>`;
  const calcMode=(manual,chosen)=>{
    const types=[...fixed,...chosen].map(s=>normalize(s.tipo));
    const advantage=manual==='vantagem'||types.includes('vantagem');
    const disadvantage=manual==='desvantagem'||types.includes('desvantagem');
    const mode=advantage&&disadvantage?'normal':advantage?'vantagem':disadvantage?'desvantagem':'normal';
    return {mode,advantage,disadvantage,die:mode==='vantagem'?'2d20kh1':mode==='desvantagem'?'2d20kl1':'1d20'};
  };
  const answer=await foundry.applications.api.DialogV2.wait({
    window:{title:`Teste de ${name} — Multiverso`,resizable:false},content,
    buttons:[{action:'cancel',label:'Cancelar'},{action:'roll',label:'Rolar',default:true,callback:(_event,_button,dialog)=>{
      const el=dialog.element.querySelector(`#${id}`);
      return {modo:el.querySelector('[name="mv-modo"]').value,extra:el.querySelector('[name="mv-extra"]').value,selected:[...el.querySelectorAll('[data-mv-option]:checked')].flatMap(e=>optionGroups[Number(e.dataset.mvOption)]?.indices??[])};
    }}],
    render:(_event,dialog)=>{
      const win=dialog.element;win.classList.add('mv-test-dialog-window');
      const el=win.querySelector(`#${id}`);if(!el)return;
      const update=()=>{
        const chosen=[...el.querySelectorAll('[data-mv-option]:checked')].flatMap(e=>optionGroups[Number(e.dataset.mvOption)]?.indices??[]).map(i=>optional[i]).filter(Boolean);
        const info=calcMode(el.querySelector('[name="mv-modo"]').value,chosen);
        const result=el.querySelector('[data-mv-test-final]');
        result.textContent=info.advantage&&info.disadvantage?'Normal — Vantagem e Desvantagem se anulam':info.mode==='vantagem'?'Vantagem':info.mode==='desvantagem'?'Desvantagem':'Normal';
        el.querySelector('[data-mv-test-formula]').textContent=info.die;
      };
      el.addEventListener('change',update);
      // Uma Vantagem fixa já deve aparecer no resumo ao abrir a janela.
      update();
    }
  });
  if(!answer||!answer.modo)return null;
  // Validate and spend actions only after the player confirms Rolar.
  // Re-check current combat state: another user may have spent the action
  // while this dialog was open. Refund receipts if the roll itself fails.
  const chosenGroups=optionGroups.filter(g=>g.indices.some(i=>answer.selected.includes(i)));
  const receipts=[];
  const refund=async()=>{
    for(const entry of receipts.reverse()){
      try{
        if(entry.activity==='reacao')await refundReaction(actor,entry.receipt);
        else await refundAction(actor,entry.receipt);
      }catch(error){console.error('Multiverso | Falha ao devolver ação após teste cancelado',error);}
    }
  };
  for(const group of chosenGroups){
    const state=optionStatus(group);
    if(!state.ok){await refund();ui.notifications.warn(`${group.item}: ${state.reason}`);return null;}
    if(!state.activity||!game.combat?.started||['livre','passiva'].includes(state.activity))continue;
    try{
      const receipt=state.activity==='reacao'?await spendReaction(actor):await reserveAction(actor,state.activity);
      if(!receipt.ok){await refund();ui.notifications.warn(`${group.item}: ${receipt.reason??'Ação indisponível.'}`);return null;}
      if(receipt.consumed)receipts.push({activity:state.activity,receipt});
    }catch(error){await refund();console.error('Multiverso | Falha ao consumir ação da opção do teste',error);ui.notifications.error('Não foi possível registrar a ação deste teste.');return null;}
  }
  const selected=[...fixed,...answer.selected.map(i=>optional[i]).filter(Boolean)];
  const {mode,die}=calcMode(answer.modo,answer.selected.map(i=>optional[i]).filter(Boolean));
  let extra=String(answer.extra??'').trim()||'0';if(/^d\d+$/i.test(extra))extra='1'+extra;
  const terms=[die,String(baseLimitada),String(marks.net)];
  if(extra!=='0')terms.push(`(${extra})`);
  for(const s of selected){const t=normalize(s.tipo);if(!['bonus','penalidade'].includes(t))continue;const raw=String(s.formula??'').trim();if(!raw)continue;terms.push(t==='penalidade'?`- abs(${raw})`:`(${raw})`);}
  const formula=terms.join(' + ');
  let roll,rolledMessage;
  try{
    roll=new Roll(formula,actor.getRollData?.()??{});await roll.evaluate();
    rolledMessage=silent?null:await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:`<strong>Teste de ${esc(name)}</strong> (${mode==='normal'?'Normal':mode==='vantagem'?'Vantagem':'Desvantagem'})`},{rollMode:CONST.DICE_ROLL_MODES.PUBLIC});
  }catch(error){await refund();throw error;}
  // Não consumir a vantagem que ficou desmarcada. O efeito permanece
  // disponível para a próxima rolagem compatível.
  const consumedConditions=selected.map(s=>s.conditionModifier).filter(Boolean);
  if(consumedConditions.length){try{await consumeConditionTestModifiers(consumedConditions);}catch(error){console.error('Multiverso | Falha ao consumir condição de teste',error);ui.notifications.warn('Rolagem concluída, mas não foi possível consumir a condição; avise ao mestre.');}}
  return {total:Number(roll.total),roll,messageId:rolledMessage?.id};
}
