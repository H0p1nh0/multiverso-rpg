// Multiverso RPG • NPCs v1.0.13. Regras puras; também usadas pelos testes Node.
export const NPC_CATEGORIES = Object.freeze({
  comum:       {name:'Comum',        attributes:15, min:1, max:5,  trained:2, specialization:1,  specializationCap:1, abilities:1, multiplier:2, bases:{pv:10,sta:8, pm:8, san:10}},
  experiente:  {name:'Experiente',   attributes:25, min:2, max:8,  trained:3, specialization:3,  specializationCap:2, abilities:2, multiplier:3, bases:{pv:18,sta:14,pm:14,san:15}},
  especialista:{name:'Especialista', attributes:35, min:3, max:11, trained:4, specialization:5,  specializationCap:3, abilities:3, multiplier:4, bases:{pv:30,sta:22,pm:22,san:20}},
  elite:       {name:'Elite',        attributes:50, min:4, max:16, trained:5, specialization:8,  specializationCap:4, abilities:5, multiplier:5, bases:{pv:50,sta:35,pm:35,san:30}},
  lendario:    {name:'Lendário',     attributes:70, min:5, max:24, trained:7, specialization:12, specializationCap:5, abilities:8, multiplier:7, bases:{pv:80,sta:55,pm:55,san:45}}
});
export const NPC_ATTRIBUTES = Object.freeze([
  {key:'forcanumero', label:'Força', short:'FOR'},
  {key:'agilidadenumero',label:'Agilidade',short:'AGI'},
  {key:'inteligencianumero',label:'Inteligência',short:'INT'},
  {key:'carismanumero',label:'Carisma',short:'CAR'},
  {key:'percepcaonumero',label:'Percepção',short:'PER'},
  {key:'resistencianumero',label:'Resistência',short:'RES'}
]);
const S = (key,label,attribute)=>({key,label,attribute});
export const NPC_SKILLS = Object.freeze([
  S('atletismonumero','Atletismo','forcanumero'), S('fisiconumero','Físico','forcanumero'),
  S('acrobacianumero','Acrobacia','agilidadenumero'),S('furtividadenumero','Furtividade','agilidadenumero'),S('furtonumero','Furto','agilidadenumero'),S('pilotarnumero','Pilotar','agilidadenumero'),
  S('arcananumero','Arcana','inteligencianumero'),S('encantamentonumero','Encantamento','inteligencianumero'),S('estudosocultosnumero','Estudos Ocultos','inteligencianumero'),S('historianumero','História','inteligencianumero'),S('investigacaonumero','Investigação','inteligencianumero'),S('medicinanumero','Medicina','inteligencianumero'),S('tecnologianumero','Tecnologia','inteligencianumero'),S('naturezanumero','Natureza','inteligencianumero'),
  S('artesnumero','Artes','carismanumero'),S('enganacaonumero','Enganação','carismanumero'),S('intimidacaonumero','Intimidação','carismanumero'),
  S('pontarianumero','Pontaria','percepcaonumero'),S('intuicaonumero','Intuição','percepcaonumero'),
  S('podernumero','Poder','resistencianumero'),S('vontadenumero','Vontade','resistencianumero'),
  S('cutnumero','Cortantes','cortantes')
]);
export const NPC_ATTRIBUTE_PRESETS = Object.freeze({
  comum:       [4,3,2,1,3,2],
  experiente:  [5,4,5,3,4,4],
  especialista:[4,5,10,4,5,7],
  elite:       [9,8,9,7,8,9],
  lendario:    [13,10,19,6,8,14]
});
const num=(x,fallback=0)=>Number.isFinite(Number(x))&&x!==null&&x!==''?Number(x):fallback;
export function npcCategory(id){return NPC_CATEGORIES[id]??NPC_CATEGORIES.comum;}
export function npcBuild(data={}) {
  const cat=npcCategory(data.npcCategoria);
  const training=(data.npcTraining&&typeof data.npcTraining==='object')?data.npcTraining:{};
  const specialties=(data.npcSpecialization&&typeof data.npcSpecialization==='object')?data.npcSpecialization:{};
  const attrs=Object.fromEntries(NPC_ATTRIBUTES.map(a=>[a.key,num(data[a.key])]));
  const attributeTotal=Object.values(attrs).reduce((sum,v)=>sum+v,0);
  const badAttributes=NPC_ATTRIBUTES.filter(a=>!Number.isInteger(attrs[a.key])||attrs[a.key]<cat.min||attrs[a.key]>cat.max).map(a=>a.label);
  const cutsAttribute=data.npcCortantesAttr==='agilidadenumero'?'agilidadenumero':'forcanumero';
  const skills=NPC_SKILLS.map(s=>{
    const key=s.attribute==='cortantes'?cutsAttribute:s.attribute;
    const natural=Math.floor(attrs[key]/2);
    const trained=training[s.key]===true;
    const specialization=trained?Math.max(0,Math.floor(num(specialties[s.key]))):0;
    return {...s,attributeKey:key,natural,trained,training:trained?2:0,specialization,bonus:natural+(trained?2:0)+specialization};
  });
  const skillValues=Object.fromEntries(skills.map(x=>[x.key,x.bonus]));
  const trainedCount=skills.filter(x=>x.trained).length;
  const specializationUsed=skills.reduce((sum,s)=>sum+s.specialization,0);
  const specialtyOver=skills.some(s=>s.specialization>cat.specializationCap);
  const raw={
    pv:cat.bases.pv+attrs.resistencianumero*cat.multiplier,
    sta:cat.bases.sta+skillValues.atletismonumero*cat.multiplier,
    pm:cat.bases.pm+skillValues.arcananumero*cat.multiplier,
    san:cat.bases.san+skillValues.vontadenumero*cat.multiplier
  };
  const manual=(data.npcFluxOverrides&&typeof data.npcFluxOverrides==='object')?data.npcFluxOverrides:{};
  const max=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,manual[k]!==undefined&&manual[k]!==null&&manual[k]!==''&&Number.isFinite(Number(manual[k]))?Math.max(0,Math.floor(Number(manual[k]))):Math.max(0,v)]));
  return {
    cat,attrs,attributeTotal,attributeRemaining:cat.attributes-attributeTotal,
    badAttributes,skillValues,skills,trainedCount,trainedRemaining:cat.trained-trainedCount,
    specializationUsed,specializationRemaining:cat.specialization-specializationUsed,specialtyOver,
    raw,max,cutsAttribute,
    valid:attributeTotal===cat.attributes&&!badAttributes.length&&trainedCount<=cat.trained&&specializationUsed<=cat.specialization&&!specialtyOver,
    errors:[
      ...(attributeTotal!==cat.attributes?[`Atributos: ${attributeTotal}/${cat.attributes} pontos.`]:[]),
      ...(badAttributes.length?[`Atributos fora do intervalo ${cat.min}–${cat.max}: ${badAttributes.join(', ')}.`]:[]),
      ...(trainedCount>cat.trained?[`Treinamentos: ${trainedCount}/${cat.trained}.`]:[]),
      ...(specializationUsed>cat.specialization?[`Especialização: ${specializationUsed}/${cat.specialization}.`]:[]),
      ...(specialtyOver?[`Máximo de +${cat.specializationCap} em cada perícia.`]:[])
    ]
  };
}
export function npcDefaultAttributes(category='comum') {
  const preset=NPC_ATTRIBUTE_PRESETS[category]??NPC_ATTRIBUTE_PRESETS.comum;
  return Object.fromEntries(NPC_ATTRIBUTES.map((a,i)=>[a.key,preset[i]]));
}
