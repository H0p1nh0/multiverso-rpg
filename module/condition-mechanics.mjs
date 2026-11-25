// Mecânicas internas tipadas de condições (compatível com registros anteriores).
export const NS='multiverso-rpg';
export const VALUE_KINDS=new Set(['attribute','movement','defense','dodge','block','capacity']);
export function changeList(mechanics=[]){
 const changes=[];
 for(const m of mechanics){
  if(m.blocksAction||m.kind==='capacity'||m.kind==='damage')continue;
  const keys=m.attributeKey?[m.attributeKey]:[];
  for(const key of keys)changes.push({key:`system.${key}`,mode:CONST.ACTIVE_EFFECT_MODES.ADD,value:String(m.delta),priority:20});
 }
 return changes;
}
export function conditionFlags(mechanics=[]){return {conditionMechanics:mechanics.filter(m=>m.kind!=='attribute'&&!m.blocksAction)};}
export function capacityFactor(actor){
  let factor=1;
  for(const effect of actor?.effects??[]){if(effect.disabled||effect.isSuppressed)continue;
   for(const m of effect.getFlag?.(NS,'conditionMechanics')??[]){if(m.kind==='capacity'&&Number.isFinite(m.delta))factor*=Math.max(0,1+m.delta/100);}
  }
  return factor;
}

// Dano adicional de condições ativas: calculado no instante da rolagem,
// nunca persiste no atributo base e desaparece ao encerrar a condição.
export function conditionDamageBonus(actor,{direction='caused',attackKind='any'}={}){
 let total=0;
 for(const effect of actor?.effects??[]){
  if(effect.disabled||effect.isSuppressed)continue;
  for(const m of effect.getFlag?.(NS,'conditionMechanics')??[]){
   if(m.kind!=='damage'||m.diceFormula||m.direction!==direction||!Number.isFinite(m.delta))continue;
   if(m.scope && m.scope!=='any' && m.scope!==attackKind && attackKind!=='any')continue;
   total+=m.delta;
  }
 }
 return total;
}

// Vantagem/desvantagem de condições ativas. O identificador do efeito permite
// consumir apenas a mecânica de uso único, preservando outros efeitos da condição.
export function conditionTestModifiers(actor,testKey='all'){
 const modifiers=[];
 // Em Chamas impõe desvantagem aos testes relacionados à Agilidade.
 const agilityTests=new Set(['agilidadenumero','acrobacianumero','atletismonumero','furtividadenumero','furtonumero','pilotarnumero','esquivabonus']);
 if(agilityTests.has(String(testKey)) && [...(actor?.effects??[])].some(e=>!e.disabled&&!e.isSuppressed&&String(e.name??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()==='em chamas'))
  modifiers.push({effect:null,index:-1,mode:'desvantagem',uses:'continuous',name:'Em Chamas'});
 for(const effect of actor?.effects??[]){
  if(effect.disabled||effect.isSuppressed)continue;
  const consumed=effect.getFlag?.(NS,'consumedTestMechanics')??[];
  const list=effect.getFlag?.(NS,'conditionMechanics')??[];
  for(let index=0;index<list.length;index++){
   const m=list[index];
   if(m.kind!=='advantage'||!['vantagem','desvantagem'].includes(m.mode))continue;
   if(m.scope&&m.scope!=='all'&&m.scope!==testKey)continue;
   if(consumed.includes(index))continue;
   modifiers.push({effect,index,mode:m.mode,uses:m.uses||'continuous',name:m.name||effect.name});
  }
 }
 return modifiers;
}

export async function consumeConditionTestModifiers(modifiers=[]){
 const grouped=new Map();
 for(const m of modifiers.filter(m=>m.uses==='once')){
  if(!grouped.has(m.effect.id))grouped.set(m.effect.id,{effect:m.effect,indices:[]});
  grouped.get(m.effect.id).indices.push(m.index);
 }
 for(const {effect,indices} of grouped.values()){
  const all=effect.getFlag?.(NS,'conditionMechanics')??[];
  const consumed=[...new Set([...(effect.getFlag?.(NS,'consumedTestMechanics')??[]),...indices])];
  // Remove a condição quando seu único efeito mecânico foi consumido.
  // Se houver outras mecânicas, persiste o marcador mas sem conceder novamente a vantagem.
  if(all.length&&all.every((m,i)=>m.kind==='advantage'&&m.uses==='once'&&consumed.includes(i))){
   // O marcador E a duração são a mesma condição. Não deixar um
   // registro órfão na aba Efeitos após o uso de Inspirado.
   const owner=effect.parent;
   const trackingId=effect.getFlag?.(NS,'trackingId');
   await owner.deleteEmbeddedDocuments('ActiveEffect',[effect.id]);
   if(trackingId){
    const tracked=owner.getFlag(NS,'trackedDurations');
    if(Array.isArray(tracked)&&tracked.some(t=>t.id===trackingId))
     await owner.setFlag(NS,'trackedDurations',tracked.filter(t=>t.id!==trackingId));
   }
  }else await effect.setFlag(NS,'consumedTestMechanics',consumed);
 }
}
