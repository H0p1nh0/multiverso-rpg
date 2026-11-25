// Bônus passivos fixos, calculados em memória a partir das habilidades presentes.
// Não altera os valores-base persistidos e não duplica bônus ao reabrir a ficha.
import {isItemEffectSource,itemSourceActive} from './item-effect-links.mjs';
const KEYS={forca:'forcanumero',agilidade:'agilidadenumero',resistencia:'resistencianumero',inteligencia:'inteligencianumero',carisma:'carismanumero',percepcao:'percepcaonumero',esquiva:'esquivabonus',bloqueio:'bloqueiobonus',deslocamento:'deslocamentonumero',pv_max:'pv_max',pm_max:'pm_max',sta_max:'sta_max',san_max:'san_max'};
const norm=v=>String(v??'').trim().toLowerCase();
export function passiveAttributeBonuses(actor){
 const totals={};
 for(const item of actor?.items??[]){
  if(!['skill','tecnica'].includes(item.type))continue;
  const flag=(name)=>item.getFlag?.('multiverso-rpg',name);
  if(flag('itemCastCloneV1')===true||flag('itemAbilityTemplateV1')===true||flag('manualEffectSourceV1')===true)continue;
  if(isItemEffectSource(item)&&!itemSourceActive(item))continue;
  if(flag('traitEffectSourceV1')===true && !actor.items.get(flag('originItemId')))continue;
  const legacy=flag('legacyEffectId');
  if(legacy && actor.effects?.get(legacy)?.disabled===false)continue;
  const props=item.system?.props??{};
  for(let i=1;i<=5;i++){
   const suffix=i===1?'':String(i),prefix=`efeito${item.type}`;
   const field=k=>props[`${prefix}${k}${suffix}`];
   const activity=norm(field('atividade')??props[`ativacaotempotipo${item.type}${suffix}`]??(i===1?props[`ativacaotempotipo${item.type}`]:''));
   if(activity!=='passiva'||!['atributo','bonus','penalidade','deslocamento','defesa'].includes(norm(field('tipo'))))continue;
   if(!['','proprio'].includes(norm(field('receptor'))))continue;
   if(!['','fixo'].includes(norm(field('definicao')))||!['','fixo'].includes(norm(field('escala'))))continue;
   const key=KEYS[norm(field('afetado'))];
   if(!key)continue;
   const op=norm(field('operacao'));
   if(!['somar','subtrair'].includes(op))continue;
   const value=Number(String(field('valor')??'').replace(',','.'));
   if(!Number.isFinite(value)||String(field('valor')??'').trim()==='')continue;
   // Não aplicar automaticamente efeitos condicionais, com custo ou resistência.
   if(field('resistenciaativa')==='sim'||field('condicao')||field('prerequisitos')||field('custo')||field('sustentacao')||field('duracao'))continue;
   totals[key]=(totals[key]??0)+(op==='subtrair'?-value:value);
  }
 }
 return totals;
}
