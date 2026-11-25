import {conditionDamageBonus} from './condition-mechanics.mjs';
import {isItemEffectSource,itemSourceActive} from './item-effect-links.mjs';
// Regras de proteção transpostas de motor-efeitos.js V6.18 (linhas 4754-4908).
// Fontes: ActiveEffect legado e efeitos passivos estruturados de itens.
const NS='multiverso-rpg';
const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const unwrap=x=>x&&typeof x==='object'&&'value'in x?x.value:x;
const txt=x=>String(unwrap(x)??'').trim();
export function normalizeDamageType(v){
  const s=normalize(v);
  if(!s||['dano','geral','qualquer','todos','todas','all','*'].includes(s))return 'todos';
  if(/fisic|cort|perfur|impact|contund/.test(s))return 'fisico';
  if(s.includes('element'))return 'elemental';
  if(/fogo|flame|calor/.test(s))return 'fogo';
  if(/frio|gelo/.test(s))return 'frio';
  if(/eletr|raio/.test(s))return 'eletrico';
  if(/quim|acid|veneno/.test(s))return 'quimico';
  if(/psiqu|mental/.test(s))return 'psiquico';
  if(/sagrad|radiante/.test(s))return 'sagrado';
  if(/sombr|necro/.test(s))return 'sombrio';
  if(s.includes('verdadeir'))return 'verdadeiro';
  return s.replace(/\s+/g,'_');
}
function matches(prot,dmg){const p=normalizeDamageType(prot),d=normalizeDamageType(dmg);return p==='todos'||p===d||(p==='elemental'&&['elemental','fogo','frio','eletrico','quimico'].includes(d));}
function nature(e){const s=normalize(e?.tipo??e?.naturezaProtecao??e?.natureza);return s.includes('imun')?'imunidade':s.includes('vulner')?'vulnerabilidade':s.includes('resist')?'resistencia':null;}
function mode(e,n){if(n==='imunidade'||n==='vulnerabilidade')return n;return /percent/.test(normalize(e.modoProtecao??e.modo??e.escala))||txt(e.valor).includes('%')?'percentual':'fixo';}
function entry(e,source){const n=nature(e);if(!n)return null;const raw=txt(e.valor).replace('%','').replace(',','.');const value=n==='resistencia'?Number(raw):100;
  if(!Number.isFinite(value))return {unsupported:true,source,reason:'Não foi possível calcular o valor desta proteção'};
  return {natureza:n,tipoDano:normalizeDamageType(e.tipodano??e.tipoDano??e.alvo??'todos'),modo:mode(e,n),valor:Math.abs(value),fonte:source,acumulo:normalize(e.acumulo||'acumula')};
}
function structured(item){const p=item.system?.props??{};const families=['tecnica','skill','especie','classe','subclasse','vantagem','item'];const a=[];
  for(const f of families){if(!Object.keys(p).some(k=>k.startsWith('efeito'+f)))continue;
    for(let i=1;i<=5;i++){const suffix=i===1?'':String(i),prefix='efeito'+f;const type=txt(p[prefix+'tipo'+suffix]);if(!type)continue;
      // Uma proteção nativa exige identificação explícita. Não confundir atributo Resistência com resistência a dano.
      const affected=txt(p[prefix+'afetado'+suffix]);
      if(['skill','tecnica'].includes(f) && affected!=='protecao_dano' && !['resistencia','vulnerabilidade','imunidade'].includes(type))continue;
      if(['skill','tecnica'].includes(f) && txt(p[prefix+'receptor'+suffix])!=='proprio')continue;
      const activity=txt(p[({skill:'ativacaotempotiposkill',tecnica:'ativacaotempotipotecnica',item:'ativacaotempotipoitem'})[f]+suffix]??p['atividade'+f+'tipo'+suffix]);
      const moment=txt(p[prefix+'momento'+suffix]);
      if(!['passiva'].includes(normalize(activity))&&!normalize(activity).includes('passiv')&&!normalize(moment).includes('sempre')&&!normalize(moment).includes('enquanto possuir'))continue;
      // Itens ativos só contam quando o estado exigido e a sincronização são compatíveis.
      if(f==='item'){
        const required=normalize(p[prefix+'estado'+suffix]);const current=normalize(p.itemestado);
        if(required&&!['qualquer','todos'].includes(required)&&required!==current)continue;
        if(normalize(p.itemsincroniza)==='sim'&&(normalize(p.itemsincronizado)!=='sim'||![item.parent?.id,item.parent?.uuid].includes(txt(p.itemsincronpersonagem))))continue;
      }
      a.push({tipo:type,tipodano:p[prefix+'tipodano'+suffix],alvo:p[prefix+'alvo'+suffix],valor:p[prefix+'valor'+suffix],escala:p[prefix+'escala'+suffix],acumulo:p[prefix+'acumulo'+suffix],modoProtecao:p[prefix+'modoProtecao'+suffix]});
    }
  }return a;
}
export function collectDamageProtections(actor,damageType){
  const entries=[],unsupported=[];
  const add=(e,source)=>{const x=entry(e,source);if(x?.unsupported)unsupported.push(x);else if(x&&matches(x.tipoDano,damageType))entries.push(x);};
  for(const ae of actor?.effects??[]){if(ae.disabled)continue;const meta=ae.flags?.multiverso??ae.flags?.['multiverso-automacao']??ae.flags?.[NS]??{};
    if(meta.protecaoDano)add({...meta.protecaoDano,tipo:meta.protecaoDano.natureza},ae.name);
    for(const e of Array.isArray(meta.efeitos)?meta.efeitos:[])add(e,ae.name);
  }
  for(const item of actor?.items??[]){
    if(item.type==='equipamento'&&item.system?.equipado&&Number(item.system?.quantidade)>0){
      const cfg=item.flags?.[NS]?.itemMotorV1;
      if(cfg&&(!cfg.syncRequired||cfg.synced===true))for(const rule of cfg.protections||[]){
        if(!['resistencia','imunidade','vulnerabilidade'].includes(rule.type))continue;
        add({natureza:rule.type,tipoDano:rule.damageType==='outro'?(rule.customDamageType||'outro'):(rule.damageType||'todos'),modoProtecao:rule.mode==='padrao'?'percentual':'fixo',valor:rule.type==='resistencia'?(rule.mode==='padrao'?50:Number(rule.value)):100,acumulo:'acumula'},item.name);
      }
    }
    if(isItemEffectSource(item)&&!itemSourceActive(item))continue;
    if(item.getFlag?.(NS,'itemCastCloneV1')===true||item.getFlag?.(NS,'itemAbilityTemplateV1')===true)continue;
    if(item.getFlag?.(NS,'traitEffectSourceV1')&&!actor.items?.get(item.getFlag(NS,'originItemId')))continue;
    const legacyId=item.getFlag?.(NS,'legacyEffectId');
    if(legacyId && actor.effects?.get(legacyId) && !actor.effects.get(legacyId).disabled)continue;
    for(const e of structured(item))add(e,item.name);
  }
  // Regras de acúmulo, mantendo entradas de origens diferentes quando permitido.
  const chosen=[],grouped=new Map();
  for(const e of entries){if(!['maior','nao','substituir'].includes(e.acumulo)){chosen.push(e);continue;}
    const k=[e.natureza,e.tipoDano,e.modo,e.acumulo].join(':');if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(e);
  }
  for(const group of grouped.values()){
    const rule=group[0].acumulo;
    chosen.push(rule==='substituir'?group.at(-1):rule==='nao'?group[0]:group.reduce((best,e)=>e.valor>best.valor?e:best));
  }
  return {entries:chosen,unsupported};
}
export function resolveDamageProtection(actor,rawDamage,damageType='', options={}){
  const original=Math.max(0,(Number(rawDamage)||0)+(options.skipConditionBonus?0:conditionDamageBonus(actor,{direction:'received'})));
  const {entries,unsupported}=collectDamageProtections(actor,damageType);
  if(unsupported.length)return {blocked:true,unsupported};
  const immunities=entries.filter(e=>e.natureza==='imunidade');
  if(immunities.length)return {original,final:0,imune:true,entries,tipoDano:normalizeDamageType(damageType),resistenciaFixa:0,resistenciaPercentual:0,vulneravel:false};
  const sum=(n,m)=>entries.filter(e=>e.natureza===n&&e.modo===m).reduce((v,e)=>v+e.valor,0);
  const resistenciaFixa=sum('resistencia','fixo'),resistenciaPercentual=Math.min(100,sum('resistencia','percentual'));
  const vulneravel=entries.some(e=>e.natureza==='vulnerabilidade');
  let final=Math.max(0,original-resistenciaFixa);
  final*=1-resistenciaPercentual/100;
  if(vulneravel)final*=2;
  final=Math.ceil(Math.max(0,final));if(original>0)final=Math.max(1,final);
  return {original,final,imune:false,resistenciaFixa,resistenciaPercentual,vulneravel,entries,tipoDano:normalizeDamageType(damageType)};
}
