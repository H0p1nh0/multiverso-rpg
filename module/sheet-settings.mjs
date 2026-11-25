// v0.1.90 — Painel de configurações gerais da ficha.
// Inicialmente inclui apenas a regeneração do Fluxo Extra no Descanso Curto.
// Não modifica as regras de rolagem, alimentação, descanso ou recarga.
import {EXTRA_REST_BASE_OPTIONS,extraRestBase,extraRestMode,extraRestEnabled,EXTRA_REST_MODES} from './rest-extra-config.mjs';

const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function openSheetSettings(actor,sheet){
  if(!actor)throw new Error('Ficha indisponível.');
  if(!actor.isOwner&&!game.user?.isGM){ui.notifications.warn('Sem permissão para configurar esta ficha.');return null;}
  const enabled=actor.system?.fluxoextraativo===true;
  const name=String(actor.system?.fluxoextranome??'').trim()||'Fluxo Extra';
  const current=String(actor.system?.fluxoextrarecuperacaobase??'');
  const mode=extraRestMode(actor.system);
  const senses=actor.getFlag('multiverso-rpg','combatSpecialSensesV1')??{};
  const groups=['Atributos','Perícias ofensivas','Perícias mentais','Perícias físicas'];
  const options=`<option value="" ${!current?'selected':''}>Escolha um atributo ou perícia</option>`+
    groups.map(group=>`<optgroup label="${esc(group)}">${EXTRA_REST_BASE_OPTIONS.filter(x=>x.group===group).map(x=>`<option value="${esc(x.key)}" ${x.key===current?'selected':''}>${esc(x.label)}</option>`).join('')}</optgroup>`).join('');
  const disabled=enabled?'':' disabled aria-disabled="true"';
  const content=`<div class="mv-sheet-settings-dialog">
    <section class="mv-sheet-settings-section">
      <h3><i class="fa-solid fa-star" aria-hidden="true"></i> Fluxos Extras</h3>
      <p>Configure os recursos personalizados deste personagem. Outras opções gerais poderão ser adicionadas aqui futuramente.</p>
      <div class="mv-sheet-settings-resource"><strong>${esc(name)}</strong><span>${enabled?'Ativo':'Inativo'}</span></div>
      <label for="mv-settings-extra-rest-mode">Quando este Fluxo Extra deve recuperar?</label>
      <select id="mv-settings-extra-rest-mode" name="mvExtraRestMode"${disabled}>
        <option value="nenhum" ${mode==='nenhum'?'selected':''}>Não recuperar em nenhum descanso</option>
        <option value="curto" ${mode==='curto'?'selected':''}>Somente no Descanso Curto</option>
        <option value="intensivo" ${mode==='intensivo'?'selected':''}>Somente no Descanso Intensivo</option>
        <option value="ambos" ${mode==='ambos'?'selected':''}>Nos dois descansos</option>
      </select>
      <label for="mv-settings-extra-rest-base">Atributo ou perícia-base (para Descanso Curto)</label>
      <select id="mv-settings-extra-rest-base" name="mvExtraRestBase" data-mv-extra-rest-base${disabled}>${options}</select>
      ${enabled?'<small>No Descanso Curto, se habilitado, segue as quatro alimentações e acrescenta ¼ da referência em Comum ou Banquete. No Descanso Intensivo, se habilitado, recupera até o máximo. Se escolher somente Intensivo ou Nenhum, a referência fica guardada, mas não é utilizada.</small>':'<small>Ative o Fluxo Extra na Visão Geral para alterar esta configuração.</small>'}
    </section>
    <section class="mv-sheet-settings-section mv-combat-senses-settings">
      <h3><i class="fa-solid fa-eye" aria-hidden="true"></i> Sentidos Especiais</h3>
      <p>Opcional: exiba um sentido especial nos Atributos de Combate.</p>
      <label><input type="checkbox" name="mvSenseEnabled" ${senses.enabled===true?'checked':''}/> Exibir sentidos especiais no Combate</label>
      <label>Nome do sentido<input type="text" name="mvSenseName" maxlength="64" value="${esc(senses.name||'Visão no Escuro')}" placeholder="Ex.: Visão no Escuro" /></label>
      <label>Alcance / descrição<input type="text" name="mvSenseRange" maxlength="64" value="${esc(senses.range||'')}" placeholder="Ex.: 18 m" /></label>
    </section>
  </div>`;
  const selected=await foundry.applications.api.DialogV2.wait({
    window:{title:'Configurações da Ficha',resizable:true},
    content,
    buttons:[
      {action:'cancel',label:'Cancelar',callback:()=>null},
      {action:'save',label:'Salvar',default:true,callback:(_event,button,dialog)=>{const form=button?.form??dialog?.element;const read=name=>form?.querySelector?.(`[name="${name}"]`);return {base:read('mvExtraRestBase')?.value??'',mode:read('mvExtraRestMode')?.value??'nenhum',senseEnabled:!!read('mvSenseEnabled')?.checked,senseName:read('mvSenseName')?.value??'',senseRange:read('mvSenseRange')?.value??''};}}
    ],
    rejectClose:false
  });
  if(!selected)return null;
  if(!actor.isOwner&&!game.user?.isGM)throw new Error('Sem permissão para alterar a ficha.');
  // Sentidos são independentes do Fluxo Extra. Nunca bloquear a configuração visual.
  const cleanSense={enabled:selected.senseEnabled===true,name:String(selected.senseName||'Visão no Escuro').trim().slice(0,64),range:String(selected.senseRange||'').trim().slice(0,64)};
  const currentSense=actor.getFlag('multiverso-rpg','combatSpecialSensesV1')??{};
  if(JSON.stringify(cleanSense)!==JSON.stringify({enabled:currentSense.enabled===true,name:String(currentSense.name||'Visão no Escuro'),range:String(currentSense.range||'')}))
    await actor.setFlag('multiverso-rpg','combatSpecialSensesV1',cleanSense);
  if(actor.system?.fluxoextraativo===true){
    if(!EXTRA_REST_MODES.includes(selected.mode))throw new Error('Modo de descanso inválido.');
    if(selected.base&&!extraRestBase(selected.base))throw new Error('Atributo ou perícia inválido para a regeneração.');
    if((selected.mode==='curto'||selected.mode==='ambos')&&!extraRestBase(selected.base)){
      ui.notifications?.warn?.('Para recuperar no Descanso Curto, selecione um atributo ou perícia-base.');
      sheet?.render?.(false);
      return selected;
    }
    const patch={};
    if(String(actor.system.fluxoextrarecuperacaobase??'')!==selected.base)patch['system.fluxoextrarecuperacaobase']=selected.base;
    if(String(actor.system.fluxoextradescansomodo??'')!==selected.mode)patch['system.fluxoextradescansomodo']=selected.mode;
    if(Object.keys(patch).length)await actor.update(patch);
  }
  sheet?.render?.(false);
  return selected;
}
