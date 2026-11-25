// Classificação conservadora extraída das regras de duração do motor original.
// Não substitui o acompanhamento por turno próprio do alvo / cenas.
const norm = value => String(value??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function classifyDuration(raw){
  const text=String(raw??'').trim();
  const v=norm(text);
  if(!v)return {kind:'unspecified',label:'Não definida',supported:true};
  if(/^(instantane[ao]|imediat[ao]|instant|0)$/.test(v) || v.includes('instantan'))return {kind:'instant',label:text,supported:true};
  if(v.includes('permanente')||v.includes('ate ser removido')||v==='manual')return {kind:'manual',label:text,supported:false};
  if(/sustent|sustain|manutencao|mantid[oa]\s+enquanto\s+(?:pagar|houver)\s+(?:custo|mana|pm)/.test(v))return {kind:'sustained',label:text,supported:true};
  if(v.includes('inicio do proximo turno'))return {kind:'turn-start',label:text,supported:false};
  if(v.includes('fim do proximo turno'))return {kind:'turn-end',label:text,supported:false};
  const qty=(pattern)=>{const m=v.match(pattern);return m?Number(m[1].replace(',','.')):null;};
  for(const [kind,pattern] of [
    ['turns',/(\d+(?:[.,]\d+)?)\s*turnos?/],
    ['rounds',/(\d+(?:[.,]\d+)?)\s*rodadas?/],
    ['seconds',/(\d+(?:[.,]\d+)?)\s*segundos?/],
    ['minutes',/(\d+(?:[.,]\d+)?)\s*minutos?/],
    ['hours',/(\d+(?:[.,]\d+)?)\s*horas?/]
  ]){const n=qty(pattern);if(n!==null)return {kind,label:text,amount:n,supported:false};}
  if(v.includes('cena'))return {kind:'scene',label:text,supported:true};
  if(v.includes('combate')||v.includes('encontro'))return {kind:'combat',label:text,supported:false};
  return {kind:'unknown',label:text,supported:false};
}
export function durationDiagnostic(raw){
  const d=classifyDuration(raw);
  if(d.supported)return null;
  return `Não é possível acompanhar a duração '${d.label}' nesta configuração. Nenhum efeito foi aplicado.`;
}
