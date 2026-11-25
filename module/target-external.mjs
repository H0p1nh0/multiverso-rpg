import {selectedExternalTokens} from './selected-targets.mjs';
import {passiveDamage} from './passive-bonuses.mjs';
// v0.1.44: primeiro suporte conservador a um alvo externo por token marcado.
// Não substitui a seleção de alvos do motor original; impede execução parcial.
import {createPendingDamageCard} from './effect-chat.mjs';
import {primaryCost,optionalCost,chooseReinforcement} from './native-effects.mjs';
import {confirmOriginalUse} from './confirmation-original.mjs';
import {availableFluxes,fluxById} from './extra-flux.mjs';
import {usageStatus,takeUsage,restoreUsage} from './skill-uses.mjs';
import {askActivationChoices,activationChoiceValue} from './activation-choices.mjs';
const fluxos={pv:'pv_atual',pm:'pm_atual',sta:'sta_atual',san:'san_atual'};
const maxima={pv:'pv_max',pm:'pm_max',sta:'sta_max',san:'san_max'};
const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function warnBlocked(errors){
  await foundry.applications.api.DialogV2.wait({window:{title:'Alvo externo — ação indisponível'},content:`<h3>Execução bloqueada</h3><p>Não houve rolagem nem alteração de ficha.</p><ul>${errors.map(e=>`<li>${html(e)}</li>`).join('')}</ul>`,buttons:[{action:'ok',label:'Entendi',default:true}]});
  return false;
}
export async function executeExternalTarget(item,source,allEffects){
  const errors=[];
  // Um efeito externo imediato agora admite custo opcional, sem alterar o destinatário.
  if(allEffects.length!==1)errors.push('Por enquanto, alvos externos exigem apenas um efeito cadastrado.');
  const e=allEffects[0];
  if(!e || !['alvo','aliado','inimigo'].includes(e.receiver))errors.push('Escolha Alvo escolhido, Aliado ou Inimigo no campo Quem Recebe.');
  if(e?.type==='recurso'&&e.extraResource)errors.push('Nesta configuração, altere o Fluxo Extra no próprio personagem.');
  if(e && !['cura','dano','recurso'].includes(e.type))errors.push('Somente Cura, Dano ou alteração imediata de recursos são suportados em outro alvo.');
  if(e?.cadence!=='once'||(e.duration?.kind!=='instant' && e.duration?.kind!=='unspecified'))errors.push(e?.cadence==='once'&&['turns','rounds'].includes(e.duration?.kind)?'Para dano/cura por turno, escolha Repetir na Seção 5; uma duração sozinha não ativa a repetição.':'Para aplicar efeitos com duração, escolha Repetir ou Manter até terminar na Seção 5.');
  // Resistência externa: fase manual fiel aos resultados já suportados no motor nativo.
  // Não inferir bônus do alvo a partir do nome textual do teste.
  const rawLimit=String(item.system.props?.[`efeito${item.type}qtdalvos${e?.index===1?'':e?.index}`]??'').trim();
  const validLimit=rawLimit && /^[1-9]\d*$/.test(rawLimit);
  if(rawLimit&&!validLimit)errors.push('Quantidade de Alvos deve ser um número inteiro positivo.');
  for(const err of e?.errors??[]){
    if(err==='O receptor selecionado não é compatível com esta execução.')continue;
    if(err==='Configuração indisponível nesta execução: Quantidade de Alvos.'&&validLimit)continue;
    errors.push(err);
  }
  const props=item.system.props??{};

  const costPlan=primaryCost(item,allEffects.length,source);
  errors.push(...costPlan.errors);
  const optionalPlan=optionalCost(item,allEffects.length,source);
  errors.push(...optionalPlan.errors);
  const marked=selectedExternalTokens(source);
  if(marked.length>1)errors.push('Marque somente um token como alvo nesta execução.');
  const target=marked[0]?.actor;
  const freeMode=marked.length===0;
  if(marked.length===1 && (!target || target.documentName!=='Actor'))errors.push('O token marcado não possui um ator válido.');
  if(target?.uuid===source.uuid)errors.push('Para afetar o próprio personagem, selecione O próprio personagem no editor.');
  if(target&&!target.isOwner)errors.push('Você não pode alterar a ficha do alvo. Peça ao mestre para executar a habilidade.');
  if(errors.length)return warnBlocked(errors);
  let choices;
  try{choices=await askActivationChoices(item,[e]);}catch(error){return warnBlocked([error.message]);}
  if(choices===null)return false;
  const selectedChoice=choices.get(e.index);
  if(selectedChoice){
    if(e.dynamicValue)e.value=activationChoiceValue(selectedChoice);
    if(selectedChoice.damageType)e.chosenDamageType=selectedChoice.damageType;
  }
  const chosenExtras=await chooseReinforcement(optionalPlan,source);
  if(chosenExtras===null)return false;
  // Um efeito exclusivamente opcional não pode ser executado se o reforço não foi escolhido.
  if(props.mvOptionalOnly1==='sim'&&!chosenExtras.some(g=>g.slots.includes(1)))return warnBlocked(['Esse efeito exige o reforço opcional. Selecione o reforço para executar.']);
  // Na v0.1.51 a resistência é solicitada no card público, depois da confirmação.
  // O cálculo e a aplicação ficam pendentes até o alvo rolar ou registrar o teste.
  const resistancePending=Boolean(e.resistanceActive && !freeMode);
  const usage=usageStatus(source,item);if(!usage.ok)return warnBlocked([usage.error??`Usos esgotados (${usage.used}/${usage.config.limit}).`]);
  const confirmed=await confirmOriginalUse(item,source,costPlan.options,chosenExtras.flatMap(g=>g.chosen.costs));
  if(!confirmed)return false;
  const costs=confirmed.costs;
  // O uso foi confirmado PRIVADAMENTE. Descontar o custo aqui, uma única vez.
  // A rolagem posterior não pede uma segunda confirmação.
  const fluxosAtuais=Object.fromEntries(availableFluxes(source).map(f=>[f.key,Number(source.system[f.key]??0)]));
  const patch={};
  for(const c of costs){const key=fluxById(source,c.resource)?.key;if(!key)return warnBlocked(['Tipo de custo desconhecido ou Fluxo Extra inativo.']);patch[key]=(patch[key]??fluxosAtuais[key])-c.amount;}
  if(Object.entries(patch).some(([key,v])=>v<0||!Number.isFinite(v))){ui.notifications.warn('Recursos insuficientes.');return false;}
  const baseFormula=e.diceFormula||String(e.value??'0');
  const passive=e.type==='dano'?passiveDamage(source,item,String(e.chosenDamageType??props[`efeito${item.type}tipodano`]??'')):{bonuses:[],errors:[]};
  if(passive.errors.length)return warnBlocked(passive.errors);
  const baseType=String(e.chosenDamageType??props[`efeito${item.type}tipodano`]??'');
  const damageParts=[{source:String(props.mvEffectTitle1??'').trim()||'Dano base',formula:baseFormula,damageType:baseType},...passive.bonuses.map(b=>({source:b.source,formula:b.formula,damageType:b.damageType}))];
  // A external-target route does not yet have the per-component damage protection
  // engine of the multi-target card. Never apply mixed types as a single type.
  if(!freeMode&&e.type==='dano'&&damageParts.some(p=>String(p.damageType??'').toLowerCase()!==baseType.toLowerCase()))
    return warnBlocked(['Esta combinação de tipos de dano não pode ser aplicada ao alvo selecionado. Use múltiplos alvos ou o mesmo tipo de dano base.']);
  const formula=damageParts.map(p=>`(${p.formula})`).join(' + ');
  const effectName=String(props.mvEffectTitle1??'').trim()||'Efeito 1';
  let usageTaken=null;
  try{
    usageTaken=await takeUsage(source,item);if(!usageTaken.ok)throw Error('Usos esgotados.');
    if(Object.keys(patch).length)await source.update(Object.fromEntries(Object.entries(patch).map(([k,v])=>[`system.${k}`,v])));
    const card=await createPendingDamageCard({actor:source,item,formula,effectName,type:e.type,resource:e.affected,operation:e.op,
      damageParts: e.type==='dano'?damageParts:[],
      externalTarget:freeMode?null:{actorUuid:target.uuid},
      resistanceRequest:resistancePending?{targetUuid:target.uuid,targetName:target.name,testName:e.testName,dt:e.dt,success:e.success,failure:e.failure}:null});
    ui.notifications.info('Uso confirmado. A rolagem está disponível no chat.');
    return !!card;
  }catch(error){
    console.error('Multiverso | criar card de dano',error);
    if(usageTaken?.limited)try{await restoreUsage(source,usageTaken);}catch(err){console.error('Multiverso | devolver uso externo',err);}
    if(Object.keys(patch).length){try{await source.update(Object.fromEntries(Object.entries(patch).map(([k])=>[`system.${k}`,fluxosAtuais[k]])));}catch(rollback){console.error('Falha ao devolver custos',rollback);}}
    ui.notifications.error('Falha na criação do card; consulte F12.');return false;
  }
}
