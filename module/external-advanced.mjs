import {queueExternalResistance} from './external-resistance-chat.mjs';
import {selectedExternalTokens} from './selected-targets.mjs';
import {changeList,conditionFlags} from "./condition-mechanics.mjs";
// v0.1.95: execução ATÔMICA de efeitos externos compostos em alvos explicitamente selecionados.
// Não presume tokens na cena nem aplica bônus em fichas sem permissão.
import {primaryCost,optionalCost,chooseReinforcement} from './native-effects.mjs';
import {confirmOriginalUse} from './confirmation-original.mjs';
import {usageStatus,takeUsage,restoreUsage} from './skill-uses.mjs';
import {fluxById,fluxByName} from './extra-flux.mjs';
import {planTrackedEntries,readTracked} from './effect-tracking.mjs';
import {buildAttributeActivationPatch,endMaintainedEffect} from './maintained-attributes.mjs';
import {rollOriginalResistance} from './resistance-test.mjs';
import {advancedMode,predicateCheck,chainAllows,sustainCosts,parseSustain} from './advanced-motor.mjs';
import {resolveDamageProtection} from './damage-protection.mjs';
import {manualDamageEntry,renderManualDamageRows,damageFlag} from './damage-cards.mjs';
import {parseArea,parseDistance,worldRadius,tokensInsideArea,placeAreaPreview,confirmAreaTargets} from './area-targeting.mjs';
import {shouldPersistArea,validatePersistentArea,persistentTemplateData,rollInitialAuraDamage} from './persistent-areas.mjs';
import {planPriority} from './effect-priority.mjs';
import {applyResourceOperation,isSpecialResourceOperation} from './special-math.mjs';
const NS='multiverso-rpg';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const busy=new Set();
export function renderSustainCard(source,events){
 const line=e=>`<div class="mv-sustain-entry"><div class="mv-sustain-entry-head"><strong>${esc(e.name)}</strong><span class="mv-sustain-tag ${e.type==='paid'?'mv-sustain-paid':'mv-sustain-ended'}">${e.type==='paid'?'MANTIDO':'ENCERRADO'}</span></div><div class="mv-sustain-detail">${e.type==='paid'?`Custo de continuidade: <b>${esc(e.cost)}</b>`:`${esc(e.reason)} • Nenhuma nova cobrança`}</div><small>${Number(e.targets)} efeito(s) externo(s) vinculado(s)</small></div>`;
 return `<section class="mv-chat-effect mv-sustain-card"><div class="mv-chat-effect-header"><strong>✦ Sustentação externa</strong><small>${esc(source.name)} • Início do turno do conjurador</small></div><div class="mv-chat-effect-body">${events.map(line).join('')}</div></section>`;
}

// Campos suportados NESTA rota: eligibleTargets() confere quantidades,
// alcance e formato antes de qualquer cobrança ou mudança de ficha.
// O analisador nativo mais antigo ainda os marca como não migrados.
export const allowedExternalAdvancedErrors=new Set([
 'Configuração indisponível nesta execução: Quantidade de Alvos.',
 'Configuração indisponível nesta execução: Alcance.',
 'Configuração indisponível nesta execução: Formato e Tamanho da Área.',
 'O receptor selecionado não é compatível com esta execução.',
 'Esta resistência não é compatível com bônus contínuos.',
 'Esta resistência não é compatível com aplicações periódicas.',
 'Este encadeamento de efeitos externos não é compatível com a configuração selecionada.',
 'Custo de sustentação exige efeito mantido no próprio personagem, com duração em turnos ou rodadas.',
 'Encadeamento aceita apenas efeitos de aplicação única nesta etapa.'
]);
const attrTypes=new Set(['recurso','atributo','bonus','penalidade','deslocamento','defesa','teste','condicao','resistencia','vulnerabilidade','imunidade']);
const resTypes=new Set(['recurso','dano','cura']);
const numeric=x=>Number.isFinite(Number(x))?Number(x):NaN;
const suffix=i=>i===1?'':i;
function setting(item,field,i){return String(item.system?.props?.[`efeito${item.type}${field}${suffix(i)}`]??'').trim();}
const dispositionMode=(item,effects)=>{
 const choices=new Set(effects.map(e=>String(item.system?.props?.[`mvAreaTargetMode${e.index}`]??'all')).filter(v=>v!=='all'));
 return choices.size===1?[...choices][0]:choices.size===0?'all':null;
};
const matchingDisposition=(token,mode)=>mode==='all'||Number(token?.document?.disposition??token?.disposition) === (mode==='friendly'?1:-1);
const includesCaster=(item,effects)=>!effects.some(e=>String(item.system?.props?.[`mvAreaIncludeCaster${e.index}`]??'yes')==='no');
function uniqueTargets(source){return [...new Map(selectedExternalTokens(source).map(t=>[t.actor?.uuid??t.id,t])).values()];}
async function eligibleTargets(item,source,effects,forcedTargets=null){
 let marked=forcedTargets??uniqueTargets(source),problems=[];
 const areaTexts=effects.map(e=>setting(item,'formarea',e.index)).filter(Boolean);
 const wantArea=effects.some(e=>e.receiver==='area')||areaTexts.length>0;
 const targetMode=dispositionMode(item,effects);if(targetMode===null)problems.push('Todos os efeitos de uma mesma área devem usar o mesmo filtro de aliados/inimigos.');
 const ranges=effects.map(e=>setting(item,'alcance',e.index)).filter(Boolean);
 const parsedRanges=ranges.map(parseDistance);
 if(parsedRanges.some(x=>!x))problems.push('Alcance inválido: informe 9 m ou 30 ft.');
 const shapes=areaTexts.map(parseArea);
 if(shapes.some(x=>!x))problems.push('Formato inválido: use Círculo 6 m, Cone 6 m ou Linha 6 m x 2 m.');
 if(wantArea&&!areaTexts.length)problems.push('Selecione Formato e Tamanho da Área (ex.: Círculo 6 m).');
 if(wantArea&&new Set(areaTexts.map(x=>x.toLowerCase().replace(/\s+/g,' '))).size>1)problems.push('Uma mesma ativação precisa usar uma única geometria de área.');
 if(parsedRanges.length>1&&new Set(ranges).size>1)problems.push('Configure apenas um alcance para posicionar a área.');
 if(problems.length)return {actors:[],problems};
 if(wantArea){
  const definition=shapes[0];
  // A prévia antecede a confirmação e qualquer consumo.
  const placed=await placeAreaPreview(definition,{source,range:parsedRanges[0]??null});
  if(!placed)return {actors:[],problems:[],cancelled:true};
  if(placed.sceneId!==canvas.scene?.id)return {actors:[],problems:['A cena mudou durante o posicionamento.']};
  marked=tokensInsideArea(canvas.tokens?.placeables??[],placed,source.uuid,!!game.user?.isGM,source.id,includesCaster(item,effects));
  marked=marked.filter(token=>token.actor?.id===source.id?includesCaster(item,effects):matchingDisposition(token,targetMode));
  if(!marked.length&&!shouldPersistArea(effects))return {actors:[],problems:['A área posicionada não contém alvos válidos. Nada foi gasto.']};
  if(!(await confirmAreaTargets(marked,{label:areaTexts[0]})))return {actors:[],problems:[],cancelled:true};
  var placedArea=placed;
 }else if(!marked.length)problems.push('Marque o alvo com T ou configure uma área circular na Seção 5.');
 if(marked.length>25)problems.push('Esta execução aceita até 25 alvos de uma vez.');
 const caps=effects.map(e=>setting(item,'qtdalvos',e.index)).filter(Boolean);
 if(caps.some(x=>!/^[1-9]\d*$/.test(x)))problems.push('Quantidade de Alvos precisa ser um número inteiro positivo.');
 const limit=caps.length?Math.min(...caps.map(Number)):null;
 if(limit&&marked.length>limit)problems.push(`A área/seleção contém ${marked.length} alvos, acima do limite ${limit}. Reposicione a área ou altere o cadastro.`);
 const actors=[];
 const origin=(canvas?.tokens?.controlled??[]).find(t=>t.actor?.uuid===source.uuid)||(canvas?.tokens?.placeables??[]).find(t=>t.actor?.uuid===source.uuid);
 if(ranges.length&&!origin)problems.push('Coloque um token do conjurador na cena para conferir o alcance.');
 for(const token of marked){
  const actor=token.actor;
  if(!actor||actor.documentName!=='Actor'){problems.push('Token sem personagem válido.');continue;}
  if(token.document?.parent?.id!==canvas?.scene?.id)problems.push(`${actor.name}: token em outra cena.`);
  if(!actor.isOwner)problems.push(`Sem permissão de editar ${actor.name}. Peça ao mestre que ative a Skill.`);
  // O conjurador pode ser atingido por auras quando a opção estiver ativa.
  if(!wantArea&&ranges.length&&origin){
   const a=origin.center??{x:origin.x+origin.w/2,y:origin.y+origin.h/2};
   const b=token.center??{x:token.x+token.w/2,y:token.y+token.h/2};
   for(const def of parsedRanges){if(def&&Math.hypot(a.x-b.x,a.y-b.y)>worldRadius(def,canvas.scene)+.001)problems.push(`${actor.name} fora do alcance de ${ranges[0]}.`);}
  }
  actors.push({actor,token});
 }
 return {actors,problems,area:placedArea??null};
}
async function warn(errors){await foundry.applications.api.DialogV2.wait({window:{title:'Multiverso • Verificar Skill'},content:`<section class="mv-chat-effect"><div class="mv-chat-effect-header"><strong>Configuração incompleta</strong></div><div class="mv-chat-effect-body"><ul>${errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul><small>Nenhum uso ou recurso foi gasto.</small></div></section>`,buttons:[{action:'ok',label:'Entendi',default:true}]});return false;}
function normalizeAfter(outcome,amount){return outcome==='sem_efeito'?0:outcome==='metade'?Math.floor(amount/2):amount;}
function markerData(entries){return entries.filter(x=>x.maintainedEffect).map(entry=>{
 const data=entry.maintainedEffect;
 if(data.protection)return {name:`Proteção: ${entry.name} (${entry.source})`,disabled:false,changes:[],flags:{[NS]:{trackingId:entry.id,sourceUuid:entry.sourceUuid,protecaoDano:{...data.protection}}}};
 if(data.condition)return {name:data.name||entry.name,disabled:false,changes:changeList(data.mechanics??[]),flags:{[NS]:{trackingId:entry.id,sourceUuid:entry.sourceUuid,isCondition:true,...conditionFlags(data.mechanics??[]),blocksAction:(data.mechanics??[]).some(x=>x.blocksAction),blockedActionTypes:(data.mechanics??[]).filter(x=>x.blocksAction).flatMap(x=>x.blockedActionTypes??['todas'])}}};
 return {name:`${entry.name} (${entry.source})`,disabled:false,changes:[],flags:{[NS]:{trackingId:entry.id,sourceUuid:entry.sourceUuid,storedAttributeDelta:{key:data.attributeKey,delta:data.delta}}}};
});}
function groupCosts(accepted,source){const costMap=new Map();for(const c of accepted.costs){const f=fluxById(source,c.resource);if(!f)throw Error(`Recurso ${c.resource} não existe ou está inativo.`);costMap.set(f.key,(costMap.get(f.key)??0)+Number(c.amount));}const original=Object.fromEntries([...costMap.keys()].map(k=>[k,Number(source.system[k])]));if([...costMap].some(([k,v])=>!Number.isSafeInteger(v)||v<0||!Number.isFinite(original[k])||original[k]<v))throw Error('Recursos insuficientes; nada foi descontado.');return {costMap,original};}
export async function executeExternalAdvanced(item,source,allEffects,options={}){
 if(busy.has(source.uuid))return warn(['Outra execução deste personagem está em andamento.']);
 busy.add(source.uuid);
 try{
  const props=item.system?.props??{};
  const costSpan=Math.max(allEffects.length,Number(item.system?.props?.mvEffectCount||0),...allEffects.map(e=>e.index));
  const costPlan=primaryCost(item,costSpan,source),optPlan=optionalCost(item,costSpan,source);
  if([...costPlan.errors,...optPlan.errors].length)return warn([...costPlan.errors,...optPlan.errors]);
  const extras=options.prepaid?[]:await chooseReinforcement(optPlan,source);if(extras===null)return false;
  const enabled=new Set(extras.flatMap(x=>x.slots)),replaced=new Set();
  for(const e of allEffects.filter(x=>enabled.has(x.index)&&props[`mvOptionalOnly${x.index}`]==='sim')){
   if(String(props[`mvOptionalMode${e.index}`]??'somar')==='substituir')replaced.add(Number(props[`mvOptionalReplace${e.index}`]));
  }
  const effects=allEffects.filter(e=>(props[`mvOptionalOnly${e.index}`]!=='sim'||enabled.has(e.index))&&!replaced.has(e.index));
  const hasOwn=effects.some(e=>e.receiver==='proprio');
  const hasExternal=effects.some(e=>e.receiver!=='proprio');
  const mixed=hasOwn&&hasExternal;
  // Não combinar receptores com área/sustentação no mesmo pacote antes de
  // existir uma transação adequada para a movimentação contínua da aura.
  const {actors,problems,cancelled,area}=await eligibleTargets(item,source,effects.filter(e=>e.receiver!=='proprio'),options.targetTokens??null);
  if(mixed){
   // Efeitos próprios + área compartilham custo/uso, mas o próprio personagem
   // não entra na lista de tokens atingidos pela aura.
   if(effects.some(e=>advancedMode(item,e.index,'mvSustainCost')&&e.receiver==='proprio'))problems.push('Sustentação própria misturada com aura não é suportada. Configure a sustentação na área.');
   if(area&&effects.some(e=>e.receiver!=='proprio'&&e.receiver!=='area'))problems.push('Mistura com área exige receptor Alvos na área nos efeitos externos.');
  }
  const crossChains=effects.filter(e=>{
   const prev=effects.find(x=>x.index===e.index-1);
   return prev&&advancedMode(item,e.index,'mvChain')&&(prev.receiver==='proprio')!==(e.receiver==='proprio');
  });
  const crossDirections=new Set(crossChains.map(e=>effects.find(x=>x.index===e.index-1).receiver==='proprio'?'own-to-external':'external-to-own'));
  if(crossDirections.size>1)problems.push('Encadeamentos mistos em direções alternadas exigem separar a Skill em duas ativações.');
  if(crossChains.some(e=>effects.find(x=>x.index===e.index-1).receiver!=='proprio')&&actors.length!==1)problems.push('Encadeamento de alvo externo para conjurador exige um único alvo, para não haver resultado ambíguo.');
  if(crossChains.some(e=>effects.find(x=>x.index===e.index-1).receiver==='proprio'&&effects.find(x=>x.index===e.index-1).type==='dano'))problems.push('Encadeamento de dano manual no conjurador para outro alvo não é suportado.');
  if(hasOwn&&!hasExternal)problems.push('A seleção opcional deixou somente efeitos próprios; execute esta configuração numa Skill própria.');
  if(cancelled)return false;
  if(!effects.length)problems.push('Nenhum efeito escolhido.');
  const areaEffects=effects.filter(e=>e.receiver!=='proprio');
  const persist=!!area&&shouldPersistArea(areaEffects);
  if(persist){const error=validatePersistentArea(areaEffects,source);if(error)problems.push(error);
   if(crossChains.length)problems.push('Encadeamentos com áreas persistentes exigem regras por entrada; use Skill de alvo escolhido para encadear receptores.');
   if(effects.some(e=>e.receiver==='proprio'&&e.cadence==='periodic'))problems.push('Repetição periódica própria em Skill com aura deve ser criada separadamente.');
   if(effects.some(e=>e.receiver==='proprio'&&e.cadence==='maintained'&&(e.duration?.kind!==areaEffects[0]?.duration?.kind||e.duration?.amount!==areaEffects[0]?.duration?.amount)))problems.push('Efeito próprio mantido e aura devem ter a mesma duração.');
   if(areaEffects.some(e=>advancedMode(item,e.index,'mvChain')))problems.push('Encadeamento por entrada em aura ainda precisa de uma regra por alvo.');
   // Cura e Fluxo periódicos usam o mesmo relógio de entrada/turno da aura.
   if(areaEffects.some(e=>['maior','nao','substituir','especial'].includes(setting(item,'acumulo',e.index))))problems.push('Esta prioridade não é compatível com a aura configurada. Escolha Acumula.');
  }
  for(const e of effects){
   if(e.type==='recurso'&&['outro','outro_max'].includes(e.affected)&&actors.some(x=>fluxByName(x.actor,e.extraResource)?.id!=='extra'))problems.push(`Efeito ${e.index}: o Fluxo Extra exige o mesmo recurso ativo nos alvos.`);
   const errors=(e.errors??[]).filter(s=>!allowedExternalAdvancedErrors.has(s));problems.push(...errors.map(s=>`Efeito ${e.index}: ${s}`));
   if(!['alvo','aliado','inimigo','area',...(mixed?['proprio']:[])].includes(e.receiver))problems.push(`Efeito ${e.index}: receptor incompatível.`);
   if(e.cadence==='maintained'&&(!attrTypes.has(e.type)||(e.type==='recurso'&&!['pv_max','pm_max','sta_max','san_max','outro_max'].includes(e.affected))))problems.push(`Efeito ${e.index}: apenas atributos e condições podem ser mantidos.`);
   if(e.cadence==='periodic'&&!resTypes.has(e.type))problems.push(`Efeito ${e.index}: repetição aceita Dano, Cura ou Alteração de fluxo.`);
   if(e.cadence==='once'&&!resTypes.has(e.type))problems.push(`Efeito ${e.index}: somente Dano, Cura e Alteração de fluxo são imediatos.`);
   if(e.cadence==='once'&&['turns','rounds'].includes(e.duration?.kind))problems.push(`Efeito ${e.index}: para repetir dano/cura durante ${e.duration.label}, escolha Repetir na Seção 5; ou deixe a duração vazia para aplicar apenas uma vez.`);
   if(e.cadence==='maintained'&&!['turns','rounds','scene','sustained'].includes(e.duration?.kind))problems.push(`Efeito ${e.index}: duração mantida precisa ser em turnos, rodadas ou cena.`);
   if(e.cadence==='periodic'&&!['turns','rounds','sustained'].includes(e.duration?.kind))problems.push(`Efeito ${e.index}: repetição periódica precisa ser em turnos ou rodadas.`);
   if(e.dynamicValue)problems.push(`Efeito ${e.index}: escolha dinâmica neste executor ainda não é suportada.`);
   if(e.cadence==='maintained'&&e.diceFormula)problems.push(`Efeito ${e.index}: mantenha um valor fixo para atributos.`);
   if(e.type==='condicao'&&e.resistanceActive&&(e.success==='metade'||e.failure==='metade'))problems.push(`Efeito ${e.index}: metade de uma Condição não é definida; escolha Efeito completo ou Sem efeito.`);
   if(e.cadence!=='maintained'&&!e.diceFormula&&!Number.isFinite(e.value))problems.push(`Efeito ${e.index}: valor/fórmula inválidos.`);
   // Fluxo Extra atual utiliza o mesmo motor de alteração dos demais recursos, validado acima.
   if(advancedMode(item,e.index,'mvTrigger'))problems.push(`Efeito ${e.index}: gatilho automático externo não é suportado nesta execução.`);
   if(advancedMode(item,e.index,'mvSustainCost')&&e.cadence!=='maintained'&&!(persist&&e.cadence==='periodic'))problems.push(`Efeito ${e.index}: sustentação exige bônus/condição mantido.`);
   const chain=advancedMode(item,e.index,'mvChain');if(chain&&!['previous_effective','previous_failed'].includes(chain))problems.push(`Efeito ${e.index}: encadeamento inválido.`);
   if(chain){
    const previous=effects.find(x=>x.index===e.index-1);
    if(!previous)problems.push(`Efeito ${e.index}: o efeito anterior precisa participar desta ativação.`);
    // Dano fica pendente no chat; o resultado só existe quando o jogador
    // aplica o valor pelo botão direito. Não antecipar gatilhos sobre ele.
    if(previous?.type==='dano'&&chain==='previous_failed')problems.push(`Efeito ${e.index}: «anterior não alterou nada» ainda não é verificável antes da aplicação manual de dano.`);
    if(previous?.type==='dano'&&chain==='previous_effective'&&e.cadence!=='maintained')problems.push(`Efeito ${e.index}: dependência de dano manual exige bônus, penalidade ou condição mantida.`);
   }
  }
  if(problems.length)return warn([...new Set(problems)]);
  const usage=usageStatus(source,item);if(!usage.ok)return warn([usage.error??'Usos esgotados.']);
  // Resistência de alvo único é pedida no chat ANTES de aplicar efeitos ou custos.
  // Na volta, a resposta assinada entrega o resultado ao mesmo executor.
  if(!options.prepaid && !options.resistanceTotals && !persist && !mixed && actors.length===1 && effects.some(e=>e.resistanceActive)){
    try{return !!(await queueExternalResistance({item,source,target:actors[0],effects}));}
    catch(err){return warn([err.message]);}
  }

  const confirmed=options.prepaid?{costs:[]}:await confirmOriginalUse(item,source,costPlan.options,extras.flatMap(g=>g.chosen.costs));if(!confirmed)return false;
  let costs;try{costs=groupCosts(confirmed,source);}catch(err){return warn([err.message]);}
  // Calcular cada resultado ANTES de consumir recursos. Resistência por alvo,
  // usando a rolagem nativa do teste com marcas, vantagens e passivos.
  const plans=[];
  // Primeiro preparar os alvos externos; o conjurador é processado por último.
  // Isso permite reverter os efeitos externos se falhar a escrita na ficha dele.
  const ownFirst=crossDirections.has('own-to-external');
  const recipients=mixed?(ownFirst?[{actor:source,token:null},...actors]:[...actors,{actor:source,token:null}]):actors;
  const sharedResults=new Map(),sharedManual=new Map();
  for(const {actor} of recipients){
   const ownRecipient=mixed&&actor.uuid===source.uuid;
   const applicable=effects.filter(e=>ownRecipient?e.receiver==='proprio':e.receiver!=='proprio');
   const steps=[],effective=new Map(),tests=new Map(),resources={},rolled=[],detail=[],manual=[];
   // Custo e recuperação do mesmo PM/PV devem formar UM valor final.
   // No caso misto a ficha do conjurador paga o custo junto de seu próprio efeito,
   // dentro da mesma transação, em vez de receber dois updates conflitantes.
   if(ownRecipient)for(const [key,amount] of costs.costMap)resources[key]=Number(costs.original[key])-amount;
   for(const e of applicable){
    const chain=advancedMode(item,e.index,'mvChain');
    if(chain && !effective.has(e.index-1) && sharedResults.has(e.index-1))effective.set(e.index-1,sharedResults.get(e.index-1));
    if(chain && !effective.has(e.index-1))return warn([`Efeito ${e.index}: o efeito anterior não foi avaliado no receptor correspondente.`]);
    if(chain&&!chainAllows(chain,effective.get(e.index-1))){effective.set(e.index,false);sharedResults.set(e.index,false);detail.push(`${e.index}: encadeamento não atendido`);continue;}
    let outcome='completo',saveTotal=null;
    if(e.resistanceActive){
     const testKey=`${e.testName}|${e.dt}`;
     if(!tests.has(testKey)){
      if(options.resistanceTotals && Object.hasOwn(options.resistanceTotals,testKey)){
       tests.set(testKey,Number(options.resistanceTotals[testKey]));
      }else{
      const result=await rollOriginalResistance(actor,e.testName);
      if(!result)return false;
      tests.set(testKey,Number(result.total));
      }
     }
     saveTotal=tests.get(testKey);
     outcome=saveTotal>=e.dt?e.success:e.failure;
    }
    if(outcome==='sem_efeito'){
      effective.set(e.index,false);sharedResults.set(e.index,false);detail.push(`${e.index}: resistência anulou`);continue;
    }
    let value=Number(e.value??0),changed=false;
    if(e.diceFormula&&!persist){
      try{const roll=new Roll(e.diceFormula,actor.getRollData?.()??{});await roll.evaluate();value=Number(roll.total);rolled.push(roll);}
      catch(error){return warn([`Não foi possível rolar o efeito ${e.index} em ${actor.name}: ${error.message}`]);}
    }
    if(!Number.isFinite(value)||value<0)return warn([`Efeito ${e.index}: valor inválido em ${actor.name}.`]);
    value=normalizeAfter(outcome,value);
    let effectiveDelta=value;
    if(e.cadence==='maintained')changed=e.type==='condicao'||!!e.protection||value!==0;
    else {
     if(persist&&e.cadence==='periodic'){effective.set(e.index,false);detail.push(`${e.index}: aplicação periódica gerenciada pela aura`);continue;}
     const resource=fluxByName(actor,e.type==='recurso'?(e.extraResource||e.affected):'pv');
     if(!resource)return warn([`${actor.name}: Fluxo não encontrado no efeito ${e.index}.`]);
     if(e.type==='dano'){
      if(persist){changed=false;effective.set(e.index,false);detail.push(`${e.index}: dano gerenciado pelo relógio da aura`);continue;}
      const damageType=String(e.chosenDamageType||setting(item,'tipodano',e.index));
      // Checagem preventiva serve apenas ao encadeamento; proteções são
      // RECALCULADAS na janela do botão direito, nunca abatidas aqui.
      const protection=resolveDamageProtection(actor,value,damageType);
      if(protection.blocked)return warn([`${actor.name}: proteção de dano especial ainda não é compatível com este efeito.`]);
      changed=Number(protection.final)>0&&Number(resources[resource.key]??actor.system[resource.key])>0;
      if(value>0){
       const match=e.diceFormula?rolled[rolled.length-1]:null;
       const entry=manualDamageEntry({actor,effect:`${item.name} • Efeito ${e.index}`,amount:value,formula:e.diceFormula||`${e.value} (fixo)`,damageType,roll:match,source:item.name,index:e.index});
       manual.push(entry);sharedManual.set(e.index,entry);
      }
      detail.push(`${e.index}: dano ${value} pendente de aplicação manual`);
     }else{
      effectiveDelta=value*(e.type==='recurso'&&e.op==='subtrair'?-1:1);
      const before=Number(resources[resource.key]??actor.system[resource.key]);
      const maximum=Number(actor.system[resource.max]);
      if(!Number.isFinite(before)||!Number.isFinite(maximum))return warn([`Recurso ${resource.label} inválido em ${actor.name}.`]);
      const after=e.type==='recurso'?applyResourceOperation({current:before,maximum,operation:e.op,value}):Math.min(maximum,Math.max(0,before+effectiveDelta));
      resources[resource.key]=after;
      changed=after!==before;
      detail.push(`${e.index}: ${e.type} ${before} → ${after}`);
     }
    }
    effective.set(e.index,changed);
    sharedResults.set(e.index,changed);
    if(!changed){if(e.cadence==='maintained')detail.push(`${e.index}: nenhum bônus efetivo`);continue;}
    // Uma condição que DEPENDE de dano só começa depois que esse dano
    // for efetivamente aplicado via botão direito (não na ativação).
    const previous=effects.find(prev=>prev.index===e.index-1);
    const isManualDependency=chain==='previous_effective' && previous?.type==='dano';
    const manualSource=isManualDependency?(manual.find(d=>d.effectIndex===previous.index)??sharedManual.get(previous.index)):null;
    if(isManualDependency&&(!manualSource||e.cadence!=='maintained'))return warn([`Efeito ${e.index}: para depender de dano aplicado manualmente, configure um bônus/condição mantido.`]);
    const clone={...e,value:e.cadence==='maintained'?value:Number(e.value??0),resistanceActive:false};
    steps.push({effect:clone,resolution:outcome,resistance:saveTotal,initialValue:value,deferUntilManual:manualSource?.id??null});
    if(manualSource){manualSource.deferred=[...(manualSource.deferred??[]),clone];if(ownRecipient)manualSource.deferredTargetUuid=source.uuid;}
    if(e.cadence==='maintained')detail.push(`${e.index}: ${e.conditionName||e.type} mantido`);
   }
   plans.push({actor,steps,resources,rolled,detail,manual});
  }
  if(ownFirst)plans.sort((a,b)=>(a.actor.uuid===source.uuid?1:0)-(b.actor.uuid===source.uuid?1:0));
  // Fonte única para cobrança de sustentação: mesmo custo, mesmo turno, vários alvos.
  const sustainInputs=effects.map(e=>advancedMode(item,e.index,'mvSustainCost')).filter(Boolean);
  if(new Set(sustainInputs).size>1)return warn(['Configure um único custo de sustentação compartilhado entre os efeitos externos.']);
  const sharedSustain=sustainInputs.length?parseSustain(sustainInputs[0],source):null;
  if(sustainInputs.length&&!sharedSustain)return warn(['Custo de sustentação inválido.']);
  if(persist&&areaEffects.some(e=>e.duration.kind==='sustained')&&!sharedSustain)return warn(['Área sustentada precisa de custo por turno (ex.: 1 PM) configurado na seção 6.']);
  if(sharedSustain){
   const durations=new Set(effects.filter(e=>e.cadence==='maintained').map(e=>`${e.duration.kind}:${e.duration.amount}`));
   if(durations.size>1)return warn(['Sustentação externa compartilhada exige a mesma duração para os efeitos mantidos desta ativação. Durações independentes sem sustentação continuam permitidas.']);
  }
  if(sharedSustain&&game.combat?.started&&!game.combat.combatants?.find(c=>c.actor?.id===source.id))return warn(['Se houver combate, inclua o conjurador na iniciativa.']);
  if(sharedSustain&&!game.combat?.started&&!persist)return warn(['Sustentação fora do combate requer área persistente.']);
  const snapshots=[];
  try{
   for(const plan of plans){
    const {actor,steps}=plan;
    const oldTracked=readTracked(actor);
    const priority=planPriority({oldTracked,steps,getMode:e=>setting(item,'acumulo',e.index)||'acumula'});
    const timed=priority.included.filter(s=>!s.deferUntilManual&&s.effect.cadence!=='once'&&(!persist||s.effect.cadence==='maintained')).map(s=>s.effect);
    const entries=planTrackedEntries({actor,item,effects:timed,externalSustainOwner:sharedSustain?source.uuid:null});
    for(const en of entries)if(sharedSustain&&en.maintainedEffect){en.externalOwner=source.uuid;en.externalSourceCast=null;}
    const resourcePatch=plan.resources,rolled=plan.rolled,detail=plan.detail;
    const beforeResources=Object.fromEntries(Object.keys(resourcePatch).map(k=>[k,Number(actor.system[k])]));
    const replaced=priority.removals.map(entry=>{
     const marker=[...(actor.effects??[])].find(x=>x.getFlag(NS,'trackingId')===entry.id);
     if(!marker)throw Error(`${actor.name}: marcador anterior não localizado; substituição cancelada.`);
     return {entry,marker:marker.toObject()};
    });
    const changedAttrs=new Set([...entries.filter(e=>e.maintainedEffect?.storedOnSheet).map(e=>e.maintainedEffect.attributeKey),...replaced.filter(x=>x.entry.maintainedEffect?.storedOnSheet).map(x=>x.entry.maintainedEffect.attributeKey)]);
    const beforeAttrs=Object.fromEntries([...changedAttrs].map(k=>[`system.${k}`,Number(actor.system[k])]));
    if(priority.skips.length)detail.push(`Prioridade: efeitos ${priority.skips.join(', ')} não superaram o bônus já ativo`);
    snapshots.push({actor,entries,resourcePatch,oldTracked,beforeAttrs,beforeResources,replaced,removed:[],rolled,detail,created:[],attrsSaved:false,resourcesSaved:false,trackedSaved:false});
   }
  }catch(err){return warn([err.message]);}
  let usageTaken=null,costSaved=false,linkSaved=false,createdTemplate=null,casterAuraMarker=null,casterAuraTracking=false;
  const oldCasterTracked=readTracked(source);
  const oldSourceLink=Array.isArray(source.getFlag(NS,'externalSustains'))?source.getFlag(NS,'externalSustains'):[];
  const castId=foundry.utils.randomID();
  try{
   // Consumo uma vez por Skill, independentemente do número de efeitos/alvos.
   if(!options.prepaid){usageTaken=await takeUsage(source,item);if(!usageTaken.ok)throw Error('Usos esgotados.');}
   if(!mixed&&costs.costMap.size){await source.update(Object.fromEntries([...costs.costMap].map(([k,v])=>[`system.${k}`,costs.original[k]-v])));costSaved=true;}
   for(const snapshot of snapshots){
    const {actor,entries,resourcePatch}=snapshot;
    for(const previous of snapshot.replaced){await endMaintainedEffect(actor,previous.entry);snapshot.removed.push(previous);}
    for(const entry of entries){if(sharedSustain&&entry.maintainedEffect)entry.externalSourceCast=castId;if(persist)entry.areaOwner=castId;}
    const markers=markerData(entries);
    for(const marker of markers){const newEffects=await actor.createEmbeddedDocuments('ActiveEffect',[marker]);snapshot.created.push(...newEffects);}
    const patch=buildAttributeActivationPatch(actor,entries).patch;
    if(Object.keys(patch).length){await actor.update(patch);snapshot.attrsSaved=true;}
    if(Object.keys(resourcePatch).length){await actor.update(Object.fromEntries(Object.entries(resourcePatch).map(([k,v])=>[`system.${k}`,v])));snapshot.resourcesSaved=true;}
    if(entries.length||snapshot.removed.length){const ids=new Set(snapshot.removed.map(x=>x.entry.id));await actor.setFlag(NS,'trackedDurations',[...snapshot.oldTracked.filter(x=>!ids.has(x.id)),...entries]);snapshot.trackedSaved=true;}
   }
   if(persist){
    const scene=canvas?.scene;if(!scene||area.sceneId!==scene.id)throw Error('A cena mudou durante a ativação da área persistente.');
    const createdLinks=snapshots.map(s=>({actorUuid:s.actor.uuid,tokenId:actors.find(x=>x.actor.uuid===s.actor.uuid)?.token?.id??null,ids:s.entries.map(e=>e.id)})).filter(l=>l.ids.length);
    const data=persistentTemplateData({area,scene,item,source,castId,effects:areaEffects,initialTargets:actors.map(x=>x.token),createdLinks,sharedSustain});
    const templates=await scene.createEmbeddedDocuments('MeasuredTemplate',[data]);createdTemplate=templates[0];
    if(!createdTemplate)throw Error('Não foi possível criar o desenho persistente na cena.');
    // The conjuror owns the AREA timer and can end it early from their sheet.
    // A controlled, no-change ActiveEffect is paired with a tracked entry.
    const ctrlId=foundry.utils.randomID(),auraDuration=effects[0].duration;
    await source.setFlag(NS,'trackedDurations',[...readTracked(source),{id:ctrlId,auraController:true,areaOwner:castId,name:`Aura: ${item.name}`,source:'Conjurador',sourceUuid:item.uuid,remaining:auraDuration.kind==='sustained'?null:auraDuration.amount,total:auraDuration.kind==='sustained'?null:auraDuration.amount,mode:auraDuration.kind,combatId:game.combat?.started?game.combat.id:null,combatantId:game.combat?.combatants?.find(c=>c.actor?.id===source.id)?.id??null}]);casterAuraTracking=true;
    const markers=await source.createEmbeddedDocuments('ActiveEffect',[{name:`Aura: ${item.name}`,img:item.img||'icons/svg/aura.svg',disabled:false,changes:[],flags:{[NS]:{trackingId:ctrlId,persistentAreaCastId:castId,sourceUuid:item.uuid}}}]);
    casterAuraMarker=markers[0];
    if(!casterAuraMarker)throw Error('Não foi possível registrar a aura nos efeitos do conjurador.');
   }
   if(sharedSustain&&!persist){
    const combat=game.combat;const current=combat.combatant;
    const linkage={id:castId,itemName:item.name,sourceUuid:source.uuid,combatId:combat.id,cost:sharedSustain,targets:snapshots.map(s=>({actorUuid:s.actor.uuid,ids:s.entries.filter(e=>e.externalOwner).map(e=>e.id)})).filter(x=>x.ids.length),createdRound:combat.round,createdTurn:combat.turn,createdCombatantId:current?.id??null,firstOwnStartSeen:current?.actor?.id===source.id};
    await source.setFlag(NS,'externalSustains',[...oldSourceLink,linkage]);linkSaved=true;
   }
  }catch(err){
   if(casterAuraMarker)try{await casterAuraMarker.delete();}catch(e){console.error(e);}
   if(casterAuraTracking)try{await source.setFlag(NS,'trackedDurations',oldCasterTracked);}catch(e){console.error(e);}
   if(createdTemplate)try{await createdTemplate.delete();}catch(e){console.error(e);}
   for(const s of snapshots.reverse()){
    try{if(s.trackedSaved||s.removed.length)await s.actor.setFlag(NS,'trackedDurations',s.oldTracked);}catch(e){console.error(e);}
    try{if(s.resourcesSaved)await s.actor.update(Object.fromEntries(Object.entries(s.beforeResources).map(([k,v])=>[`system.${k}`,v])));}catch(e){console.error(e);}
    for(const marker of s.created.reverse())try{await marker.delete();}catch(e){console.error(e);}
    if(s.attrsSaved||s.removed.length)try{await s.actor.update(s.beforeAttrs);}catch(e){console.error(e);}
    for(const previous of s.removed)try{await s.actor.createEmbeddedDocuments('ActiveEffect',[previous.marker],{keepId:true});}catch(e){console.error('Multiverso | restauração de efeito anterior',e);}
   }
   if(linkSaved)try{await source.setFlag(NS,'externalSustains',oldSourceLink);}catch(e){console.error(e);}
   if(costSaved)try{await source.update(Object.fromEntries(Object.entries(costs.original).map(([k,v])=>[`system.${k}`,v])));}catch(e){console.error(e);}
   if(usageTaken?.limited)try{await restoreUsage(source,usageTaken);}catch(e){console.error(e);}
   return warn([`A aplicação não foi concluída: ${err.message}. Confira as fichas se houve falha de conexão.`]);
  }
  // Card único de conjuração: narrativa e destinatários, sem expor os detalhes
  // internos da aplicação. Rolagens e botões de dano permanecem funcionais.
  const damageEntries=plans.flatMap(p=>p.manual).map(d=>({...d,itemUuid:item.uuid}));
  const abilityProps=item.system?.props??{};
  const description=String(abilityProps[item.type==='tecnica'?'descricaotecnica':'descricaoskill']||item.system?.descricao||'').trim();
  const level=abilityProps[item.type==='tecnica'?'niveltecnica':'nivelskill'];
  const actionKey=String(abilityProps[`ativacaotempotipo${item.type}`]??'').toLowerCase();
  const actionLabel={completa:'Ação Completa',acao:'Ação Padrão',movimento:'Movimento',bonus:'Ação Bônus',reacao:'Reação',livre:'Ação Livre',passiva:'Passiva'}[actionKey]||'';
  const initialCost=setting(item,'custo',1);
  const sustainLabel=sharedSustain?'Sustentação':'';
  const meta=[level!==undefined&&String(level).trim()?`Nível ${esc(level)}`:'',actionLabel,initialCost,sustainLabel].filter(Boolean).map(escPart=>`<span>${escPart}</span>`).join(' <span aria-hidden="true">•</span> ');
  const affected=[...new Set(snapshots.map(s=>String(s.actor.name??'').trim()).filter(Boolean))];
  try{
   const damageMarkup=damageEntries.length?await renderManualDamageRows(damageEntries):'';
   const affectedHtml=affected.length?affected.map(esc).join(', '):'Nenhum alvo na área no momento da conjuração';
   const content=`<section class="mv-chat-effect mv-chat-automatic mv-cast-story"><div class="mv-chat-effect-header"><strong>${esc(item.name)}</strong><small>${esc(source.name)}${level!==undefined&&String(level).trim()?` • Habilidade de Nível ${esc(level)}`:''}</small></div><div class="mv-chat-effect-body">${description?`<p class="mv-cast-story-description">${esc(description)}</p>`:''}<div class="mv-cast-story-targets"><strong>✦ Afetados</strong><div>${affectedHtml}</div></div>${meta?`<small class="mv-cast-story-meta">${meta}</small>`:''}${damageMarkup}</div></section>`;
   const chatData={content,rolls:snapshots.flatMap(s=>s.rolled),flags:{[NS]:damageFlag(damageEntries)}};
   if(options.reuseMessage)await options.reuseMessage.update(chatData);
   else await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:source}),...chatData});
  }catch(err){console.error('Multiverso | publicação do card de habilidade',err);ui.notifications.warn('Efeitos registrados, mas o card não pôde ser publicado. Confira antes de continuar.');}
  // Rolar dano para quem já está na área NO MOMENTO da conjuração.
  // O processamento por turno da aura só voltará a atingir cada pessoa quando
  // chegar o próprio turno; nenhum PV é alterado antes do botão direito.
  if(persist&&createdTemplate&&areaEffects.some(e=>e.type==='dano'||e.cadence==='periodic')){
   try{await rollInitialAuraDamage(createdTemplate,actors.map(x=>x.token));}
   catch(err){console.error('Multiverso | dano inicial da aura',err);ui.notifications.error('A aura foi criada, mas o dano inicial não pôde ser publicado corretamente. Confira o chat.');}
  }
  return true;
 }finally{busy.delete(source.uuid);}
}
// Processar uma única cobrança no início do TURNO DO CONJURADOR.
// Efeitos em diferentes alvos compartilham o custo; não cobrar por alvo.
const processed=new Map();
export async function processExternalSustains(combat,member,tick){
 if(!game.user?.isGM||!member?.actor||!combat?.started)return;
 const source=member.actor;
 const fullTick=`${combat.id}:${tick}`;if(processed.get(source.uuid)===fullTick)return;processed.set(source.uuid,fullTick);
 const current=Array.isArray(source.getFlag(NS,'externalSustains'))?source.getFlag(NS,'externalSustains'):[];
 if(!current.length)return;
 const keep=[],notes=[];
 for(const linked of current){
  if(linked.combatId!==combat.id){keep.push(linked);continue;}
  if(!linked.firstOwnStartSeen){keep.push({...linked,firstOwnStartSeen:true});continue;}
  if(linked.createdRound===combat.round&&linked.createdTurn===combat.turn&&linked.createdCombatantId===member.id){keep.push(linked);continue;}
  const targets=[];
  for(const group of linked.targets){
   const actor=await fromUuid(group.actorUuid);
   if(actor)targets.push({actor,entries:readTracked(actor).filter(x=>group.ids.includes(x.id))});
  }
  const remaining=targets.flatMap(x=>x.entries);
  if(!remaining.length)continue;
  const expire=remaining.some(x=>x.remaining<=1);
  const pay=sustainCosts(linked.cost,source);const totals=new Map();
  for(const c of pay)totals.set(c.key,(totals.get(c.key)||0)+Number(c.amount));
  const unable=!expire && (!pay.length||pay.some(c=>!c.key||!Number.isSafeInteger(c.amount)||c.amount<1)||[...totals].some(([k,v])=>!Number.isFinite(Number(source.system[k]))||Number(source.system[k])<v));
  if(expire||unable){
   let failures=false;
   for(const {actor,entries} of targets){
    const entriesToKeep=readTracked(actor).filter(x=>!entries.some(e=>e.id===x.id));
    try{
     for(const entry of entries)if(entry.maintainedEffect)await endMaintainedEffect(actor,entry);
     await actor.setFlag(NS,'trackedDurations',entriesToKeep);
    }catch(err){failures=true;console.error('Multiverso | encerramento externo',err);}
   }
   if(failures){keep.push(linked);ui.notifications.error(`Não foi possível encerrar todos os efeitos de ${linked.itemName}.`);}
   else notes.push({type:'ended',name:linked.itemName,reason:unable?'Faltaram recursos':'Duração concluída',targets:remaining.length});
   continue;
  }
  const before=Object.fromEntries([...totals.keys()].map(k=>[k,Number(source.system[k])]));
  const previousTargets=targets.map(x=>({actor:x.actor,tracked:readTracked(x.actor)}));
  try{
   await source.update(Object.fromEntries([...totals].map(([k,v])=>[`system.${k}`,before[k]-v])));
   for(const {actor,entries} of targets){
    const ids=new Set(entries.map(e=>e.id));
    await actor.setFlag(NS,'trackedDurations',readTracked(actor).map(x=>ids.has(x.id)?{...x,remaining:x.remaining-1}:x));
   }
   keep.push(linked);notes.push({type:'paid',name:linked.itemName,cost:pay.map(c=>`${c.amount} ${c.resource.toUpperCase()}`).join(' + '),targets:remaining.length});
  }catch(err){
   console.error('Multiverso | sustentação externa',err);
   try{await source.update(Object.fromEntries(Object.entries(before).map(([k,v])=>[`system.${k}`,v])));}catch(e){console.error(e);}
   for(const x of previousTargets)try{await x.actor.setFlag(NS,'trackedDurations',x.tracked);}catch(e){console.error(e);}
   keep.push(linked);ui.notifications.error('Falha na sustentação externa. Confira as fichas.');
  }
 }
 try{await source.setFlag(NS,'externalSustains',keep);}catch(err){console.error(err);}
 if(notes.length)try{await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:source}),content:renderSustainCard(source,notes)});}catch(err){console.error(err);}
}
