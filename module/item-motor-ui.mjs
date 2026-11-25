// Multiverso v0.2.41 — Motor de Itens: campos contextuais e estética preto/dourado.
import {itemMotorConfig,saveItemMotor,ITEM_ACTIONS,ITEM_RESOURCES,ITEM_DAMAGE_TYPES,ITEM_FORMULA_FIELDS,rechargeItemMotor} from './item-motor.mjs';
import {itemAbilitySummary,itemAbilityDetails,openItemAbilityManager} from './item-ability-manager.mjs';
const esc=v=>foundry.utils.escapeHTML(String(v??''));
const option=(rows,value)=>rows.map(([id,name])=>`<option value="${esc(id)}" ${id===value?'selected':''}>${esc(name)}</option>`).join('');
const protectionKinds=[['resistencia','Resistência'],['bloqueio','Bloqueio'],['esquiva','Esquiva'],['imunidade','Imunidade'],['vulnerabilidade','Vulnerabilidade']];
const damageTypes=[['todos','Todos os danos'],...ITEM_DAMAGE_TYPES];
const rechargeKinds=[['manual','Manual'],['curto','Descanso curto'],['intensivo','Descanso intensivo'],['novo_dia','Novo dia'],['tempo','Após tempo decorrido'],['evento','Evento personalizado']];
function pForm(data,i){
 const type=data.type||'resistencia';
 const damage=type==='resistencia'||type==='imunidade'||type==='vulnerabilidade';
 return `<div class="mv-im-protection-row" data-im-protection="${i}"><div class="mv-im-protection-top"><b>Proteção ${i+1}</b><button type="button" class="mv-im-plain-danger" data-im-remove-protection="${i}">Remover</button></div><div class="mv-im-grid">
 <label>Proteção ou alteração<select data-p="type">${option(protectionKinds,type)}</select></label>
 ${damage?`<label>Tipo de dano<select data-p="damageType">${option(damageTypes,data.damageType||'todos')}</select></label>${data.damageType==='outro'?`<label>Especificar dano personalizado<input type="text" maxlength="70" data-p="customDamageType" value="${esc(data.customDamageType||'')}" placeholder="Ex.: Radiação" /></label>`:''}`:''}
 ${type==='resistencia'?`<label>Como reduz o dano<select data-p="mode">${option([['flat','Flat — subtrai valor'],['padrao','Padrão — reduz metade']],data.mode||'flat')}</select></label>`:''}
 ${['bloqueio','esquiva'].includes(type)||type==='resistencia'&&data.mode!=='padrao'?`<label>${type==='resistencia'?'Redução Flat':'Bônus (+) ou penalidade (-)'}<input type="number" step="1" data-p="value" value="${Number(data.value||0)}"/></label>`:''}
 </div></div>`;
}
export function mountItemMotor(sheet,root){
 const host=root.querySelector('[data-mv-item-motor]');if(!host)return;
 const item=sheet.item,cfg=itemMotorConfig(item);
 const actor=item.parent?.documentName==='Actor'?item.parent:null;
 const workingProtections=(cfg.protections||[]).map(x=>({...x}));
 host.addEventListener('click',event=>{
   const chosen=event.target.closest('[data-mv-im-summary-select]');
   if(!chosen)return;
   host.querySelectorAll('[data-mv-im-summary-select]').forEach(b=>b.classList.toggle('is-selected',b===chosen));
   const pane=host.querySelector('[data-mv-im-ability-detail]');
   if(pane)pane.innerHTML=itemAbilityDetails(item,chosen.dataset.mvImSummarySelect);
 });
 host.innerHTML=`<div class="mv-im-engine">
 <div class="mv-im-heading"><div><span>MULTIVERSO RPG</span><h3>Motor do Item</h3><p>Configure apenas as funcionalidades que este objeto possui. Cada área fica separada.</p></div><i class="fa-solid fa-gears" aria-hidden="true"></i></div>
 <div class="mv-im-card"><h4><i class="fa-solid fa-sliders"></i> Especificação</h4>
  <div class="mv-im-grid"><label>Tempo de uso<select data-im="action">${option(ITEM_ACTIONS,cfg.action)}</select></label>
  <label class="mv-im-toggle"><input data-im="magical" type="checkbox" ${cfg.magical?'checked':''}/> Item mágico</label>
  <label class="mv-im-toggle"><input data-im="requiresEquip" type="checkbox" ${cfg.requiresEquip?'checked':''}/> Exige estar equipado</label>
  <label class="mv-im-toggle"><input data-im="syncRequired" type="checkbox" ${cfg.syncRequired?'checked':''}/> Exige sincronização</label>
  <label class="mv-im-toggle"><input data-im="synced" type="checkbox" ${cfg.synced?'checked':''}/> Sincronizado com este personagem</label>
  <label class="mv-im-toggle"><input data-im="consume" type="checkbox" ${cfg.consume?'checked':''}/> Consumir 1 unidade após utilização</label></div>
  <p class="mv-im-hint">O item pode fazer várias coisas simultaneamente. Habilidades conjuradas respeitam as próprias regras de execução.</p></div>
 <div class="mv-im-card"><h4><i class="fa-solid fa-swords"></i> Ataque e dano <span class="mv-im-muted">Opcional</span></h4>
  <label class="mv-im-toggle"><input type="checkbox" data-im="enableAttack" ${cfg.enableAttack?'checked':''}/> Permitir ataques com este item</label>
  <div data-im-conditional="enableAttack" class="mv-im-subsection" ${cfg.enableAttack?'':'hidden'}>
  <div class="mv-im-grid"><label>Rolagem de ataque<input data-im="attackFormula" value="${esc(cfg.attackFormula)}" placeholder="d20 + força"/></label>
  <label>Rolagem de dano<input data-im="damageFormula" value="${esc(cfg.damageFormula)}" placeholder="2d6 + força"/></label>
  <label>Tipo de dano<select data-im="damageType">${option(ITEM_DAMAGE_TYPES,cfg.damageType)}</select></label>
  <label>Crítico<input data-im="critical" value="${esc(cfg.critical)}" placeholder="15, 20, 1x10, 2x17, 4x5"/></label>
  <label data-im-custom-damage ${cfg.damageType==='outro'?'':'hidden'}>Nome do dano personalizado<input maxlength="70" data-im="customDamageType" value="${esc(cfg.customDamageType)}" placeholder="Ex.: Astral"/></label></div>
  <section class="mv-im-guaranteed"><label class="mv-im-toggle"><input type="checkbox" data-im="guaranteedEnabled" ${cfg.guaranteedEnabled?'checked':''}/> Esta arma possui Dano Garantido</label>
   <div class="mv-im-grid" data-im-conditional="guaranteedEnabled" ${cfg.guaranteedEnabled?'':'hidden'}>
    <label>Base do dano garantido (atributo ou perícia)<select data-im="guaranteedBase">${option(ITEM_FORMULA_FIELDS,cfg.guaranteedBase)}</select></label>
    <label>Proporção de Dano Garantido<select data-im="guaranteedInterval">${option([['4','A cada 4 pontos'],['3','A cada 3 pontos'],['2','A cada 2 pontos'],['1','Mesmo valor (1 por ponto)']],String(cfg.guaranteedInterval||4))}</select></label>
    <label>Quantidade adicional de Dano Garantido<input data-im="guaranteedBonus" value="${esc(cfg.guaranteedBonus)}" placeholder="0, 2, pontaria..."/></label>
    <p class="mv-im-hint mv-im-full">O Dano Garantido usa a proporção escolhida da base, somada ao bônus adicional. Conta após o acerto, sem multiplicar no crítico.</p>
   </div></section>
  <p class="mv-im-hint"><b>Crítico 15 ou 20:</b> +1 dado do maior tipo com esse valor natural ou mais. <b>1x10:</b> marca crítico no 10 natural ou mais, sem aumentar o dano. <b>2x:</b> dobro no 20 natural. <b>4x5:</b> quádruplo com 5 natural ou mais. O acerto continua sendo confirmado após Esquiva/Bloqueio.</p></div></div>
 <div class="mv-im-card"><h4><i class="fa-solid fa-flask"></i> Poções e recuperação <span class="mv-im-muted">Opcional</span></h4>
  <label class="mv-im-toggle"><input type="checkbox" data-im="enableRecovery" ${cfg.enableRecovery?'checked':''}/> Este item recupera recursos</label>
  <div class="mv-im-grid" data-im-conditional="enableRecovery" ${cfg.enableRecovery?'':'hidden'}>
    <label>Recurso<select data-im="healResource">${option(ITEM_RESOURCES,cfg.healResource)}</select></label><label>Valor ou dados<input data-im="healFormula" value="${esc(cfg.healFormula)}" placeholder="2d6 + 2"/></label>
  </div></div>
 <div class="mv-im-card"><h4><i class="fa-solid fa-battery-half"></i> Cargas e recarga <span class="mv-im-muted">Opcional</span></h4>
  <label class="mv-im-toggle"><input type="checkbox" data-im="chargesEnabled" ${cfg.chargesEnabled?'checked':''}/> Este item usa cargas</label>
  <div class="mv-im-subsection" data-im-conditional="chargesEnabled" ${cfg.chargesEnabled?'':'hidden'}>
    <div class="mv-im-grid"><label>Cargas atuais<input type="number" data-im="chargesCurrent" min="0" value="${cfg.chargesCurrent}"/></label><label>Máximo de cargas<input type="number" min="1" data-im="chargesMax" value="${cfg.chargesMax}"/></label>
    <label>Cargas por utilização<input type="number" min="1" data-im="chargeCost" value="${cfg.chargeCost}"/></label>
    <label>Tipo de recarga<select data-im="rechargeMode">${option(rechargeKinds,cfg.rechargeMode)}</select></label>
    <label>Quantidade recuperada<input data-im="rechargeAmount" value="${esc(cfg.rechargeAmount)}" placeholder="máximo ou 1d4"/></label>
    <label data-im-recharge-time ${cfg.rechargeMode==='tempo'?'':'hidden'}>Intervalo em minutos<input type="number" min="1" data-im="rechargeMinutes" value="${cfg.rechargeMinutes}"/></label>
    <label data-im-recharge-event ${cfg.rechargeMode==='evento'?'':'hidden'}>Nome do evento<input data-im="rechargeEvent" maxlength="80" value="${esc(cfg.rechargeEvent)}" placeholder="Identificador de evento"/></label>
    </div><button type="button" class="mv-im-recharge" data-im-recharge><i class="fa-solid fa-rotate"></i> Recarregar manualmente</button>
    <p class="mv-im-hint">Recargas por descanso e Novo Dia acompanham os eventos do Multiverso. Por tempo, acompanham o relógio do mundo; eventos personalizados precisam ser emitidos pela mesa/módulo.</p>
  </div></div>
 <div class="mv-im-card"><h4><i class="fa-solid fa-shield-halved"></i> Proteções e modificadores <span class="mv-im-muted">Opcional</span></h4>
  <p class="mv-im-hint">Resistência Flat/Padrão, imunidade, vulnerabilidade, Esquiva e Bloqueio. As opções de cada proteção aparecem após escolher seu tipo.</p>
  <div data-im-protection-list class="mv-im-protection-list"></div>
  <button type="button" class="mv-im-add-sub" data-im-add-protection><i class="fa-solid fa-plus"></i> Adicionar proteção</button>
 </div>
 <div class="mv-im-card mv-im-ability-card"><h4><i class="fa-solid fa-wand-magic-sparkles"></i> Habilidades do item <span class="mv-im-muted">Opcional</span></h4>
  <p class="mv-im-hint">Cadastre as habilidades próprias deste objeto. Conjurar executa um poder do item; Conceder o disponibiliza enquanto equipado.</p>
  <div data-im-ability-summary>${itemAbilitySummary(item)}</div>
  <button type="button" class="mv-im-add-sub mv-im-open-abilities" data-im-manage-abilities><i class="fa-solid fa-book-open"></i> Gerenciar habilidades do item <i class="fa-solid fa-arrow-up-right-from-square"></i></button>
 </div>
 <div class="mv-im-card"><h4><i class="fa-solid fa-sparkles"></i> Efeitos especiais <span class="mv-im-muted">Opcional</span></h4>
  <p>Para aplicar uma condição ou outro efeito mecânico, abra a aba <strong>Efeitos</strong> acima e cadastre cada efeito no editor original. Agora cada um tem seu próprio <strong>gatilho de ativação</strong>: uso, acerto, crítico, erro, dano, derrota e outros eventos.</p>
  <button type="button" class="mv-im-add-sub" data-im-go-effects>Abrir Efeitos <i class="fa-solid fa-arrow-right"></i></button>
 </div>
 <div class="mv-im-save-indicator" role="status" aria-live="polite"><i class="fa-solid fa-check" aria-hidden="true"></i><span data-im-status>As alterações são salvas automaticamente.</span></div>
 </div>`;
 let protections=workingProtections;
 const get=k=>host.querySelector(`[data-im="${k}"]`);
 const read=k=>{const el=get(k);return el?.type==='checkbox'?el.checked:el?.value??'';};
 const updateVisibility=()=>{
   host.querySelectorAll('[data-im-conditional]').forEach(el=>el.hidden=!get(el.dataset.imConditional)?.checked);
   host.querySelector('[data-im-custom-damage]').hidden=read('damageType')!=='outro';
   host.querySelector('[data-im-recharge-time]').hidden=read('rechargeMode')!=='tempo';
   host.querySelector('[data-im-recharge-event]').hidden=read('rechargeMode')!=='evento';
 };
 host.addEventListener('change',e=>{
   if(e.target.matches('[data-im]'))updateVisibility();
   if(e.target.matches('[data-p="type"],[data-p="mode"],[data-p="damageType"]')){
     const box=e.target.closest('[data-im-protection]');const i=Number(box.dataset.imProtection);protections[i]=readProtection(box,protections[i]);renderProtections();
   }
   if(e.target.matches('[data-p="damageType"]')&&e.target.value==='outro'&&!e.target.closest('[data-im-protection]')?.querySelector('[data-p="customDamageType"]')?.value)return;
   if(e.target.matches('[data-im],[data-p]'))scheduleSave();
 });
 const readProtection=(box,old={})=>({type:box.querySelector('[data-p="type"]')?.value||old.type||'resistencia',mode:box.querySelector('[data-p="mode"]')?.value||old.mode||'flat',damageType:box.querySelector('[data-p="damageType"]')?.value||old.damageType||'todos',customDamageType:box.querySelector('[data-p="customDamageType"]')?.value??old.customDamageType??'',value:Number(box.querySelector('[data-p="value"]')?.value??old.value??0)});
 const harvestProtections=()=>{host.querySelectorAll('[data-im-protection]').forEach(box=>{const i=Number(box.dataset.imProtection);protections[i]=readProtection(box,protections[i]);});};
 const renderProtections=()=>{host.querySelector('[data-im-protection-list]').innerHTML=protections.map(pForm).join('');};
 host.addEventListener('click',e=>{
   const btn=e.target.closest('[data-im-remove-protection],[data-im-add-protection]');if(!btn)return;
   if(btn.hasAttribute('data-im-remove-protection')){harvestProtections();protections.splice(Number(btn.dataset.imRemoveProtection),1);renderProtections();scheduleSave();}
   if(btn.hasAttribute('data-im-add-protection')){harvestProtections();if(protections.length>=12)return ui.notifications.warn('Limite de 12 proteções por item.');protections.push({type:'resistencia',mode:'flat',damageType:'todos',value:0});renderProtections();scheduleSave();}

 });
 renderProtections();updateVisibility();
 host.querySelector('[data-im-go-effects]')?.addEventListener('click',async()=>{
   // O Motor do Item é uma janela independente; a configuração de efeitos continua na ficha do item.
   sheet._mvItemTab='efeitos';
   await sheet.render(true);
 });
 host.querySelector('[data-im-recharge]')?.addEventListener('click',async e=>{
   const button=e.currentTarget;button.disabled=true;
   try{
     await saveNow();
     if(await rechargeItemMotor(item)){
       const current=get('chargesCurrent');
       if(current)current.value=String(itemMotorConfig(item).chargesCurrent);
       ui.notifications.info('Cargas recarregadas.');
       sheet.render(false);
     }
   }catch(error){console.error(error);ui.notifications.error(error.message);}
   finally{if(button.isConnected)button.disabled=false;}
 });
 host.querySelector('[data-im-manage-abilities]')?.addEventListener('click',async e=>{
   const button=e.currentTarget;button.disabled=true;
   try{
     await openItemAbilityManager(item);
     const summary=host.querySelector('[data-im-ability-summary]');
     if(summary)summary.innerHTML=itemAbilitySummary(item);
   }catch(error){console.error('Multiverso | Gerenciar habilidades do item',error);ui.notifications.error(error.message);}
   finally{if(button.isConnected)button.disabled=false;}
 });
 // Salvamento automático: mudanças simples são gravadas no change;
 // texto/fórmulas são gravados após pausa de digitação. Salva uma operação
 // por vez para impedir que respostas assíncronas antigas sobrescrevam campos.
 let debounce=null, saving=false, pending=false;
 const status=host.querySelector('[data-im-status]');
 const statusText=text=>{if(status)status.textContent=text;};
 const snapshot=()=>{
   harvestProtections();
   const latestLinks=itemMotorConfig(item);
   return {action:read('action'),magical:read('magical'),requiresEquip:read('requiresEquip'),syncRequired:read('syncRequired'),synced:read('synced'),consume:read('consume'),
      kind:read('enableAttack')?'ataque':read('enableRecovery')?'recuperacao':latestLinks.castSources.length?'conjurar':'nenhum',
      enableAttack:read('enableAttack'),enableRecovery:read('enableRecovery'),enableCast:latestLinks.castSources.length>0,
      attackFormula:read('attackFormula'),damageFormula:read('damageFormula'),guaranteedEnabled:read('guaranteedEnabled'),guaranteedBase:read('guaranteedBase'),guaranteedInterval:Number(read('guaranteedInterval')),guaranteedBonus:read('guaranteedBonus'),damageType:read('damageType'),customDamageType:read('customDamageType'),critical:read('critical'),
      healResource:read('healResource'),healFormula:read('healFormula'),chargesEnabled:read('chargesEnabled'),chargesCurrent:Number(read('chargesCurrent')),chargesMax:Number(read('chargesMax')),chargeCost:Number(read('chargeCost')),
      rechargeMode:read('rechargeMode'),rechargeAmount:read('rechargeAmount'),rechargeMinutes:Number(read('rechargeMinutes')),rechargeEvent:read('rechargeEvent'),
      grantSources:latestLinks.grantSources,castSources:latestLinks.castSources,grantSource:'',castSource:'',protections:protections.map(p=>({...p}))};
 };
 const flush=async()=>{
   if(saving)return;
   saving=true;
   let lastError=null;
   try{
     while(pending){
       pending=false;
       try{
         statusText('Salvando alterações...');
         await saveItemMotor(item,snapshot());
         lastError=null;
         statusText('Alterações salvas automaticamente.');
       }catch(error){
         lastError=error;
         console.warn('Multiverso | Salvamento automático do item',error);
         statusText(`Não salvo: ${error.message}`);
       }
     }
   }finally{saving=false;}
   if(lastError)throw lastError;
 };
 const saveNow=async()=>{
   if(debounce!==null){clearTimeout(debounce);debounce=null;}
   pending=true;
   if(saving){
     // Espera a gravação em andamento; a própria fila processa a última edição.
     while(saving)await new Promise(resolve=>setTimeout(resolve,30));
     return;
   }
   await flush();
 };
 const scheduleSave=(delayed=false)=>{
   if(debounce!==null)clearTimeout(debounce);
   if(delayed){debounce=setTimeout(()=>{debounce=null;pending=true;void flush().catch(()=>{});},500);}
   else {debounce=null;pending=true;void flush().catch(()=>{});}
 };
 host.addEventListener('input',e=>{
   if(e.target.matches('[data-im],[data-p]')&&e.target.type!=='checkbox'&&e.target.tagName!=='SELECT')scheduleSave(true);
 });

}
