import {changeList,conditionFlags} from "./condition-mechanics.mjs";
// Efeitos mantidos dependentes de dano confirmado manualmente.
// O custo da Skill já foi pago na ativação; não cobrar custo nem uso novamente.
import {planTrackedEntries,readTracked} from './effect-tracking.mjs';
import {buildAttributeActivationPatch} from './maintained-attributes.mjs';
const NS='multiverso-rpg';
export async function applyDeferredMaintained(actor,item,effects){
 if(!effects?.length)return 0;
 if(!item||!actor||!actor.isOwner)throw Error('Sem permissão ou Skill ausente para encadeamento.');
 if(effects.some(e=>e.cadence!=='maintained'||!['condicao','atributo','bonus','penalidade','teste','deslocamento','defesa','resistencia','vulnerabilidade','imunidade'].includes(e.type)))throw Error('Somente bônus e condições mantidas podem ser condicionados à aplicação manual de dano.');
 const old=readTracked(actor);
 const planned=planTrackedEntries({actor,item,effects});
 if(planned.length!==effects.length)throw Error('Não foi possível registrar a duração dos efeitos condicionados.');
 const attrs=buildAttributeActivationPatch(actor,planned);
 const prev=Object.fromEntries(Object.entries(attrs.patch).map(([k])=>[k,actor.system[k.slice(7)]]));
 const markers=planned.map(en=>{
  const effect=en.maintainedEffect;
  if(!effect)throw Error('Efeito encadeado não possui marcador.');
  if(effect.protection)return {name:`Proteção: ${en.name}`,disabled:false,changes:[],flags:{[NS]:{trackingId:en.id,sourceUuid:en.sourceUuid,protecaoDano:{...effect.protection}}}};
  if(effect.condition)return {name:effect.name||en.name,disabled:false,changes:changeList(effect.mechanics??[]),flags:{[NS]:{trackingId:en.id,sourceUuid:en.sourceUuid,...conditionFlags(effect.mechanics??[]),blocksAction:(effect.mechanics??[]).some(m=>m.blocksAction)}}};
  return {name:`${en.name} (${en.source})`,disabled:false,changes:[],flags:{[NS]:{trackingId:en.id,sourceUuid:en.sourceUuid,storedAttributeDelta:{key:effect.attributeKey,delta:effect.delta}}}};
 });
 const created=[];let updated=false,flagSaved=false;
 try{
  for(const marker of markers){const active=await actor.createEmbeddedDocuments('ActiveEffect',[marker]);created.push(...active);}
  if(Object.keys(attrs.patch).length){await actor.update(attrs.patch);updated=true;}
  await actor.setFlag(NS,'trackedDurations',[...old,...planned]);flagSaved=true;
  return planned.length;
 }catch(error){
  if(flagSaved)try{await actor.setFlag(NS,'trackedDurations',old)}catch(e){console.error('Multiverso | rollback encadeamento',e)}
  if(updated)try{await actor.update(prev)}catch(e){console.error('Multiverso | rollback atributo',e)}
  for(const ae of created.reverse())try{await ae.delete()}catch(e){console.error('Multiverso | rollback marcador',e)}
  throw error;
 }
}
