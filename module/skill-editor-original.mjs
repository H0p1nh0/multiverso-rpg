import { original } from "./skill-editor-definition.mjs";
import {conditionalIntro,bindAdaptiveEditor,refreshAdaptiveEditor} from "./skill-editor-ui.mjs";
import {availablePericias,resolvePericiaKey} from "./pericia-fields.mjs";
import {availableFluxes} from './extra-flux.mjs';
import {specialRechargeKind} from './skill-uses.mjs';
import {openAbilityDiagnostic} from './ability-diagnostics.mjs';
// Editor native to Foundry VTT 14; retains the original CSB property names.
// Effect execution deliberately remains disabled during migration.
// Estrutura original de condições internas do módulo multiverso-automacao.
const CONDITION_SCOPE = 'multiverso-rpg';
const LEGACY_CONDITION_SCOPE = 'multiverso-automacao';
// Direct flags access is required for legacy module data: getFlag rejects inactive scopes.
const CONDITION_FLAG = 'condicoesHabilidadeV1';
const CONDITION_MIRROR = 'mvConditionDefinitionsV1';
function readConditionMap(item) {
  const mirrored=item.system?.props?.[CONDITION_MIRROR];
  if(mirrored && typeof mirrored==='object' && Object.keys(mirrored).length)return mirrored;
  const current=item.flags?.[CONDITION_SCOPE]?.[CONDITION_FLAG];
  if(current && typeof current==='object' && Object.keys(current).length)return current;
  return item.flags?.[LEGACY_CONDITION_SCOPE]?.[CONDITION_FLAG] ?? {};
}
const conditionSlot = (item,index) => `${item.type === 'tecnica' ? 'tecnica' : 'skill'}:${index}`;
function conditionData(item,index) {
  const map = readConditionMap(item);
  const saved = map[conditionSlot(item,index)] ?? {};
  const effects = Array.isArray(saved?.efeitos) ? saved.efeitos : Array.isArray(saved) ? saved : [];
  return {versao:2,nome:String(saved.nome ?? storedValue(item,'condicaores',index) ?? '').trim(),
    fonte:String(saved.fonte ?? item.name),descricao:String(saved.descricao ?? '').trim(),
    efeitos:effects.slice(0,5).map(e=>({...e}))};
}
async function replaceConditionMap(item,newMap) {
  const fresh=foundry.utils.deepClone(newMap);
  // Espelho no documento Item, sem depender de escopo de módulo legado.
  await item.update({[`system.props.${CONDITION_MIRROR}`]:fresh});
  // Compatibilidade com dados antigos e suas rotinas de edição.
  await item.unsetFlag(CONDITION_SCOPE,CONDITION_FLAG);
  if(Object.keys(fresh).length)await item.setFlag(CONDITION_SCOPE,CONDITION_FLAG,fresh);
  const saved=readConditionMap(item);
  if(JSON.stringify(saved)!==JSON.stringify(fresh))throw new Error('Mecânicas internas não persistiram no documento.');
}
const MAX = 5;
const COUNT_KEY = "mvEffectCount";
const activeTabByItem = new Map();
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const canonical = (item, field, i) => {
  const suffix = i === 1 ? "" : String(i);
  if (field === "atividade") return item.type === "skill" ? `ativacaotempotiposkill${suffix}` : `ativacaotempotipotecnica${suffix}`;
  if (field === "nome") return item.type === "skill" ? `atividadenomeskill${suffix}` : `atividadenometecnica${suffix}`;
  return `efeito${item.type}${field}${suffix}`;
};
const storedValue = (item, id, index) => item.system.props?.[canonical(item,id,index)] ?? "";
const optionalKey = index => `mvOptionalOnly${index}`;
const modeKey = index => `mvOptionalMode${index}`;
const replaceKey = index => `mvOptionalReplace${index}`;
const titleKey = index => `mvEffectTitle${index}`;
// Seleção explícita de atributos/perícias, mantendo o campo legado `alvo`.
const ATTR_TESTS=[['Força','Força'],['Agilidade','Agilidade'],['Resistência','Resistência'],['Inteligência','Inteligência'],['Carisma','Carisma'],['Percepção','Percepção']];
const TEST_ATTR_KEYS=new Set(ATTR_TESTS.map(([name])=>name.toLowerCase()));
const isAttributeTest=name=>TEST_ATTR_KEYS.has(String(name??'').trim().toLowerCase())||/^(forca|agilidade|resistencia|inteligencia|carisma|percepcao)numero$/i.test(String(name??''));

const cadenceKey = index => `mvEffectCadence${index}`;
// v0.1.77: multiple embedded Skill/Technique IDs, kept separate from legacy cost selector.
const passiveModeKey = index => `mvPassiveTargetMode${index}`;
const passiveIdsKey = index => `mvPassiveTargetIds${index}`;
const costModeKey = index => `mvCostTargetMode${index}`;
const costIdsKey = index => `mvCostTargetIds${index}`;


// v0.1.78 — opções explícitas, separadas dos campos legados de texto livre.
// As keys são movidas juntamente com o efeito, evitando órfãos ao duplicar/excluir.
const ADVANCED_KEYS=['mvPredicateMode','mvPredicateA','mvPredicateB','mvTrigger','mvChain','mvSustainCost'];
const advancedKey=(name,index)=>`${name}${index}`;
const optionsFor=(pairs,current)=>pairs.map(([value,label])=>`<option value="${escapeHtml(value)}" ${current===value?'selected':''}>${escapeHtml(label)}</option>`).join('');
function advancedPanel(item,index){
 const props=item.system.props??{};
 const val=name=>String(props[advancedKey(name,index)]??'');
 const field=(id,label,options,help='')=>`<label class="mv-legacy-field" data-mv-advance-control="${id}" data-mv-can-chain="${index>1?'true':'false'}"><span>${escapeHtml(label)}</span><select data-mv-advanced-name="${id}" data-mv-key="${advancedKey(id,index)}">${optionsFor(options,val(id))}</select>${help?`<small>${escapeHtml(help)}</small>`:''}</label>`;
 const predicates=[['','Sem condição'],['pv_lt_50','PV abaixo de 50%'],['pm_lt_50','PM abaixo de 50%'],['sta_lt_50','STA abaixo de 50%'],['san_lt_50','SAN abaixo de 50%'],['pv_gt_0','PV acima de zero'],['pv_lt_25','PV abaixo de 25%']];
 return `<div class="mv-advanced-panel"><div class="mv-advanced-heading"><strong>⚙ Automação avançada (opcional)</strong><small>Configure apenas o que esta habilidade precisa.</small></div><div class="mv-advanced-grid">
 ${field('mvTrigger','Quando este efeito deve acontecer?',[['','Ao usar a habilidade (padrão)'],['damage_received','Quando o PV diminuir'],['heal_received','Quando o PV aumentar'],['damage_dealt','Após causar dano confirmado (clique direito)'],['turn_start','No início do próprio turno'],['turn_end','No fim do próprio turno'],['threshold_cross','Quando a condição 1 passar a ser verdadeira'],['attack_hit','Após ataque acertar (mestre confirma)'],['attack_miss','Após ataque errar (mestre confirma)'],['attack_critical','Após crítico causado (mestre confirma)'],['critical_received','Ao receber crítico confirmado'],['reaction_used','Após usar uma Reação com sucesso']],'Gatilhos: efeitos passivos de fluxo fixo. Resultados de ataques são confirmados pelo mestre no Combate; Reação é registrada após ativação bem-sucedida.')}
 <label class="mv-ui-switch mv-grid-wide"><input type="checkbox" data-mv-ui-toggle="predicate" ${(val('mvPredicateA')||val('mvPredicateMode'))?'checked':''}><span>Este efeito exige uma condição adicional?</span></label>
 <p data-mv-conditions-help class="mv-original-status">Sem condições: o efeito segue o gatilho escolhido.</p>
 ${field('mvPredicateA','Qual condição precisa ser verdadeira?',predicates)}
 <label class="mv-ui-switch mv-grid-wide"><input type="checkbox" data-mv-ui-toggle="second" ${['and','or'].includes(val('mvPredicateMode'))?'checked':''}><span>Adicionar segunda condição?</span></label>
 ${field('mvPredicateMode','Como combinar as duas condições?',[['','Escolher combinação...'],['and','E — ambas precisam ocorrer'],['or','OU — uma delas precisa ocorrer']])}
 ${field('mvPredicateB','Segunda condição',predicates)}
 ${index>1||val('mvChain')?field('mvChain','Depende do efeito anterior?',[['','Não, executar normalmente'],['previous_effective','Sim, se o efeito anterior alterar algo'],['previous_failed','Sim, se o efeito anterior não alterar nada']],'Encadeamento disponível para efeitos imediatos próprios; depende do resultado efetivo anterior.'):''}
 <p class="mv-original-status mv-grid-wide">Campos narrativos não disparam efeitos por conta própria. Materiais são conferidos e gastos manualmente pelo jogador.</p>
 </div></div>`;
}

function auraOptions(item,index){
 const props=item.system?.props??{};
 const get=(key,fallback)=>String(props[`${key}${index}`]??fallback);
 const sel=(key,label,options,fallback)=>`<label class="mv-legacy-field"><span>${label}</span><select data-mv-key="${key}${index}">${optionsFor(options,get(key,fallback))}</select></label>`;
 return `<div class="mv-advanced-panel mv-ui-wide"><div class="mv-advanced-heading"><strong>Área persistente (se usar Alvos na área)</strong><small>Uma mesma conjuração compartilha filtros, movimento e histórico de aplicação. Neutral só entra em Todos.</small></div><div class="mv-advanced-grid">
 ${sel('mvAreaTargetMode','Quem recebe os efeitos da área?', [['all','Todos (Friendly, Hostile, Neutral)'],['friendly','Somente Friendly / aliados'],['hostile','Somente Hostile / inimigos']], 'all')}
 ${sel('mvAreaIncludeCaster','Afetar também o conjurador?', [['yes','Sim (se estiver dentro da área)'],['no','Não afetar o conjurador']], 'yes')}
 ${sel('mvAreaReapplyMode','Reaplicação da condição ao reentrar?', [['once','Uma vez por conjuração'],['renew','Renovar a duração (sem acumular)'],['after_expire','Reaplicar somente depois de expirar']], 'once')}
 <label class="mv-legacy-field"><span>Movimento máximo da área (metros por rodada)</span><input type="number" step="0.5" min="0" max="100" data-mv-key="mvAreaMoveMeters${index}" value="${escapeHtml(get('mvAreaMoveMeters',''))}"/><small>Em branco = sem limite (compatibilidade); 0 = imóvel; ex.: 1.5 para Chama das Graças. O mestre arrasta o círculo no mapa.</small></label>
 </div></div>`;
}

function sustainPanel(item,index){
 const auto=String(item.system.props?.[advancedKey('mvSustainCost',index)]??'');
 const legacy=String(storedValue(item,'sustentacao',index)??'');
 const mode=auto?'auto':legacy?'manual':'none';
 const legacyField=original.BASE_FIELDS.find(([id])=>id==='sustentacao');
 return `<div class="mv-sustain-editor"><label class="mv-legacy-field"><span>Como a habilidade é sustentada?</span><select data-mv-ui-sustain-mode><option value="none" ${mode==='none'?'selected':''}>Sem sustentação configurada</option><option value="auto" ${mode==='auto'?'selected':''}>Cobrança automática por turno</option><option value="manual" ${mode==='manual'?'selected':''}>Regra especial / texto livre</option></select></label>
 <div data-mv-sustain-part="auto"><label class="mv-legacy-field"><span>Custo por turno (recursos combinados)</span><input type="text" data-mv-key="${advancedKey('mvSustainCost',index)}" value="${escapeHtml(auto)}" placeholder="Ex.: 1 PM + 1 SAN" maxlength="120" spellcheck="false"/><small>Escreva valores fixos, como 2 PM ou 1 PM + 1 SAN. Aceita PV, PM, STA, SAN e o nome exato do Fluxo Extra ativo (ex.: 1 PM + 1 Entropia). O pagamento é feito no início de cada turno de continuidade, sem gastos parciais; o turno da ativação não é cobrado. O tipo de efeito continua independente: use Alteração de atributo para Força; para Fluxo Extra, selecione Alteração de fluxo, 'Outro' e escreva o nome do Fluxo em 'Alvo / teste / propriedade específica'.</small></label>${legacy?'<p class="mv-ui-warning">Uma regra especial antiga também está preenchida. Confira-a na opção manual; ela pode impedir a automação até ser removida explicitamente.</p>':''}</div>
 <div data-mv-sustain-part="manual">${makeField(item,legacyField,index)}<p class="mv-original-status">Regra descritiva preservada do módulo antigo; não é automatizada nesta etapa.</p></div>
 <p class="mv-original-status">Trocar esta opção só altera a visualização. Para desativar uma sustentação existente, limpe explicitamente o campo correspondente. Nenhum dado é apagado ao ocultar.</p></div>`;
}

const passiveIds = (item,index) => String(item.system.props?.[passiveIdsKey(index)]??'').split(',').map(v=>v.trim()).filter(Boolean);
const passiveAbilities = item => [...(item.parent?.documentName==='Actor'?item.parent.items??[]:[])].filter(x=>['skill','tecnica'].includes(x.type)&&x.id!==item.id && x.getFlag?.('multiverso-rpg','manualEffectSourceV1')!==true && x.getFlag?.('multiverso-rpg','traitEffectSourceV1')!==true);
const isDamagePassive = (item,index) => {
  const kind=String(storedValue(item,'tipo',index)).toLowerCase();
  const activity=String(storedValue(item,'atividade',index)).toLowerCase();
  const dest=String(storedValue(item,'afetado',index));
  return ['dano','bonus','penalidade'].includes(kind) && (dest==='dano_adicional'||kind==='dano'&&!dest) && activity==='passiva';
};
function passiveSelector(item,index) {
  const mode=String(item.system.props?.[passiveModeKey(index)]??'todos');
  const ids=new Set(passiveIds(item,index));
  const options=passiveAbilities(item);
  return `<div class="mv-passive-targets" data-mv-passive-targets>
    <div class="mv-passive-targets-head"><strong>Skills e Técnicas afetadas pelo bônus</strong><small>Os vínculos são IDs dos itens desta ficha, não nomes digitados.</small></div>
    <label class="mv-legacy-field"><span>Aplicar o bônus a</span><select data-mv-key="${passiveModeKey(index)}"><option value="todos" ${mode!=='especificas'?'selected':''}>Todas as habilidades compatíveis</option><option value="especificas" ${mode==='especificas'?'selected':''}>Somente as Skills e Técnicas selecionadas</option></select></label>
    <div data-mv-passive-options ${mode==='especificas'?'':'hidden'}>${options.length?options.map(x=>`<label class="mv-passive-choice"><input type="checkbox" data-mv-passive-ability-id="${escapeHtml(x.id)}" ${ids.has(x.id)?'checked':''}/><span>${escapeHtml(x.name)} <small>(${x.type==='skill'?'Skill':'Técnica'})</small></span></label>`).join(''):'<p>Adicione esta passiva à ficha de um personagem que tenha outras Skills/Técnicas para selecionar.</p>'}</div>
    <p class="mv-original-status">Com habilidades específicas selecionadas, o filtro implícito pelo tipo do ataque deixa de restringir o vínculo. O tipo próprio do bônus continua independente para calcular as proteções. Se ativar o filtro de dano abaixo, ele também será respeitado.</p>
  </div>`;
}
function costSelector(item,index) {
 const selectedMode=item.system.props?.[costModeKey(index)];
 const legacyTarget=String(storedValue(item,'custoalvohabilidade',index)??'').trim();
 const mode=String(selectedMode??(legacyTarget?'legado':'todos'));
 const ids=new Set(String(item.system.props?.[costIdsKey(index)]??'').split(',').map(x=>x.trim()));
 const choices=passiveAbilities(item);
 return `<div class="mv-passive-targets" data-mv-cost-targets>
 <div class="mv-passive-targets-head"><strong>Skills e Técnicas afetadas pela alteração de custo</strong><small>Selecione várias habilidades da ficha; os vínculos usam IDs para não depender do nome.</small></div>
 <label class="mv-legacy-field"><span>Aplicar modificador a</span><select data-mv-key="${costModeKey(index)}">${mode==='legado'?`<option value="legado" selected>Filtro anterior preservado: ${escapeHtml(legacyTarget)}</option>`:''}<option value="todos" ${mode==='todos'?'selected':''}>Todas as habilidades compatíveis</option><option value="especificas" ${mode==='especificas'?'selected':''}>Somente as Skills e Técnicas selecionadas</option></select></label>
 <div data-mv-cost-options ${mode==='especificas'?'':'hidden'}>${choices.length?choices.map(x=>`<label class="mv-passive-choice"><input type="checkbox" data-mv-cost-ability-id="${escapeHtml(x.id)}" ${ids.has(x.id)?'checked':''}/><span>${escapeHtml(x.name)} <small>(${x.type==='skill'?'Skill':'Técnica'})</small></span></label>`).join(''):'<p>Adicione outras Skills ou Técnicas à ficha para poder selecioná-las.</p>'}</div>
 <p class="mv-original-status">Exemplo: -1 PM reduz apenas PM. Use -1 PM, -2 STA para mais de um recurso; no mínimo, escreva 1 PM, 0 STA. Alterações antigas numéricas continuam compatíveis.</p>
 </div>`;
}
function effectHasValues(item, index) {
  return original.BASE_FIELDS.some(([id]) => String(storedValue(item,id,index)).trim() !== "");
}
function countEffects(item) {
  const current = Array.from({length:MAX},(_,i)=>i+1).filter(i=>effectHasValues(item,i));
  const legacyCount = current.length ? Math.max(...current) : 0;
  const stored = Number(item.system.props?.[COUNT_KEY]);
  return Math.max(legacyCount, Number.isInteger(stored) && stored>=0 ? Math.min(stored,MAX) : 0);
}
function makeField(item, [id,label,kind,options], index) {
  const manual=item.getFlag?.('multiverso-rpg','manualEffectSourceV1')===true;
  // Um efeito manual permanece ativo enquanto estiver na ficha. O documento
  // guarda o mesmo formato das Skills, mas não oferece execução por ação.
  if(manual&&id==='atividade')return '<p class="mv-original-status">Ativação: contínua (sem ação ou rolagem de habilidade).</p>';
  if(manual&&id==='origemescala')return '';
  if(item.getFlag?.('multiverso-rpg','traitEffectSourceV1')===true && id==='origemescala' && Array.isArray(options))options=options.filter(([value])=>value==='personagem');
  if(manual&&id==='escala'&&Array.isArray(options))options=options.filter(([value])=>value!=='por_nivel');
  const key = canonical(item,id,index);
  let value = String(storedValue(item,id,index)??'');
  // v0.2.10: show the existing legacy manual + recognized event as one RECARGA
  // choice without migrating/deleting approved stored data until edited.
  const legacySpecial=String(storedValue(item,'recargaespecial',index)??'').trim();
  const recognizedLegacyEvent=specialRechargeKind(legacySpecial);
  if(id==='recarga'&&value==='manual'&&recognizedLegacyEvent)value=`evento:${recognizedLegacyEvent}`;
  const attribute = `data-mv-key="${escapeHtml(key)}" ${id==='atividade'?'data-mv-canonical-activity':''}`;
  const activeExtra=availableFluxes(item.parent).find(flow=>flow.id==='extra');
  // Exibe a identidade do recurso cadastrado, não rótulos genéricos e campos redundantes.
  if(id==='afetado'&&kind==='select'){
    options=[...(options??[]).filter(([v])=>!['outro','outro_max'].includes(v)),
      ...(activeExtra?[["outro",`${activeExtra.label} atual`],["outro_max",`${activeExtra.label} máximo`]]:[])];
  }
  let control;
  if(id==='recargaespecial'){
    // Manter texto livre do legado editável. Datalist oferece IDs de eventos
    // reconhecidos sem apagar descrições narrativas já aprovadas.
    const suggestions=[['ataque_acertado','Ao acertar ataque'],['ataque_critico','Ao confirmar crítico'],['reacao_usada','Ao usar Reação'],['inimigo_derrotado','Ao derrotar inimigo']];
    const listId=`mv-special-recharge-${index}`;
    control=`<input type="text" list="${listId}" maxlength="120" ${attribute} value="${escapeHtml(value)}" placeholder="Selecione um evento ou escreva uma regra manual"/><datalist id="${listId}">${suggestions.map(([v,l])=>`<option value="${escapeHtml(v)}" label="${escapeHtml(l)}"></option>`).join('')}</datalist><small>Eventos automáticos reconhecidos: ataque_acertado, ataque_critico, reacao_usada, inimigo_derrotado. Requer Recarga = Manual / condição especial. Texto narrativo antigo permanece editável, mas não dispara evento automaticamente. Derrotas exigem confirmação explícita do mestre; PV 0 não basta.</small>`;
  }else if(id==='recarga'&&kind==='select'){
    const opts = [['','Selecionar...'],...(options??[])].map(([v,l])=>`<option value="${escapeHtml(v)}" ${String(v)===value?'selected':''}>${escapeHtml(l)}</option>`).join('');
    // No duplicate Regra de recarga especial input. Unsupported narrative rules
    // from older versions stay visible as a note, with their value untouched.
    const narrative=legacySpecial&&!recognizedLegacyEvent?`<small>Regra narrativa anterior preservada: ${escapeHtml(legacySpecial)}. Essa descrição não ativa eventos automáticos.</small>`:'';
    control=`<select ${attribute}>${opts}</select><small>Eventos especiais são confirmados pelo mestre ou pelo uso bem-sucedido da Reação. Escolha diretamente aqui, sem outro campo.</small>${narrative}`;
  }else if(kind === "select") {
    const known=(options??[]).some(([v])=>String(v)===value);
    const legacy=value&&!known?[[value,['outro','outro_max'].includes(value)?'Fluxo Extra desativado na ficha (configuração preservada)':`Configuração anterior: ${value} (revisar)`]]:[];
    const choices=id==='tipo'?(options??[]).filter(([v])=>v!=='atributo'||value==='atributo'):(options??[]);
    const opts = [['','Selecionar...'], ...legacy, ...choices].map(([v,l])=>`<option value="${escapeHtml(v)}" ${String(v)===value?'selected':''}>${escapeHtml(l)}</option>`).join('');
    control=`<select ${attribute}>${opts}</select>`;
  } else if(kind==='abilitySelect') {
    const choices=passiveAbilities(item);
    const known=choices.some(x=>x.id===value||x.name===value);
    const options=[`<option value="" ${!value?'selected':''}>Todas / não especificar</option>`,
      ...(value&&!known?[`<option value="${escapeHtml(value)}" selected>Valor antigo preservado: ${escapeHtml(value)}</option>`]:[]),
      ...choices.map(x=>`<option value="${escapeHtml(x.id)}" ${value===x.id||value===x.name?'selected':''}>${escapeHtml(x.name)} (${x.type==='skill'?'Skill':'Técnica'})</option>`)].join('');
    control=`<select ${attribute}>${options}</select><small>Selecione pela ficha. Valores antigos continuam preservados.</small>`;
  } else if(kind === "textarea") control=`<textarea ${attribute} rows="4">${escapeHtml(value)}</textarea>`;
  else if(id==='alvo' && String(storedValue(item,'tipo',index))==='teste'){
    const selected=String(value??'');
    const attr=String(item.system.props?.[`mvTestGroup${index}`]??(isAttributeTest(selected)?'atributo':'pericia'))==='atributo';
    const options=attr?ATTR_TESTS:availablePericias().map(({label})=>[label,label]);
    const known=options.some(([key])=>key.toLowerCase()===selected.toLowerCase());
    control=`<select ${attribute}><option value="">Escolha o teste...</option>${selected&&!known?`<option value="${escapeHtml(selected)}" selected>Anterior: ${escapeHtml(selected)}</option>`:''}${options.map(([key,label])=>`<option value="${escapeHtml(key)}" ${key.toLowerCase()===selected.toLowerCase()?'selected':''}>${escapeHtml(label)}</option>`).join('')}</select>`;
  }else if(id==='alvo'){
    const listId=`mv-pericias-${index}-${item.id}`;
    control=`<input ${attribute} type="text" list="${escapeHtml(listId)}" value="${escapeHtml(value)}" placeholder="Ex.: Furtividade"/><datalist id="${escapeHtml(listId)}">${availablePericias().map(({label})=>`<option value="${escapeHtml(label)}"></option>`).join('')}</datalist>`;
  } else control=`<input ${attribute} ${kind==='numberSigned'||kind==='numberMin'?'type="number" step="any"':'type="text"'} value="${escapeHtml(value)}" />`;
  const shownLabel=id==='detalhe'?'Detalhes específicos desta mecânica (opcional)':label;
  return `<label class="mv-legacy-field" data-mv-field="${escapeHtml(id)}"><span>${escapeHtml(shownLabel)}</span>${control}</label>`;
}

function editorFields(item,index) {
 const peek=id=>storedValue(item,id,index);
 return original.FIELD_SECTIONS.map(section=>{
  const showButton=String(item.system.props?.[`mvShowUseButton${index}`]??'');
  const useButtonOption=section.id==='escolhas'?`<label class="mv-legacy-field mv-ui-wide"><span>Botão individual de uso na ficha</span><select data-mv-key="mvShowUseButton${index}"><option value="" ${!showButton?'selected':''}>Não mostrar (padrão)</option><option value="sim" ${showButton==='sim'?'selected':''}>Mostrar botão para este efeito</option><option value="nao" ${showButton==='nao'?'selected':''}>Ocultar explicitamente</option></select><small>O botão aparece abaixo de Nível, Execução e Alvo, antes da Descrição. Permite executar apenas este efeito.</small></label>`:'';
  const cadence=section.id==='aplicacao'?`<label class="mv-legacy-field mv-ui-wide"><span>Comportamento durante a duração</span><select data-mv-key="${cadenceKey(index)}"><option value="once" ${item.system.props?.[cadenceKey(index)]!=='periodic'&&item.system.props?.[cadenceKey(index)]!=='maintained'?'selected':''}>Aplicar uma vez (não repetir nem desfazer)</option><option value="periodic" ${item.system.props?.[cadenceKey(index)]==='periodic'?'selected':''}>Repetir na ativação e no início dos próximos turnos do alvo</option><option value="maintained" ${item.system.props?.[cadenceKey(index)]==='maintained'?'selected':''}>Manter bônus ou condição até terminar</option></select><small>Periódico: para dois turnos, aplica agora e no turno seguinte do alvo.</small></label>` : '';
  const extra=section.id==='escolhas'?`<label class="mv-legacy-field mv-ui-wide"><span>Grupo de alternativas (opcional)</span><input data-mv-key="mvAlternativeGroup${index}" type="text" maxlength="35" value="${escapeHtml(String(item.system.props?.[`mvAlternativeGroup${index}`]??''))}" placeholder="Ex.: Escolher ataque ou cura"/><small>Efeitos com o mesmo nome de grupo são alternativas: na ativação, escolha uma. Sem grupo, todos os efeitos continuam juntos.</small></label><div class="mv-activation-options mv-ui-wide"><label class="mv-legacy-field">Condição de ativação<select data-mv-key="${optionalKey(index)}"><option value="" ${!item.system.props?.[optionalKey(index)]?'selected':''}>Normal — executar sempre</option><option value="sim" ${item.system.props?.[optionalKey(index)]==='sim'?'selected':''}>Somente se pagar Custo Opcional / Reforço</option></select></label><div class="mv-reinforcement-options" data-mv-reinforcement-options><label class="mv-legacy-field">Quando o reforço for pago<select data-mv-key="${modeKey(index)}"><option value="somar" ${item.system.props?.[modeKey(index)]!=='substituir'?'selected':''}>Somar ao efeito normal</option><option value="substituir" ${item.system.props?.[modeKey(index)]==='substituir'?'selected':''}>Substituir outro efeito</option></select></label><label class="mv-legacy-field" data-mv-replace-choice>Qual efeito normal será substituído?<select data-mv-key="${replaceKey(index)}"><option value="">Selecionar efeito...</option>${Array.from({length:countEffects(item)},(_,i)=>i+1).filter(i=>i!==index).map(i=>`<option value="${i}" ${String(item.system.props?.[replaceKey(index)]??'')===String(i)?'selected':''}>${escapeHtml(String(item.system.props?.[titleKey(i)]??'').trim()||`Efeito ${i}`)}</option>`).join('')}</select></label><p class="mv-original-status">O reforço pode adicionar este efeito ou substituir o efeito selecionado.</p></div></div>`:'';
  // O filtro e a sustentação antigos continuam armazenados para compatibilidade,
  // mas não possuem um segundo controle na seção 6. Os controles funcionais
  // correspondentes são costSelector e sustainPanel, logo abaixo.
  const visibleIds=section.id==='custos'
    ? section.fields.filter(id=>!['custoalvohabilidade','sustentacao'].includes(id))
    : section.fields;
  const fields=visibleIds.map(id=>original.BASE_FIELDS.find(([field])=>field===id)).filter(Boolean).map(field=>makeField(item,field,index)).join('');
  const testGroup=section.id==='efeito'&&String(peek('tipo'))==='teste'?`<label class="mv-legacy-field" data-mv-test-group-field><span>Qual tipo de teste?</span><select data-mv-key="mvTestGroup${index}"><option value="pericia" ${String(item.system.props?.[`mvTestGroup${index}`]??(isAttributeTest(peek('alvo'))?'atributo':'pericia'))!=='atributo'?'selected':''}>Teste de perícia</option><option value="atributo" ${String(item.system.props?.[`mvTestGroup${index}`]??(isAttributeTest(peek('alvo'))?'atributo':'pericia'))==='atributo'?'selected':''}>Teste de atributo</option></select></label>`:'';
  let additions='';
  if(section.id==='aplicacao'){
    // Vínculos de dano passivo usam mvPassiveTargetIds; o seletor de custo só existe na seção 6.
    additions=passiveSelector(item,index);
  }
  if(section.id==='aplicacao')additions+=auraOptions(item,index);
  if(section.id==='custos')additions=costSelector(item,index)+sustainPanel(item,index);
  if(section.id==='avancado')additions=advancedPanel(item,index);
  return `<details class="mv-original-section" data-mv-section="${section.id}" ${section.open?'open':''}><summary>${escapeHtml(section.title)}</summary><div class="mv-original-fields">${conditionalIntro(section.id,peek,index)}${useButtonOption}${extra}${cadence}${section.id==='avancado'?additions:''}${testGroup}${fields}${section.id==='avancado'?'':additions}</div></details>`;
 }).join('');
}

function friendly(item,id,index) {
  const value=String(storedValue(item,id,index)).trim();
  if(!value)return '';
  const def=original.BASE_FIELDS.find(([key])=>key===id);
  return def?.[3]?.find(([key])=>key===value)?.[1] ?? value;
}
function summary(item,index) {
  const type=friendly(item,'tipo',index);
  const userTitle=String(item.system.props?.[titleKey(index)]??'').trim();
  const target=friendly(item,'receptor',index);
  const currentExtra=availableFluxes(item.parent).find(flow=>flow.id==='extra');
  const storedAffected=storedValue(item,'afetado',index);
  const affected=currentExtra&&['outro','outro_max'].includes(storedAffected)?`${currentExtra.label} ${storedAffected==='outro'?'atual':'máximo'}`:friendly(item,'afetado',index);
  const value=friendly(item,'valor',index);
  const duration=friendly(item,'duracao',index);
  const pieces=[target && `Recebe: ${target}`,affected && `Altera: ${affected}`,value && `Valor: ${value}`,duration && `Duração: ${duration}`].filter(Boolean);
  const itemEffectSource=item.getFlag?.('multiverso-rpg','itemEffectSourceV1')===true;
  const configured=item.getFlag?.('multiverso-rpg','itemEffectTriggersV1')?.[index]??'nenhum';
  const triggerTypes=[['nenhum','Sem acionamento automático'],['manual','Ativação manual'],['uso','Ao usar'],['acerto','Ao acertar'],['critico','Ao critar'],['erro','Ao errar'],['dano','Ao causar dano'],['derrota','Ao derrotar'],['receber_dano','Ao receber dano'],['esquiva','Ao esquivar'],['bloqueio','Ao bloquear'],['equipar','Ao equipar'],['desequipar','Ao desequipar'],['inicio_turno','Início do turno'],['fim_turno','Fim do turno'],['ultima_carga','Ao gastar a última carga']];
  return `<article class="mv-effect-summary">
      <div class="mv-effect-summary-info"><strong>${userTitle?escapeHtml(userTitle):`Efeito ${index}`}${type?' — '+escapeHtml(type):''}</strong><small>${pieces.length?pieces.map(escapeHtml).join(' · '):'Sem configurações preenchidas'}${item.system.props?.[optionalKey(index)]==='sim'?(item.system.props?.[modeKey(index)]==='substituir'?` · Reforço substitui efeito ${escapeHtml(item.system.props?.[replaceKey(index)]??'?')}`:' · Reforço adiciona efeito'):''}</small></div>
      ${itemEffectSource?`<label class="mv-im-effect-trigger">Gatilho deste efeito<select data-mv-item-effect-trigger="${index}">${triggerTypes.map(([id,label])=>`<option value="${id}" ${configured===id?'selected':''}>${label}</option>`).join('')}</select></label>`:''}
      ${itemEffectSource&&configured==='manual'?`<button type="button" class="mv-im-manual-effect" data-mv-item-effect-manual="${index}">Ativar efeito</button>`:''}
      <div class="mv-effect-summary-actions"><button type="button" data-mv-edit-effect="${index}">Editar</button><button type="button" data-mv-duplicate-effect="${index}" ${countEffects(item)>=MAX?'disabled':''}>Duplicar</button><button type="button" class="mv-danger" data-mv-delete-effect="${index}">Excluir</button></div>
    </article>`;
}
function skillQuickSummary(item, levelValue) {
  // Resumo de leitura: valores existentes na ficha, sem gravar campos ou alterar efeitos.
  const props=item.system.props??{};
  const first=(id)=>{for(let i=1;i<=countEffects(item);i++){const v=friendly(item,id,i);if(v)return v;}return '';};
  const level=String(levelValue||'—');
  const cost=first('custo') || '—';
  const execution=first('atividade')||'—';
  const range=first('alcance')||'—';
  const duration=first('duracao')||'—';
  return `<div class="mv-skill-quick-summary" aria-label="Resumo da habilidade">
    <div><b>Nível:</b><span>${escapeHtml(level)}</span></div><div><b>Custo:</b><span>${escapeHtml(cost)}</span></div>
    <div><b>Execução:</b><span>${escapeHtml(execution)}</span></div><div><b>Alcance:</b><span>${escapeHtml(range)}</span></div>
    <div><b>Duração:</b><span>${escapeHtml(duration)}</span></div></div>`;
}
function markup(item, effectsOnly=false) {
  const props=item.system.props ?? {};
  const description=(item.type==='skill'?props.descricaoskill:props.descricaotecnica) ?? item.system.descricao ?? '';
  const count=countEffects(item);
  const levelKey=item.type==='tecnica'?'nivel_tecnica':'nivel_skill';
  const levelAliases=item.type==='tecnica'?['nivel_tecnica','niveltecnica','tecnicanivel','efeitotecnicanivelinicio']:['nivel_skill','nivelskill','skillnivel','efeitoskillnivelinicio'];
  const levelValue=levelAliases.map(key=>props[key]).find(v=>v!==undefined&&String(v).trim()!=='')??'';
  const manual=item.getFlag?.('multiverso-rpg','manualEffectSourceV1')===true;
  const trait=item.getFlag?.('multiverso-rpg','traitEffectSourceV1')===true || item.getFlag?.('multiverso-rpg','itemEffectSourceV1')===true;
  const origin=trait?item.parent?.items?.get(item.getFlag('multiverso-rpg','originItemId')):null;
  const label=origin?({especie:'Espécie',habilidadeEspecie:'Traço de Espécie',classe:'Classe',subclasse:'Subclasse',habilidadeClasse:'Habilidade de Classe',habilidadeSubclasse:'Habilidade de Subclasse',vantagem:'Vantagem / Desvantagem'}[origin.type]||'Característica'):'Característica';
  const isAbility=!manual&&!trait;
  const effectsContent=`${manual?'<p class="mv-original-status">Efeito contínuo: modificadores passivos compatíveis permanecem ativos enquanto o registro existir. Nenhuma ação é consumida.</p>':trait?'<p class="mv-original-status">Use Passiva e O próprio personagem para traços contínuos. Registros ativáveis continuam usando o executor original.</p>':'<p class="mv-original-status">Adicione as mecânicas que compõem esta habilidade. Cada efeito possui seus próprios detalhes.</p><button type="button" data-mv-execute-test>Testar habilidade</button>'}<div class="mv-original-effect-toolbar"><strong>Efeitos cadastrados: ${count}/${MAX}</strong><button type="button" data-mv-add-effect ${count>=MAX?'disabled':''}>+ Criar efeito</button></div><div class="mv-effect-summary-list">${count?Array.from({length:count},(_,i)=>summary(item,i+1)).join(''):'<p class="mv-original-empty">Nenhum efeito cadastrado.</p>'}</div>`;
  if(effectsOnly)return `<section class="mv-original-editor mv-original-effects-only"><div data-mv-original-page="efeitos">${effectsContent}</div><p class="mv-original-status" role="status">As alterações são salvas automaticamente ao sair dos campos.</p></section>`;
  return `<section class="mv-original-editor">
    <nav class="mv-original-tabs"><button type="button" data-mv-original-tab="descricao">Descrição</button><button type="button" data-mv-original-tab="efeitos">Efeitos</button></nav>
    <div data-mv-original-page="descricao">
      ${isAbility?skillQuickSummary(item,levelValue):''}
      ${isAbility?`<label class="mv-legacy-field">Nível da ${item.type==='skill'?'Skill':'Técnica'}<input type="number" step="1" min="0" data-mv-ability-level="${levelKey}" value="${escapeHtml(levelValue)}" /></label>`:''}
      <label class="mv-legacy-field">Descrição geral<textarea rows="9" data-mv-description>${escapeHtml(description)}</textarea></label>
    </div>
    <div data-mv-original-page="efeitos" hidden>${effectsContent}</div>
    <p class="mv-original-status" role="status">Os campos são salvos ao sair deles.</p>
  </section>`;
}
const AppV2 = foundry.applications.api.ApplicationV2;
// Cada condição usa o MESMO modelo de efeitos internos do gerenciador original.
// Campos ainda sem executor ficam preservados e são bloqueados pelo diagnóstico.
class MultiversoConditionMechanicWindow extends AppV2 {
  constructor({owner,index}) {
    super({window:{title:`${owner.item.name} — Mecânica ${index+1}`,resizable:true},position:{width:890,height:740},classes:['mv-effect-edit-window','mv-condition-mechanic-window']});
    this.owner=owner;this.index=index;
  }
  async _renderHTML(){
    const e=this.owner.definition.efeitos[this.index];
    if(!e)return '<div class="mv-effect-window-body">Mecânica não encontrada.</div>';
    const kind=String(e.mvMechanicKind|| (e.mvImpedeAgir==='sim'?'action':'attribute'));
    const choices=[['attribute','Atributo'],['movement','Deslocamento'],['defense','Defesa (Esquiva e Bloqueio)'],['dodge','Somente Esquiva'],['block','Somente Bloqueio'],['capacity','Capacidade de carga (%)'],['action','Restringir ações'],['damage','Dano causado/recebido'],['periodic','Dano ou cura periódica (pendente)'],['advantage','Vantagem / Desvantagem'],['cost','Consumo de recursos (pendente)'],['immunity','Resistência / Imunidade (pendente)'],['evolution','Evolução de condições (pendente)']];
    const kindPicker=`<label class="mv-legacy-field">Tipo de mecânica<select data-mv-inner-kind>${choices.map(([v,l])=>`<option value="${v}" ${kind===v?'selected':''}>${l}</option>`).join('')}</select></label>`;
    // Reutiliza o construtor de campos da janela-pai: a função `field`
    // usada anteriormente aqui não existia no escopo desta janela.
    // Esses controles também mantêm os atributos data-mv-inner-index/id
    // usados pelos listeners de gravação em _onRender.
    const field=(id,options=null)=>{
      const base=original.BASE_FIELDS.find(([key])=>key===id);
      if(!base)throw new Error(`Campo de mecânica desconhecido: ${id}`);
      const definition=options? [base[0],base[1],'select',options]:base;
      return this.owner._field(definition,e,this.index);
    };
    const attrs=original.BASE_FIELDS.find(f=>f[0]==='afetado')[3].filter(([key])=>['forca','agilidade','resistencia','inteligencia','carisma','percepcao'].includes(key));
    const operations=[['somar','Somar'],['subtrair','Subtrair']];
    const scales=[['fixo','Valor fixo'],['formula','Fórmula'],['dado','Dados']];
    const isValue=['attribute','movement','defense','dodge','block','capacity','damage'].includes(kind);
    const mechanics=kind==='attribute'?`${field('afetado',attrs)}${field('operacao',operations)}${field('valor')}${field('escala',scales)}`:isValue?`${kind==='capacity'?'<p class="mv-original-status">Informe um percentual: 50 aumenta a capacidade em 50%; -50 reduz em 50%.</p>':''}${kind==='movement'?'<p class="mv-original-status">Use Somar/Subtrair para deslocamento. O valor é em metros.</p>':''}${kind==='defense'?'<p class="mv-original-status">Defesa modifica Esquiva E Bloqueio, uma vez em cada teste.</p>':''}${kind==='capacity'?'':field('operacao',operations)}${field('valor')}${kind==='capacity'?'':field('escala',scales)}`:'';
    const damageFields=kind==='damage'?`<label class="mv-legacy-field">Direção do dano<select data-mv-inner-damage-direction>${[['caused','Dano causado'],['received','Dano recebido']].map(([v,l])=>`<option value="${v}" ${String(e.mvDamageDirection||'caused')===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="mv-legacy-field">Origem do dano<select data-mv-inner-damage-scope>${[['any','Qualquer fonte de dano'],['melee','Corpo a corpo'],['ranged','À distância']].map(([v,l])=>`<option value="${v}" ${String(e.mvDamageScope||'any')===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="mv-legacy-field">Tipo do dano adicional<select data-mv-inner-damage-type>${[['fisico','Físico'],['fogo','Fogo'],['frio','Frio'],['eletrico','Elétrico'],['quimico','Químico'],['psiquico','Psíquico'],['sagrado','Sagrado'],['sombrio','Sombrio'],['verdadeiro','Verdadeiro'],['outro','Outro']].map(([v,l])=>`<option value="${v}" ${String(e.mvDamageType||'fisico')===v?'selected':''}>${l}</option>`).join('')}</select></label>`:'';
    const testTargets=[['all','Todos os testes'],['forcanumero','Força'],['agilidadenumero','Agilidade'],['resistencianumero','Resistência'],['inteligencianumero','Inteligência'],['carismanumero','Carisma'],['percepcaonumero','Percepção'],['cutnumero','Cortantes'],['fisiconumero','Físico'],['pontarianumero','Pontaria'],['arcananumero','Arcana'],['encantamentonumero','Encantamento'],['podernumero','Poder'],['artesnumero','Artes'],['enganacaonumero','Enganação'],['estudosocultosnumero','Estudos Ocultos'],['historianumero','História'],['investigacaonumero','Investigação'],['medicinanumero','Medicina'],['pilotarnumero','Pilotar'],['tecnologianumero','Tecnologia'],['acrobacianumero','Acrobacia'],['atletismonumero','Atletismo'],['furtividadenumero','Furtividade'],['furtonumero','Furto'],['intimidacaonumero','Intimidação'],['intuicaonumero','Intuição'],['naturezanumero','Natureza'],['vontadenumero','Vontade']];
    const picker=(attr,options,current)=>`<label class="mv-legacy-field">${({mvAdvMode:'Tipo de efeito',mvAdvScope:'Quais testes são afetados?',mvAdvUses:'Duração do benefício'}[attr]||attr)}<select data-mv-inner-adv="${attr}">${options.map(([v,l])=>`<option value="${v}" ${String(current||'')===v?'selected':''}>${l}</option>`).join('')}</select></label>`;
    const advAttrs=testTargets.filter(([k])=>['all','forcanumero','agilidadenumero','resistencianumero','inteligencianumero','carismanumero','percepcaonumero'].includes(k));
    const advSkills=testTargets.filter(([k])=>k==='all'||!advAttrs.some(([a])=>a===k));
    const selectedGroup=String(e.mvAdvTargetType||(['forcanumero','agilidadenumero','resistencianumero','inteligencianumero','carismanumero','percepcaonumero'].includes(e.mvAdvScope)?'atributo':'pericia'));
    const advantageFields=kind==='advantage'?`${picker('mvAdvMode',[['vantagem','Conceder vantagem'],['desvantagem','Impor desvantagem']],e.mvAdvMode||'vantagem')}${picker('mvAdvTargetType',[['pericia','Teste de perícia'],['atributo','Teste de atributo']],selectedGroup)}${picker('mvAdvScope',selectedGroup==='atributo'?advAttrs:advSkills,e.mvAdvScope||'all')}${picker('mvAdvUses',[['continuous','Enquanto a condição estiver ativa'],['once','Consumir após o próximo teste afetado']],e.mvAdvUses||'continuous')}<p class="mv-original-status">Vantagem usa 2d20 e o maior; desvantagem usa 2d20 e o menor. Se as duas estiverem ativas, se anulam. Para Inspirado, selecione Consumir após o próximo teste.</p>`:'';
    const blocking=kind==='action';
    const legacy=['bonus','penalidade'].includes(e.tipo)?'<p class="mv-ui-warning">Mecânica antiga: preservada; confira os campos antes de alterar.</p>':'';
    return `<div class="mv-effect-window-body"><header><h2>Mecânica interna ${this.index+1}</h2></header>
      <label class="mv-legacy-field">Nome da mecânica<input type="text" maxlength="100" data-mv-inner-name value="${escapeHtml(e.nome??'')}" placeholder="Ex.: Reduzir Agilidade" /></label>
      ${kindPicker}
      ${blocking?`<label class="mv-legacy-field">Bloquear qual tipo de ação?<select data-mv-inner-block-type>${[['todas','Todas as ações'],['acao','Ação Padrão'],['movimento','Ação de Movimento'],['bonus','Ação Bônus'],['completa','Ação Completa'],['reacao','Reação']].map(([v,l])=>`<option value="${v}" ${String(e.mvBloqueiaTipo||'todas')===v?'selected':''}>${l}</option>`).join('')}</select></label>`:''}
      <p class="mv-original-status">${blocking?'Restringe as ações selecionadas enquanto a condição estiver ativa.':isValue?'O modificador dura enquanto a condição permanecer ativa.':kind==='advantage'?'A rolagem reconhece a condição ativa. O uso único será consumido após um teste válido.':'Esta categoria exige integração adicional com o executor e será bloqueada pelo diagnóstico até ser implementada.'}</p>
      ${legacy}${damageFields}${advantageFields}${mechanics}
      <div class="mv-effect-window-footer"><span>Os campos são salvos ao salvar a condição.</span><button type="button" data-mv-inner-done>Concluir</button></div></div>`;
  }
  _replaceHTML(result,content){content.innerHTML=result;}
  _onRender(context,options){
    super._onRender(context,options);
    const e=this.owner.definition.efeitos[this.index];if(!e)return;
    bindAdaptiveEditor(this.element.querySelector('.mv-effect-window-body'));
    this.element.querySelectorAll('[data-mv-inner-index]').forEach(input=>{
      const update=()=>{e[input.dataset.mvInnerId]=input.value;};
      input.addEventListener('input',update);input.addEventListener('change',update);
    });
    this.element.querySelector('[data-mv-inner-kind]')?.addEventListener('change',event=>{
      const kind=event.target.value;
      e.mvMechanicKind=kind;e.mvImpedeAgir=kind==='action'?'sim':'nao';e.receptor='proprio';e.definicao='fixo';
      e.tipo=kind==='action'?'acao':'atributo';
      if(kind!=='attribute')e.afetado='';
      if(kind==='action'){e.operacao='';e.valor='';}
      else if(kind==='capacity'){e.operacao='somar';e.escala='fixo';}
      else {e.operacao=e.operacao||'somar';e.escala=e.escala||'fixo';}
      this.render(true);
    });
    this.element.querySelector('[data-mv-inner-block-type]')?.addEventListener('change',event=>{e.mvBloqueiaTipo=event.target.value;});
    this.element.querySelector('[data-mv-inner-damage-direction]')?.addEventListener('change',event=>{e.mvDamageDirection=event.target.value;});
    this.element.querySelector('[data-mv-inner-damage-scope]')?.addEventListener('change',event=>{e.mvDamageScope=event.target.value;});
    this.element.querySelector('[data-mv-inner-damage-type]')?.addEventListener('change',event=>{e.mvDamageType=event.target.value;});
    this.element.querySelectorAll('[data-mv-inner-adv]').forEach(el=>el.addEventListener('change',()=>{
      e[el.dataset.mvInnerAdv]=el.value;
      if(el.dataset.mvInnerAdv==='mvAdvTargetType'){
        e.mvAdvScope='all';this.render(true);
      }
    }));
    const name=this.element.querySelector('[data-mv-inner-name]');
    name?.addEventListener('input',()=>{e.nome=name.value;});
    this.element.querySelector('[data-mv-inner-done]')?.addEventListener('click',()=>this.close());
  }
  async close(options){
    const result=await super.close(options);
    if(this.owner.rendered)await this.owner.render(true);
    return result;
  }
}
class MultiversoConditionWindow extends AppV2 {
  constructor({item,index}) {
    super({window:{title:`${item.name} — Mecânicas da condição ${index}`,resizable:true},position:{width:940,height:760},classes:['mv-effect-edit-window','mv-condition-editor-window']});
    this.item=item;this.index=index;this.definition=conditionData(item,index);
  }
  _field([id,label,kind,options],effect,i){
    const value=String(effect[id]??'');
    const data=`data-mv-inner-index="${i}" data-mv-inner-id="${escapeHtml(id)}"`;
    let control;
    if(kind==='select'){
      control=`<select ${data}><option value="">Selecionar...</option>${(options??[]).map(([key,title])=>`<option value="${escapeHtml(key)}" ${String(key)===value?'selected':''}>${escapeHtml(title)}</option>`).join('')}</select>`;
    }else if(kind==='abilitySelect'){
      const options=passiveAbilities(this.item);
      const known=options.some(x=>x.id===value||x.name===value);
      control=`<select ${data}><option value="" ${!value?'selected':''}>Todas / não especificar</option>${value&&!known?`<option value="${escapeHtml(value)}" selected>Valor antigo: ${escapeHtml(value)}</option>`:''}${options.map(x=>`<option value="${escapeHtml(x.id)}" ${x.id===value||x.name===value?'selected':''}>${escapeHtml(x.name)}</option>`).join('')}</select>`;
    }else if(kind==='textarea')control=`<textarea ${data} rows="3">${escapeHtml(value)}</textarea>`;
    else control=`<input ${data} type="${kind==='numberSigned'||kind==='numberMin'?'number':'text'}" value="${escapeHtml(value)}" />`;
    return `<label class="mv-legacy-field" data-mv-field="${escapeHtml(id)}">${escapeHtml(label)}${control}</label>`;
  }
  _mechanic(effect,i){
    const name=String(effect.nome??'').trim()||`Mecânica ${i+1}`;
    const readable=(id)=>{
      const raw=String(effect[id]??'').trim();
      if(!raw)return '';
      const def=original.BASE_FIELDS.find(([key])=>key===id);
      return def?.[3]?.find(([value])=>String(value)===raw)?.[1]??raw;
    };
    const details=[effect.mvMechanicKind?`Tipo: ${effect.mvMechanicKind}`:effect.mvImpedeAgir==='sim'?'Impede agir':null,readable('tipo'),readable('afetado'),readable('operacao')&&readable('valor')?`${readable('operacao')} ${readable('valor')}`:readable('valor')].filter(Boolean).join(' · ');
    return `<article class="mv-effect-summary mv-condition-mechanic-summary"><div class="mv-effect-summary-info"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(details||'Sem configurações preenchidas')}</small></div><div class="mv-effect-summary-actions"><button type="button" data-mv-inner-edit="${i}">Editar</button><button type="button" data-mv-inner-duplicate="${i}" ${this.definition.efeitos.length>=5?'disabled':''}>Duplicar</button><button type="button" class="mv-danger" data-mv-inner-remove="${i}">Excluir</button></div></article>`;
  }
  async _renderHTML(){
    const d=this.definition;
    return `<div class="mv-effect-window-body mv-condition-root"><h2>Configurar condição</h2><p class="mv-original-status">Até cinco mecânicas internas. Clique em Editar para abrir a configuração completa em outra janela.</p>
      <label class="mv-legacy-field">Nome da condição<input data-mv-condition-meta="nome" value="${escapeHtml(d.nome)}"></label>
      <label class="mv-legacy-field">Descrição da condição<textarea data-mv-condition-meta="descricao" rows="3">${escapeHtml(d.descricao)}</textarea></label>
      <div class="mv-condition-mechanic-head"><strong>Mecânicas da condição: ${d.efeitos.length}/5</strong><button type="button" data-mv-inner-add ${d.efeitos.length>=5?'disabled':''}>+ Adicionar mecânica</button></div>
      <div class="mv-effect-summary-list">${d.efeitos.length?d.efeitos.map((e,i)=>this._mechanic(e,i)).join(''):'<p class="mv-original-status">Nenhuma mecânica cadastrada: a condição será somente narrativa.</p>'}</div>
      <p class="mv-original-status">Atributos, deslocamento, defesa e carga possuem execução. Os demais tipos aparecem como planejados e são bloqueados pelo diagnóstico até terem motor próprio.</p>
      <div class="mv-effect-window-footer"><span>As alterações são salvas ao clicar no botão.</span><button type="button" data-mv-condition-save>Salvar condição</button></div></div>`;
  }
  _replaceHTML(result,content){content.innerHTML=result;}
  _onRender(context,options){
    super._onRender(context,options);
    this.element.querySelectorAll('[data-mv-condition-meta]').forEach(input=>input.addEventListener('input',()=>{this.definition[input.dataset.mvConditionMeta]=input.value;}));
    this.element.querySelector('[data-mv-inner-add]')?.addEventListener('click',()=>{
      if(this.definition.efeitos.length>=5)return;
      const index=this.definition.efeitos.length;
      this.definition.efeitos.push({nome:'',tipo:'atributo',receptor:'proprio',definicao:'fixo',escala:'fixo',mvImpedeAgir:'nao',indice:index+1});
      this.render(true);new MultiversoConditionMechanicWindow({owner:this,index}).render(true);
    });
    this.element.querySelectorAll('[data-mv-inner-edit]').forEach(button=>button.addEventListener('click',()=>new MultiversoConditionMechanicWindow({owner:this,index:Number(button.dataset.mvInnerEdit)}).render(true)));
    this.element.querySelectorAll('[data-mv-inner-duplicate]').forEach(button=>button.addEventListener('click',()=>{
      if(this.definition.efeitos.length>=5)return;
      const i=Number(button.dataset.mvInnerDuplicate);
      const copy=foundry.utils.deepClone(this.definition.efeitos[i]);
      copy.nome=copy.nome?`${copy.nome} (cópia)`:'';
      this.definition.efeitos.splice(i+1,0,copy);
      this.render(true);
    }));
    this.element.querySelectorAll('[data-mv-inner-remove]').forEach(button=>button.addEventListener('click',async()=>{
      const i=Number(button.dataset.mvInnerRemove);
      if(!await foundry.applications.api.DialogV2.confirm({window:{title:'Excluir mecânica'},content:`<p>Remover a mecânica ${i+1} da condição? A exclusão será salva quando clicar em Salvar condição.</p>`,rejectClose:false}))return;
      this.definition.efeitos.splice(i,1);this.render(true);
    }));
    this.element.querySelector('[data-mv-condition-save]')?.addEventListener('click',async ev=>{
      const button=ev.currentTarget;button.disabled=true;
      try{
        const map=foundry.utils.deepClone(readConditionMap(this.item));
        const d=foundry.utils.deepClone(this.definition);
        d.nome=String(d.nome??'').trim();d.descricao=String(d.descricao??'').trim();
        d.fonte=String(d.fonte||this.item.name);
        d.efeitos=d.efeitos.slice(0,5).map((e,i)=>({...e,indice:i+1}));
        map[conditionSlot(this.item,this.index)]=d;
        await replaceConditionMap(this.item,map);
        ui.notifications.info(`Condição salva com ${d.efeitos.length} mecânica(s) interna(s).`);await this.close();
      }catch(error){console.error('Multiverso | erro ao salvar condição',error);ui.notifications.error('Não foi possível salvar a condição.');button.disabled=false;}
    });
  }
}
class MultiversoEffectWindow extends AppV2 {
  constructor({item,index,onSaved}) {
    super({window:{title:`${item.name} — Efeito ${index}`,resizable:true},position:{width:890,height:740},classes:['mv-effect-edit-window']});
    this.item=item;
    this.index=index;
    this.onSaved=onSaved;
  }
  async _renderHTML() {
    return `<div class="mv-effect-window-body"><header><h2>Configuração do Efeito ${this.index}</h2></header><label class="mv-legacy-field">Nome do efeito<input type="text" maxlength="100" data-mv-key="${titleKey(this.index)}" value="${escapeHtml(this.item.system.props?.[titleKey(this.index)]??'')}" placeholder="Ex.: Cura Potencializada" /></label>${editorFields(this.item,this.index)}<div class="mv-condition-config-callout" data-mv-condition-callout><strong>Condição — efeitos mecânicos internos</strong><p>Configure as mecânicas da condição no modelo original (até cinco). O cadastro é separado da aplicação.</p><button type="button" data-mv-open-condition>Configurar condição e mecânicas</button></div><div class="mv-effect-window-footer"><span data-mv-window-status>As alterações são salvas ao sair dos campos.</span><button type="button" data-mv-close-effect>Concluir</button></div></div>`;
  }
  _replaceHTML(result,content) {
    // ApplicationV2 base renders an HTML string from _renderHTML.
    content.innerHTML=result;
  }
  _onRender(context,options) {
    super._onRender(context,options);
    const updateReinforcementUI=()=>{
      const only=this.element.querySelector(`[data-mv-key="${optionalKey(this.index)}"]`)?.value==='sim';
      const mode=this.element.querySelector(`[data-mv-key="${modeKey(this.index)}"]`)?.value;
      const wrapper=this.element.querySelector('[data-mv-reinforcement-options]');
      if(wrapper)wrapper.hidden=!only;
      const target=this.element.querySelector('[data-mv-replace-choice]');
      if(target)target.hidden=!only||mode!=='substituir';
    };
    const updateConditionUI=()=>{
      const chosen=this.element.querySelector(`[data-mv-key="${canonical(this.item,'tipo',this.index)}"]`)?.value??storedValue(this.item,'tipo',this.index);
      const panel=this.element.querySelector('[data-mv-condition-callout]');if(panel)panel.hidden=chosen!=='condicao';
    };

    bindAdaptiveEditor(this.element.querySelector('.mv-effect-window-body'));
    updateReinforcementUI();updateConditionUI();refreshAdaptiveEditor(this.element.querySelector('.mv-effect-window-body'));
    this.element.querySelectorAll('[data-mv-passive-ability-id]').forEach(box=>box.addEventListener('change',async()=>{
      const status=this.element.querySelector('[data-mv-window-status]');
      const ids=[...this.element.querySelectorAll('[data-mv-passive-ability-id]:checked')].map(e=>e.dataset.mvPassiveAbilityId);
      status.textContent='Salvando vínculos...';
      try{await this.item.update({[`system.props.${passiveIdsKey(this.index)}`]:ids.join(',')});status.textContent='Vínculos salvos.';this.onSaved?.();}
      catch(err){console.error('Multiverso | vínculos de passivos',err);status.textContent='Erro ao salvar vínculos.';ui.notifications.error('Não foi possível salvar os vínculos.');}
    }));
    this.element.querySelectorAll('[data-mv-cost-ability-id]').forEach(box=>box.addEventListener('change',async()=>{
      const status=this.element.querySelector('[data-mv-window-status]');
      const ids=[...this.element.querySelectorAll('[data-mv-cost-ability-id]:checked')].map(e=>e.dataset.mvCostAbilityId);
      if(status)status.textContent='Salvando filtro de custos...';
      try{await this.item.update({[`system.props.${costIdsKey(this.index)}`]:ids.join(',')});if(status)status.textContent='Filtro de custos salvo.';this.onSaved?.();}
      catch(err){console.error('Multiverso | filtro de custos',err);if(status)status.textContent='Erro ao salvar filtro.';ui.notifications.error('Falha ao salvar filtro de custos.');}
    }));
    this.element.querySelector('[data-mv-ui-sustain-mode]')?.addEventListener('change',event=>{
      const current=event.target.value;
      const auto=String(this.item.system.props?.[advancedKey('mvSustainCost',this.index)]??'');
      const legacy=String(storedValue(this.item,'sustentacao',this.index)??'');
      if(current==='none'&&(auto||legacy)){
        ui.notifications.warn('Existe sustentação salva. Para desativá-la, limpe o valor no modo automático ou especial antes de selecionar Sem sustentação.');
        event.target.value=auto?'auto':'manual';
      }
      refreshAdaptiveEditor(this.element.querySelector('.mv-effect-window-body'));
    });
    this.element.querySelector('[data-mv-open-condition]')?.addEventListener('click',()=>new MultiversoConditionWindow({item:this.item,index:this.index}).render(true));
    this.element.querySelector('[data-mv-close-effect]')?.addEventListener('click',()=>this.close());
    this.element.querySelector('.mv-effect-window-body')?.addEventListener('change',async event=>{
      const field=event.target.closest('[data-mv-key]');
      if(!field)return;
      updateReinforcementUI();updateConditionUI();refreshAdaptiveEditor(this.element.querySelector('.mv-effect-window-body'));
      // Selector for old shared property may be displayed in two contexts.
      this.element.querySelectorAll('[data-mv-key]').forEach(other=>{
        if(other!==field && other.dataset.mvKey===field.dataset.mvKey)other.value=field.value;
      });
      refreshAdaptiveEditor(this.element.querySelector('.mv-effect-window-body'));
      const status=this.element.querySelector('[data-mv-window-status]');
      status.textContent='Salvando...';
      try {
        const patch={[`system.props.${field.dataset.mvKey}`]:field.value};
        if(field.dataset.mvKey===canonical(this.item,'recarga',this.index)){
          // Clear only the stale secondary field when the user explicitly
          // changes RECARGA; embedded event selection now lives in RECARGA.
          patch[`system.props.${canonical(this.item,'recargaespecial',this.index)}`]='';
        }
        // Ao trocar de mecanismo, descarte somente o destino da categoria anterior.
        // O novo executor infere alvos óbvios sem obrigar a selecioná-los novamente.
        if(field.dataset.mvKey===canonical(this.item,'tipo',this.index)){
          const targetKey=canonical(this.item,'afetado',this.index);
          const target=this.element.querySelector(`[data-mv-key="${targetKey}"]`);
          const current=String(target?.value??'');
          const needs={
            atributo:['forca','agilidade','resistencia','inteligencia','carisma','percepcao'],
            recurso:['pv','pm','sta','san','pv_max','pm_max','sta_max','san_max','outro','outro_max'],
            defesa:['esquiva','bloqueio']
          };
          const options=needs[field.value]??[];
          const implicit=['teste','dano','condicao','deslocamento','resistencia','vulnerabilidade','imunidade','modificador_custo'].includes(field.value);
          if(target && (implicit || (options.length&&!options.includes(current)))){
            target.value='';patch[`system.props.${targetKey}`]='';
          }
          if(field.value==='teste'){
            const skill=this.element.querySelector(`[data-mv-key="${canonical(this.item,'alvo',this.index)}"]`);
            if(skill?.value&&!resolveTestKey(skill.value)){
              skill.value='';patch[`system.props.${canonical(this.item,'alvo',this.index)}`]='';
            }
          }
          refreshAdaptiveEditor(this.element.querySelector('.mv-effect-window-body'));
        }
        if(field.dataset.mvKey===`mvTestGroup${this.index}`){
          const targetKey=canonical(this.item,'alvo',this.index);
          patch[`system.props.${targetKey}`]='';
        }
        await this.item.update(patch);
        if(field.dataset.mvKey===canonical(this.item,'tipo',this.index)||field.dataset.mvKey===`mvTestGroup${this.index}`){
          await this.render(true);
        }
        status.textContent='Salvo.';
        this.onSaved?.();
      }catch(error){console.error('Multiverso | Falha ao salvar efeito',error);status.textContent='Erro ao salvar (F12).';ui.notifications.error('Falha ao salvar efeito.');}
    });
  }
}
const openEffect = (item,index,refresh) => new MultiversoEffectWindow({item,index,onSaved:refresh}).render(true);
async function confirm(message,title='Confirmar') {
  return foundry.applications.api.DialogV2.confirm({window:{title},content:`<p>${escapeHtml(message)}</p>`,rejectClose:false});
}
async function addEffect(item,index,refresh) {
  const current=countEffects(item);
  if(current>=MAX) return;
  const manual=item.getFlag?.('multiverso-rpg','manualEffectSourceV1')===true;
  const trait=item.getFlag?.('multiverso-rpg','traitEffectSourceV1')===true || item.getFlag?.('multiverso-rpg','itemEffectSourceV1')===true;
  const next=current+1;
  const suffix=next===1?'':String(next);
  await item.update({[`system.props.${COUNT_KEY}`]:next,...(manual||trait?{
    [`system.props.ativacaotempotiposkill${suffix}`]:'passiva',
    [`system.props.efeitoskillreceptor${suffix}`]:'proprio',
    [`system.props.efeitoskilldefinicao${suffix}`]:'fixo',
    [`system.props.efeitoskilloperacao${suffix}`]:'somar',
    [`system.props.efeitoskillescala${suffix}`]:'fixo'
  }:{})});
  refresh();
  openEffect(item,current+1,refresh);
}
async function deleteEffect(item,index,refresh) {
  const current=countEffects(item);
  if(index<1||index>current)return;
  if(!await confirm(`Excluir o Efeito ${index}? Esta ação apagará suas configurações.`,'Excluir efeito'))return;
  const patch={[`system.props.${COUNT_KEY}`]:current-1};
  for(let slot=index;slot<current;slot++){
    for(const optionKey of [optionalKey,modeKey,replaceKey,titleKey,cadenceKey,passiveModeKey,passiveIdsKey,(slot=>`mvAlternativeGroup${slot}`),(slot=>`mvShowUseButton${slot}`),...ADVANCED_KEYS.map(name=>slot=>advancedKey(name,slot))])patch[`system.props.${optionKey(slot)}`]=item.system.props?.[optionKey(slot+1)]??"";
    const oldTarget=Number(item.system.props?.[replaceKey(slot+1)]);
    if(oldTarget){patch[`system.props.${replaceKey(slot)}`]=String(oldTarget===index?'':oldTarget>index?oldTarget-1:oldTarget);}
    for(const [id] of original.BASE_FIELDS){
      patch[`system.props.${canonical(item,id,slot)}`]=storedValue(item,id,slot+1);
    }
  }
  for(const optionKey of [optionalKey,modeKey,replaceKey,titleKey,cadenceKey,passiveModeKey,passiveIdsKey,(slot=>`mvAlternativeGroup${slot}`),(slot=>`mvShowUseButton${slot}`),...ADVANCED_KEYS.map(name=>slot=>advancedKey(name,slot))])patch[`system.props.-=${optionKey(current)}`]=null;
  // Prevent dangling replacement pointers to the removed effect.
  for(let slot=1;slot<current;slot++){
    const originalSlot=slot<index?slot:slot+1;
    const originalTarget=Number(item.system.props?.[replaceKey(originalSlot)]);
    if(originalTarget===index)patch[`system.props.${replaceKey(slot)}`]='';
  }
  for(const [id] of original.BASE_FIELDS){
    const key=canonical(item,id,current);
    patch[`system.props.-=${key}`]=null;
  }
  await item.update(patch);
  const map=foundry.utils.deepClone(readConditionMap(item));
  if(Object.keys(map).length){
    const updated={...map};
    for(let slot=index;slot<current;slot++){
      const from=map[conditionSlot(item,slot+1)];
      if(from)updated[conditionSlot(item,slot)]=from;
      else delete updated[conditionSlot(item,slot)];
    }
    delete updated[conditionSlot(item,current)];
    await replaceConditionMap(item,updated);
  }
  refresh();
}
async function duplicateEffect(item,index,refresh) {
  const current=countEffects(item);
  if(current>=MAX)return;
  const patch={[`system.props.${COUNT_KEY}`]:current+1};
  for(const optionKey of [optionalKey,modeKey,replaceKey,titleKey,cadenceKey,passiveModeKey,passiveIdsKey,(slot=>`mvAlternativeGroup${slot}`),(slot=>`mvShowUseButton${slot}`),...ADVANCED_KEYS.map(name=>slot=>advancedKey(name,slot))])patch[`system.props.${optionKey(current+1)}`]=item.system.props?.[optionKey(index)]??'';
  for(const [id] of original.BASE_FIELDS)patch[`system.props.${canonical(item,id,current+1)}`]=storedValue(item,id,index);
  await item.update(patch);
  const map=foundry.utils.deepClone(readConditionMap(item));
  const source=map[conditionSlot(item,index)];
  if(source){map[conditionSlot(item,current+1)]=foundry.utils.deepClone(source);await replaceConditionMap(item,map);}
  refresh();
  openEffect(item,current+1,refresh);
}
export function mountMultiversoSkillEditor(root,item,{effectsOnly=false}={}) {
  const host=root.querySelector('[data-mv-skill-editor]');
  if(!host)return;
  host.innerHTML=markup(item,effectsOnly);
  // Traços passivos e efeitos vinculados a itens também podem ser inspecionados.
  if(!host.querySelector('[data-mv-execute-test]')){
    const toolbar=host.querySelector('.mv-original-effect-toolbar');
    if(toolbar){
      const button=document.createElement('button');
      button.type='button';
      button.dataset.mvExecuteTest='';
      button.textContent='Testar habilidade';
      toolbar.before(button);
    }
  }
  host.querySelector('[data-mv-execute-test]')?.addEventListener('click',async event=>{
    const button=event.currentTarget;
    button.disabled=true;
    try{await openAbilityDiagnostic(item);}
    catch(error){console.error('Multiverso | Diagnóstico de habilidade',error);ui.notifications.error(error?.message||'Não foi possível analisar a habilidade.');}
    finally{if(button.isConnected)button.disabled=false;}
  });
  const refresh=()=>{if(host.isConnected)mountMultiversoSkillEditor(root,item,{effectsOnly});};
  const lastTab=effectsOnly?'efeitos':(activeTabByItem.get(item.uuid)??'descricao');
  host.querySelectorAll('[data-mv-original-tab]').forEach(b=>b.classList.toggle('is-active',b.dataset.mvOriginalTab===lastTab));
  host.querySelectorAll('[data-mv-original-page]').forEach(page=>page.hidden=page.dataset.mvOriginalPage!==lastTab);
  host.querySelectorAll('[data-mv-original-tab]').forEach(btn=>btn.addEventListener('click',()=>{
    activeTabByItem.set(item.uuid,btn.dataset.mvOriginalTab);
    host.querySelectorAll('[data-mv-original-tab]').forEach(b=>b.classList.toggle('is-active',b===btn));
    host.querySelectorAll('[data-mv-original-page]').forEach(page=>page.hidden=page.dataset.mvOriginalPage!==btn.dataset.mvOriginalTab);
  }));
  const perform=async(button,action)=>{
    button.disabled=true;
    try {await action();}
    catch(error){console.error('Multiverso | Falha na edição do efeito',error);ui.notifications.error('Erro na edição do efeito (F12).');}
    finally {if(button.isConnected)button.disabled=false;}
  };
  host.querySelector('[data-mv-add-effect]')?.addEventListener('click',event=>perform(event.currentTarget,()=>addEffect(item,null,refresh)));
  host.querySelectorAll('[data-mv-item-effect-manual]').forEach(button=>button.addEventListener('click',async()=>{
    const origin=item.parent?.items?.get(item.getFlag('multiverso-rpg','originItemId'));
    if(!origin)return ui.notifications.warn('O item de origem não existe mais.');
    button.disabled=true;
    try{
      const {activateItemEffects}=await import('./item-effect-links.mjs');
      await activateItemEffects(origin,{skipAction:false,onlySlots:[Number(button.dataset.mvItemEffectManual)]});
    }catch(error){console.error(error);ui.notifications.error(error.message);}
    finally{if(button.isConnected)button.disabled=false;}
  }));
  host.querySelectorAll('[data-mv-item-effect-trigger]').forEach(select=>select.addEventListener('change',async()=>{
    try{
      const previous=item.getFlag('multiverso-rpg','itemEffectTriggersV1')??{};
      const index=Number(select.dataset.mvItemEffectTrigger),suffix=index===1?'':String(index);
      if(select.value!=='nenhum'&&item.system.props?.[`ativacaotempotiposkill${suffix}`]==='passiva')
        await item.update({[`system.props.ativacaotempotiposkill${suffix}`]:'livre'});
      await item.setFlag('multiverso-rpg','itemEffectTriggersV1',{...previous,[index]:select.value});
    }catch(error){ui.notifications.error(error.message);}
  }));
  host.querySelectorAll('[data-mv-edit-effect]').forEach(btn=>btn.addEventListener('click',()=>openEffect(item,Number(btn.dataset.mvEditEffect),refresh)));
  host.querySelectorAll('[data-mv-delete-effect]').forEach(btn=>btn.addEventListener('click',event=>perform(event.currentTarget,()=>deleteEffect(item,Number(btn.dataset.mvDeleteEffect),refresh))));
  host.querySelectorAll('[data-mv-duplicate-effect]').forEach(btn=>btn.addEventListener('click',event=>perform(event.currentTarget,()=>duplicateEffect(item,Number(btn.dataset.mvDuplicateEffect),refresh))));
  host.querySelector('[data-mv-ability-level]')?.addEventListener('change',async event=>{
    const input=event.target;
    const status=host.querySelector('.mv-original-status');
    const raw=String(input.value).trim();
    if(raw && (!/^\d+$/.test(raw)||Number(raw)>999)) {ui.notifications.warn('Informe um nível inteiro entre 0 e 999.');return;}
    try {
      if(status)status.textContent='Salvando nível...';
      await item.update({[`system.props.${input.dataset.mvAbilityLevel}`]:raw});
      if(status?.isConnected)status.textContent='Nível salvo.';
    } catch(error) {console.error('Multiverso | Erro ao salvar nível',error);ui.notifications.error('Não foi possível salvar nível da habilidade.');}
  });
  host.querySelector('[data-mv-description]')?.addEventListener('change',async event=>{
    const status=host.querySelector('.mv-original-status');
    status.textContent='Salvando...';
    try {
      await item.update({'system.descricao':event.target.value,[`system.props.${item.type==='skill'?'descricaoskill':'descricaotecnica'}`]:event.target.value});
      if(status.isConnected)status.textContent='Salvo.';
    }catch(error){console.error('Multiverso | Falha ao salvar descrição',error);if(status.isConnected)status.textContent='Erro ao salvar.';}
  });
}

// Abre o MESMO editor de Skills/Técnicas na aba de efeitos, sem um formulário duplicado.
export function openMultiversoSkillEffectEditor(item){
  if(!item||!['skill','tecnica'].includes(item.type))throw Error('A origem do efeito deve ser uma Skill ou Técnica.');
  activeTabByItem.set(item.uuid,'efeitos');
  item.sheet?.render(true);
}
