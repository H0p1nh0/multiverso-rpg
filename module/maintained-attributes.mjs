// Multiverso RPG v0.1.83 — atributos mantidos: alteração real na ficha + marcador ActiveEffect.
// O registro da duração é a autoridade; nenhuma mudança é inferida somente pelo nome.
import {availablePericias} from './pericia-fields.mjs';
const NS='multiverso-rpg';
const MAX_TO_CURRENT={pv_max:'pv_atual',pm_max:'pm_atual',sta_max:'sta_atual',san_max:'san_atual',fluxoextramax:'fluxoextraatual'};
const ATTR_KEYS=new Set(['pv_max','pm_max','sta_max','san_max','fluxoextramax','forcanumero','agilidadenumero','resistencianumero','inteligencianumero','carismanumero','percepcaonumero','deslocamentonumero','esquivabonus','bloqueiobonus',...availablePericias().map(x=>x.key)]);
export const isStoredAttribute=entry=>entry?.maintainedEffect?.storedOnSheet===true;
export const readStoredValue=(actor,key)=>Number(actor?._source?.system?.[key]??actor?.system?.[key]);
export function buildAttributeActivationPatch(actor,entries){
 const totals=new Map(),before={};
 for(const entry of entries){
  if(!isStoredAttribute(entry))continue;
  const {attributeKey:key,delta}=entry.maintainedEffect;
  if(!ATTR_KEYS.has(key)||!Number.isFinite(delta))throw new Error(`Atributo mantido inválido em ${entry.name}.`);
  totals.set(key,(totals.get(key)??0)+delta);
 }
 const patch={};
 for(const [key,delta] of totals){
  const value=readStoredValue(actor,key);
  if(!Number.isFinite(value))throw new Error(`Valor atual inválido para ${key}.`);
  if(key==='deslocamentonumero'&&value+delta<0)throw new Error('O deslocamento não pode ser reduzido abaixo de zero.');
  if(Object.hasOwn(MAX_TO_CURRENT,key)&&value+delta<0)throw new Error('O Fluxo máximo não pode ficar negativo.');
  before[key]=value;
  patch[`system.${key}`]=value+delta;
  if(Object.hasOwn(MAX_TO_CURRENT,key)){const currentKey=MAX_TO_CURRENT[key];const current=readStoredValue(actor,currentKey);if(current>value+delta){before[currentKey]=current;patch[`system.${currentKey}`]=value+delta;}}
 }
 return {patch,before};
}
// Também usado no encerramento manual e no fim de cena.
// v0.1.82 e condições com ActiveEffect ADD continuam funcionando pelo caminho legado.
export async function endMaintainedEffect(actor,entry){
 const ae=Array.from(actor?.effects??[]).find(e=>e.getFlag(NS,'trackingId')===entry?.id);
 // Uma condição de uso único (ex.: Inspirado) pode ter seu ActiveEffect
 // consumido antes de terminar a aura. A duração/tracking remanescente deve
 // poder ser removida sem tentar reverter um modificador inexistente.
 // Atributos efetivamente gravados na ficha continuam exigindo seu marcador:
 // sem ele não é seguro reverter o delta.
 if(!ae){
  if(!isStoredAttribute(entry))return;
  throw new Error(`Efeito ativo não encontrado: ${entry?.name??'sem nome'}.`);
 }
 if(!isStoredAttribute(entry)){await ae.delete();return;}
 const {attributeKey:key,delta}=entry.maintainedEffect;
 if(!ATTR_KEYS.has(key)||!Number.isFinite(delta))throw new Error(`Atributo inválido ao encerrar ${entry.name}.`);
 const old=readStoredValue(actor,key);
 if(!Number.isFinite(old))throw new Error(`Valor atual inválido ao encerrar ${entry.name}.`);
 // Primeiro subtrai exatamente a contribuição aplicada; outras Skills continuam somadas.
 const value=old-delta;
 if(Object.hasOwn(MAX_TO_CURRENT,key)&&value<0)throw new Error('O Fluxo máximo não pode terminar negativo.');
 const currentKey=MAX_TO_CURRENT[key],current=currentKey?readStoredValue(actor,currentKey):null;
 const patch={[`system.${key}`]:value};
 if(currentKey&&current>value)patch[`system.${currentKey}`]=Math.max(0,value);
 await actor.update(patch);
 try{await ae.delete();}
 catch(err){
  try{await actor.update({[`system.${key}`]:old,...(currentKey&&Number.isFinite(current)?{[`system.${currentKey}`]:current}:{})});}
  catch(revertError){console.error('Multiverso RPG | falha crítica ao restaurar atributo',revertError);}
  throw err;
 }
}
