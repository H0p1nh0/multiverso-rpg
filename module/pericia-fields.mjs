// Catálogo canônico de perícias da ficha; evita nomes inventados ou divergentes.
export const SKILLS=[
 ['cutnumero','Cortantes','Ofensivas'],['fisiconumero','Físico','Ofensivas'],['pontarianumero','Pontaria','Ofensivas'],['arcananumero','Arcana','Ofensivas'],['encantamentonumero','Encantamento','Ofensivas'],['podernumero','Poder','Ofensivas'],
 ['artesnumero','Artes','Mentais'],['enganacaonumero','Enganação','Mentais'],['estudosocultosnumero','Estudos Ocultos','Mentais'],['historianumero','História','Mentais'],['investigacaonumero','Investigação','Mentais'],['medicinanumero','Medicina','Mentais'],['pilotarnumero','Pilotar','Mentais'],['tecnologianumero','Tecnologia','Mentais'],
 ['acrobacianumero','Acrobacia','Físicas'],['atletismonumero','Atletismo','Físicas'],['furtividadenumero','Furtividade','Físicas'],['furtonumero','Furto','Físicas'],['intimidacaonumero','Intimidação','Físicas'],['intuicaonumero','Intuição','Físicas'],['naturezanumero','Natureza','Físicas'],['vontadenumero','Vontade','Físicas']
];
const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const ATTR_TESTS=[['forcanumero','Força'],['agilidadenumero','Agilidade'],['resistencianumero','Resistência'],['inteligencianumero','Inteligência'],['carismanumero','Carisma'],['percepcaonumero','Percepção']];
export function resolveTestKey(name){
 const v=normalize(name);
 if(!v)return null;
 return ATTR_TESTS.find(([key,label])=>normalize(key)===v||normalize(key.replace(/numero$/,''))===v||normalize(label)===v)?.[0]??resolvePericiaKey(name);
}
export function resolvePericiaKey(name){
 const v=normalize(name);
 if(!v)return null;
 return SKILLS.find(([key,label])=>normalize(key)===v||normalize(key.replace(/numero$/,''))===v||normalize(label)===v)?.[0]??null;
}
export const availablePericias=()=>SKILLS.map(([key,label])=>({key,label}));
