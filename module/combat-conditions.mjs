// Condições gerais para a aba Combate, mantendo o motor de ActiveEffects como autoridade.
// Não confundir uma condição narrativa, um status ou um modificador de atributo
// com a mecânica particular de restrição de ações.
const NS='multiverso-rpg';
const ACTIONS={acao:'Padrão',movimento:'Movimento',bonus:'Bônus',completa:'Completa',reacao:'Reação',todas:'Todas as ações'};
export function listCombatConditions(actor,tracked=[]){
  const activeTracked=new Set((tracked??[]).filter(e=>e?.maintainedEffect?.condition).map(e=>e.id));
  const result=[];
  for(const effect of actor?.effects??[]){
    if(effect?.disabled || effect?.isSuppressed)continue;
    const get=k=>effect.getFlag?.(NS,k)??effect.flags?.[NS]?.[k];
    const trackingId=get('trackingId');
    const statuses=effect.statuses;
    const hasStatus=Boolean(statuses?.size ?? statuses?.length ?? 0) || Boolean(effect.flags?.core?.statusId);
    const isCondition=Boolean(get('isCondition') || get('blocksAction') || (trackingId&&activeTracked.has(trackingId)) || hasStatus);
    if(!isCondition)continue;
    const block=Boolean(get('blocksAction'));
    const types=block?(Array.isArray(get('blockedActionTypes'))&&get('blockedActionTypes').length?get('blockedActionTypes'):['todas']):[];
    const names=[...new Set(types.map(t=>ACTIONS[t]??String(t)))];
    result.push({id:effect.id,name:String(effect.name||effect.label||'Condição'),description:block?'Restringe: '+names.join(', '):'Condição ativa',blocksAction:block});
  }
  return result;
}
