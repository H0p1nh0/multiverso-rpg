// v0.2.54 — Prévia e simulação NÃO destrutivas das habilidades.
// Somente lê os registros aprovados; nunca chama o executor, atualiza documentos,
// gasta ações/recursos ou publica resultados no chat.
import {original} from './skill-editor-definition.mjs';
import {diagnose,primaryCost,optionalCost} from './native-effects.mjs';
import {canUseExternalCard,allowedExternalCardErrors} from './external-card-apply.mjs';
import {allowedExternalAdvancedErrors} from './external-advanced.mjs';
import {chooseExternalExecutionRoute,EXECUTION_ROUTE_LABELS} from './ability-execution-route.mjs';
import {alternativeGroups} from './effect-alternatives.mjs';
import {advancedMode} from './advanced-motor.mjs';
import {isSpecialResourceOperation} from './special-math.mjs';
import {actionStatus,isActionBlocked} from './action-economy.mjs';
import {usageStatus} from './skill-uses.mjs';
import {signedResourceBalance} from './extra-flux.mjs';

const NS='multiverso-rpg';
const FIELDS=new Map(original.BASE_FIELDS.map(([id,label,,options])=>[id,{label,options}]));
const IDS=[...FIELDS.keys()];
const MAX=5;
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const text=value=>String(value??'').trim();
const suffix=i=>i===1?'':String(i);
function value(item,id,i){
  const key=id==='atividade'?'ativacaotempotipo'+item.type+suffix(i):
    id==='nome'?'atividadenome'+item.type+suffix(i):
    'efeito'+item.type+id+suffix(i);
  return text(item.system?.props?.[key]);
}
const label=(id,val)=>{
  const choices=FIELDS.get(id)?.options;
  return choices?.find(([key])=>String(key)===String(val))?.[1]??val;
};
function sourceFor(item){
  if(!item)return null;
  if(['skill','tecnica'].includes(item.type))return item;
  const actor=item.parent?.documentName==='Actor'?item.parent:null;
  if(!actor)return null;
  const ref=item.getFlag?.(NS,'traitEffectSourceIdV1');
  const direct=ref?actor.items.get(ref):null;
  if(direct?.getFlag?.(NS,'originItemId')===item.id)return direct;
  return [...(actor.items??[])].find(candidate=>
    candidate.getFlag?.(NS,'traitEffectSourceV1')===true&&
    candidate.getFlag?.(NS,'originItemId')===item.id)??null;
}
function countEffects(item){
  if(!item)return 0;
  const saved=Math.max(0,Math.min(MAX,Number(item.system?.props?.mvEffectCount)||0));
  const detected=Array.from({length:MAX},(_,n)=>n+1).filter(i=>
    IDS.some(id=>Boolean(value(item,id,i)))||
    Boolean(text(item.system?.props?.['mvEffectTitle'+i]))).pop()??0;
  return Math.max(saved,detected);
}
function effectDescription(item,i){
  const get=id=>value(item,id,i);
  const type=get('tipo'),target=get('receptor'),affected=get('afetado');
  const amount=get('valor'),scale=get('escala'),operation=get('operacao');
  const bits=[];
  if(type==='dano')bits.push('Causa '+(amount||'dano ainda não definido')+
    (get('tipodano')?' de dano '+label('tipodano',get('tipodano')):' de dano')+'.');
  else if(type==='condicao')bits.push('Condição: '+(get('condicaores')||'não especificada')+'.');
  else if(type)bits.push(label('tipo',type)+
    (affected?' em '+label('afetado',affected):'')+
    (operation?' — '+label('operacao',operation).toLowerCase():'')+
    (amount?' '+amount:'')+'.');
  if(target)bits.push('Recebe: '+label('receptor',target)+'.');
  if(scale&&type!=='condicao')bits.push('Cálculo: '+label('escala',scale)+'.');
  if(get('resistenciaativa')==='conjurador'){
    bits.push('Teste do conjurador: '+(get('resistenciateste')||'perícia não informada')+(get('resistenciadt')?' contra DT '+get('resistenciadt'):' (resultado decidido pelo mestre)')+'.');
  } else if(get('resistenciaativa')==='oposto'){
    bits.push('Teste contestado: '+(get('resistenciadt')||'perícia do usuário não informada')+' do usuário contra '+(get('resistenciateste')||'perícia do alvo não informada')+' do alvo.');
  } else if(get('resistenciaativa')==='sim'){
    bits.push('Teste de resistência: '+(get('resistenciateste')||'não informado')+
      ' contra DT '+(get('resistenciadt')||'não informada')+'.');
    bits.push('Se falhar: '+(label('resistenciafalha',get('resistenciafalha'))||'não configurado')+
      '. Se passar: '+(label('resistenciasucesso',get('resistenciasucesso'))||'não configurado')+'.');
  }
  if(get('atividade'))bits.push('Execução: '+label('atividade',get('atividade'))+'.');
  if(get('alcance'))bits.push('Alcance: '+get('alcance')+'.');
  if(get('qtdalvos'))bits.push('Alvos: '+get('qtdalvos')+'.');
  if(get('formarea'))bits.push('Área: '+get('formarea')+'.');
  if(get('duracao'))bits.push('Duração: '+get('duracao')+'.');
  if(get('custo'))bits.push('Custo principal: '+get('custo')+'.');
  if(get('custoopcional'))bits.push('Reforço opcional: '+get('custoopcional')+'.');
  if(get('sustentacao')||item.system?.props?.['mvSustainCost'+i])
    bits.push('Sustentação: '+(text(item.system.props['mvSustainCost'+i])||get('sustentacao'))+'.');
  if(get('usos'))bits.push('Limite de usos: '+get('usos')+'.');
  if(get('recarga'))bits.push('Recarga: '+label('recarga',get('recarga'))+'.');
  if(get('prerequisitos'))bits.push('Materiais / requisitos narrativos (conferência manual): '+get('prerequisitos')+'.');
  if(get('detalhe'))bits.push('Detalhes adicionais: '+get('detalhe'));
  if(item.system?.props?.['mvOptionalOnly'+i]==='sim')
    bits.push('Este efeito depende do custo opcional / reforço.');
  for(const key of ['mvPredicateA','mvPredicateB','mvTrigger']){
    const configured=text(item.system?.props?.[key+i]);
    if(configured)bits.push((key==='mvTrigger'?'Gatilho':'Condição automática')+': '+configured+'.');
  }
  return bits;
}
function diagnoseSafe(source){
  try{return diagnose(source);}
  catch(error){return [{index:0,errors:['Não foi possível analisar a configuração: '+(error?.message||String(error))]}];}
}
export function buildAbilityReport(item,{originItem=null}={}){
  const source=sourceFor(item),actor=source?.parent?.documentName==='Actor'?source.parent:null;
  const count=countEffects(source),effects=[],issues=[],checks=[];
  if(!source){
    checks.push('Registro sem mecânicas automáticas vinculadas. Consulte sua descrição.');
    return {item,source,actor,effects,issues,checks,rolls:[],passive:true};
  }
  const engine=diagnoseSafe(source);
  const narrativeOnly=Array.from({length:count},(_,i)=>i+1).every(i=>!value(source,'tipo',i));
  // A prévia consulta a MESMA decisão de rota que a execução real. Não se
  // deve tratar um receptor externo como inválido apenas porque o analisador
  // nativo foi construído originalmente para efeitos no próprio usuário.
  let hasVariants=false;
  try{hasVariants=alternativeGroups(source,engine).length>0;}
  catch(error){issues.push('Alternativas: '+(error?.message||String(error)));}
  const selectedCount=Number(game?.user?.targets?.size??0);
  const route=chooseExternalExecutionRoute(engine,{
    cardEligible:canUseExternalCard(engine),hasVariants,selectedCount,
    specialOperation:isSpecialResourceOperation,
    setting:(field,index)=>field.startsWith('mv')?advancedMode(source,index,field):value(source,field,index)
  });
  checks.push('Motor previsto para a ativação: '+EXECUTION_ROUTE_LABELS[route]+'.');
  const areaRoute=engine.some(e=>e.receiver==='area'&&Boolean(value(source,'formarea',e.index)));
  // Somente mensagens explicitamente migradas para o validador da rota real
  // podem ser removidas. Todos os demais erros continuam visíveis.
  const externalReceiverError='O receptor selecionado não é compatível com esta execução.';
  function ignoredByRoute(error,e){
    if(route==='external-advanced')return allowedExternalAdvancedErrors.has(error);
    if(e.receiver==='proprio'||route==='native')return false;
    if(route==='external-card')return allowedExternalCardErrors.has(error);
    if(['open-effect','external-target','multi-target','external-maintained'].includes(route))return error===externalReceiverError;
    return false;
  }
  for(let i=1;i<=count;i++){
    const e=engine.find(entry=>entry.index===i);
    const errors=(narrativeOnly?[]:(e?.errors??[])).filter(error=>
      !ignoredByRoute(error,e??{receiver:'proprio'})&&
      !(/passiva não pode ser executada diretamente/i.test(error)&&
        value(source,'atividade',i)==='passiva'));
    for(const error of errors)issues.push('Efeito '+i+': '+error);
    const name=text(source.system?.props?.['mvEffectTitle'+i])||'Efeito '+i;
    effects.push({name,index:i,lines:effectDescription(source,i)});
  }
  // Avisar sobre limitações reais da rota, mesmo quando o analisador nativo
  // anterior não possuía uma mensagem específica para elas.
  if(route==='multi-target')for(const e of engine){
    if(!['alvo','aliado','inimigo'].includes(e.receiver))issues.push(`Efeito ${e.index}: múltiplos alvos aceitam apenas alvo escolhido, aliado ou inimigo.`);
    if(!['dano','cura'].includes(e.type))issues.push(`Efeito ${e.index}: a rota de múltiplos alvos aceita apenas Dano ou Cura imediatos.`);
    if(e.cadence!=='once'||!['instant','unspecified'].includes(e.duration?.kind))issues.push(`Efeito ${e.index}: múltiplos alvos exigem aplicação imediata.`);
  }
  if(route==='external-maintained')for(const e of engine){
    if(e.receiver!=='alvo')issues.push(`Efeito ${e.index}: a rota mantida exige receptor Alvo escolhido.`);
    if(!['turns','rounds'].includes(e.duration?.kind))issues.push(`Efeito ${e.index}: informe duração em turnos ou rodadas.`);
    if(e.resistanceActive||e.dynamicValue||e.diceFormula)issues.push(`Efeito ${e.index}: resistência, valor escolhido e rolagens não são compatíveis com efeito mantido simples.`);
  }
  if(route==='external-advanced')for(const e of engine){
    if(e.receiver!=='proprio'&&!['alvo','aliado','inimigo','area'].includes(e.receiver))issues.push(`Efeito ${e.index}: receptor externo incompatível.`);
    if(e.cadence==='once'&&!['recurso','dano','cura'].includes(e.type))issues.push(`Efeito ${e.index}: esta rota só aceita Dano, Cura ou Alteração de fluxo como efeito imediato.`);
    if(e.cadence==='periodic'&&!['recurso','dano','cura'].includes(e.type))issues.push(`Efeito ${e.index}: repetição aceita apenas Dano, Cura ou Alteração de fluxo.`);
    if(e.dynamicValue)issues.push(`Efeito ${e.index}: escolha dinâmica de valor não está disponível na execução composta.`);
  }
  if(route==='external-card')checks.push('O token marcado recebe o efeito pelo card externo; o destinatário e as permissões serão conferidos no uso.');
  if(route==='open-effect')checks.push('Sem alvo marcado: o uso real publicará um card no chat para aplicação posterior, sem efeito imediato sobre outra ficha.');
  if(areaRoute)checks.push('Área: a posição, os alvos e a sustentação serão conferidos no uso real.');
  if(engine.some(e=>e.receiver!=='proprio')&&!['external-card','open-effect'].includes(route))
    checks.push('Seleção de alvo e permissões serão conferidas na utilização real; a prévia não aplica efeitos.');
  if(engine.some(e=>e.receiver==='proprio')&&engine.some(e=>e.receiver!=='proprio'))
    checks.push('Efeitos mistos: o executor composto coordena efeito próprio, alvo externo e custo principal numa ativação.');
  if(narrativeOnly)checks.push('Habilidade narrativa: uso permitido sem efeito mecânico; ações e custos continuam aplicáveis.');
  else if(!effects.length)checks.push('Nenhum efeito configurado no motor da habilidade.');
  const actions=[...new Set(effects.map(e=>value(source,'atividade',e.index)).filter(Boolean))];
  const passive=actions.length>0&&actions.every(a=>a==='passiva');
  if(passive)checks.push('Efeito passivo: não exige clicar em Usar nem gastar uma ação.');
  else if(actions.length===1){
    const action=actions[0];
    checks.push('Ação necessária: '+label('atividade',action)+'.');
    if(actor&&isActionBlocked(actor,action))issues.push('Condição ativa impede esta ação.');
    if(actor&&!['passiva','reacao'].includes(action)){
      const status=actionStatus(actor,action);
      if(!status.ok)issues.push('Ação indisponível agora: '+status.reason);
      else checks.push('Ação disponível nas condições atuais do combate.');
    }else if(action==='reacao')checks.push('Reação: conferir a disponibilidade no combate antes de usar.');
  }else if(actions.length>1)issues.push('Efeitos com tipos de ação diferentes: revise a execução conjunta.');
  if(actor&&count&&!passive){
    try{
      const costs=primaryCost(source,count,actor);
      issues.push(...(costs.errors||[]));
      const options=costs.options||[];
      if(options.length>1)checks.push('Há alternativas de custo; a escolha ocorre ao usar.');
      if(options.length===1&&options[0].costs?.length){
        const balance=signedResourceBalance(actor,options[0].costs);
        if(!balance.ok)issues.push('Recursos insuficientes ou indisponíveis para o custo principal atual.');
        else checks.push('Recursos suficientes para o custo principal atual.');
      }
      const optional=optionalCost(source,count,actor);
      issues.push(...(optional.errors||[]));
      if(optional.groups?.length)checks.push('Existem opções de reforço; serão oferecidas durante o uso real.');
    }catch(error){checks.push('Verificação de custos disponível no uso real: '+(error?.message||'erro de leitura'));}
    try{
      const uses=usageStatus(actor,source);
      if(uses.error)issues.push(uses.error);
      else if(uses.limited)checks.push('Usos restantes: '+uses.remaining+'.');
      if(uses.limited&&!uses.ok)issues.push('Limite de usos atingido.');
    }catch(error){checks.push('Limite de usos não pôde ser conferido nesta prévia.');}
  }else if(count&&!actor)checks.push('Sem personagem vinculado: requisitos dinâmicos não podem ser conferidos.');
  if(originItem){
    checks.push('Origem: item '+originItem.name+'.');
    checks.push('Equipamento e sincronização do item devem ser conferidos no uso real.');
  }
  if(effects.some(e=>value(source,'receptor',e.index)!=='proprio'&&value(source,'receptor',e.index)))
    checks.push('Efeito externo: exige escolha / confirmação do alvo na utilização real.');
  if(effects.some(e=>value(source,'prerequisitos',e.index)))
    checks.push('Materiais indicados são conferidos e gastos manualmente, conforme o motor atual.');
  const rolls=effects.flatMap(e=>{
    const formula=value(source,'valor',e.index).replace(/\s+/g,'');
    return (/^\d*d\d+(?:[+-]\d+)?$/i.test(formula)?[{name:e.name,formula}]:[]);
  });
  return {item,source,actor,effects,issues:[...new Set(issues)],checks,rolls,passive};
}
function list(items,empty){
  return items.length?'<ul>'+items.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>':'<p>'+esc(empty)+'</p>';
}
function reportHTML(report){
  const category=report.passive?'Passiva / característica':'Habilidade ativável';
  const description=text(report.item.system?.props?.[
    report.item.type==='tecnica'?'descricaotecnica':'descricaoskill'
  ])||text(report.item.system?.descricao);
  const parts=[
    '<div class="mv-diagnostic">',
    '<div class="mv-diagnostic-banner"><small>SIMULAÇÃO SEM CONSEQUÊNCIAS • '+esc(category)+'</small>',
    '<h2>'+esc(report.item.name)+'</h2>',
    '<p>Esta janela não executa a habilidade, não cobra custos e não altera fichas, alvos ou chat.</p></div>',
    description?'<p class="mv-diagnostic-description">'+esc(description)+'</p>':'',
    '<section><h3>Condições e requisitos</h3>'+list(report.checks,'Nenhum requisito informado.')+'</section>',
    '<section><h3>Diagnóstico da configuração</h3>',
    report.issues.length?'<div class="mv-diagnostic-warning">'+list(report.issues,'')+'</div>':
      '<p class="mv-diagnostic-ok">Nenhuma incompatibilidade detectada pela análise disponível. O resultado em jogo depende de alvos, testes e escolhas.</p>',
    '</section>',
    '<section><h3>O que a habilidade faria</h3>'
  ];
  for(const e of report.effects){
    parts.push('<article><h4>'+esc(e.name)+'</h4>'+list(e.lines,'Efeito sem propriedades preenchidas.')+'</article>');
  }
  if(!report.effects.length)parts.push('<p>Sem efeitos automáticos cadastrados. Consulte a descrição do registro.</p>');
  parts.push('</section>',
    '<p class="mv-diagnostic-disclaimer">Prévia baseada nos campos salvos. Testes do alvo e decisões do mestre são resolvidos somente no uso real.</p>',
    '</div>');
  return parts.join('');
}
async function simulateRolls(report){
  const samples=[];
  for(const entry of report.rolls){
    try{
      if(typeof Roll==='undefined')throw Error('rolagem indisponível');
      const roll=await new Roll(entry.formula).evaluate();
      samples.push(entry.name+': '+entry.formula+' → '+roll.total);
    }catch(error){samples.push(entry.name+': não foi possível simular '+entry.formula+'.');}
  }
  const content='<div class="mv-diagnostic"><div class="mv-diagnostic-banner"><h2>Rolagem ilustrativa</h2>'+
    '<p>Nenhum recurso, ação, alvo, efeito ou mensagem de chat foi alterado.</p></div>'+
    list(samples,'Esta habilidade não possui fórmulas simples de dados para simular. Seus requisitos e efeitos estão na prévia.')+
    '<p class="mv-diagnostic-disclaimer">Esta amostra não decide acerto ou resistência do alvo. Para resolver em jogo, use o botão de ativação real.</p></div>';
  await foundry.applications.api.DialogV2.wait({window:{title:'Simulação • '+report.item.name,resizable:true,width:630},
    classes:['mv-diagnostic-dialog'],content,buttons:[{action:'close',label:'Fechar',default:true}],rejectClose:false});
}
export async function openAbilityDiagnostic(item,{originItem=null}={}){
  const report=buildAbilityReport(item,{originItem});
  const result=await foundry.applications.api.DialogV2.wait({
    classes:['mv-diagnostic-dialog'],
    window:{title:'Testar habilidade • '+item.name,resizable:true,width:760},
    content:reportHTML(report),
    buttons:[
      {action:'close',label:'Fechar',callback:()=>false},
      {action:'simulate',label:'Simular dados (sem efeitos)',default:true,callback:()=>true}
    ],rejectClose:false
  });
  if(result)await simulateRolls(report);
  return report;
}
