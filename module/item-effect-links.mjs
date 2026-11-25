// v0.2.39 — Itens usam a configuração canônica do motor de Skills/Técnicas.
// A origem técnica é uma Skill embutida, invisível nas listas de Skills.
const NS='multiverso-rpg';
export const isItemEffectSource=item=>item?.getFlag?.(NS,'itemEffectSourceV1')===true;
export const itemForSource=source=>{
  if(!isItemEffectSource(source))return null;
  const actor=source.parent;
  return actor?.documentName==='Actor'?actor.items.get(source.getFlag(NS,'originItemId')):null;
};
export const itemSourceActive=source=>{
  const origin=itemForSource(source);
  // Passivos de equipamento nunca se aplicam se o objeto saiu da ficha,
  // acabou ou foi guardado. Não conceder passivos por mero cadastro.
  if(origin?.type!=='equipamento'||Number(origin.system?.quantidade??0)<=0||origin.system?.equipado!==true)return false;
  const cfg=origin.getFlag?.(NS,'itemMotorV1');
  return !cfg?.syncRequired||cfg.synced===true;
};
export const sourceForItem=item=>{
  if(item?.type!=='equipamento'||item.parent?.documentName!=='Actor')return null;
  const actor=item.parent;
  const ref=item.getFlag?.(NS,'itemEffectSourceIdV1');
  const stored=ref?actor.items.get(ref):null;
  if(stored&&isItemEffectSource(stored)&&stored.getFlag(NS,'originItemId')===item.id)return stored;
  return [...actor.items].find(x=>isItemEffectSource(x)&&x.getFlag(NS,'originItemId')===item.id)??null;
};
export const hasItemEffects=item=>{
  const source=sourceForItem(item);
  if(!source)return false;
  const p=source.system?.props??{};
  const count=Math.min(5,Number(p.mvEffectCount)||0);
  return Array.from({length:count},(_,i)=>i+1).some(i=>String(p[`efeitoskilltipo${i===1?'':i}`]??'').trim());
};
export const hasActivatedItemEffects=item=>{
  const source=sourceForItem(item);
  if(!source)return false;
  const p=source.system?.props??{};
  const count=Math.min(5,Number(p.mvEffectCount)||0);
  return Array.from({length:count},(_,i)=>i+1).some(i=>{
    const suffix=i===1?'':String(i);
    return String(p[`efeitoskilltipo${suffix}`]??'').trim() &&
      String(p[`ativacaotempotiposkill${suffix}`]??'').trim().toLowerCase()!=='passiva';
  });
};
export async function getOrCreateItemSource(item){
  if(item?.type!=='equipamento'||item.parent?.documentName!=='Actor')throw Error('O item precisa estar no inventário de um personagem.');
  if(!item.isOwner&&!game.user?.isGM)throw Error('Sem permissão para configurar os efeitos deste item.');
  const existing=sourceForItem(item);
  if(existing)return existing;
  const actor=item.parent;
  const [source]=await actor.createEmbeddedDocuments('Item',[{
    name:item.name,
    type:'skill',img:item.img,
    flags:{[NS]:{itemEffectSourceV1:true,originItemId:item.id}},
    system:{descricao:item.system?.descricao??'',props:{mvEffectCount:0,descricaoskill:item.system?.descricao??''}}
  }]);
  if(!source)throw Error('Não foi possível criar a configuração de efeitos.');
  await item.setFlag(NS,'itemEffectSourceIdV1',source.id);
  return source;
}
export async function deleteItemSource(item){
  const source=sourceForItem(item);
  if(source)await source.delete();
}
export async function activateItemEffects(item,{skipAction=false,onlySlots=null}={}){
  if(item?.type!=='equipamento'||item.parent?.documentName!=='Actor')throw Error('Item inválido.');
  if(!item.isOwner&&!game.user?.isGM)throw Error('Sem permissão para usar este item.');
  if(Number(item.system?.quantidade??0)<=0)throw Error('Não há unidades disponíveis.');
  const source=sourceForItem(item);
  if(!source||!hasActivatedItemEffects(item))return false;
  const {executeNativeEffectTest}=await import('./native-effects.mjs');
  return executeNativeEffectTest(source,{skipAction,onlySlots});
}
