// Port limitado da preparação de fórmulas do motor-efeitos.js original.
// Segurança: não avalia JS, não permite nomes desconhecidos nem funções arbitrárias.
export function evaluateArithmetic(expression) {
  const src = String(expression ?? '').replace(/\s+/g,'').replace(/,/g,'.');
  if (!src || src.length > 200 || !/^[0-9+\-*/%().]+$/.test(src)) return NaN;
  let i=0;
  const eat=c=>src[i]===c?(i++,true):false;
  const number=()=>{const start=i;while(i<src.length&&/[0-9.]/.test(src[i]))i++;return start===i?NaN:Number(src.slice(start,i));};
  function factor(){if(eat('+'))return factor();if(eat('-'))return -factor();if(eat('(')){const n=sum();return eat(')')?n:NaN;}return number();}
  function product(){let n=factor();while(['*','/','%'].includes(src[i])&&i<src.length){const op=src[i++],b=factor();n=op==='*'?n*b:op==='/'?n/b:n%b;}return n;}
  function sum(){let n=product();while(['+','-'].includes(src[i])&&i<src.length){const op=src[i++],b=product();n=op==='+'?n+b:n-b;}return n;}
  const result=sum();return i===src.length&&Number.isFinite(result)?result:NaN;
}
const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,'');
const aliases={forca:'forcanumero',agilidade:'agilidadenumero',resistencia:'resistencianumero',inteligencia:'inteligencianumero',carisma:'carismanumero',percepcao:'percepcaonumero',fisico:'fisiconumero',arcana:'arcananumero',vontade:'vontadenumero',medicina:'medicinanumero',atletismo:'atletismonumero'};
export function levelOf(actor,item,origin='personagem'){
  if(origin!=='habilidade')return Number(actor?.system?.nivelpersonagem??actor?.system?.props?.nivelpersonagem??NaN);
  const p=item?.system?.props??{};
  const candidates=item?.type==='tecnica'?['nivel_tecnica','niveltecnica','tecnicanivel','efeitotecnicanivelinicio']:['nivel_skill','nivelskill','skillnivel','efeitoskillnivelinicio'];
  for(const key of candidates)if(p[key]!==undefined&&String(p[key]).trim())return Number(p[key]);
  return 1; // Convenção explícita do motor original: nível de habilidade ausente = 1.
}
function variables(actor,item){
  const props={...(actor?.system?.props??{}),...(actor?.system??{})};
  const vars={};
  for(const [k,v] of Object.entries(props)){
    if(typeof v!=='number' && (typeof v!=='string'||!v.trim()))continue;
    const n=Number(v);if(!Number.isFinite(n))continue;
    const key=normalize(k); vars[key]=n;
    if(key.endsWith('numero'))vars[key.slice(0,-6)]=n;
  }
  for(const [alias,key] of Object.entries(aliases))if(vars[normalize(key)]!==undefined)vars[alias]=vars[normalize(key)];
  const lv=levelOf(actor,item),skill=levelOf(actor,item,'habilidade');
  if(Number.isFinite(lv)){vars.nivel=lv;vars.nivelpersonagem=lv;}
  if(Number.isFinite(skill)){vars.nivelhabilidade=skill;vars.nivelskill=skill;vars.niveltecnica=skill;}
  return vars;
}
export function prepareFormula(raw,actor,item){
  if(typeof raw!=='string' || !raw.trim() || raw.length>200)return null;
  const vars=variables(actor,item);
  let f=raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  // Mantém o suporte do original às variáveis @atributo e aos nomes completos.
  f=f.replace(/@([A-Za-z_][A-Za-z_0-9]*)/g,(all,key)=>Object.hasOwn(vars,normalize(key))?String(vars[normalize(key)]):all);
  for(const key of Object.keys(vars).filter(k=>k.length>=3).sort((a,b)=>b.length-a.length)){
    const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    f=f.replace(new RegExp(`\\b${escaped}\\b`,'gi'),String(vars[key]));
  }
  // Funções matemáticas permitidas no motor original, com argumentos aritméticos.
  for(let i=0;i<20;i++){
    const updated=f.replace(/\b(floor|ceil|round|abs|min|max)\(([^()]*)\)/gi,(all,fn,args)=>{
      const parts=/^(min|max)$/i.test(fn)?args.split(/\s*,\s*/):[args];
      const values=parts.map(evaluateArithmetic);
      if(!values.length||values.some(v=>!Number.isFinite(v)))return all;
      return String(({floor:()=>Math.floor(values[0]),ceil:()=>Math.ceil(values[0]),round:()=>Math.round(values[0]),abs:()=>Math.abs(values[0]),min:()=>Math.min(...values),max:()=>Math.max(...values)})[fn.toLowerCase()]());
    });
    if(updated===f)break;f=updated;
  }
  return f;
}
export function resolveValue({raw,scale,origin,actor,item,affected}){
  const base=prepareFormula(raw,actor,item);
  if(base===null)return {error:'Fórmula vazia ou muito longa.'};
  if(!['','fixo','formula','por_nivel','percentual'].includes(scale))return {error:`Escala ${scale} ainda não suportada neste executor.`};
  const parsed=evaluateArithmetic(base.replace(/%\s*$/,''));
  if(!Number.isFinite(parsed) || parsed<0)return {error:'Fórmula inválida: use números, operações aritméticas ou variáveis conhecidas, sem dados.'};
  if(scale==='por_nivel'){
    const n=levelOf(actor,item,origin||'personagem');
    if(!Number.isFinite(n)||n<0)return {error:'Nível não disponível para a escala escolhida.'};
    return {value:parsed*n,detail:`${parsed} × nível ${n}`};
  }
  if(scale==='percentual'){
    const resource=['pv','pm','sta','san'].includes(affected)?affected:'pv';
    const max=Number(actor?.system?.[`${resource}_max`]);
    if(!Number.isFinite(max))return {error:'Fluxo máximo indisponível para percentual.'};
    return {value:max*parsed/100,detail:`${parsed}% de ${resource.toUpperCase()} máximo (${max})`};
  }
  return {value:parsed,detail:base};
}
