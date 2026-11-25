// Tipos de registro visíveis no editor de efeitos por origem.
// Cada escolha representa um Item próprio; os efeitos continuam vinculados ao Item correto.
export const TRAIT_ENTRY_KINDS = Object.freeze({
  especie: [
    {id:'especie',label:'Especificação de Espécie',type:'especie',category:''},
    {id:'vantagem-especie',label:'Vantagem de Espécie',type:'habilidadeEspecie',category:'vantagem'},
    {id:'desvantagem-especie',label:'Desvantagem de Espécie',type:'habilidadeEspecie',category:'desvantagem'}
  ],
  classe: [
    {id:'classe',label:'Especificação de Classe',type:'classe',category:''},
    {id:'subclasse',label:'Especificação de Subclasse',type:'subclasse',category:''},
    {id:'habilidade-classe',label:'Habilidade de Classe',type:'habilidadeClasse',category:''},
    {id:'habilidade-subclasse',label:'Habilidade de Subclasse',type:'habilidadeSubclasse',category:''}
  ],
  geral: [
    {id:'vantagem-geral',label:'Vantagem Geral',type:'vantagem',category:'vantagem'},
    {id:'desvantagem-geral',label:'Desvantagem Geral',type:'vantagem',category:'desvantagem'}
  ]
});
export const groupForTraitType = type => ['especie','habilidadeEspecie'].includes(type)?'especie':
  ['classe','subclasse','habilidadeClasse','habilidadeSubclasse'].includes(type)?'classe':
  type==='vantagem'?'geral':null;
export const kindsForTraitGroup = group => TRAIT_ENTRY_KINDS[group] ?? [];
export const matchesTraitKind = (item,kind) => !!item&&!!kind&&item.type===kind.type&&
  (!['habilidadeEspecie','vantagem'].includes(kind.type) ||
  (['desvantagem','negativo'].includes(String(item.system?.categoria??'').toLowerCase())
   ?kind.category==='desvantagem':kind.category==='vantagem'));
export const kindForTrait = item => kindsForTraitGroup(groupForTraitType(item?.type)).find(kind=>matchesTraitKind(item,kind)) ?? null;
