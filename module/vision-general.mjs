import {passiveAttributeBonuses} from './passive-attributes.mjs';
// Visão Geral nativa — reconstruída a partir de ficha-skills.js (legado: montarVisaoGeral,
// atualizarVisaoGeral, abrirGerenciadorTestes e MV_ATRIBUTOS/PERICIAS_TESTES).
// Mantém dados em system.* e usa o rolador V8 já testado; não depende de CSB.
import {rollOriginalResistance} from './resistance-test.mjs';
import {SKILLS} from './pericia-fields.mjs';
import {rememberLastActor} from './chat-roll-apply.mjs';
import {resolveTestMarks} from './test-marks.mjs';
import {passiveTests} from './passive-bonuses.mjs';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const ATTRS=[
 ['agilidadenumero','Agilidade','fa-person-running'],['forcanumero','Força','fa-hand-fist'],
 ['inteligencianumero','Inteligência','fa-book-open'],['carismanumero','Carisma','fa-people-group'],
 ['percepcaonumero','Percepção','fa-eye'],['resistencianumero','Resistência','fa-shield-halved']
];
export {SKILLS} from "./pericia-fields.mjs";

const SKILL_ICONS=Object.freeze({
  'cutnumero':'fa-khanda',
  'fisiconumero':'fa-hand-fist',
  'pontarianumero':'fa-crosshairs',
  'arcananumero':'fa-hat-wizard',
  'encantamentonumero':'fa-wand-magic-sparkles',
  'podernumero':'fa-bolt',
  'artesnumero':'fa-palette',
  'enganacaonumero':'fa-masks-theater',
  'estudosocultosnumero':'fa-book-skull',
  'historianumero':'fa-scroll',
  'investigacaonumero':'fa-magnifying-glass',
  'medicinanumero':'fa-kit-medical',
  'pilotarnumero':'fa-car',
  'tecnologianumero':'fa-microchip',
  'acrobacianumero':'fa-person-running',
  'atletismonumero':'fa-dumbbell',
  'furtividadenumero':'fa-user-ninja',
  'furtonumero':'fa-hand',
  'intimidacaonumero':'fa-skull',
  'intuicaonumero':'fa-eye',
  'naturezanumero':'fa-leaf',
  'vontadenumero':'fa-brain'
});
const ATTRIBUTE_KEYS=new Set(ATTRS.map(([key])=>key));
const all=[...ATTRS,...SKILLS];
const tests=new Map(all.map(a=>[a[0],a]));
const numeric=v=>{const n=Number(v??0);return Number.isFinite(n)?n:0;};
const prop=(actor,key)=>actor.system?.[key]??0;
const textProp=(actor,key)=>String(actor.system?.[key]??'');
// Atributos mantidos alteram o próprio dado persistido; a ficha exibe esse valor.
const baseProp=(actor,key)=>actor._source?.system?.[key]??actor.system?.toObject?.()?.[key]??prop(actor,key);
const checked=(actor,key)=>prop(actor,key)===true||prop(actor,key)==='true'||prop(actor,key)===1;
const favorites=actor=>(Array.isArray(actor.flags?.multiverso?.periciasFavoritas)?actor.flags.multiverso.periciasFavoritas:[]).filter(key=>SKILLS.some(s=>s[0]===key)).slice(0,6);
// A mesma lista de efeitos fixos usada pelo rolador informa o total visual.
// Efeitos opcionais, vantagem/desvantagem e dados não são incorporados ao valor fixo.
function fixedTestBonus(actor,key){
 const name=tests.get(key)?.[1]??key;
 const legacy=globalThis.MultiversoEfeitos?.modoTestePassivo?.(actor,key)
   ??globalThis.MultiversoEfeitos?.modoTestePassivo?.(actor,name)??{};
 const native=passiveTests(actor,name);
 const sources=[...(legacy.fontes??[]),...(legacy.modificadores??[]),...native.fixed];
 return sources.reduce((total,source)=>{
  if(String(source.definicao??'fixo')==='escolhido'||source.escolhidoAoUsar)return total;
  const kind=String(source.tipo??'').toLowerCase().trim();
  if(!['bonus','penalidade'].includes(kind))return total;
  const formula=String(source.formula??'').trim();
  // Dados são calculados no momento da rolagem, não na ficha.
  if(!/^[+\-]?\d+(?:[.,]\d+)?$/.test(formula))return total;
  const value=Number(formula.replace(',','.'));
  return total+(kind==='penalidade'?-value:value);
 },0);
}
export function testSummary(actor,key){
 const base=numeric(prop(actor,key));const prof=[1,2,3].filter(n=>checked(actor,`${key}_prof${n}`)).length;
 const imp=['','2'].filter(s=>checked(actor,`${key}_impasse${s}`)).length;
 const marks=resolveTestMarks(prof,imp);
 const effectBonus=fixedTestBonus(actor,key);
 const total=Math.min(15,base)+marks.net+effectBonus;
 return {base,prof,imp,effectBonus,total,marks};
}

const signed=n=>`${n>=0?'+':''}${n}`;
const input=(actor,key,label,attrs='')=>`<input type="number" data-mv-visao-edit="${key}" value="${numeric(ATTRIBUTE_KEYS.has(key)?prop(actor,key):baseProp(actor,key))}" aria-label="${esc(label)}" ${attrs}>`;
// O cartão mostra o total do teste, mas o campo edita apenas o valor-base persistido.
// Usamos a fonte original para não confundir bônus de atributo com bônus de teste.
function attributeDisplay(actor,key){
 const summary=testSummary(actor,key);
 const storedBase=numeric(actor._source?.system?.[key]??baseProp(actor,key));
 return {total:summary.total,base:storedBase,bonus:summary.total-storedBase};
}
function attributeBonusBadge(actor,key){
 const {base,bonus}=attributeDisplay(actor,key);
 if(!bonus)return '';
 return `<span class="mv-v-attribute-bonus" title="Base ${base}; bônus ${signed(bonus)}">Base ${base} · Bônus ${signed(bonus)}</span>`;
}
function cardAttr(actor,[key,name,icon]){
 const display=attributeDisplay(actor,key);
 return `<div class="mv-v-attr" data-mv-v-roll="${key}" title="Clique no card para rolar ${esc(name)}; clique no campo numérico para editar a base do atributo">
 <i class="fa-solid ${icon}" aria-hidden="true"></i><span class="mv-v-attr-title">${esc(name)}</span>
 <input type="number" data-mv-visao-edit="${key}" value="${display.total}" aria-label="${esc(name)} (total; edição altera apenas a base)">${attributeBonusBadge(actor,key)}<span class="mv-v-dice"><i class="fa-solid fa-dice-d20"></i> Rolar teste</span></div>`;
}
function flux(actor,name,code,ico,current,max){return `<div class="mv-v-flux">
 <i class="fa-solid ${ico}" aria-hidden="true"></i><span class="mv-v-flux-title">${name} <small>(${code})</small></span>
 <div class="mv-v-flow-input">${input(actor,current,`${name} atual`)}<span>/</span>${input(actor,max,`${name} máximo`)}</div></div>`;}
function itemType(actor,type,fallback,field){const item=[...(actor.items??[])].find(x=>x.type===type);return String(prop(actor,field)||item?.name||fallback);}
export function renderVision(actor){
 const fav=favorites(actor);
 const favHtml=fav.map(k=>{
  const t=tests.get(k);
  const name=esc(t?.[1]??k);
  const icon=SKILL_ICONS[k]??'fa-dice-d20';
  const summary=testSummary(actor,k);
  return `<button type="button" class="mv-v-favorite" data-mv-v-roll="${k}" title="Rolar ${name}${summary.effectBonus?`; efeitos fixos: ${signed(summary.effectBonus)}`:''}" aria-label="Rolar ${name}">
    <i class="fa-solid fa-star mv-v-favorite-star" aria-hidden="true"></i>
    <i class="fa-solid ${icon} mv-v-favorite-icon" aria-hidden="true"></i>
    <strong class="mv-v-favorite-total">${signed(summary.total)}</strong>
    <span class="mv-v-favorite-name">${name}</span>
    ${summary.total!==summary.base?`<span class="mv-v-favorite-breakdown" title="Valor-base ${summary.base}; bônus de proficiências, impasses e efeitos ${signed(summary.total-summary.base)}">Base ${signed(summary.base)} · Bônus ${signed(summary.total-summary.base)}</span>`:''}
    <span class="mv-v-favorite-hint"><i class="fa-solid fa-dice-d20" aria-hidden="true"></i> Rolar teste</span>
  </button>`;
 }).join('');
 return `<div class="mv-v-layout">
 <section class="mv-v-panel mv-v-attrs"><h3>ATRIBUTOS</h3><div class="mv-v-attrs-grid">${ATTRS.map(a=>cardAttr(actor,a)).join('')}</div></section>
 <section class="mv-v-panel mv-v-fluxes"><h3 class="mv-v-section-row">FLUXOS <label class="mv-v-toggle" title="Ativar ou ocultar o Fluxo Extra"><span>Fluxo extra</span><input type="checkbox" data-mv-visao-edit="fluxoextraativo" ${checked(actor,'fluxoextraativo')?'checked':''}/><span class="mv-v-toggle-track" aria-hidden="true"></span></label></h3>
 <div class="mv-v-flux-grid ${checked(actor,'fluxoextraativo')?'has-extra':''}">
 ${flux(actor,'VIDA','PV','fa-heart','pv_atual','pv_max')}
 ${flux(actor,'STAMINA','STA','fa-bolt','sta_atual','sta_max')}
 ${flux(actor,'MANA','PM','fa-droplet','pm_atual','pm_max')}
 ${flux(actor,'SANIDADE','SAN','fa-brain','san_atual','san_max')}
 ${checked(actor,'fluxoextraativo')?`<div class="mv-v-flux mv-v-flux-extra"><i class="fa-solid fa-star" aria-hidden="true"></i><input class="mv-v-extra-name" type="text" data-mv-visao-edit="fluxoextranome" value="${esc(prop(actor,'fluxoextranome'))}" placeholder="Fluxo Extra" aria-label="Nome do fluxo extra"><div class="mv-v-flow-input">${input(actor,'fluxoextraatual','Fluxo extra atual')}<span>/</span>${input(actor,'fluxoextramax','Fluxo extra máximo')}</div></div>`:''}
 </div></section>
 <section class="mv-v-panel mv-v-skills"><h3 class="mv-v-section-row">PERÍCIAS EM DESTAQUE <button type="button" data-mv-v-manage>Ver todas <i class="fa-solid fa-arrow-right"></i></button></h3>
 <div class="mv-v-favorites">${favHtml||'<div class="mv-v-empty">Nenhuma perícia favorita. Use <strong>Ver todas</strong> para escolher até 6.</div>'}</div></section>
 <section class="mv-v-panel mv-v-shortcuts"><h3>ACESSO RÁPIDO</h3><div class="mv-v-shortcuts-grid">
 ${[['habilidades','fa-book-open','HABILIDADES','Ir para habilidades'],['combate','fa-khanda','COMBATE','Ir para combate'],['inventario','fa-bag-shopping','INVENTÁRIO','Ir para inventário'],['efeitos','fa-flask','EFEITOS','Ir para efeitos']].map(([page,icon,name,sub])=>`<button type="button" data-mv-v-go="${page}" title="${sub}"><i class="fa-solid ${icon} mv-v-shortcut-icon" aria-hidden="true"></i><span><strong>${name}</strong><small>${sub}</small></span><i class="fa-solid fa-arrow-right mv-v-shortcut-arrow" aria-hidden="true"></i></button>`).join('')}
 </div></section>
 <section class="mv-v-panel mv-v-concept"><h3>PERSONAGEM — CONCEITO E NOTAS</h3>
  <div class="mv-v-writing-grid">
    <div class="mv-v-writing-stack">
      <label class="mv-v-writing-field"><span><i class="fa-solid fa-lightbulb" aria-hidden="true"></i> Conceito</span>
        <textarea data-mv-visao-edit="conceitopersonagem" rows="3" placeholder="Quem é o personagem? Qual é sua ideia central?">${esc(textProp(actor,'conceitopersonagem'))}</textarea>
      </label>
      <label class="mv-v-writing-field"><span><i class="fa-solid fa-user-pen" aria-hidden="true"></i> Aparência e personalidade</span>
        <textarea data-mv-visao-edit="aparenciapersonagem" rows="3" placeholder="Traços físicos, comportamento e características marcantes...">${esc(textProp(actor,'aparenciapersonagem'))}</textarea>
      </label>
    </div>
    <label class="mv-v-writing-field mv-v-writing-notes"><span><i class="fa-solid fa-book-open" aria-hidden="true"></i> Notas gerais</span>
      <textarea data-mv-visao-edit="notaspersonagem" rows="8" placeholder="História, relações, acontecimentos e anotações da campanha...">${esc(textProp(actor,'notaspersonagem'))}</textarea>
    </label>
  </div>
</section>
 </div>`;
}
function managerRow(actor,[key,name],includeFavorite){const d=testSummary(actor,key);const fav=favorites(actor).includes(key);
 const prof=[1,2,3].map(n=>`<button type="button" class="mv-v-mark ${checked(actor,`${key}_prof${n}`)?'is-on':''}" data-mv-v-toggle="${key}_prof${n}" title="Proficiência ${n}">P${n}</button>`).join('');
 const imp=['','2'].map((s,i)=>`<button type="button" class="mv-v-mark is-imp ${checked(actor,`${key}_impasse${s}`)?'is-on':''}" data-mv-v-toggle="${key}_impasse${s}" title="Impasse ${i+1}">I${i+1}</button>`).join('');
 return `<div class="mv-v-manager-row" data-mv-v-test="${key}">
 ${includeFavorite?`<button type="button" class="mv-v-fav-toggle ${fav?'is-on':''}" data-mv-v-fav="${key}" title="${fav?'Remover':'Adicionar'} favorito"><i class="fa-${fav?'solid':'regular'} fa-star"></i></button>`:'<span></span>'}
 <span class="mv-v-test-name">${esc(name)}</span>${input(actor,key,`Valor base de ${name}`,'data-mv-v-test-base')}
 <span class="mv-v-marks">${prof}</span><span class="mv-v-marks">${imp}</span><output data-mv-v-total="${key}">${signed(d.total)}</output>
 ${includeFavorite?`<button type="button" class="mv-v-roll" data-mv-v-test-roll="${key}" title="Rolar ${esc(name)}"><i class="fa-solid fa-dice-d20"></i></button>`:'<span></span>'}</div>`;
}
const group=(actor,title,list,fav)=>`<section class="mv-v-manager-section"><h3>${title}</h3><div class="mv-v-manager-header"><span>${fav?'★':''}</span><span>TESTE</span><span>VALOR</span><span>PROFICIÊNCIA</span><span>IMPASSES (2)</span><span>TOTAL</span><span>ROLAR</span></div>${list.map(t=>managerRow(actor,t,fav)).join('')}</section>`;
export function managerHTML(actor){return `<div class="mv-v-manager"><p>Favorite até <strong>6 perícias</strong> para exibi-las na Visão Geral. Edite o valor do atributo; efeitos de duração aplicados diretamente à ficha são revertidos quando encerrados. Marque as três Proficiências e os dois Impasses. Cada Proficiência anula um Impasse; somente as marcas restantes alteram o teste.</p>${group(actor,'Atributos',ATTRS,false)}${group(actor,'Ofensivas',SKILLS.filter(s=>s[2]==='Ofensivas'),true)}${group(actor,'Mentais',SKILLS.filter(s=>s[2]==='Mentais'),true)}${group(actor,'Físicas',SKILLS.filter(s=>s[2]==='Físicas'),true)}</div>`;}
async function roll(actor,key){const t=tests.get(key);if(!t)return;rememberLastActor(actor);try{await rollOriginalResistance(actor,t[1],key);}catch(error){console.error('Multiverso | Erro no teste da Visão Geral',error);ui.notifications.error('Falha ao rolar o teste; confira F12.');}}
async function saveField(actor,input){
 if(!actor.isOwner&&!game.user.isGM){ui.notifications.warn('Você não tem permissão para editar esta ficha.');return;}
 const key=input.dataset.mvVisaoEdit; if(!key)return;
 const schema=actor.system?.schema?.fields??{};
 if(!Object.hasOwn(schema,key))return;
 let value=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;
 if(input.type==='number'&&!Number.isFinite(value))return;
 // Atributos exibem o total, mas somente o valor-base é persistido.
 if(ATTRIBUTE_KEYS.has(key) && typeof value==='number'){
  const display=attributeDisplay(actor,key);
  value-=display.bonus;
 }
 await actor.update({[`system.${key}`]:value});
}
export function initVisionGeneral(sheet,root,selectTab){
 const actor=sheet.actor;const host=root.querySelector('[data-mv-vision-mount]');if(!host)return;
 host.innerHTML=renderVision(actor);
 host.addEventListener('change',async e=>{
  const field=e.target.closest('[data-mv-visao-edit]');if(!field)return;
  // Sem atributo name: somente o gerenciador da Visão Geral grava estes campos.
  // Isso evita a gravação duplicada pelo listener delegado da ficha nativa.
  try{await saveField(actor,field);}catch(err){console.error('Multiverso | Salvar Visão Geral',err);ui.notifications.error('Não foi possível salvar o campo.');}
 });
 host.addEventListener('click',async e=>{
  const go=e.target.closest('[data-mv-v-go]');if(go){selectTab(go.dataset.mvVGo);return;}
  const launch=e.target.closest('[data-mv-v-roll]');if(launch&&!e.target.closest('input')){await roll(actor,launch.dataset.mvVRoll);return;}
  if(e.target.closest('[data-mv-v-manage]')){await openManager(actor,sheet);return;}
 });
}
async function openManager(actor,sheet){
 const D=foundry.applications.api.DialogV2;
 // DialogV2 é gerenciado pelo Foundry, não criamos <form> dentro do diálogo.
 await D.wait({window:{title:'Perícias e Modificadores',resizable:true},content:managerHTML(actor),buttons:[{action:'close',label:'Fechar',default:true}],render:(_event,dialog)=>{
  const host=dialog.element.querySelector('.mv-v-manager');if(!host)return;
  dialog.element.classList.add('mv-v-manager-window');
  host.addEventListener('change',async e=>{
   const field=e.target.closest('[data-mv-v-test-base]');if(!field)return;
   const key=field.dataset.mvVisaoEdit;const n=Number(field.value);if(!Number.isFinite(n))return;
   if(!actor.isOwner&&!game.user.isGM){ui.notifications.warn('Sem permissão para alterar esta ficha.');return;}
   const baseValue=ATTRIBUTE_KEYS.has(key)?n-numeric(passiveAttributeBonuses(actor)[key]):n;
   await actor.update({[`system.${key}`]:baseValue});
   const val=host.querySelector(`[data-mv-v-total="${key}"]`);if(val)val.textContent=signed(testSummary(actor,key).total);
  });
  host.addEventListener('click',async e=>{
   const fav=e.target.closest('[data-mv-v-fav]');if(fav){
     if(!actor.isOwner&&!game.user.isGM){ui.notifications.warn('Sem permissão para alterar favoritos.');return;}
     const key=fav.dataset.mvVFav;let list=favorites(actor);
     list=list.includes(key)?list.filter(k=>k!==key):list.length>=6?(ui.notifications.warn('Você pode favoritar no máximo 6 perícias.'),null):[...list,key];
     if(!list)return;await actor.update({'flags.multiverso.periciasFavoritas':list});
     fav.classList.toggle('is-on',list.includes(key));fav.innerHTML=`<i class="fa-${list.includes(key)?'solid':'regular'} fa-star"></i>`;return;
   }
   const toggle=e.target.closest('[data-mv-v-toggle]');if(toggle){
     if(!actor.isOwner&&!game.user.isGM){ui.notifications.warn('Sem permissão para alterar esta ficha.');return;}
     const key=toggle.dataset.mvVToggle;const on=!checked(actor,key);await actor.update({[`system.${key}`]:on});toggle.classList.toggle('is-on',on);
     const base=toggle.closest('[data-mv-v-test]')?.dataset.mvVTest;const val=host.querySelector(`[data-mv-v-total="${base}"]`);if(val)val.textContent=signed(testSummary(actor,base).total);return;
   }
   const rb=e.target.closest('[data-mv-v-test-roll]');if(rb)await roll(actor,rb.dataset.mvVTestRoll);
  });
 }});
}
