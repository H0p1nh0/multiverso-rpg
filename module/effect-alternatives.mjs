// v0.2.00 — escolher QUAL efeito executar, sem criar um segundo motor de dano/atributos.
// Efeitos com o mesmo grupo são alternativas excludentes (um por grupo).
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function alternativeGroups(item,effects){
 const props=item.system?.props??{},groups=new Map();
 for(const e of effects){
  const name=String(props[`mvAlternativeGroup${e.index}`]??'').trim();
  if(!name)continue;
  if(name.length>35)throw new Error(`Efeito ${e.index}: nome do grupo de alternativas muito longo.`);
  if(!groups.has(name))groups.set(name,[]);
  groups.get(name).push(e);
 }
 return [...groups].filter(([,list])=>list.length>1).map(([name,list])=>({name,effects:list}));
}
export async function chooseEffectAlternatives(item,effects){
 const groups=alternativeGroups(item,effects);
 if(!groups.length)return effects;
 const props=item.system?.props??{};
 // Custos opcionais são outra modalidade de escolha, com suas próprias regras.
 if(groups.some(g=>g.effects.some(e=>props[`mvOptionalOnly${e.index}`]==='sim'||String(props[`efeito${item.type}custoopcional${e.index===1?'':e.index}`]??'').trim())))
  throw new Error('Alternativas de efeito e reforço opcional não podem usar o mesmo grupo.');
 const primaryCosts=effects.map(e=>String(props[`efeito${item.type}custo${e.index===1?'':e.index}`]??'').trim()).filter(Boolean);
 if(new Set(primaryCosts).size>1)throw new Error('Alternativas não podem possuir custos principais diferentes: configure um único custo compartilhado para esta Skill/Técnica.');
 // A DialogV2 já cria o <form> da janela. Não aninhar outro form:
 // a árvore DOM resultante pode impedir o envio do botão na Foundry v14.
 const labels={dano:'Dano',recurso:'Alteração de Fluxo',cura:'Cura',condicao:'Condição',atributo:'Alteração de atributo',defesa:'Esquiva/Bloqueio',deslocamento:'Deslocamento',teste:'Perícia/Teste',resistencia:'Resistência',vulnerabilidade:'Vulnerabilidade',imunidade:'Imunidade'};
 const resourceNames={pv:'PV atual',pm:'PM atual',sta:'STA atual',san:'SAN atual',pv_max:'PV máximo',pm_max:'PM máximo',sta_max:'STA máximo',san_max:'SAN máximo',outro:'Fluxo Extra atual',outro_max:'Fluxo Extra máximo'};
 const describe=e=>{
  const title=String(props[`mvEffectTitle${e.index}`]??'').trim()||`Efeito ${e.index}`;
  const type=labels[e.type]||e.type||'Efeito';
  const receptor=e.receiver==='proprio'?'Próprio personagem':e.receiver==='area'?'Alvos na área':'Alvo escolhido';
  const resource=resourceNames[e.affected]||e.affected||'';
  const value=e.diceFormula||e.formulaDetail&&e.formulaDetail.match(/\bd\d/i)?.[0]||String(props[`efeito${item.type}valor${e.index===1?'':e.index}`]??e.value??'').trim();
  const operation=e.op==='subtrair'?'Subtrair':'Somar';
  const action=String(props[`ativacaotempotipo${item.type}${e.index===1?'':e.index}`]??'').trim();
  const actionLabel={acao:'Ação Padrão',movimento:'Movimento',bonus:'Bônus',completa:'Completa',reacao:'Reação',livre:'Livre'}[action];
  const parts=[type+(resource?' · '+resource:''),receptor];
  if(e.type==='dano')parts.push(`Dano ${value||'não configurado'}`);
  else if(e.type==='recurso'||e.type==='cura')parts.push(`${operation} ${value||'0'}`);
  else if(e.type==='condicao')parts.push(e.conditionName||'Condição narrativa');
  else if(value&&value!=='0')parts.push(`${operation} ${value}`);
  if(actionLabel)parts.push(actionLabel);
  if(e.duration?.label&&e.duration.kind!=='unspecified')parts.push(e.duration.label);
  const description=String(props[`efeito${item.type}detalhe${e.index===1?'':e.index}`]??'').trim();
  return `<strong>${esc(title)}</strong><small style="display:block;opacity:.85;margin:3px 0 0 24px">${esc(parts.join(' · '))}</small>${description?`<small style="display:block;opacity:.75;margin:3px 0 0 24px">${esc(description.slice(0,280))}</small>`:''}`;
 };
 const html=`<div class="mv-effect-alternatives">${groups.map((g,k)=>`<fieldset style="margin:8px 0;padding:10px;border:1px solid #a78d65"><legend>${esc(g.name)}</legend>${g.effects.map((e,i)=>`<label style="display:block;margin:7px 0;cursor:pointer"><input type="radio" name="mv-alternative-${k}" value="${e.index}" ${i===0?'checked':''}/> ${describe(e)}</label>`).join('')}</fieldset>`).join('')}</div><p>Escolha uma alternativa por grupo. Custo e uso continuam únicos.</p>`;
 const result=await foundry.applications.api.DialogV2.wait({window:{title:`Escolhas de ${item.name}`},content:html,buttons:[{action:'cancel',label:'Cancelar',callback:()=>[]},{action:'confirm',label:'Usar opções escolhidas',default:true,callback:(_event,button,dialog)=>{
  // Button.form é o formulário real da DialogV2 v14, mesmo ao enviar por Enter.
  const form=button?.form??dialog?.element?.querySelector?.('form');
  if(!form)throw Error('Formulário de alternativas não encontrado.');
  const chosen=groups.map((g,k)=>Number(form.querySelector(`input[name="mv-alternative-${k}"]:checked`)?.value));
  if(!chosen.every((v,k)=>groups[k].effects.some(e=>e.index===v)))throw Error('Selecione uma alternativa válida em cada grupo.');
  return chosen;
 }}],rejectClose:false});
 if(!Array.isArray(result)||!result.length)return null;
 const excluded=new Set(groups.flatMap(g=>g.effects.map(e=>e.index)).filter(index=>!result.includes(index)));
 return effects.filter(e=>!excluded.has(e.index));
}
