// v0.1.85 — resolução explícita dos quatro Fluxos e do único Fluxo Extra ativo.
// Nunca criar ou habilitar um Fluxo implicitamente a partir de uma expressão.
export const CORE_FLUXES=Object.freeze({
 pv:{key:'pv_atual',max:'pv_max',label:'PV'},
 pm:{key:'pm_atual',max:'pm_max',label:'PM'},
 sta:{key:'sta_atual',max:'sta_max',label:'STA'},
 san:{key:'san_atual',max:'san_max',label:'SAN'}
});
export const normalizeFluxName=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLowerCase();
export function availableFluxes(actor){
 const all=Object.entries(CORE_FLUXES).map(([id,def])=>({id,...def}));
 if(actor?.system?.fluxoextraativo===true){
  const name=String(actor.system.fluxoextranome??'').trim().replace(/\s+/g,' ');
  const id=normalizeFluxName(name);
  if(name && id && !Object.hasOwn(CORE_FLUXES,id))all.push({id:'extra',name,label:name,key:'fluxoextraatual',max:'fluxoextramax'});
 }
 return all;
}
export function fluxByName(actor,raw){
 const name=normalizeFluxName(raw);
 return availableFluxes(actor).find(x=>normalizeFluxName(x.label)===name)??null;
}
export function fluxById(actor,id){return availableFluxes(actor).find(x=>x.id===id)??null;}
export function parseFluxExpression(raw,actor,{defaultName=null,allowZero=false}={}){
 const text=String(raw??'').trim();if(!text)return null;
 const parts=text.split(/\s*\+\s*/);if(!parts.length)return null;
 const grouped=new Map();
 for(const part of parts){
  const match=part.trim().match(/^([0-9]+(?:[.,][0-9]+)?)\s*(.*?)$/u);
  if(!match)return null;
  const amount=Number(match[1].replace(',','.'));
  const name=match[2].trim()||defaultName;
  const def=fluxByName(actor,name);
  if(!def||!Number.isSafeInteger(amount)||amount>(1000000)||amount<(allowZero?0:1))return null;
  const last=grouped.get(def.key);
  grouped.set(def.key,{resource:def.id,label:def.label,key:def.key,max:def.max,amount:(last?.amount??0)+amount});
 }
 const costs=[...grouped.values()];
 return costs.length&&costs.every(c=>Number.isSafeInteger(c.amount)&&c.amount<=1000000)?costs:null;
}
export function signedResourceBalance(actor,costs,balances=null){
 const sheet=actor?.system??{};
 const totals=new Map();
 for(const c of costs??[]){
  const def=fluxById(actor,c.resource);
  if(!def||def.key!==c.key||!Number.isSafeInteger(c.amount)||c.amount<0)return {ok:false,invalid:c};
  totals.set(def.key,(totals.get(def.key)??0)+c.amount);
 }
 for(const [key,amount] of totals){
  const current=Number(balances?.[key]??sheet[key]);
  if(!Number.isFinite(current)||current<amount)return {ok:false,key,required:amount,current};
 }
 return {ok:true,totals};
}

// v0.1.87: diagnóstico apenas; NÃO habilita nem cria recursos automaticamente.
export function fluxExpressionError(raw,actor,{defaultName=null,allowZero=false}={}) {
 const parts=String(raw??'').trim().split(/\s*\+\s*/);
 for(const part of parts){
  const match=part.trim().match(/^([0-9]+(?:[.,][0-9]+)?)\s*(.*?)$/u);
  if(!match)return null; // expressão especial: continua requerendo migração
  const label=match[2].trim()||defaultName;
  if(!label)return 'Informe o nome do Fluxo utilizado no custo.';
  if(/^[%*/=\-]/.test(label))return null; // fórmula especial, não é nome de Fluxo
  const amount=Number(match[1].replace(',','.'));
  if(!Number.isSafeInteger(amount)||amount>(1000000)||amount<(allowZero?0:1))return `Quantidade inválida para ${label}. Use valor inteiro fixo.`;
  if(!fluxByName(actor,label))return `O Fluxo "${label}" não existe ou não está ativo na ficha. Confira o nome cadastrado.`;
 }
 return null;
}
