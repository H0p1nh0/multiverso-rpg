// Motor compartilhado de efeitos para traços, espécie, classe e vantagens.
// Um Item Skill técnico armazena as propriedades canônicas do motor original.
// O Item de origem continua sendo o único registro visível nas subabas de Habilidades.
import {executeNativeEffectTest} from './native-effects.mjs';
import {openMultiversoSkillEffectEditor} from './skill-editor-original.mjs';
const NS='multiverso-rpg';
export const TRAIT_TYPES=new Set(['especie','habilidadeEspecie','classe','subclasse','habilidadeClasse','habilidadeSubclasse','vantagem']);
export const isTraitEffectSource=item=>item?.getFlag?.(NS,'traitEffectSourceV1')===true;
export const sourceForTrait=item=>{
  if(!item||!TRAIT_TYPES.has(item.type)||item.parent?.documentName!=='Actor')return null;
  const actor=item.parent;
  const ref=item.getFlag?.(NS,'traitEffectSourceIdV1');
  const stored=ref?actor.items.get(ref):null;
  if(stored&&isTraitEffectSource(stored)&&stored.getFlag(NS,'originItemId')===item.id)return stored;
  return [...(actor.items??[])].find(e=>isTraitEffectSource(e)&&e.getFlag(NS,'originItemId')===item.id)??null;
};
export const hasActiveTraitEffects=item=>{
  const s=sourceForTrait(item);if(!s)return false;
  const p=s.system?.props??{};
  for(let i=1;i<=Math.min(5,Number(p.mvEffectCount)||0);i++){
    const k=i===1?'':String(i);
    if(!String(p[`efeitoskilltipo${k}`]??'').trim())continue;
    const activity=String(p[`ativacaotempotiposkill${k}`]??'passiva').trim();
    if(activity!=='passiva')return true;
  }
  return false;
};
export async function getOrCreateTraitSource(item){
  if(!TRAIT_TYPES.has(item?.type)||item.parent?.documentName!=='Actor')throw Error('O registro deve pertencer a um personagem.');
  if(!item.isOwner&&!game.user?.isGM)throw Error('Sem permissão para configurar efeitos neste personagem.');
  let source=sourceForTrait(item);
  if(source)return source;
  const flags={[NS]:{traitEffectSourceV1:true,originItemId:item.id,originType:item.type}};
  const [created]=await item.parent.createEmbeddedDocuments('Item',[{
    name:item.name,type:'skill',img:item.img,system:{descricao:item.system?.descricao??'',props:{mvEffectCount:0,descricaoskill:item.system?.descricao??''}},flags
  }]);
  if(!created)throw Error('Não foi possível criar a configuração de efeitos.');
  source=created;
  await item.setFlag(NS,'traitEffectSourceIdV1',source.id);
  return source;
}
export async function openTraitEffects(item){
  const source=await getOrCreateTraitSource(item);
  // A edição usa a janela *original*, sem cópia de formulários.
  openMultiversoSkillEffectEditor(source);
  return source;
}
export async function activateTraitEffects(item){
  if(!item?.isOwner&&!game.user?.isGM)throw Error('Sem permissão para ativar habilidades.');
  const source=sourceForTrait(item);
  if(!source||!hasActiveTraitEffects(item))throw Error('Este registro não possui efeitos ativáveis.');
  // Mesmo executor e validação do motor de Skills/Técnicas.
  return executeNativeEffectTest(source);
}
export async function deleteTraitEffects(item){
  const source=sourceForTrait(item);
  if(source)await source.delete();
}
