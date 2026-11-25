import {queueOpenEffect} from './open-effect-chat.mjs';
import {VALUE_KINDS,conditionDamageBonus} from "./condition-mechanics.mjs";
import {reactionActivity,reactionStatus,spendReaction,refundReaction} from './reaction-combat.mjs';
import {activityOf,actionStatus,beginAbilityAction,finishAbilityAction,isActionBlocked} from './action-economy.mjs';
import {chooseEffectAlternatives,alternativeGroups} from './effect-alternatives.mjs';
import {resolvePericiaKey,resolveTestKey} from './pericia-fields.mjs';
import {predicateCheck,validateAdvanced,advancedMode,chainAllows} from './advanced-motor.mjs';
import {confirmOriginalUse} from './confirmation-original.mjs';
import {createEffectChatCard} from './effect-chat.mjs';
import {executeExternalTarget} from './target-external.mjs';
import {executeExternalMaintained} from './external-maintained.mjs';
import {executeExternalAdvanced} from './external-advanced.mjs';
import {canUseExternalCard,executeExternalCard} from './external-card-apply.mjs';
import {chooseExternalExecutionRoute} from './ability-execution-route.mjs';
import {manualDamageEntry} from './damage-cards.mjs';
import {selectedExternalTokens} from './selected-targets.mjs';
import {executeMultiTarget,validateSelectedTargetLimit} from './multi-target.mjs';
import {resolveValue, prepareFormula, evaluateArithmetic} from './effect-formulas.mjs';
// Fase 2 — execução nativa conservadora: bloqueia configurações sem migração.
// Não substitui o motor original do CSB.
import {original} from './skill-editor-definition.mjs';
import {parseAdvancedCosts,expandCostRange,splitCostAlternatives} from './advanced-costs.mjs';
import {askActivationChoices,activationChoiceValue} from './activation-choices.mjs';
import {classifyDuration, durationDiagnostic} from './effect-duration.mjs';
import {parseDistance} from './area-targeting.mjs';
import {planTrackedEntries} from './effect-tracking.mjs';
import {availableFluxes,fluxById,fluxByName,parseFluxExpression,fluxExpressionError,signedResourceBalance} from './extra-flux.mjs';
import {usageStatus,takeUsage,restoreUsage} from './skill-uses.mjs';
import {rollOriginalResistance} from './resistance-test.mjs';
import {createOpposedCard} from './opposed-chat.mjs';
import {applyResourceOperation,isSpecialResourceOperation,verifySpecialResourceOperation} from './special-math.mjs';
const MAX = 5;
const ENGINE_VERSION = '0.1.49';
const keyFor = (item, id, index) => {
  const suffix=index===1?'':String(index);
  if(id==='atividade')return `ativacaotempotipo${item.type}${suffix}`;
  if(id==='nome')return `atividadenome${item.type}${suffix}`;
  return `efeito${item.type}${id}${suffix}`;
};
const valueFor = (item,id,i)=>String(item.system.props?.[keyFor(item,id,i)]??'').trim();
const numeric = str => /^\d+(?:[.,]\d+)?$/.test(str) ? Number(str.replace(',','.')) : null;
const FIELD_IDS=original.BASE_FIELDS.map(row=>row[0]);
const ALLOWED_FIELDS=new Set(['tipo','receptor','definicao','afetado','alvo','operacao','valor','escala','origemescala','nome','detalhe','atividade','acumulo','ataquerolagem','resistenciaativa','resistenciateste','resistenciadt','resistenciafalha','resistenciasucesso','prerequisitos','custo','custoopcional','usos','recarga','recargaespecial','duracao','condicaores','tipodano','tipodanomodo','escolhatipo','escolhaquantidade','escolharepetir','escolhaopcoes','filtroaplicacao','filtrodanohabilitado','filtrotipodano']);
const FLUXO={pv:'pv_atual',pm:'pm_atual',sta:'sta_atual',san:'san_atual'};
const MAXIMO={pv:'pv_max',pm:'pm_max',sta:'sta_max',san:'san_max'};
const MAX_FIELDS=new Set(['pv_max','pm_max','sta_max','san_max']);
const ATTR={pv_max:'pv_max',pm_max:'pm_max',sta_max:'sta_max',san_max:'san_max',forca:'forcanumero',agilidade:'agilidadenumero',resistencia:'resistencianumero',inteligencia:'inteligencianumero',carisma:'carismanumero',percepcao:'percepcaonumero',deslocamento:'deslocamentonumero',esquiva:'esquivabonus',bloqueio:'bloqueiobonus'};
const MAINTAINED_TYPES=['atributo','bonus','penalidade','deslocamento','defesa','teste','resistencia','vulnerabilidade','imunidade'];
const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function slotCount(item){
  const saved=Number(item.system.props?.mvEffectCount??0);
  const detected=Array.from({length:MAX},(_,i)=>i+1).filter(i=>FIELD_IDS.some(id=>valueFor(item,id,i)!=='')).pop()??0;
  return Math.min(MAX,Math.max(Number.isFinite(saved)?saved:0,detected));
}
// Custo principal: primeira entrada preenchida, fiel ao motor antigo.
// Formas fixas/combinadas aprovadas são preservadas; a v0.1.93 acrescenta
// percentuais do máximo, fórmulas aritméticas e faixas explícitas.
// Dados e fórmulas especiais ainda são diagnosticados antes da aplicação.
function parseCostGroup(raw,defaultResource,actor,item){
 const clean=String(raw).trim();
 // Preservar rótulos legados também nos reforços: '2 PM (reforço)'.
 const label=clean.match(/^(.*?)\s+\(([^()]*)\)\s*$/);
 if(label){
   const parsed=parseAdvancedCosts(label[1],actor,item,defaultResource);
   if(!parsed.error)return parsed;
 }
 return parseAdvancedCosts(clean,actor,item,defaultResource);
}
export function primaryCost(item,count,actor=item.parent,onlySlots=null){
  const entries=Array.from({length:count},(_,n)=>({slot:n+1,raw:valueFor(item,'custo',n+1)})).filter(e=>e.raw&&(!onlySlots||onlySlots.includes(e.slot)));
  const resource=item.type==='tecnica'?'sta':'pm';
  if(!entries.length)return {options:[{label:'Sem custo',costs:[]}],errors:[]};
  const selected=entries[0];
  // Custos simples seguem a conversão de recurso principal do motor original.
  // Em custos compostos com recursos EXPLICITAMENTE distintos, preservar o rótulo
  // de cada parcela. Caso contrário '2 PM + 1 STA' vira incorretamente '3 PM'.
  // Essa exceção é a adaptação nativa combinada para os custos mistos.
  const explicitResources=[...selected.raw.matchAll(/(?:^|\+)\s*\d+\s*([^+()]+?)(?=\+|$|\()/gi)].map(m=>m[1].trim().toLowerCase());
  const mixedResources=new Set(explicitResources).size>1;
  const normalized=mixedResources?selected.raw:selected.raw.replace(item.type==='tecnica'?/\bPM\b/gi:/\bSTA\b/gi,resource.toUpperCase());
  const baseAlternatives=splitCostAlternatives(normalized)??[];
  if(!baseAlternatives.length)return {options:[],errors:['Custo principal inválido: confira separadores e parênteses.']};
  const alternatives=baseAlternatives.flatMap(a=>expandCostRange(a,resource)??[a]);
  const options=[];
  for(const alternative of alternatives){
    // Rótulos finais apenas quando a alternativa contém texto de apresentação,
    // e nunca no valor numérico da fórmula '( @forca / 2 ) PM'.
    const trailing=alternative.match(/^(.*?)\s+\(([^()]*)\)\s*$/);
    const expr=trailing?trailing[1]:alternative;
    const label=trailing?.[2]||alternative;
    const parsed=parseCostGroup(expr,resource,actor,item);
    if(parsed.error)return {options:[],errors:[parsed.error]};
    options.push({label,costs:parsed.costs,details:parsed.details??[]});
  }
  return {options,errors:[],slot:selected.slot};
}
// Cada efeito reforçado pode definir seu próprio custo opcional. Para preservar
// fichas anteriores, um custo opcional somente no efeito normal continua sendo
// o reforço compartilhado dos efeitos vinculados sem custo próprio.
export function optionalCost(item,count,actor=item.parent,onlySlots=null){
  const props=item.system.props??{};
  const optionalSlots=Array.from({length:count},(_,i)=>i+1).filter(slot=>props[`mvOptionalOnly${slot}`]==='sim'&&(!onlySlots||onlySlots.includes(slot)));
  const costs=Array.from({length:count},(_,i)=>({slot:i+1,raw:valueFor(item,'custoopcional',i+1)})).filter(c=>c.raw&&(!onlySlots||onlySlots.includes(c.slot)));
  const defaultResource=item.type==='tecnica'?'sta':'pm';
  const independent=costs.filter(c=>optionalSlots.includes(c.slot));
  const shared=costs.filter(c=>!optionalSlots.includes(c.slot));
  if(shared.length>1 && new Set(shared.map(c=>c.raw)).size>1)return {groups:[],errors:['Custos opcionais diferentes nos efeitos normais: configure um custo compartilhado único.']};
  const groups=[];
  const assigned=new Set();
  for(const c of independent){
    const alternatives=splitCostAlternatives(c.raw)??[];
    if(!alternatives.length)return {groups:[],errors:['Custo opcional inválido: confira separadores e parênteses.']};
    const options=alternatives.map(text=>({label:text,...parseCostGroup(text,defaultResource,actor,item)}));
    if(options.some(o=>o.error))return {groups:[],errors:[options.find(o=>o.error).error]};
    groups.push({id:`effect${c.slot}`,slots:[c.slot],title:String(props[`mvEffectTitle${c.slot}`]??'').trim()||`Efeito ${c.slot}`,options});
    assigned.add(c.slot);
  }
  const leftovers=optionalSlots.filter(slot=>!assigned.has(slot));
  if(shared.length){
    const alternatives=splitCostAlternatives(shared[0].raw)??[];
    if(!alternatives.length)return {groups:[],errors:['Custo opcional inválido: confira separadores e parênteses.']};
    const options=alternatives.map(text=>({label:text,...parseCostGroup(text,defaultResource,actor,item)}));
    if(options.some(o=>o.error))return {groups:[],errors:[options.find(o=>o.error).error]};
    groups.unshift({id:'shared',slots:leftovers,title: String(props[`mvEffectTitle${shared[0].slot}`]??'').trim()||'Reforço geral',options});
  } else if(leftovers.length) return {groups:[],errors:[`Efeitos ${leftovers.join(', ')} dependem de reforço, mas não possuem custo opcional.`]};
  return {groups,errors:[]};
}
export async function chooseReinforcement(plan,actor){
  if(!plan.groups.length)return [];
  // Diálogo multi-escolha: uma opção por reforço, ou nenhuma. O botão de
  // confirmar não altera o personagem, apenas define o conjunto a executar.
  const content=`<div class="mv-reinforce-dialog"><p class="mv-reinforce-intro">Escolha os reforços de <strong>${esc(actor.name)}</strong>. Cada reforço é independente.</p><form class="mv-reinforce-choices">${plan.groups.map((g,i)=>`<fieldset class="mv-reinforce-group"><legend>${esc(g.title)}</legend><label class="mv-reinforce-option"><input type="radio" name="mv-extra-${i}" value="-1" checked /><span>Não utilizar</span></label>${g.options.map((o,j)=>`<label class="mv-reinforce-option"><input type="radio" name="mv-extra-${i}" value="${j}" /><span>${esc(o.label)}</span></label>`).join('')}</fieldset>`).join('')}</form><p class="mv-reinforce-note">Os custos e efeitos escolhidos aparecerão no card antes de serem aplicados.</p></div>`;
  const result=await foundry.applications.api.DialogV2.wait({window:{title:'Escolher reforços opcionais'},content,buttons:[{action:'confirm',label:'Continuar',default:true,callback:(_ev,button,dialog)=>{
    const root=dialog?.element;
    if(!root)return null;
    return plan.groups.flatMap((g,i)=>{
      const choice=Number(root.querySelector(`input[name="mv-extra-${i}"]:checked`)?.value??-1);
      return choice>=0 && g.options[choice]?[{...g,chosen:g.options[choice]}]:[];
    });
  }},{action:'cancel',label:'Cancelar execução',callback:()=>null}],rejectClose:false});
  return Array.isArray(result)?result:null;
}
export async function selectCostOption(plan,actor){
  if(plan.options.length===1)return plan.options[0];
  const buttons=plan.options.map((option,i)=>({action:String(i),label:`${i+1}. ${option.label}`,callback:()=>i}));
  const result=await foundry.applications.api.DialogV2.wait({
    window:{title:'Escolher custo principal'},
    content:`<p>Escolha uma das alternativas de custo para ${esc(actor.name)}. O custo será aplicado somente após confirmar o card no chat.</p>`,
    buttons:[...buttons,{action:'cancel',label:'Cancelar',callback:()=>null}],rejectClose:false
  });
  return Number.isInteger(result)&&result>=0&&result<plan.options.length?plan.options[result]:null;
}

// Mesmo local e estrutura da definição de condições de ficha-skills.js do original.
function analyzeConditionMechanics(item,index){
  const raw=item.system?.props?.mvConditionDefinitionsV1 ?? item.flags?.['multiverso-rpg']?.condicoesHabilidadeV1 ?? item.flags?.['multiverso-automacao']?.condicoesHabilidadeV1 ?? {};
  const condition=raw[`${item.type==='tecnica'?'tecnica':'skill'}:${index}`];
  const list=Array.isArray(condition?.efeitos)?condition.efeitos:Array.isArray(condition)?condition:[];
  if(condition && !Array.isArray(condition?.efeitos) && !Array.isArray(condition))return {errors:['Formato de mecânicas da condição inválido; reabra e salve o editor da condição.'],mechanics:[]};
  const errors=[];const mechanics=[];
  if(list.length>5)errors.push('O original permite até 5 efeitos mecânicos internos.');
  // Tudo que não foi integrado fica bloqueado, não é ignorado.
  const safeFields=new Set(['indice','nome','detalhe','tipo','afetado','operacao','valor','escala','receptor','definicao','mvImpedeAgir','mvBloqueiaTipo','mvMechanicKind','mvDamageDirection','mvDamageScope','mvDamageType','mvAdvMode','mvAdvScope','mvAdvUses','mvAdvTargetType']);
  for(const [n,inner] of list.entries()){
    const tag=`Mecânica ${n+1}`;
    if(!inner || typeof inner!=='object'){errors.push(`${tag}: definição inválida.`);continue;}
    const kind=String(inner.mvMechanicKind||(inner.mvImpedeAgir==='sim'?'action':'attribute'));
    const restrict=kind==='action';
    const type=String(inner.tipo??'').trim();
    const affected=String(inner.afetado??'').trim();
    const rawValue=String(inner.valor??'').trim();
    const scale=String(inner.escala??'fixo').trim()||'fixo';
    // A fórmula é avaliada UMA VEZ quando a condição é criada.
    // O Active Effect guarda o resultado fixo para permitir remoção limpa.
    const hasDice = (scale==='dado' || (scale==='formula' && /\b\d*d\d+\b/i.test(rawValue)));
    const diceFormula = hasDice ? prepareFormula(rawValue,item.parent,item) : null;
    const validDice = hasDice && diceFormula!==null && /\b\d*d\d+\b/i.test(diceFormula) && /^(?=.{1,200}$)[0-9dD+\-*/%(). ]+$/.test(diceFormula);
    const calculation=hasDice ? {value: validDice?0:null, error:validDice?null:'Fórmula de dados inválida ou variável desconhecida.'} : scale==='formula'
      ? resolveValue({raw:rawValue,scale,origin:'personagem',actor:item.parent,item,affected:String(inner.afetado??'')})
      : {value:numeric(rawValue)};
    const value=calculation.value??null;
    const receiver=String(inner.receptor??'proprio').trim()||'proprio';
    const define=String(inner.definicao??'fixo').trim()||'fixo';
    const operation=String(inner.operacao??'').trim();
    const unsupported=Object.entries(inner).filter(([key,val])=>!safeFields.has(key)&&val!==''&&val!==null&&val!==undefined).map(([key])=>key);
    if(unsupported.length)errors.push(`${tag}: campos incompatíveis com esta condição: ${unsupported.join(', ')}.`);
    if(!restrict && !VALUE_KINDS.has(kind) && kind!=='damage' && kind!=='advantage')errors.push(`${tag}: mecânica ${kind} ainda não possui executor automático. Não será aplicada.`);
    if(!restrict && (VALUE_KINDS.has(kind)||kind==='damage'||kind==='advantage') && !['atributo','bonus','penalidade','deslocamento','defesa'].includes(type))errors.push(`${tag}: tipo '${type||'vazio'}' não é válido para esta condição.`);
    if(kind==='attribute' && !Object.hasOwn(ATTR,affected))errors.push(`${tag}: escolha um dos seis atributos principais.`);
    if(kind==='damage'&&!['caused','received'].includes(String(inner.mvDamageDirection||'caused')))errors.push(`${tag}: direção do dano inválida.`);
    if(kind==='damage'&&!['any','melee','ranged'].includes(String(inner.mvDamageScope||'any')))errors.push(`${tag}: tipo de ataque inválido.`);
    if(kind==='advantage' && !['vantagem','desvantagem'].includes(String(inner.mvAdvMode||'vantagem')))errors.push(`${tag}: tipo de vantagem inválido.`);
    if(kind==='advantage' && !['continuous','once'].includes(String(inner.mvAdvUses||'continuous')))errors.push(`${tag}: modo de consumo inválido.`);
    if(kind==='capacity'&&scale!=='fixo')errors.push(`${tag}: capacidade de carga exige porcentagem fixa.`);
    if(!restrict && !['fixo','formula','dado'].includes(scale))errors.push(`${tag}: escala '${scale}' ainda não suportada em condições.`);
    if(!restrict && kind!=='advantage' && calculation.error)errors.push(`${tag}: ${calculation.error}`);
    if(receiver!=='proprio')errors.push(`${tag}: receptor interno deve ser Próprio (o personagem condicionado).`);
    if(define!=='fixo')errors.push(`${tag}: não é possível escolher um valor variável nesta configuração.`);
    if(kind!=='capacity'&&operation&&!['somar','subtrair'].includes(operation))errors.push(`${tag}: operação ${operation} não é compatível com esta condição.`);
    if(!restrict && kind!=='advantage' && (value===null || !Number.isFinite(value) || (value<0 && kind!=='capacity')))errors.push(`${tag}: informe um valor numérico não negativo ou fórmula válida.`);
    const sign=type==='penalidade'?-1:(operation==='subtrair'?-1:1);
    if(restrict){
      if(type && type!=='acao')errors.push(`${tag}: para impedir ações, use Tipo de Efeito = Ação/reação.`);
      if(affected||rawValue||operation)errors.push(`${tag}: impedimento de ações não precisa de atributo, operação ou valor; limpe esses campos.`);
      const allowedBlocked=['todas','acao','movimento','bonus','completa','reacao'];
      const blockedType=String(inner.mvBloqueiaTipo||'todas').trim();
      if(!allowedBlocked.includes(blockedType))errors.push(`${tag}: tipo de ação bloqueada não reconhecido.`);
      mechanics.push({blocksAction:true,blockedActionTypes:[blockedType],name:String(inner.nome||tag).trim()});
    }else {
      const keys=kind==='defense'?['esquivabonus','bloqueiobonus']:kind==='dodge'?['esquivabonus']:kind==='block'?['bloqueiobonus']:kind==='movement'?['deslocamentonumero']:kind==='attribute'?[ATTR[affected]??null]:[];
      for(const key of keys)mechanics.push({kind,attributeKey:key,delta:(value??0)*sign,sign,diceFormula:validDice?diceFormula:null,name:String(inner.nome||tag).trim()});
      if(kind==='capacity')mechanics.push({kind,delta:value??0,name:String(inner.nome||tag).trim()});
      if(kind==='advantage')mechanics.push({kind,mode:String(inner.mvAdvMode||'vantagem'),scope:String(inner.mvAdvScope||'all'),uses:String(inner.mvAdvUses||'continuous'),name:String(inner.nome||tag).trim()});
      if(kind==='damage')mechanics.push({kind,direction:String(inner.mvDamageDirection||'caused'),scope:String(inner.mvDamageScope||'any'),damageType:String(inner.mvDamageType||'fisico'),delta:(value??0)*sign,diceFormula:validDice?diceFormula:null,name:String(inner.nome||tag).trim()});
    }
  }
  return {errors,mechanics};
}
function analyze(item,i){
  const get=id=>valueFor(item,id,i);
  const errors=[];
  const effectType=get('tipo');
  const protection=['resistencia','vulnerabilidade','imunidade'].includes(effectType);
  const affected=protection?'protecao_dano':(get('afetado')||({deslocamento:'deslocamento',teste:'teste',dano:'pv',cura:'pv',resistencia:'protecao_dano',vulnerabilidade:'protecao_dano',imunidade:'protecao_dano'}[effectType]??''));
  const receiver=get('receptor')||'proprio';
  const currentExtraName=availableFluxes(item.parent).find(flow=>flow.id==='extra')?.label??null;
  const extraResourceName=['outro','outro_max'].includes(affected)?(currentExtraName||get('alvo')):null;
  // Penalidade de atributo sempre diminui o valor; Bônus preserva Somar/Subtrair cadastrado.
  const op=effectType==='penalidade'?'subtrair':(get('operacao')||'somar');
  const isCondition=effectType==='condicao';
  const maxResource=effectType==='recurso'&&(MAX_FIELDS.has(affected)||affected==='outro_max');
  const canMaintain=MAINTAINED_TYPES.includes(effectType)||maxResource;
  const conditionName=(get('condicaores')||String(item.system.props?.[`mvEffectTitle${i}`]??'').trim());
  const innerCondition=isCondition?analyzeConditionMechanics(item,i):{errors:[],mechanics:[]};
  errors.push(...innerCondition.errors);
  const testRollMode=effectType==='teste'&&['vantagem','desvantagem'].includes(op);
  const dynamicValue=get('definicao')==='escolhido'&&!isCondition&&!testRollMode;
  const rawValue=(testRollMode||isCondition||['imunidade','vulnerabilidade'].includes(effectType)|| (effectType==='recurso'&&op==='maximizar'))?'0':get('valor');
  const diceMode=!dynamicValue&&!testRollMode&&(get('escala')==='dado' || (get('escala')==='formula' && /\b\d*d\d+\b/i.test(rawValue)));
  const preparedDice=diceMode?prepareFormula(rawValue,item.parent,item):null;
  const validDice=diceMode && preparedDice!==null && /\b\d*d\d+\b/i.test(preparedDice) && /^(?=.{1,200}$)[0-9dD+\-*/%(). ]+$/.test(preparedDice);
  const resolved=testRollMode?{value:0,detail:'Próximo teste'}:dynamicValue?{value:0,detail:'Valor escolhido na ativação'}:diceMode?(validDice?{value:0,detail:preparedDice}:{error:'Fórmula de dados inválida ou variável desconhecida.'}):resolveValue({raw:rawValue,scale:protection?'fixo':get('escala'),origin:get('origemescala'),actor:item.parent,item,affected});
  const base=resolved.value??null;
  const rawCadence=item.system.props?.[`mvEffectCadence${i}`];
  let cadence=String(rawCadence??'once').trim()||'once';
  // Áreas com cura/alteração de fluxo atual são periódicas, nunca bônus de atributo mantido.
  // Preserva o registro antigo escolhido como 'Manter' no editor.
  const areaPeriodic=receiver==='area' && effectType==='recurso' && ['pv','pm','sta','san'].includes(affected) && Boolean(get('formarea')) && cadence==='maintained';
  if(areaPeriodic)cadence='periodic';
  const duration=classifyDuration(get('duracao'));
  const durationError=durationDiagnostic(get('duracao'));
  // Passivas permanentes são calculadas pela ficha, sem duração nem execução.
  const permanentPassive=get('atividade')==='passiva' && !get('duracao') && !get('custo') && !get('sustentacao') && !get('resistenciaativa').includes('sim') && ['atributo','bonus','penalidade','deslocamento','defesa'].includes(effectType) && ['','proprio'].includes(receiver) && ['','fixo'].includes(get('definicao')) && ['','fixo'].includes(get('escala'));
  if(permanentPassive){
    if(!Object.hasOwn(ATTR,affected))errors.push('Passiva permanente: selecione um atributo ou destino suportado.');
    if(!['somar','subtrair'].includes(op))errors.push('Passiva permanente: use Somar ou Subtrair.');
    if(!Number.isFinite(base)||base<0)errors.push('Passiva permanente: informe um valor fixo não negativo.');
    return {index:i,errors,type:effectType,affected,attributeKey:ATTR[affected]??null,op,value:base,receiver,cadence:'passive',duration:{kind:'permanent',label:'Permanente'}};
  }
  if(!['once','periodic','maintained'].includes(cadence))errors.push('Comportamento de duração inválido.');
  if(effectType==='teste'&&affected!=='teste')errors.push('Perícia: escolha Perícia / teste específico.');
  if(effectType==='teste'&&!resolveTestKey(get('alvo')))errors.push('Teste não reconhecido: escolha um atributo ou uma perícia existente.');
  if(effectType==='deslocamento'&&affected!=='deslocamento')errors.push('Deslocamento exige o destino Deslocamento.');
  if(effectType==='defesa'&&!['esquiva','bloqueio'].includes(affected))errors.push('Defesa: selecione Esquiva ou Bloqueio.');
  if(isCondition && cadence!=='maintained')errors.push('Condição com duração: escolha Manter até terminar na seção 5.');
  if((MAINTAINED_TYPES.includes(effectType)||maxResource) && cadence!=='maintained'&&!testRollMode)errors.push('Alteração temporária de atributo: escolha Comportamento durante a duração = Manter até terminar, na seção 5.');
  if(cadence==='maintained'){
    if(!['turns','rounds','scene','sustained'].includes(duration.kind))errors.push('Bônus contínuo exige duração em turnos, rodadas, cena ou sustentação.');
    if(!canMaintain&&!isCondition)errors.push('Efeitos mantidos aceitam atributos, proteções, deslocamento, Esquiva, Bloqueio ou condição.');
    if(!isCondition && !protection && !Object.hasOwn(ATTR,affected)&&!(affected==='outro_max'&&fluxByName(item.parent,extraResourceName)?.id==='extra')&&!(effectType==='teste'&&resolveTestKey(get('alvo'))))errors.push('Destino mantido inválido: selecione um atributo ou uma perícia existente.');
    if(!isCondition && !protection && !['somar','subtrair',...(testRollMode?['vantagem','desvantagem']:[])].includes(op))errors.push('Bônus contínuo exige Somar ou Subtrair.');
    if(!isCondition && !protection && get('escala')!=='fixo')errors.push('Bônus contínuo exige Valor fixo nesta etapa.');
    if(!isCondition && (resolved.error||!Number.isFinite(base)||base<0))errors.push('Informe um valor fixo não negativo.');
    if(isCondition && !conditionName)errors.push('Informe Condição Aplicada ou Nome do efeito.');
    if(get('resistenciaativa')==='sim')errors.push('Esta resistência não é compatível com bônus contínuos.');
  }
  if(cadence==='periodic'&&!game.combat?.started&&['turns','rounds'].includes(duration.kind))errors.push('Efeitos periódicos fora de combate ainda não têm regra de repetição por cena.');
  if(cadence==='periodic'&&!['turns','rounds'].includes(duration.kind)&&!(receiver==='area'&&duration.kind==='sustained'))errors.push('Repetição por turno exige duração em turnos, rodadas ou sustentação em área.');
  if(cadence==='periodic'&&get('resistenciaativa')==='sim')errors.push('Esta resistência não é compatível com aplicações periódicas.');
  if(durationError && !['turns','rounds','scene','sustained'].includes(duration.kind))errors.push(durationError);
  if(['turns','rounds'].includes(duration.kind)&&(!Number.isInteger(duration.amount)||duration.amount<1))errors.push('Turnos/rodadas precisam ser inteiros positivos.');
  if(!effectType)errors.push('Tipo de efeito não configurado.');
  if(!['recurso','cura','dano'].includes(effectType) && !testRollMode && !(cadence==='maintained'&&(MAINTAINED_TYPES.includes(effectType)||isCondition)))errors.push(`Tipo de efeito não disponível para esta configuração: ${effectType||'vazio'}.`);
  if(receiver!=='proprio')errors.push('O receptor selecionado não é compatível com esta execução.');
  if(resolved.error)errors.push(resolved.error);
  if(dynamicValue&&!['recurso','cura','dano'].includes(effectType))errors.push('Escolha de valor disponível apenas para Alteração de Fluxo, Cura ou Dano imediatos.');
  if(dynamicValue&&cadence!=='once')errors.push('A escolha de valor não é compatível com efeitos de duração contínua.');
  // Mensagens específicas de erro de fórmula são geradas pelo resolvedor.
  if(base!==null&&base<0)errors.push('Valor negativo não permitido neste executor.');
  if(!isCondition && !protection && !['somar','subtrair','', 'multiplicar','maximizar','limitar_minimo','limitar_maximo',...(testRollMode?['vantagem','desvantagem']:[])].includes(op))errors.push(`Operação não compatível com esta configuração: ${op}.`);
  const mathError=verifySpecialResourceOperation({type:effectType,affected,operation:op,cadence,diceFormula:validDice?preparedDice:null,resistanceActive:get('resistenciaativa')==='sim',dynamicValue});
  if(mathError)errors.push(mathError);
  if(isSpecialResourceOperation(op)){
    const diceLimit=['limitar_minimo','limitar_maximo'].includes(op)&&validDice;
    if(!['fixo',''].includes(get('escala'))&&!diceLimit)
      errors.push('Esta operação exige Valor fixo. Para Garantir mínimo e Limitar máximo, também é possível usar Dados com fórmula válida (ex.: 1d8).');
  }
  if(protection){
    if(affected!=='protecao_dano')errors.push('Proteção exige destino Proteção contra dano.');
    // Proteção usa Conceder implicitamente; operações antigas ocultas são ignoradas.
    if(get('operacao')==='remover')errors.push('Remover proteção temporária não é suportado; use o encerramento do efeito.');
    if(effectType==='resistencia'&&!(Number(base)>0))errors.push('Resistência exige redução fixa positiva.');
  }
  if(effectType==='recurso'&&!Object.hasOwn(FLUXO,affected)&&!MAX_FIELDS.has(affected)&&!(['outro','outro_max'].includes(affected)&&fluxByName(item.parent,extraResourceName)?.id==='extra'))errors.push('Alteração de fluxo: selecione PV/PM/STA/SAN ou Outro com o nome de um Fluxo Extra ativo na ficha.');
  if((effectType==='cura'||effectType==='dano')&&affected&&!['pv','pv_atual'].includes(affected))errors.push('Cura/dano aqui funciona apenas para PV atual.');
  const resistanceActive=get('resistenciaativa')==='sim';
  const opposedActive=get('resistenciaativa')==='oposto';
  const dtFormula=prepareFormula(get('resistenciadt'),item.parent,item);
  const dt = dtFormula===null ? null : evaluateArithmetic(dtFormula);
  const failure=get('resistenciafalha');
  const success=get('resistenciasucesso');
  const outcomes=['completo','metade','sem_efeito'];
  if(resistanceActive){
    if(!get('resistenciateste'))errors.push('Informe o nome do teste de resistência.');
    if(dt===null || !Number.isFinite(dt))errors.push('DT deve conter uma fórmula aritmética válida, sem dados.');
    if(!outcomes.includes(failure))errors.push('Configure "Se falhar" como Completo, Metade ou Sem efeito.');
    if(!outcomes.includes(success))errors.push('Configure "Se passar" como Completo, Metade ou Sem efeito.');
  } else if(opposedActive){
    if(!resolvePericiaKey(get('resistenciateste')))errors.push('Teste contestado: escolha uma perícia válida do alvo.');
    if(!resolvePericiaKey(get('resistenciadt')))errors.push('Teste contestado: escolha uma perícia válida do usuário.');
    if(effectType)errors.push('Teste contestado automático em efeitos mecânicos ainda não está disponível. Use uma habilidade sem efeito mecânico para o confronto narrativo.');
  } else if(get('resistenciaativa')==='conjurador'){
    if(!resolvePericiaKey(get('resistenciateste')))errors.push('Teste do conjurador: escolha uma perícia válida.');
    const raw=get('resistenciadt');
    if(raw&&(!/^\d+$/.test(raw)||Number(raw)<1))errors.push('Teste do conjurador: DT precisa ser número positivo ou ficar vazia para decisão do mestre.');
  } else if(get('resistenciaativa') && get('resistenciaativa')!=='nao') errors.push('Configuração de resistência não reconhecida.');
  else if(['resistenciateste','resistenciadt','resistenciafalha','resistenciasucesso'].some(id=>get(id)))errors.push('Há campos de resistência preenchidos, mas "Possui teste de resistência?" não está como Sim.');
  if(get('tipodanomodo')==='escolhido'&&effectType!=='dano'&&!protection)errors.push('Escolha de tipo de dano só pode ser usada em efeitos de Dano.');
  if(get('tipodano')==='outro')errors.push('Tipo de dano Outro ainda precisa da identificação específica; escolha uma opção cadastrada nesta etapa.');
  if(get('filtroaplicacao')==='sim'&&get('atividade')!=='passiva')errors.push('Filtro de aplicação de passivos não pode ser utilizado em um efeito ativo nesta etapa.');

  for(const id of FIELD_IDS){
    if(!ALLOWED_FIELDS.has(id)&&get(id)!==''){
      // O executor externo composto valida o alcance e a quantidade no alvo real.
      // Não gerar um falso erro de campo indisponível na prévia.
      if(receiver!=='proprio'&&id==='alcance'){
        if(!parseDistance(get(id)))errors.push('Alcance inválido: use Corpo a corpo, Toque ou uma distância como 9 m.');
        continue;
      }
      if(receiver!=='proprio'&&id==='qtdalvos'){
        if(!/^[1-9]\d*$/.test(get(id)))errors.push('Quantidade de Alvos precisa ser um inteiro positivo.');
        continue;
      }
      errors.push(`Configuração indisponível nesta execução: ${original.BASE_FIELDS.find(f=>f[0]===id)?.[1]??id}.`);
    }
  }
  if(get('atividade')&&!['passiva','livre','acao','movimento','bonus','completa','reacao'].includes(get('atividade')))errors.push('Tipo de ação não reconhecido.');
  if(get('atividade')==='passiva')errors.push('Esta Skill passiva não pode ser executada diretamente. Configure gatilhos para Alteração de Fluxo ou use os efeitos passivos apropriados.');
  errors.push(...validateAdvanced(item.system.props,i,{activity:get('atividade'),effectType,affected,receiver,cadence,durationKind:duration.kind,external:receiver!=='proprio',actor:item.parent}));
  return {index:i,extraResource:effectType==='recurso'?extraResourceName:null,fixedValue:!dynamicValue && !validDice && ['fixo',''].includes(get('escala')) && (isCondition || (effectType==='recurso'&&op==='maximizar') || /^\d+(?:[.,]\d+)?$/.test(get('valor'))),errors,type:effectType,dynamicValue,damageChoice:get('tipodanomodo')==='escolhido',conditionName,conditionMechanics:innerCondition.mechanics,protection:protection?{natureza:effectType,tipoDano:get('tipodano')||'todos',valor:Number(base??0),modoProtecao:'fixo'}:null,affected,attributeKey:effectType==='teste'?resolveTestKey(get('alvo')):(affected==='outro_max'?'fluxoextramax':ATTR[affected]??null),op,value:base,formulaDetail:resolved.detail,diceFormula:validDice?preparedDice:null,receiver,resistanceActive,dt,failure,success,testName:get('resistenciateste'),duration,cadence};
}
export function diagnose(item){
  return Array.from({length:slotCount(item)},(_,n)=>analyze(item,n+1));
}
// Permite executar habilidades sem efeito mecânico, reaproveitando os campos
// existentes do primeiro slot (ação e custo), sem criar uma seção paralela.
function hasMechanicalEffect(item){
 return Array.from({length:slotCount(item)},(_,i)=>valueFor(item,'tipo',i+1)).some(Boolean);
}
// Teste exclusivo do conjurador, sem token e sem teste do defensor.
// DT vazia mantém a interpretação pelo mestre; DT definida bloqueia a execução
// dos efeitos mecânicos se não for alcançada (sem consumir ação ou custo).
async function rollCasterOnly(item,actor){
 const slots=Array.from({length:slotCount(item)},(_,i)=>i+1).filter(i=>valueFor(item,'resistenciaativa',i)==='conjurador');
 const results=[];
 for(const slot of slots){
  const skill=String(valueFor(item,'resistenciateste',slot)??'').trim();
  const raw=String(valueFor(item,'resistenciadt',slot)??'').trim();
  if(!resolvePericiaKey(skill)){ui.notifications.warn(`Teste do conjurador ${slot}: escolha uma perícia válida.`);return null;}
  if(raw && (!/^\d+$/.test(raw)||Number(raw)<1)){ui.notifications.warn(`Teste do conjurador ${slot}: use uma DT numérica positiva ou deixe vazia.`);return null;}
  const roll=await rollOriginalResistance(actor,skill,null,{silent:true});
  if(!roll)return null;
  const dt=raw?Number(raw):null;
  results.push({slot,skill,total:Number(roll.total),dt,success:dt===null?null:Number(roll.total)>=dt,diceHTML:await roll.roll.render()});
 }
 return results;
}
function casterTestHTML(tests){
 if(!tests?.length)return '';
 return `<section class="mv-caster-result"><h4>Teste do Conjurador</h4>${tests.map(t=>`<div class="mv-caster-result-row"><strong>${esc(t.skill)}</strong><div class="mv-caster-dice">${t.diceHTML??`<b>${t.total}</b>`}</div>${t.dt!==null?`<span>DT ${t.dt} • ${t.success?'Sucesso':'Falha'}</span>`:''}</div>`).join('')}</section>`;
}
async function executeDescriptiveAbility(item,actor){
 const count=slotCount(item);
 const plan=primaryCost(item,count,actor);
 if(plan.errors.length){ui.notifications.warn(plan.errors.join(' '));return false;}
 const usage=usageStatus(actor,item);
 if(!usage.ok){ui.notifications.warn(usage.error??'Usos esgotados.');return false;}
 const extras=optionalCost(item,count,actor);
 if(extras.errors.length){ui.notifications.warn(extras.errors.join(' '));return false;}
 const chosenExtras=await chooseReinforcement(extras,actor);
 if(chosenExtras===null)return false;
 const confirmed=await confirmOriginalUse(item,actor,plan.options,chosenExtras.flatMap(g=>g.chosen.costs));
 if(!confirmed)return false;
 const costs=confirmed.costs??[];
 if(!signedResourceBalance(actor,costs).ok){ui.notifications.warn('Recursos insuficientes.');return false;}
 const casterTests=await rollCasterOnly(item,actor);
 if(casterTests===null)return false;
 if(casterTests.some(test=>test.success===false)){
   await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<section class="mv-ability-descriptive"><h3>${esc(item.name)}</h3>${casterTestHTML(casterTests)}<p>Teste falhou. Efeito não executado; custo e ação preservados.</p></section>`});
   return false;
 }
 const patch={};
 for(const cost of costs){
  const flux=fluxById(actor,cost.resource);
  if(!flux){ui.notifications.warn('Recurso de custo não disponível.');return false;}
  const key=`system.${flux.key}`;
  patch[key]=(patch[key]??Number(actor.system[flux.key]??0))-Number(cost.amount);
 }
 const props=item.system?.props??{};
 // Resistência contestada usa as perícias já existentes na seção 3.
 // Para efeitos narrativos, a vitória é informativa: não inventar cancelamento de magia.
 const opposedSlots=Array.from({length:count},(_,i)=>i+1).filter(i=>valueFor(item,'resistenciaativa',i)==='oposto');
 const opposedConfig=[];
 for(const slot of opposedSlots){
   const own=valueFor(item,'resistenciadt',slot),targetSkill=valueFor(item,'resistenciateste',slot);
   if(!resolvePericiaKey(own)||!resolvePericiaKey(targetSkill)){
     ui.notifications.warn(`Teste contestado ${slot}: escolha duas perícias válidas. Nenhum custo foi cobrado.`);return false;
   }
   opposedConfig.push({slot,own,targetSkill});
 }
 // O card pertence à ficha de origem, mesmo quando não há token na cena.
 // A rolagem do conjurador ocorre uma única vez; o defensor rola ao clicar no card.
 const opposedRolls=[];
 for(const config of opposedConfig){
   const roll=await rollOriginalResistance(actor,config.own);
   if(!roll)return false;
   opposedRolls.push({...config,total:Number(roll.total),rolledMessageId:roll.messageId});
 }
 const description=String(props[item.type==='tecnica'?'descricaotecnica':'descricaoskill']??item.system?.descricao??'');
 const activity=activityOf(item);
 const labels={acao:'Padrão',movimento:'Movimento',bonus:'Bônus',completa:'Completa',reacao:'Reação',livre:'Livre',passiva:'Passiva'};
 const content=`<section class="mv-ability-descriptive"><h3>${esc(item.name)}</h3>${description?`<p style="white-space:pre-wrap">${esc(description)}</p>`:''}${chosenExtras.length?`<p>Reforço opcional escolhido: ${esc(chosenExtras.map(g=>g.title).join(', '))}.</p>`:''}${casterTestHTML(casterTests)}</section>`;
 // O registro da ação acontece no wrapper, apenas após sucesso.
 try{
  if(Object.keys(patch).length)await actor.update(patch);
  if(opposedRolls.length)await createOpposedCard({actor,item,content,rolls:opposedRolls});
  else await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content});
 }catch(error){
  console.error('Multiverso | uso descritivo',error);
  if(Object.keys(patch).length){
   try{const refund={};for(const cost of costs){const f=fluxById(actor,cost.resource);const k=`system.${f.key}`;refund[k]=(refund[k]??Number(actor.system[f.key]??0))+Number(cost.amount);}await actor.update(refund);}
   catch(rollback){console.error('Multiverso | reembolso de uso descritivo falhou',rollback);ui.notifications.error('Falha no chat e no reembolso. Confira os recursos manualmente.');return false;}
  }
  ui.notifications.error('Não foi possível usar a habilidade. Nenhuma ação foi consumida.');return false;
 }
 return true;
}
// Sem alvo T: a conjuração é paga ANTES da publicação no chat.
// A aplicação posterior é só no destinatário e não repete o débito.
async function publishPaidOpenEffect(item,actor){
 const count=slotCount(item);
 const usage=usageStatus(actor,item);
 if(!usage.ok){ui.notifications.warn(usage.error??'Usos esgotados.');return false;}
 const main=primaryCost(item,count,actor),optional=optionalCost(item,count,actor);
 const errors=[...main.errors,...optional.errors];
 if(errors.length){ui.notifications.warn(errors.join(' | '));return false;}
 const chosen=await chooseReinforcement(optional,actor);
 if(chosen===null)return false;
 // Sem reforços de efeitos ainda não aplicados no card aberto.
 if(chosen.some(g=>g.chosen?.effects?.length)){
  ui.notifications.warn('Reforço com efeitos alternativos exige alvo T. Nenhum custo gasto.');return false;
 }
 const confirmed=await confirmOriginalUse(item,actor,main.options,chosen.flatMap(g=>g.chosen.costs));
 if(!confirmed)return false;
 const changes={},before={};
 for(const cost of confirmed.costs){
  const flux=fluxById(actor,cost.resource);
  if(!flux){ui.notifications.warn('Recurso de custo não disponível.');return false;}
  const key=flux.key,old=Number(actor.system[key]);
  if(!Number.isFinite(old)||old<Number(cost.amount)){ui.notifications.warn('Recursos insuficientes.');return false;}
  if(!(key in before))before[key]=old;
  changes[`system.${key}`]=(changes[`system.${key}`]??old)-Number(cost.amount);
 }
 if(Object.values(changes).some(n=>!Number.isFinite(n)||n<0)){
  ui.notifications.warn('Recursos insuficientes.');return false;
 }
 let receipt=null,debited=false;
 try{
  receipt=await takeUsage(actor,item);
  if(!receipt.ok)throw Error('Usos esgotados.');
  if(Object.keys(changes).length){await actor.update(changes);debited=true;}
  const card=await queueOpenEffect({item,source:actor,prepaid:true});
  if(!card)throw Error('O card não foi publicado.');
  return true;
 }catch(err){
  console.error('Multiverso | publicação pós-pagamento',err);
  if(debited)try{await actor.update(Object.fromEntries(Object.entries(before).map(([k,v])=>[`system.${k}`,v])));}catch(e){console.error('Multiverso | falha ao devolver custo',e);ui.notifications.error('Verifique manualmente os recursos; reembolso falhou.');}
  if(receipt?.limited)try{await restoreUsage(actor,receipt);}catch(e){console.error('Multiverso | falha ao devolver uso',e);}
  ui.notifications.error('Habilidade não publicada; confira os recursos.');return false;
 }
}
async function executeNativeEffectInternal(item,onlySlots=null){
  if(!item.parent || item.parent.documentName!=='Actor'){
    ui.notifications.warn('A Skill/Técnica precisa estar na ficha de um personagem.');return false;
  }
  const actor=item.parent;
  if(!actor.isOwner){ui.notifications.warn('Você não tem permissão para alterar esse personagem.');return false;}
  if(!hasMechanicalEffect(item))return executeDescriptiveAbility(item,actor);
  const casterTests=await rollCasterOnly(item,actor);
  if(casterTests===null)return false;
  if(casterTests.some(test=>test.success===false)){
    await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<section class="mv-ability-descriptive"><h3>${esc(item.name)}</h3>${casterTestHTML(casterTests)}<p>Teste falhou. Efeito não executado; custo e ação preservados.</p></section>`});
    ui.notifications.info('Teste do conjurador falhou. Efeito não executado; custo e ação preservados.');return false;
  }
  if(Array.from({length:slotCount(item)},(_,i)=>i+1).some(i=>valueFor(item,'resistenciaativa',i)==='oposto')){
    ui.notifications.warn('Teste contestado automático com efeito mecânico ainda não é suportado. Configure como habilidade narrativa ou use DT fixa. Nenhum recurso gasto.');return false;
  }
  let allEffects=diagnose(item);
  if(Array.isArray(onlySlots))allEffects=allEffects.filter(e=>onlySlots.includes(e.index));
  const hasVariants=alternativeGroups(item,allEffects).length>0;
  try{allEffects=await chooseEffectAlternatives(item,allEffects);}catch(error){ui.notifications.warn(error.message);return false;}
  if(allEffects===null)return false;
  if(allEffects.some(e=>e.receiver!=='proprio')){
    // A rota aberta publica a habilidade para aplicação posterior caso não
    // haja token marcado. O motor composto exige alvo e não entra aqui.
    const cardEligible=canUseExternalCard(allEffects);
    const selected=selectedExternalTokens(actor);
    // Respeita o atalho do card aprovado antes de validar seleções externas.
    // A mesma função pura decide a rota mostrada pelo botão Testar habilidade.
    const route=chooseExternalExecutionRoute(allEffects,{
      cardEligible,hasVariants,selectedCount:selected.length,
      specialOperation:isSpecialResourceOperation,
      setting:(field,index)=>field==='mvSustainCost'?advancedMode(item,index,field):valueFor(item,field,index)
    });
    if(route==='open-effect')return publishPaidOpenEffect(item,actor);
    if(route==='external-card')return executeExternalCard(item,actor,allEffects);
    // Mesmo no executor de um efeito, limite explícito deve impedir seleção excessiva.
    if(!allEffects.some(e=>e.receiver==='area'||valueFor(item,'formarea',e.index)) && !(await validateSelectedTargetLimit(item,allEffects)))return false;
    if(route==='external-advanced')return executeExternalAdvanced(item,actor,allEffects);
    if(route==='external-maintained')return executeExternalMaintained(item,actor,allEffects);
    if(route==='multi-target')return executeMultiTarget(item,actor,allEffects);
    return executeExternalTarget(item,actor,allEffects);
  }
  if(!allEffects.length){ui.notifications.warn('Nenhum efeito configurado.');return false;}
  const costPlan=primaryCost(item,slotCount(item),actor,onlySlots);
  const extraPlan=optionalCost(item,slotCount(item),actor,onlySlots);
  const preliminaryErrors=[...costPlan.errors,...extraPlan.errors];
  if(preliminaryErrors.length){
    await foundry.applications.api.DialogV2.wait({window:{title:'Diagnóstico dos custos'},content:`<h3>Execução bloqueada</h3><ul>${preliminaryErrors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul>`,buttons:[{action:'ok',label:'Entendi',default:true}]});
    return false;
  }
  const chosenExtras=await chooseReinforcement(extraPlan,actor);
  if(chosenExtras===null)return false;
  const activatedSlots=new Set(chosenExtras.flatMap(g=>g.slots));
  const linkedEffects=allEffects.filter(e=>item.system.props?.[`mvOptionalOnly${e.index}`]==='sim');
  if(linkedEffects.length&&!extraPlan.groups.length){ui.notifications.warn('Há efeitos vinculados ao reforço, mas nenhum Custo Opcional foi configurado.');return false;}
  // Reforço pode acrescentar efeitos ou substituir outros efeitos normais.
  // O alvo da substituição é sempre explícito, evitando adivinhações em Skills com muitos efeitos.
  const replacementTargets=new Set();
  const replacementErrors=[];
  if(activatedSlots.size){
    for(const effect of linkedEffects.filter(e=>activatedSlots.has(e.index))){
      const mode=String(item.system.props?.[`mvOptionalMode${effect.index}`]??'somar');
      if(!['somar','substituir'].includes(mode)){
        replacementErrors.push(`Efeito ${effect.index}: modo de reforço desconhecido.`);continue;
      }
      if(mode!=='substituir')continue;
      const raw=String(item.system.props?.[`mvOptionalReplace${effect.index}`]??'');
      const target=Number(raw);
      if(!/^\d+$/.test(raw)||!Number.isInteger(target)||target<1||target>allEffects.length||target===effect.index){
        replacementErrors.push(`Efeito ${effect.index}: selecione um efeito normal válido para substituir.`);continue;
      }
      if(item.system.props?.[`mvOptionalOnly${target}`]==='sim'){
        replacementErrors.push(`Efeito ${effect.index}: não é permitido substituir outro efeito condicionado ao reforço.`);continue;
      }
      if(replacementTargets.has(target)){
        replacementErrors.push(`Efeito ${target}: dois reforços tentam substituir o mesmo efeito.`);continue;
      }
      replacementTargets.add(target);
    }
  }
  let effects=allEffects.filter(e=>(activatedSlots.has(e.index)||item.system.props?.[`mvOptionalOnly${e.index}`]!=='sim')&&!replacementTargets.has(e.index));
  const errors=[...replacementErrors,...effects.flatMap(e=>e.errors.map(error=>`Efeito ${e.index}: ${error}`))];
  if(errors.length){
    const content=`<h3>Esta configuração não pode ser executada</h3><p>Nenhuma alteração foi aplicada.</p><ul>${errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul>`;
    await foundry.applications.api.DialogV2.wait({window:{title:'Diagnóstico dos efeitos'},content,buttons:[{action:'ok',label:'Entendi',default:true}]});
    return false;
  }
  // Condições explícitas: não cobrar custo por Skill cujos efeitos ficaram todos inativos.
  const disabled=[];
  const eligible=[];
  for(const e of effects){
    try{if(predicateCheck(item.system.props,e.index,actor.system))eligible.push(e);
      else disabled.push(e.index);
    }catch(error){ui.notifications.error(`Efeito ${e.index}: ${error.message}`);return false;}
  }
  effects=eligible;
  if(!effects.length){ui.notifications.warn('Nenhum efeito cumpre suas condições de ativação. Nenhum custo cobrado.');return false;}
  const usage=usageStatus(actor,item);
  if(!usage.ok){ui.notifications.warn(usage.error??`${item.name}: usos esgotados (${usage.used}/${usage.config.limit}); recarga: ${usage.config.recharge}.`);return false;}
  let activationChoices;
  try{activationChoices=await askActivationChoices(item,effects);}catch(error){ui.notifications.warn(error.message);return false;}
  if(activationChoices===null)return false;
  for(const e of effects){
    const choice=activationChoices.get(e.index);
    if(!choice)continue;
    if(e.dynamicValue){e.value=activationChoiceValue(choice);e.formulaDetail=`Escolhido ao usar: ${choice.values.join(' + ')}`;}
    if(choice.damageType)e.chosenDamageType=choice.damageType;
  }
  const confirmed=await confirmOriginalUse(item,actor,costPlan.options,chosenExtras.flatMap(g=>g.chosen.costs));
  if(!confirmed)return false;
  const selectedCost=confirmed.selected;
  const costs=confirmed.costs;
  const fluxes=availableFluxes(actor);
  const snapshot=Object.fromEntries(fluxes.map(f=>[f.key,Number(actor.system[f.key]??0)]));
  // Rolagens após a validação de TODOS os efeitos, sem alterar ficha antes do Yes.
  // A mesma API Roll/evaluate é utilizada no motor-efeitos.js original.
  const completedRolls=[];
  const effectRolls=new Map();
  for(const e of effects.filter(e=>e.diceFormula)){
    try{
      const roll=new Roll(e.diceFormula,actor.getRollData?.()??{});
      await roll.evaluate();
      if(!Number.isFinite(Number(roll.total)) || Number(roll.total)<0)throw new Error('Total de dados inválido ou negativo.');
      e.value=Number(roll.total);
      completedRolls.push(roll);effectRolls.set(e.index,roll);
      e.formulaDetail=`${e.diceFormula} (rolagem)`;
    }catch(error){
      ui.notifications.error(`Efeito ${e.index}: não foi possível rolar ${e.diceFormula}. Nenhuma alteração foi aplicada.`);
      console.error('Multiverso RPG: erro ao rolar dados do efeito',error);
      return false;
    }
  }
  // Mecânicas internas com dados: rolar UMA vez ao criar a condição.
  // O delta consolidado é armazenado no Active Effect e será removido ao expirar.
  // Não há novas rolagens a cada turno para condições mantidas.
  for(const e of effects.filter(e=>e.type==='condicao')){
    for(const m of e.conditionMechanics??[]){
      if(!m.diceFormula || m.kind==='damage')continue;
      try {
        const roll=new Roll(m.diceFormula,actor.getRollData?.()??{});
        await roll.evaluate();
        const amount=Number(roll.total);
        if(!Number.isFinite(amount)||amount<0)throw new Error('Total de dados inválido ou negativo.');
        m.delta=amount*m.sign;
        completedRolls.push(roll);
        m.rollDetail=`${m.diceFormula} (rolagem) = ${amount}`;
      }catch(error){
        console.error('Multiverso RPG | erro na rolagem interna de condição',error);
        ui.notifications.error(`Mecânica ${m.name}: falha ao rolar os dados. Nenhum card foi publicado.`);
        return false;
      }
    }
  }
  // A resistência usa resultado MANUAL: a fórmula do teste nativo antigo ainda não está portada.
  // Nunca supor uma rolagem a partir do nome textual do teste.
  const resistances=effects.filter(e=>e.resistanceActive);
  const outcomes=new Map();
  if(resistances.length){
    const inputs=resistances.map(e=>`<div class="mv-manual-resistance-row"><label for="mv-roll-${e.index}"><strong>Efeito ${e.index} — ${esc(e.testName)}</strong> (DT ${e.dt})</label><input id="mv-roll-${e.index}" type="number" step="any" required placeholder="Resultado total do teste"/><small>Digite o resultado TOTAL da resistência, já com modificadores. Valor igual à DT passa.</small></div>`).join('');
    const result=await foundry.applications.api.DialogV2.wait({window:{title:'Resistência — resultado manual'},content:`<p>Informe os resultados de resistência do próprio personagem. Nenhum dado será rolado automaticamente nesta versão.</p><form class="mv-manual-resistance">${inputs}</form>`,buttons:[{action:'cancel',label:'Cancelar'},{action:'confirm',label:'Calcular resultado',default:true,callback:(_event,button,dialog)=>{
      const form=dialog?.element?.querySelector('form') ?? button?.form ?? button?.closest?.('dialog')?.querySelector('form');
      if(!form)return null;
      const values={};
      for(const e of resistances){
        const input=form.querySelector(`#mv-roll-${e.index}`);
        if(!input || !input.value.trim() || !Number.isFinite(Number(input.value)))return null;
        values[e.index]=Number(input.value);
      }
      return values;
    }}],rejectClose:false});
    if(!result || typeof result!=='object'){
      ui.notifications.warn('Teste de resistência cancelado ou resultado inválido. Nada foi aplicado.');
      return false;
    }
    for(const e of resistances){
      const roll=result[e.index];
      if(!Number.isFinite(roll)){ui.notifications.warn('Resultado de resistência inválido.');return false;}
      const passed=roll>=e.dt;
      const resolution=passed?e.success:e.failure;
      outcomes.set(e.index,{roll,passed,resolution,multiplier:resolution==='completo'?1:resolution==='metade'?0.5:0});
    }
  }
  // Compute atomically in memory; one Actor.update after confirmation; no partial item application.
  const before=Object.fromEntries([...fluxes.map(f=>f.key),...fluxes.map(f=>f.max)].map(k=>[k,Number(actor.system[k]??0)]));
  const after={...before};
  // Verificar e descontar TODOS os recursos da alternativa escolhida, antes dos efeitos.
  for(const cost of costs){
    const key=fluxById(actor,cost.resource)?.key;
    if(!key || before[key]<cost.amount){
      ui.notifications.warn(`Recursos insuficientes: requer ${cost.amount} ${cost.resource.toUpperCase()}, disponível ${before[key]??0}. Nenhum efeito foi publicado.`);
      return false;
    }
  }
  for(const cost of costs)after[fluxById(actor,cost.resource).key]-=cost.amount;
  const actuallyExecuted=[];
  const manualDamage=[];
  const chainResult=new Map();
  for(const e of effects){
    const chain=advancedMode(item,e.index,'mvChain');
    const hasPrevious=chainResult.has(e.index-1);
    const beforeEffect=chainResult.get(e.index-1)??false;
    if((chain&&!hasPrevious)||!chainAllows(chain,beforeEffect)){
      disabled.push(e.index);chainResult.set(e.index,false);continue;
    }
    actuallyExecuted.push(e);
    if(e.cadence==='maintained'){chainResult.set(e.index,false);continue;} // ActiveEffect não modifica o atributo base.
    if(e.type==='teste'&&['vantagem','desvantagem'].includes(e.op)){chainResult.set(e.index,true);continue;} // Benefício no próximo teste; nenhum PV alterado.

    // Periódico: primeira aplicação na ativação (turno 1). As demais serão processadas nos próximos turnos do alvo.
    const resource=e.type==='recurso'?(e.extraResource||e.affected):'pv';
    const flux=fluxByName(actor,resource);
    const key=flux?.key;
    if(!key){ui.notifications.warn('Recurso não reconhecido.');return false;}
    const max=Math.max(0,Number(actor.system[flux.max]??0));
    let delta=e.value*(e.op==='subtrair'?-1:1)*(outcomes.get(e.index)?.multiplier??1);
    if(e.type==='cura')delta=Math.abs(delta);
    if(e.type==='dano'){
      const amount=Math.max(0,Math.floor(Math.abs(delta)+conditionDamageBonus(actor,{direction:'caused'})));
      if(amount>0)manualDamage.push(manualDamageEntry({actor,effect:`${item.name} • Efeito ${e.index}`,amount,formula:e.diceFormula||`${e.value} (fixo)`,damageType:e.chosenDamageType||valueFor(item,'tipodano',e.index),roll:effectRolls.get(e.index),index:e.index}));
      chainResult.set(e.index,amount>0&&Number(after[key])>0);
      continue; // Nunca descontar PV por dano antes do botão direito.
    }
    const initial=after[key]??0;
    after[key]=e.type==='recurso' ? applyResourceOperation({current:initial,maximum:max,operation:e.op,value:Math.abs(e.value)*(outcomes.get(e.index)?.multiplier??1)}) : Math.min(max,Math.max(0,initial+delta));
    chainResult.set(e.index,after[key]!==initial);
  }
  let timedEntries=[];
  const instantTestEffects=actuallyExecuted.filter(e=>e.cadence==='once'&&e.type==='teste'&&['vantagem','desvantagem'].includes(e.op)).map(e=>({mode:e.op,scope:e.attributeKey,uses:'once',name:String(item.system.props?.[`mvEffectTitle${e.index}`]??'').trim()||item.name}));
  try {timedEntries=planTrackedEntries({actor,item,effects:actuallyExecuted});}
  catch(error){ui.notifications.warn(error.message);return false;}
  const lines=fluxes.filter(f=>before[f.key]!==after[f.key]).map(f=>`${f.label}: ${before[f.key]} → ${after[f.key]}`);
  const effectLabel=index=>String(item.system.props?.[`mvEffectTitle${index}`]??'').trim()||`Efeito ${index}`;
  const formulaLines=actuallyExecuted.map(e=>{
    const text=e.type==='teste'&&['vantagem','desvantagem'].includes(e.op)?`${e.op==='vantagem'?'Vantagem':'Desvantagem'} no próximo teste de ${valueFor(item,'alvo',e.index)}${e.cadence==='maintained'?' durante a duração':''}`:e.protection?
      `${({resistencia:'Resistência',vulnerabilidade:'Vulnerabilidade',imunidade:'Imunidade'})[e.protection.natureza]||'Proteção'} contra ${e.protection.tipoDano}${e.protection.natureza==='resistencia'?` (reduz ${e.protection.valor} de dano)`:''}`:
      e.type==='condicao'?'Condição: '+e.conditionName+(e.conditionMechanics?.length?' · '+e.conditionMechanics.map(m=>`${m.name} ${m.delta>=0?'+':''}${m.delta}${m.rollDetail?' ('+m.rollDetail+')':''}`).join(' · '):' · apenas marcador narrativo'):
      (e.type==='recurso'&&isSpecialResourceOperation(e.op)?({multiplicar:`Multiplicar Fluxo atual por ${e.value}`,maximizar:'Restaurar Fluxo atual ao máximo',limitar_minimo:`Garantir Fluxo atual mínimo ${e.value}${e.diceFormula?` (rolado: ${e.diceFormula})`:''}`,limitar_maximo:`Limitar Fluxo atual a ${e.value}${e.diceFormula?` (rolado: ${e.diceFormula})`:''}`})[e.op]:(e.formulaDetail??'valor fixo')+' = '+e.value)+(e.chosenDamageType?' · Tipo de dano: '+e.chosenDamageType:'');
    const cadence=e.cadence==='periodic'?' · Periódico: aplica agora e repete no próximo turno do alvo':e.cadence==='maintained'?(e.protection?' · Proteção ativa até expirar':e.type==='condicao'?' · Condição até expirar':' · Bônus contínuo até expirar'):' · Aplicação única';
    return `${effectLabel(e.index)}: ${text}${e.duration?.kind!=='unspecified'?` · Duração: ${e.duration.label}`:''}${cadence}`;
  });
  for(const test of casterTests)formulaLines.unshift(`Teste do Conjurador • ${test.skill}: ${test.total}${test.dt!==null?` / DT ${test.dt} (${test.success?'Sucesso':'Falha'})`:' • Resultado para o mestre decidir'}`);
  for(const index of disabled)formulaLines.push(`Efeito ${index}: não executado por condição/encadeamento.`);
  // Custos são privados e não entram nas linhas do card.
  if(chosenExtras.length){
    for(const target of replacementTargets)formulaLines.push(`Reforço: ${effectLabel(target)} substituído (não executado).`);
    for(const g of chosenExtras){
      formulaLines.push(`Reforço escolhido: ${g.title}`);
      // O custo do reforço fica apenas na confirmação privada.
      if(!g.slots.length)formulaLines.push(`Reforço narrativo: ${g.title}.`);
    }
  } else if(extraPlan.groups.length)formulaLines.push('Reforço opcional não utilizado.');
  const resistanceLines=resistances.map(e=>{const o=outcomes.get(e.index);return `Efeito ${e.index}: ${e.testName} ${o.roll} contra DT ${e.dt} — ${o.passed?'sucesso':'falha'} — ${o.resolution==='completo'?'completo':o.resolution==='metade'?'metade':'sem efeito'}`;});
  // A confirmação sai da janela e passa para um card persistente no chat.
  // A rolagem só é publicada depois que todos os efeitos foram validados.
  try {
    // Uma Skill inteiramente fixa aplicada ao próprio personagem não exige
    // segundo clique: a confirmação privada já autorizou esse efeito.
    // Não alterar o fluxo de rolagens, escolhas, alvos externos ou efeitos mistos.
    const autoApplySelf=actuallyExecuted.length>0 && actuallyExecuted.every(e=>e.receiver==='proprio'&&(e.fixedValue||e.type==='dano'))
      && (completedRolls.length===0||actuallyExecuted.every(e=>e.type==='dano'));
    // A vantagem de uso único é aplicada após a confirmação, sem nova janela obrigatória.
    const card=await createEffectChatCard({actor,item,before,after,formulas:formulaLines,resistances:resistanceLines,rolls:completedRolls,requiredCosts:costs.map(c=>({key:fluxById(actor,c.resource).key,amount:c.amount,atCreation:before[fluxById(actor,c.resource).key],resource:c.resource,label:fluxById(actor,c.resource).label})),timedEntries,instantTestEffects,autoApplySelf,manualDamageEntries:manualDamage});
    if(card&&!autoApplySelf)ui.notifications.info('Rolagem publicada no chat. Use “Aplicar efeito” no card quando necessário.');
    return !!card;
  }catch(error){
    console.error('Multiverso RPG | falha ao criar card do efeito',error);
    ui.notifications.error('Não foi possível publicar o efeito no chat. Nenhum recurso foi alterado.');
    return false;
  }
}

// Uma Skill com vários efeitos consome UMA reação, como no motor antigo.
// A reserva é criada antes da ativação para evitar publicação/efeitos sem a reação paga.
// Se o jogador cancelar a configuração, a confirmação ou ocorrer uma falha, ela volta.
const reactionActivationLocks=new Set();
export async function executeNativeEffectTest(item,{skipAction=false,onlySlots=null}={}){
 if(skipAction)return executeNativeEffectInternal(item,onlySlots); // Gatilho de um item já resolveu a própria economia de ações.
 const actor=item?.parent;
 const isolated=Array.isArray(onlySlots)&&onlySlots.length===1?onlySlots[0]:null;
 const activity=isolated?valueFor(item,'atividade',isolated):activityOf(item);
 if(activity==='incompativel'){
  ui.notifications.warn('Configure uma única ação de execução para os efeitos da mesma Skill/Técnica.');return false;
 }
 if(isActionBlocked(actor,activity)){
  ui.notifications.warn('Uma condição ativa impede esta ação. Encerre a condição ou escolha uma ação permitida.');return false;
 }
 if(activity!=='reacao'){
  if(!activity)return executeNativeEffectInternal(item,onlySlots); // Skills antigas sem classificação
  const attempt=beginAbilityAction(actor,activity);
  if(!attempt.ok){ui.notifications.warn(attempt.reason);return false;}
  let result=false;
  try{
   result=await executeNativeEffectInternal(item,onlySlots);
   return result;
  }finally{
   // O débito acontece APENAS após a ativação bem-sucedida.
   // Cancelar qualquer um dos diálogos não toca na flag do personagem.
   const done=await finishAbilityAction(actor,attempt,{success:result});
   if(result&&!done.ok){
    ui.notifications.error(`O efeito foi executado, mas a ação não foi contabilizada: ${done.reason}`);
    console.error('Multiverso | falha no registro final da ação',done);
   }
  }
 }

 // Fora de combate, preservar o comportamento antigo: não limitar reações.
 const combat=game.combat;
 if(!combat?.started)return executeNativeEffectInternal(item,onlySlots);
 const key=actor?.uuid??actor?.id??'';
 if(!key||reactionActivationLocks.has(key)){
  ui.notifications.warn('Já existe uma ativação de reação em andamento para este personagem.');
  return false;
 }
 if(!actor?.isOwner&&!game.user?.isGM){ui.notifications.warn('Sem permissão para usar a reação desse personagem.');return false;}
 const status=reactionStatus(actor,combat);
 if(!status.ok){
  ui.notifications.warn(status.reason==='not-combatant'?'O personagem precisa participar do combate para usar uma Reação.':`Reações esgotadas até seu próximo turno (${status.current}/${status.max}).`);
  return false;
 }
 reactionActivationLocks.add(key);
 let receipt=null;
 try{
  receipt=await spendReaction(actor,{combat});
  if(!receipt.ok){ui.notifications.warn('Não foi possível reservar a Reação. Nenhum efeito foi ativado.');return false;}
  const result=await executeNativeEffectInternal(item,onlySlots);
  if(!result){
   if(receipt.consumed)await refundReaction(actor,receipt,{combat});
   return false;
  }
  if(receipt.consumed){
    ui.notifications.info(`${actor.name}: Reação utilizada. Restam ${receipt.current}/${receipt.max} até seu próximo turno.`);
    try{await actor.setFlag('multiverso-rpg','reactionSuccessEventV1',{nonce:foundry.utils.randomID(),combatId:combat.id,round:Number(combat.round)});}
    catch(error){console.error('Multiverso | reação concluída; gatilho não foi registrado',error);ui.notifications.warn('Reação utilizada, mas o gatilho passivo não pôde ser registrado.');}
  }
  return result;
 }catch(error){
  if(receipt?.consumed)try{await refundReaction(actor,receipt,{combat});}catch(rollback){console.error('Multiverso | erro ao devolver reação',rollback);}
  throw error;
 }finally{reactionActivationLocks.delete(key);}
}
