// v0.1.93 — Custos determinísticos expressos no cadastro, sem eval.
// Complementa, não substitui, o parser de custos fixos aprovado na v0.1.85.
import {parseFluxExpression,fluxByName} from './extra-flux.mjs';
import {prepareFormula,evaluateArithmetic} from './effect-formulas.mjs';
// Alternativas são separadas por " / " ou "|" SOMENTE fora de parênteses.
// Evita transformar '(@forca / 2) PM' em duas alternativas.
export function splitCostAlternatives(raw){
 const src=String(raw??''),parts=[];let depth=0,start=0;
 for(let i=0;i<src.length;i++){
  if(src[i]==='(')depth++;else if(src[i]===')')depth--;
  if(depth<0)return null;
  if(depth!==0)continue;
  const pipe=src[i]==='|',slash=src[i]==='/'&&/\s/.test(src[i-1]??'')&&/\s/.test(src[i+1]??'');
  if(pipe||slash){parts.push(src.slice(start,i).trim());start=i+1;}
 }
 if(depth!==0)return null;parts.push(src.slice(start).trim());
 return parts.every(Boolean)?parts:null;
}
export function splitCostParts(raw){
 const parts=[];let depth=0,from=0;const text=String(raw??'');
 for(let i=0;i<text.length;i++){
  if(text[i]==='(')depth++;else if(text[i]===')')depth--;
  if(depth<0)return null;
  if(text[i]==='+'&&depth===0){parts.push(text.slice(from,i).trim());from=i+1;}
 }
 if(depth!==0)return null;parts.push(text.slice(from).trim());
 return parts.every(Boolean)?parts:null;
}
export function costPart(raw,actor,item,defaultName){
 const text=String(raw??'').trim();
 // Números + recursos (inclusive Fluxos Extras com espaços) continuam no parser antigo.
 const fixed=parseFluxExpression(text,actor,{defaultName,allowZero:true});
 if(fixed)return {costs:fixed};
 // Porcentagem do valor MÁXIMO cadastrado — arredonda para cima, sempre em unidade inteira.
 const percent=text.match(/^\(?\s*(\d+(?:[.,]\d+)?)\s*%\s*\)?\s*(.+)$/u);
 if(percent){
  const def=fluxByName(actor,percent[2].trim());
  if(!def)return {error:`Fluxo "${percent[2].trim()}" não existe ou não está ativo.`};
  const max=Number(actor?.system?.[def.max]);
  const fraction=Number(percent[1].replace(',','.'));
  if(!Number.isFinite(max)||max<0||fraction<0)return {error:'Percentual ou máximo inválido.'};
  const amount=Math.ceil(max*fraction/100);
  if(!Number.isSafeInteger(amount)||amount>1000000)return {error:'Percentual calculou um custo inválido.'};
  return {costs:[{resource:def.id,label:def.label,key:def.key,max:def.max,amount}],detail:`${fraction}% de ${def.label} máximo (${max}) = ${amount}`};
 }
 // Fórmula aritmética entre parênteses, seguida do nome do Fluxo.
 const expr=text.match(/^\(([^()]+)\)\s*(.+)$/u);
 if(expr){
  const def=fluxByName(actor,expr[2].trim());
  if(!def)return {error:`Fluxo "${expr[2].trim()}" não existe ou não está ativo.`};
  const prepared=prepareFormula(expr[1],actor,item);
  const rawValue=prepared===null?NaN:evaluateArithmetic(prepared);
  if(!Number.isFinite(rawValue)||rawValue<0)return {error:'Fórmula de custo inválida. Use operações ou variáveis conhecidas, sem dados.'};
  const amount=Math.ceil(rawValue);
  if(!Number.isSafeInteger(amount)||amount>1000000)return {error:'Custo da fórmula fora do limite.'};
  return {costs:[{resource:def.id,label:def.label,key:def.key,max:def.max,amount}],detail:`(${expr[1]}) ${def.label} = ${amount}`};
 }
 return {error:`Custo não reconhecido: "${text}". Use quantidade fixa, percentual (10% PM) ou fórmula ((@forca / 2) PM).`};
}
export function parseAdvancedCosts(raw,actor,item,defaultName){
 const direct=parseFluxExpression(raw,actor,{defaultName,allowZero:true});
 if(direct)return {costs:direct,details:[]};
 const parts=splitCostParts(raw);
 if(!parts)return {error:'Custo contém parênteses ou parcelas inválidas.'};
 const merged=new Map(),details=[];
 for(const part of parts){
  const parsed=costPart(part,actor,item,defaultName);
  if(parsed.error)return parsed;
  for(const c of parsed.costs){const last=merged.get(c.key);merged.set(c.key,{...c,amount:c.amount+(last?.amount??0)});}
  if(parsed.detail)details.push(parsed.detail);
 }
 const costs=[...merged.values()];
 if(!costs.length||costs.some(c=>!Number.isSafeInteger(c.amount)||c.amount>1000000))return {error:'Soma de custos fora do limite.'};
 return {costs,details};
}
// Faixa antiga: '1-3 PM' produz opções explícitas (sem rolagem oculta).
export function expandCostRange(raw,defaultName){
 const match=String(raw??'').trim().match(/^(\d+)\s*[-–—]\s*(\d+)\s*(.*)$/u);
 if(!match)return null;
 const lo=Number(match[1]),hi=Number(match[2]);
 const name=match[3]?.trim()||defaultName;
 if(!name||!Number.isSafeInteger(lo)||!Number.isSafeInteger(hi)||lo<0||hi<lo||hi-lo>20)return null;
 return Array.from({length:hi-lo+1},(_,i)=>`${lo+i} ${name}`);
}
