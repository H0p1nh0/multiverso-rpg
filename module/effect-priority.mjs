// Política de acúmulo compatível com o motor antigo: acumular, não acumular,
// apenas o maior valor equivalente ou substituir o anterior.
export function equivalentMaintained(old,e){
 const data=old?.maintainedEffect;
 if(!data)return false;
 if(e.type==='condicao')return !!data.condition&&data.name===e.conditionName;
 // Proteções são agrupadas por natureza E tipo de dano. Uma imunidade de Fogo
 // não pode substituir uma resistência de Frio nem outra categoria de proteção.
 if(e.protection)return !!data.protection
   && String(data.protection.natureza)===String(e.protection.natureza)
   && String(data.protection.tipoDano||'todos')===String(e.protection.tipoDano||'todos');
 const signed=Number(e.value)*(e.op==='subtrair'?-1:1);
 // Bônus e penalidades no mesmo atributo são grupos diferentes.
 return !data.condition&&data.attributeKey===e.attributeKey&&Math.sign(Number(data.delta))===Math.sign(signed);
}
export function planPriority({oldTracked,steps,getMode}){
 const removals=new Map(),included=[];const skips=[];
 const chosen=new Map();
 for(const step of steps){
  if(step.deferUntilManual||step.effect.cadence!=='maintained'){included.push(step);continue;}
  const e=step.effect,mode=getMode(e);
  if(!['','acumula','nao','maior','substituir'].includes(mode))throw Error(`Prioridade «${mode}» não suportada.`);
  const key=e.type==='condicao'?`condicao:${e.conditionName}`:e.protection?`protecao:${e.protection.natureza}:${e.protection.tipoDano||'todos'}`:`attr:${e.attributeKey}`;
  if(mode!=='acumula'&&chosen.has(key))throw Error('Dois efeitos da mesma Skill não podem aplicar prioridades incompatíveis no mesmo atributo/condição.');
  chosen.set(key,e);
  const similar=oldTracked.filter(old=>equivalentMaintained(old,e));
  if(mode==='nao'&&similar.length)throw Error(`O efeito ${e.index} não acumula e já está ativo.`);
  if(mode==='maior'){
   if(e.type==='condicao'||(e.protection&&e.protection.natureza!=='resistencia'))throw Error('Só o maior valor exige bônus, penalidade ou resistência numérica. Use Substituir ou Não acumula para condições, imunidades e vulnerabilidades.');
   const newMagnitude=e.protection?Number(e.protection.valor):Math.abs(Number(e.value));
   if(similar.some(old=>(old.maintainedEffect.protection?Number(old.maintainedEffect.protection.valor):Math.abs(Number(old.maintainedEffect.delta)))>=newMagnitude)){skips.push(e.index);continue;}
   for(const old of similar)removals.set(old.id,old);
  }
  if(mode==='substituir')for(const old of similar)removals.set(old.id,old);
  included.push(step);
 }
 return {included,removals:[...removals.values()],skips};
}
