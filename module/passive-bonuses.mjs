import {isItemEffectSource,itemSourceActive} from './item-effect-links.mjs';
import {predicateCheck,validateAdvanced} from './advanced-motor.mjs';
// v0.1.77 — Passive Skills/Techniques. Source rules inspected in
// motor-efeitos.js: efeitoCombinaComFiltrosAplicacao, coletarBonusDanoPassivo,
// coletarModificadoresCusto and resolverAcumuloEntradas.
// Unsupported dynamic triggers are blocked instead of silently ignored.
const norm=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const raw=(p,k)=>{const x=p?.[k];return x&&typeof x==='object'&&'value'in x?x.value:x;};
const num=x=>{if(x===null||x===undefined||String(x).trim()==='')return null;const n=Number(String(x).replace(',','.'));return Number.isFinite(n)?n:null;};
const WILDCARDS=new Set(['','*','qualquer','todas','todos','all']);
const ELEMENTAL=new Set(['elemental','fogo','frio','eletrico','quimico','gelo','acido']);
export const damageTypeLabel=x=>({fisico:'Físico',elemental:'Elemental',fogo:'Fogo',frio:'Frio/Gelo',eletrico:'Elétrico',quimico:'Químico/Ácido',psiquico:'Psíquico',sagrado:'Sagrado',sombrio:'Sombrio/Necrótico',verdadeiro:'Verdadeiro',outro:'Outro'}[norm(x)]||String(x??'').trim());
function effects(actor){
 const out=[];
 for(const item of actor?.items??[]){
  if(!['skill','tecnica'].includes(item.type))continue;
  if(isItemEffectSource(item)&&!itemSourceActive(item))continue;
  if(item.getFlag?.('multiverso-rpg','itemCastCloneV1')===true||item.getFlag?.('multiverso-rpg','itemAbilityTemplateV1')===true)continue;
  const linkedOrigin=item.getFlag?.('multiverso-rpg','traitEffectSourceV1')?item.parent?.items?.get(item.getFlag('multiverso-rpg','originItemId')):true;
  if(!linkedOrigin)continue;
  // Migração: nunca somar o passivo novo a um ActiveEffect legado ainda ativo.
  const oldId=item.getFlag?.('multiverso-rpg','legacyEffectId');
  if(oldId && actor?.effects?.get(oldId) && !actor.effects.get(oldId).disabled)continue;
  const p=item.system?.props??{};
  for(let n=1;n<=5;n++){
   const pre=`efeito${item.type}`,s=n===1?'':String(n),get=k=>raw(p,pre+k+s),kind=norm(get('tipo'));
   if(!kind)continue;
   const activity=norm(get('atividade')||raw(p,'ativacaotempotipo'+item.type+(n===1?'':n))||raw(p,'ativacaotempotipo'+item.type));
   const receiver=norm(get('receptor')||'proprio');
   if(activity!=='passiva'||(receiver&&!['proprio','o proprio personagem'].includes(receiver)))continue;
   const affected=norm(get('afetado')||(kind==='teste'?'teste':kind==='dano'?'dano_adicional':''));
   out.push({item,p,n,kind,get,scale:norm(get('escala')||'fixo'),affected,operation:norm(get('operacao')||'somar'),definition:norm(get('definicao')||'fixo')});
  }
 }
 return out;
}
// Distinguish explicit ability filters from damage type on the bonus itself.
const typeMatches=(want,have)=>WILDCARDS.has(norm(want))||(norm(want)==='elemental'?ELEMENTAL.has(norm(have)):norm(want)===norm(have));
function skillDamageTypes(skill){
 const p=skill?.system?.props??{},types=[];
 for(let i=1;i<=5;i++){
  const pre=`efeito${skill.type}`,s=i===1?'':String(i);
  if(norm(raw(p,pre+'tipo'+s))==='dano' && norm(raw(p,pre+'tipodanomodo'+s))!=='escolhido'){
    const kind=raw(p,pre+'tipodano'+s);if(kind)types.push(kind);
  }
 }
 return types;
}
function targetMatches(target,skill){
 const list=String(target??'').split(/[,;\n]/).map(x=>norm(x)).filter(Boolean);
 return !list.length||list.some(x=>WILDCARDS.has(x)||[skill?.id,skill?.uuid,skill?.name].some(v=>norm(v)===x));
}
function abilityFilter(e,skill){
 const costMode=norm(raw(e.p,`mvCostTargetMode${e.n}`));
 const mode=e.kind==='modificador_custo'?costMode:e.affected==='dano_adicional'?norm(raw(e.p,`mvPassiveTargetMode${e.n}`)):'';
 if(mode==='especificas'){
  const ids=String(raw(e.p,`${e.kind==='modificador_custo'?'mvCostTargetIds':'mvPassiveTargetIds'}${e.n}`)??'').split(',').filter(Boolean);
  if(!ids.includes(String(skill?.id)))return {match:false,specific:true};
 }
 const flag=norm(e.get('filtroaplicacao'));
 // A seleção moderna por IDs substitui o filtro antigo (não soma os dois).
 // Quando ainda não foi configurada, o filtro legado continua valendo.
 const filteredTarget=e.kind==='modificador_custo' && ['todos','especificas'].includes(costMode)
  ? '' : e.get('custoalvohabilidade');
 const implicit=flag!== 'nao' && flag!=='false' && (!!String(filteredTarget??'').trim()||!!String(e.get('filtrotipodano')??'').trim());
 const filterEnabled=flag==='sim'||flag==='true'||(!flag&&implicit);
 if(filterEnabled&&!targetMatches(filteredTarget,skill))return {match:false,specific:mode==='especificas'};
 const damageFlag=norm(e.get('filtrodanohabilitado'));
 const filterType=e.get('filtrotipodano');
 const legacy=!flag&&!WILDCARDS.has(norm(filterType));
 const checkType=filterEnabled&&(damageFlag==='sim'||damageFlag==='true'||(!['nao','false'].includes(damageFlag)&&!WILDCARDS.has(norm(filterType))));
 if(checkType&&!WILDCARDS.has(norm(filterType))&&!skillDamageTypes(skill).some(t=>typeMatches(filterType,t)))return {match:false,specific:mode==='especificas'};
 return {match:true,specific:mode==='especificas'};
}
const errorsFor=e=>{
 const unsupported=['formarea','especial','condicao','prerequisitos'].filter(k=>{const x=e.get(k);return x!==null&&x!==undefined&&String(x).trim()!=='';});
 const accumulation=norm(e.get('acumulo'));
 if(accumulation==='especial')unsupported.push('acumulo=especial');
 if(!['','acumula','maior','nao','substituir','especial'].includes(accumulation))unsupported.push('acumulo='+accumulation);
 const extra=validateAdvanced(e.p,e.n,{activity:'passiva',effectType:e.kind,affected:e.affected,receiver:'proprio'});
 if(extra.length)unsupported.push(...extra);
 return unsupported.length?`Passivo ${e.item.name}, efeito ${e.n}: condição ou regra especial ainda não automatizada (${unsupported.join(', ')}).`:null;
};
// Original resolverAcumuloEntradas groups equivalent entries; mean of simple dice is
// used for "maior". Dynamic/complex formulas are never guessed.
function meanOf(formula){
 let t=String(formula??'').toLowerCase().replace(/\s+/g,'').replace(/,/g,'.');
 t=t.replace(/(\d*)d(\d+)/g,(_,count,faces)=>String(Number(count||1)*(Number(faces)+1)/2));
 if(!/^[+-]?\d+(?:\.\d+)?(?:[+-]\d+(?:\.\d+)?)*$/.test(t))return NaN;
 return (t.match(/[+-]?\d+(?:\.\d+)?/g)??[]).reduce((n,x)=>n+Number(x),0);
}
function resolveAccumulation(rows){
 const result=[],groups=new Map();
 rows.forEach((row,index)=>{
  const rule=norm(row.accumulation||'acumula');
  if(rule==='acumula'){result.push({row,index});return;}
  const k=`${row.groupKey}::${rule}`;
  if(!groups.has(k))groups.set(k,[]);
  groups.get(k).push({row,index});
 });
 for(const [key,list] of groups){
  const rule=key.slice(key.lastIndexOf('::')+2);
  if(rule==='substituir')result.push(list.at(-1));
  else if(rule==='maior')result.push(list.reduce((a,b)=>(b.row.comparison??-Infinity)>(a.row.comparison??-Infinity)?b:a));
  else result.push(list[0]);
 }
 return result.sort((a,b)=>a.index-b.index).map(x=>x.row);
}
// Fórmulas explícitas para custos; números sem recurso seguem a regra legada
// (Skill = PM, Técnica = STA) para não quebrar fichas existentes.
export function parseCostModifiers(value,legacyResource='pm',allowNegative=true){
 const txt=String(value??'').trim();if(!txt)return {entries:[],legacy:false};
 if(/^[+-]?\d+(?:[.,]\d+)?$/.test(txt)){
  const amount=Number(txt.replace(',','.'));
  if(!allowNegative&&amount<0)throw new Error('Custo mínimo não pode ser negativo.');
  return {entries:[{resource:legacyResource,amount}],legacy:true};
 }
 const parts=txt.split(/\s*[,;]\s*|\s+\+\s+(?=[+-]?\d)/).filter(Boolean),entries=[];
 for(const part of parts){
  const match=part.trim().match(/^([+-]?\d+(?:[.,]\d+)?)\s+(.+?)$/);
  if(!match)throw new Error(`Fórmula de custo inválida: ${part}. Use -1 PM, -2 STA.`);
  const amount=Number(match[1].replace(',','.'));
  if(!allowNegative&&amount<0)throw new Error('Custo mínimo não pode ser negativo.');
  const resource=norm(match[2]);
  if(!resource||resource==='todas'||resource==='todos')throw new Error(`Recurso inválido: ${part}`);
  const normalized=({mana:'pm',stamina:'sta',sanidade:'san',vida:'pv'})[resource]||resource;
  entries.push({resource:normalized,amount});
 }
 return {entries,legacy:false};
}
export function passiveCosts(actor,skill){
 const rows=[],errors=[];
 for(const e of effects(actor)){
  if(e.kind!=='modificador_custo'&&e.affected!=='modificador_custo')continue;
  if(!abilityFilter(e,skill).match)continue;
  const err=errorsFor(e);if(err){errors.push(err);continue;}
  try{if(!predicateCheck(e.p,e.n,actor.system))continue;}catch(x){errors.push(`${e.item.name}: ${x.message}`);continue;}
  const defaultResource=skill?.type==='tecnica'?'sta':'pm';
  let deltas,minimum;
  try{
   deltas=parseCostModifiers(e.get('customodificador'),defaultResource,true).entries;
   minimum=parseCostModifiers(e.get('custominimo'),defaultResource,false).entries;
   if(!deltas.length)throw new Error('Modificador vazio.');
  }catch(error){errors.push(`Passivo ${e.item.name}: ${error.message}`);continue;}
  rows.push({source:e.item.name,deltas,minimum,delta:deltas.reduce((n,v)=>n+v.amount,0),floor:minimum.find(x=>x.resource===defaultResource)?.amount??null,
   accumulation:e.get('acumulo'),comparison:deltas.reduce((n,v)=>n+Math.abs(v.amount),0),groupKey:`custo:${norm(raw(e.p,`mvCostTargetMode${e.n}`)||e.get('custoalvohabilidade')||'todas')}:${norm(e.get('filtrotipodano'))}`});
 }
 return {mods:resolveAccumulation(rows),errors};
}
export function applyPassiveCost(option,actor,skill){
 const {mods,errors}=passiveCosts(actor,skill);if(errors.length)return {error:errors.join(' ')};
 const original=(option.costs??[]).map(c=>({...c}));if(!mods.length)return {option,details:null};
 const map=new Map();for(const c of original){const r=norm(c.resource);map.set(r,(map.get(r)??0)+Number(c.amount));}
 const adjustments=new Map(),floors=new Map();
 for(const m of mods){
  for(const d of m.deltas)adjustments.set(d.resource,(adjustments.get(d.resource)??0)+d.amount);
  for(const f of m.minimum)floors.set(f.resource,Math.max(floors.get(f.resource)??0,f.amount));
 }
 const finalCosts=[];const changes=[];
 for(const resource of new Set([...map.keys(),...adjustments.keys()])){
  const base=map.get(resource)??0,delta=adjustments.get(resource)??0,minimum=floors.get(resource)??0;
  // Reduções não geram custos novos e não cobram recursos ausentes.
  const final=base<=0&&delta<=0?0:Math.max(0,minimum,base+delta);
  if(final>0)finalCosts.push({resource,amount:final});
  if(base!==final)changes.push({resource,base,final,delta,minimum});
 }
 const resource=skill?.type==='tecnica'?'sta':'pm';
 const primary=changes.find(c=>c.resource===resource)??changes[0]??{resource,base:map.get(resource)??0,final:map.get(resource)??0,delta:0,minimum:0};
 return {option:{...option,costs:finalCosts},details:{...primary,changes,mods}};
}
export function passiveDamage(actor,skill,damageType=''){
 const rows=[],errors=[];
 for(const e of effects(actor)){
  if(!['dano','bonus','penalidade'].includes(e.kind)||e.affected!=='dano_adicional')continue;
  const match=abilityFilter(e,skill);if(!match.match)continue;
  // v0.1.76 compatibility: without explicit linked abilities, bonus damage
  // defaults to matching its own type with the offensive effect type.
  const bonusType=norm(e.get('tipodano'));
  if(!match.specific&&bonusType&&bonusType!=='outro'&&!typeMatches(bonusType,damageType))continue;
  const err=errorsFor(e);if(err){errors.push(err);continue;}
  try{if(!predicateCheck(e.p,e.n,actor.system))continue;}catch(x){errors.push(`${e.item.name}: ${x.message}`);continue;}
  if(e.definition==='escolhido'){errors.push(`Passivo de dano ${e.item.name} exige uma escolha que não está disponível nesta ativação.`);continue;}
  if(!['somar','conceder','subtrair'].includes(e.operation)){errors.push(`Passivo de dano ${e.item.name}: operação não suportada.`);continue;}
  const val=String(e.get('valor')??'').trim();
  if(!val||!/^(?=.{1,80}$)[0-9dD+\-*/(). ]+$/.test(val)||!['fixo','formula','dado'].includes(e.scale)){
   errors.push(`Passivo de dano ${e.item.name}: fórmula/escala ainda não suportada.`);continue;
  }
  rows.push({source:e.item.name,formula:e.operation==='subtrair'||e.kind==='penalidade'?`-(${val})`:val,damageType:bonusType||damageType,explicitDamageType:Boolean(bonusType),
   accumulation:e.get('acumulo'),comparison:Number.isFinite(meanOf(val))?Math.abs(meanOf(val)):-Infinity,
   groupKey:`dano-adicional:${bonusType}:${norm(e.get('custoalvohabilidade')||'todas')}:${norm(e.get('filtrotipodano'))}`});
 }
 return {bonuses:resolveAccumulation(rows),errors};
}
export function passiveTests(actor,testName){
 const fixed=[],optional=[],errors=[];
 for(const e of effects(actor)){
  if(!['teste','bonus','penalidade','vantagem','desvantagem'].includes(e.kind))continue;
  if(!['teste','resistencia','forca','agilidade','inteligencia','carisma','percepcao'].includes(e.affected))continue;
  const filter=norm(e.get('alvo'));
  if(filter&&!norm(testName).includes(filter)&&!['*','todos','todas'].includes(filter))continue;
  const err=errorsFor(e);
  if(err){errors.push(err);continue;}
  try{if(!predicateCheck(e.p,e.n,actor.system))continue;}catch(x){errors.push(`${e.item.name}: ${x.message}`);continue;}
  if(norm(e.get('filtroaplicacao'))==='sim'){errors.push(`Passivo de teste ${e.item.name}: filtro por habilidade não se aplica a testes livres; desative-o ou use uma Skill de dano.`);continue;}
  if(!['','acumula'].includes(norm(e.get('acumulo')))){errors.push(`Passivo de teste ${e.item.name}: escolha Somar para o acúmulo de efeitos em testes.`);continue;}
  let formula='';
  const testMode=e.kind==='teste'?e.operation:e.kind;
  if(['bonus','penalidade','somar','subtrair'].includes(testMode)){
   formula=String(e.get('valor')??'').trim();
   if(!formula||!/^(?=.{1,80}$)[0-9dD+\-*/(). ]+$/.test(formula)||!['fixo','dado','formula'].includes(e.scale)){
    errors.push(`Passivo de teste ${e.item.name}: fórmula inválida.`);continue;
   }
  }
  const rollType=testMode==='somar'?'bonus':testMode==='subtrair'?'penalidade':testMode;
  if(!['bonus','penalidade','vantagem','desvantagem'].includes(rollType)){errors.push(`Passivo de perícia ${e.item.name}: operação inválida.`);continue;}
  const originId=isItemEffectSource(e.item)?e.item.getFlag('multiverso-rpg','originItemId'):null;
  const origin=originId?actor.items.get(originId):null;
  const row={tipo:rollType,formula,item:origin?.name??e.item.name,definicao:e.definition,sourceId:e.item.id,originItemId:originId};
  (e.definition==='escolhido'?optional:fixed).push(row);
 }
 return {fixed,optional,errors};
}
