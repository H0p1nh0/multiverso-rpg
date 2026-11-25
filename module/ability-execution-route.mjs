// Multiverso RPG v1.0.3 — Seleção ÚNICA da rota de execução externa.
// Não executa a habilidade, não lê fichas nem altera dados.
// Tanto o uso real quanto o diagnóstico consultam esta mesma decisão.
const MAINTAINED_TYPES=new Set(['atributo','bonus','penalidade','deslocamento','defesa','teste','condicao']);
const ADVANCED_PRIORITY=new Set(['maior','substituir','nao']);
const MAXIMUM_RESOURCES=new Set(['pv_max','pm_max','sta_max','san_max','outro_max']);
export function chooseExternalExecutionRoute(effects,{
  cardEligible=false,hasVariants=false,selectedCount=0,
  specialOperation=()=>false,setting=()=>''
}={}){
  if(!Array.isArray(effects)||!effects.some(e=>e.receiver!=='proprio'))return 'native';
  // A rota aberta existente publica um card quando não há alvos nem área.
  // Não ocorre com efeitos mistos, pois estes dependem de um destinatário.
  if(selectedCount===0&&!effects.some(e=>e.receiver==='proprio'||e.receiver==='area'||setting('formarea',e.index)))return 'open-effect';
  if(cardEligible)return 'external-card';
  const mixed=effects.some(e=>e.receiver==='proprio');
  if(mixed)return 'external-advanced';
  const maintained=effects.length>0&&effects.every(e=>e.cadence==='maintained'&&MAINTAINED_TYPES.has(e.type));
  const advanced=hasVariants||effects.some(e=>specialOperation(e.op))||effects.some(e=>
    (e.type==='recurso'&&e.affected==='outro')||
    (e.cadence==='maintained'&&MAXIMUM_RESOURCES.has(e.affected))||
    ADVANCED_PRIORITY.has(setting('acumulo',e.index))||
    e.cadence==='periodic'||
    (e.cadence==='once'&&['turns','rounds'].includes(e.duration?.kind))||
    (e.cadence==='maintained'&&(selectedCount>1||e.resistanceActive||e.receiver==='area'||setting('mvSustainCost',e.index)||setting('alcance',e.index)||setting('formarea',e.index)))
  )||(effects.some(e=>e.cadence==='maintained')&&effects.some(e=>e.cadence==='once'))||
    effects.some(e=>e.receiver==='area'||setting('formarea',e.index));
  if(advanced)return 'external-advanced';
  if(maintained)return 'external-maintained';
  return selectedCount>1||effects.length>1?'multi-target':'external-target';
}

export const EXECUTION_ROUTE_LABELS=Object.freeze({
  native:'Efeitos no próprio personagem',
  'open-effect':'Card de efeito para aplicação posterior',
  'external-card':'Card de aplicação de efeito externo',
  'external-advanced':'Execução composta (alvo + usuário, áreas e condições)',
  'external-maintained':'Efeitos mantidos em um alvo',
  'multi-target':'Efeitos imediatos em múltiplos alvos',
  'external-target':'Efeito imediato em um alvo'
});
