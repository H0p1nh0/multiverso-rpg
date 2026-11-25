// v0.1.89 — Fonte única das opções de atributo/perícia para Descanso Curto
// dos Fluxos Extras. Os códigos correspondem aos dados nativos da ficha.
export const EXTRA_REST_BASE_OPTIONS=Object.freeze([
  {key:'agilidadenumero',label:'Agilidade',group:'Atributos'},
  {key:'forcanumero',label:'Força',group:'Atributos'},
  {key:'inteligencianumero',label:'Inteligência',group:'Atributos'},
  {key:'carismanumero',label:'Carisma',group:'Atributos'},
  {key:'percepcaonumero',label:'Percepção',group:'Atributos'},
  {key:'resistencianumero',label:'Resistência',group:'Atributos'},
  {key:'cutnumero',label:'Cortantes',group:'Perícias ofensivas'},
  {key:'fisiconumero',label:'Físico',group:'Perícias ofensivas'},
  {key:'pontarianumero',label:'Pontaria',group:'Perícias ofensivas'},
  {key:'arcananumero',label:'Arcana',group:'Perícias ofensivas'},
  {key:'encantamentonumero',label:'Encantamento',group:'Perícias ofensivas'},
  {key:'podernumero',label:'Poder',group:'Perícias ofensivas'},
  {key:'artesnumero',label:'Artes',group:'Perícias mentais'},
  {key:'enganacaonumero',label:'Enganação',group:'Perícias mentais'},
  {key:'estudosocultosnumero',label:'Estudos Ocultos',group:'Perícias mentais'},
  {key:'historianumero',label:'História',group:'Perícias mentais'},
  {key:'investigacaonumero',label:'Investigação',group:'Perícias mentais'},
  {key:'medicinanumero',label:'Medicina',group:'Perícias mentais'},
  {key:'pilotarnumero',label:'Pilotar',group:'Perícias mentais'},
  {key:'tecnologianumero',label:'Tecnologia',group:'Perícias mentais'},
  {key:'acrobacianumero',label:'Acrobacia',group:'Perícias físicas'},
  {key:'atletismonumero',label:'Atletismo',group:'Perícias físicas'},
  {key:'furtividadenumero',label:'Furtividade',group:'Perícias físicas'},
  {key:'furtonumero',label:'Furto',group:'Perícias físicas'},
  {key:'intimidacaonumero',label:'Intimidação',group:'Perícias físicas'},
  {key:'intuicaonumero',label:'Intuição',group:'Perícias físicas'},
  {key:'naturezanumero',label:'Natureza',group:'Perícias físicas'},
  {key:'vontadenumero',label:'Vontade',group:'Perícias físicas'}
]);
export const extraRestBase=key=>EXTRA_REST_BASE_OPTIONS.find(x=>x.key===String(key??''))??null;
// Comportamento antigo: referência salva, sem modo registrado => somente descanso curto.
// Modo explícito é individual do personagem, preservado ao desativar o Fluxo.
export const EXTRA_REST_MODES=Object.freeze(['nenhum','curto','intensivo','ambos']);
export function extraRestMode(system){
 const stored=String(system?.fluxoextradescansomodo??'').trim();
 return EXTRA_REST_MODES.includes(stored)?stored:(extraRestBase(system?.fluxoextrarecuperacaobase)?'curto':'nenhum');
}
export const extraRestEnabled=(system,kind)=>{
 const mode=extraRestMode(system);
 return kind==='curto'?(mode==='curto'||mode==='ambos'):(mode==='intensivo'||mode==='ambos');
};
export function extraIntensiveRestResource(system){
 if(system?.fluxoextraativo!==true || !extraRestEnabled(system,'intensivo'))return null;
 const name=String(system.fluxoextranome??'').trim().replace(/\s+/g,' ');
 if(!name)return null;
 return {label:name,current:'fluxoextraatual',max:'fluxoextramax',extra:true};
}
// Descanso curto usa alimentação + ¼ da referência. O intensivo é independente.
export function extraRestResource(system){
 if(system?.fluxoextraativo!==true || !extraRestEnabled(system,'curto'))return null;
 const selected=extraRestBase(system.fluxoextrarecuperacaobase);
 const name=String(system.fluxoextranome??'').trim().replace(/\s+/g,' ');
 if(!selected||!name)return null;
 return {label:name,current:'fluxoextraatual',max:'fluxoextramax',reference:selected.key,referenceName:selected.label,extra:true};
}
