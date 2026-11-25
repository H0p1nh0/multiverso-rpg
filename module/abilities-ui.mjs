import {sourceForTrait,hasActiveTraitEffects,activateTraitEffects,deleteTraitEffects,isTraitEffectSource} from './trait-effect-links.mjs';
// Painel de Habilidades v0.2.27 — Descrição/Efeitos separados, edição de imagem e atalhos visíveis.
// Execução de Skills/Técnicas delegada integralmente ao executor aprovado.
import {kindsForTraitGroup} from './trait-entry-kinds.mjs';
import {executeNativeEffectTest} from './native-effects.mjs';
import {openAbilityDiagnostic} from './ability-diagnostics.mjs';

const NS='multiverso-rpg';
const TABS={skill:'Skills',tecnica:'Técnicas',especie:'Espécie',classe:'Classe',geral:'Geral'};
const TYPES={
  skill:'Skill',tecnica:'Técnica',habilidadeClasse:'Habilidade de Classe',habilidadeSubclasse:'Habilidade de Subclasse',
  classe:'Classe',subclasse:'Subclasse',especie:'Espécie',habilidadeEspecie:'Traço de Espécie',vantagem:'Característica Geral'
};
const TYPE_ICON={skill:'fa-wand-magic-sparkles',tecnica:'fa-khanda',habilidadeClasse:'fa-shield-halved',habilidadeSubclasse:'fa-sun',classe:'fa-chess-knight',subclasse:'fa-crown',especie:'fa-leaf',habilidadeEspecie:'fa-seedling',vantagem:'fa-star'};
const ESC = v=>foundry.utils.escapeHTML(String(v??''));
const owned=actor=>Boolean(actor.isOwner||game.user?.isGM);
const skillTypes=new Set(['skill','tecnica']);
const classTypes=new Set(['habilidadeClasse','habilidadeSubclasse','classe','subclasse']);
const listTypes = new Set([...skillTypes,...classTypes,'especie','habilidadeEspecie','vantagem']);
const PUBLISH_LABELS={skill:'Skill',tecnica:'Técnica',habilidadeClasse:'Habilidade de Classe',habilidadeSubclasse:'Habilidade de Subclasse',classe:'Classe',subclasse:'Subclasse',especie:'Espécie',habilidadeEspecie:'Traço de Espécie',vantagem:'Característica Geral'};
const text=x=>String(x??'').trim();
const field=(item,name,i=1)=>text(item.system?.props?.[`efeito${item.type}${name}${i===1?'':i}`]);
const activity=(item,i=1)=>text(item.system?.props?.[`ativacaotempotipo${item.type}${i===1?'':i}`]);
const present=(value,fallback='—')=>text(value)||fallback;
const isDisadvantage = item=>['desvantagem','negativo','desvantagemespecie','desvantagem_especie'].includes(text(item.system?.categoria).toLowerCase());
function itemTab(item){
  if(item.type==='skill')return 'skill';
  if(item.type==='tecnica')return 'tecnica';
  if(classTypes.has(item.type))return 'classe';
  if(['especie','habilidadeEspecie'].includes(item.type))return 'especie';
  if(item.type==='vantagem')return 'geral';
  return null;
}
function itemLabel(item){
  if(item.type==='habilidadeEspecie')return isDisadvantage(item)?'Desvantagem de Espécie':'Vantagem de Espécie';
  if(item.type==='vantagem')return isDisadvantage(item)?'Desvantagem Geral':'Vantagem Geral';
  return TYPES[item.type]||'Habilidade';
}
function effects(item){
  const origin=skillTypes.has(item.type)?item:sourceForTrait(item);
  if(!origin)return [];
  const props=origin.system?.props??{};
  const possible=['tipo','afetado','valor','receptor','custo','atividade','alcance','duracao','detalhe','condicaores'];
  const count=Math.max(0,Math.min(5,Number(props.mvEffectCount)||0));
  const existing=Array.from({length:5},(_,i)=>i+1).filter(i=>possible.some(k=>k==='atividade'?activity(origin,i):field(origin,k,i))||text(props[`mvEffectTitle${i}`]));
  const total=Math.max(count,...existing,0);
  return Array.from({length:total},(_,index)=>{
    const i=index+1;
    const name=text(props[`mvEffectTitle${i}`])||`Efeito ${i}`;
    return {name,index:i,kind:field(origin,'tipo',i),target:field(origin,'afetado',i),receiver:field(origin,'receptor',i),value:field(origin,'valor',i),detail:field(origin,'detalhe',i),duration:field(origin,'duracao',i),range:field(origin,'alcance',i),cost:field(origin,'custo',i),action:activity(origin,i),recharge:field(origin,'recarga',i)};
  });
}
function summary(item){
  const e=effects(item);
  const props=item.system?.props??{};
  const levelAliases = item.type==='tecnica' ? ['nivel_tecnica','niveltecnica','tecnicanivel'] : ['nivel_skill','nivelskill','skillnivel'];
  const level=skillTypes.has(item.type)?levelAliases.map(key=>text(props[key])).find(Boolean)||'' : '';
  const first=(key)=>e.map(x=>x[key]).find(Boolean)||'';
  const description=skillTypes.has(item.type)?text(props[item.type==='skill'?'descricaoskill':'descricaotecnica'])||text(item.system?.descricao):text(item.system?.descricao);
  return {level,cost:first('cost'),action:first('action'),range:first('range'),duration:first('duration'),target:first('receiver'),description,effects:e};
}
function favoriteIds(actor){const ids=actor.getFlag(NS,'combatFavoritesV1');return Array.isArray(ids)?ids:[];}
function isFavorite(actor,item){
  if(skillTypes.has(item.type))return favoriteIds(actor).includes(item.id);
  return item.getFlag(NS,'abilityFavoriteV1')===true;
}
async function toggleFavorite(actor,item){
  if(!owned(actor))throw Error('Sem permissão para editar favoritos.');
  const favorite=isFavorite(actor,item);
  if(skillTypes.has(item.type)){
    const list=favoriteIds(actor).filter(id=>id!==item.id);
    if(!favorite)list.push(item.id);
    await actor.setFlag(NS,'combatFavoritesV1',list);
  }else await item.setFlag(NS,'abilityFavoriteV1',!favorite);
}
function badge(label,style=''){return `<span class="mv-ab-badge ${style}">${ESC(label)}</span>`;}
function itemRow(actor,item,selected){
  const s=summary(item);
  const star=isFavorite(actor,item);
  const disadvantage=isDisadvantage(item);
  return `<article class="mv-ab-entry ${item.id===selected?'is-selected':''} ${disadvantage?'is-disadvantage':''}" data-mv-ab-select="${ESC(item.id)}" tabindex="0" role="button" aria-label="Selecionar ${ESC(item.name)}">
    <button type="button" class="mv-ab-star ${star?'is-on':''}" data-mv-ab-favorite="${ESC(item.id)}" title="${star?'Remover dos favoritos':'Favoritar'}"><i class="fa-${star?'solid':'regular'} fa-star"></i></button>
    <img src="${ESC(item.img||'icons/svg/item-bag.svg')}" alt=""/>
    <div class="mv-ab-entry-info"><strong>${ESC(item.name)}</strong><div>${badge(itemLabel(item),disadvantage?'negative':'')}${s.level?`<small>Nível ${ESC(s.level)}</small>`:''}</div><small>${s.cost?'Custo: '+ESC(s.cost):s.description?ESC(s.description.slice(0,90)):'Sem descrição cadastrada.'}</small></div>
    <i class="fa-solid fa-chevron-right mv-ab-entry-arrow"></i></article>`;
}
function details(actor,item,activeTab='descricao'){
  if(!item)return `<div class="mv-ab-detail-empty"><i class="fa-solid fa-book-open"></i><h3>Selecione um registro</h3><p>Selecione uma entrada da lista para consultar, favoritar ou compartilhar.</p></div>`;
  const s=summary(item);
  const fav=isFavorite(actor,item);
  const attrs=[['Nível',s.level],['Custo',s.cost],['Execução',s.action],['Alcance',s.range],['Alvo',s.target],['Duração',s.duration]].filter(([,v])=>v);
  const effectContent=s.effects.length?`<section class="mv-ab-effects"><h4>EFEITOS CADASTRADOS <small>${s.effects.length}</small></h4>${s.effects.map(e=>{
    const meta=[e.kind&&`Tipo: ${e.kind}`,e.target&&`Altera: ${e.target}`,e.value&&`Valor: ${e.value}`,e.duration&&`Duração: ${e.duration}`,e.recharge&&`Recarga: ${e.recharge}`,e.range&&`Alcance: ${e.range}`,e.action&&`Execução: ${e.action}`,e.cost&&`Custo: ${e.cost}`].filter(Boolean).map(v=>`<span>${ESC(v)}</span>`).join('');
    return `<details class="mv-ab-effect"><summary><i class="fa-solid fa-sparkles"></i><strong>${ESC(e.name)}</strong><i class="fa-solid fa-angle-down"></i></summary><div>${meta?`<div class="mv-ab-effect-meta">${meta}</div>`:''}${e.detail?`<p>${ESC(e.detail)}</p>`:''}</div></details>`;
  }).join('')}</section>`:'<div class="mv-ab-no-effects"><i class="fa-regular fa-circle-check"></i><p>Não há efeitos cadastrados neste registro.</p></div>';
  const actionable=skillTypes.has(item.type)||hasActiveTraitEffects(item);
  const buttons=actionable?`<button type="button" class="mv-ab-action-primary" data-mv-ab-use="${ESC(item.id)}"><i class="fa-solid fa-play"></i> ${skillTypes.has(item.type)?'Usar':'Ativar'}</button>`:'';
  const buttonFor=(e)=>`<button type="button" class="mv-ab-action-primary" data-mv-ab-effect-use="${e.index}" data-mv-ab-id="${ESC(item.id)}"><i class="fa-solid fa-play"></i> ${ESC(e.name)}${e.cost?' · '+ESC(e.cost):''}</button>`;
  const effectButtons=s.effects.filter(e=>item.system.props?.[`mvShowUseButton${e.index}`]==='sim').map(buttonFor).join('');
  return `<div class="mv-ab-detail-head">
      <button type="button" class="mv-ab-image-button" data-mv-ab-change-image="${ESC(item.id)}" title="Clique para alterar a imagem" aria-label="Alterar imagem de ${ESC(item.name)}"><img src="${ESC(item.img||'icons/svg/item-bag.svg')}" alt="Imagem de ${ESC(item.name)}"/><span class="mv-ab-image-hint"><i class="fa-solid fa-camera"></i> Alterar</span></button>
      <div><span class="mv-ab-kicker">${ESC(itemLabel(item))}</span><h3>${ESC(item.name)}</h3>${s.level?`<small>Nível ${ESC(s.level)}</small>`:''}</div>
      <button type="button" class="mv-ab-detail-star ${fav?'is-on':''}" data-mv-ab-favorite="${ESC(item.id)}" title="${fav?'Remover dos favoritos':'Favoritar'}" aria-label="${fav?'Desfavoritar':'Favoritar'} ${ESC(item.name)}"><i class="fa-${fav?'solid':'regular'} fa-star"></i></button>
    </div>
    <div class="mv-ab-top-actions" aria-label="Ações da habilidade">
      ${buttons}
      <button type="button" data-mv-ab-test="${ESC(item.id)}"><i class="fa-solid fa-flask"></i> Testar habilidade</button>
      <button type="button" class="mv-ab-share" data-mv-ab-share="${ESC(item.id)}"><i class="fa-solid fa-comment-dots"></i> Enviar ao chat</button>
      <button type="button" data-mv-ab-edit="${ESC(item.id)}"><i class="fa-solid fa-pen"></i> Editar</button>
      <button type="button" class="mv-ab-delete" data-mv-ab-delete="${ESC(item.id)}" title="Excluir registro (requer confirmação)" aria-label="Excluir ${ESC(item.name)}"><i class="fa-solid fa-trash-can"></i></button>
    </div>
    <nav class="mv-ab-inner-tabs" role="tablist" aria-label="Detalhes da habilidade">
      <button type="button" data-mv-ab-detail-tab="descricao" role="tab" aria-selected="${activeTab==='descricao'}" class="${activeTab==='descricao'?'is-active':''}"><i class="fa-solid fa-book-open"></i> Descrição</button>
      <button type="button" data-mv-ab-detail-tab="efeitos" role="tab" aria-selected="${activeTab==='efeitos'}" class="${activeTab==='efeitos'?'is-active':''}"><i class="fa-solid fa-sparkles"></i> Efeitos ${s.effects.length?`<span class="mv-ab-effect-count">${s.effects.length}</span>`:''}</button>
    </nav>
    <div class="mv-ab-inner-body" role="tabpanel">
      ${activeTab==='efeitos' ? effectContent : `${attrs.length?`<div class="mv-ab-stats">${attrs.map(([k,v])=>`<div><span>${ESC(k)}</span><strong>${ESC(v)}</strong></div>`).join('')}</div>`:''}
        ${effectButtons?`<div class="mv-ab-top-actions mv-ab-effect-actions" aria-label="Ativações dos efeitos">${effectButtons}</div>`:''}
        <section class="mv-ab-description"><h4>DESCRIÇÃO</h4><p>${s.description?ESC(s.description):'<span class="mv-ab-muted">Nenhuma descrição cadastrada.</span>'}</p></section>
        <section class="mv-ab-card-preview"><h4>CARTÃO DO CHAT <small>Pré-visualização</small></h4><div class="mv-ab-card-embed">${chatCard(actor,item)}</div></section>`}
    </div>`;
}
function options(list,current){return list.map(([value,label])=>`<option value="${ESC(value)}" ${current===value?'selected':''}>${ESC(label)}</option>`).join('');}
function allowedFor(tab){
  if(tab==='skill')return [['skill','Skill','']];
  if(tab==='tecnica')return [['tecnica','Técnica','']];
  if(['especie','classe','geral'].includes(tab))return kindsForTraitGroup(tab).map(kind=>[kind.type,kind.label,kind.category]);
  return [];
}
async function createItem(actor,tab,subtype){
  if(!owned(actor))return ui.notifications.warn('Sem permissão para criar habilidades.');
  const allowed=allowedFor(tab);
  const preselected=allowed.find(([type,,category])=>type+':'+category===subtype)||allowed[0];
  const choices=allowed.map(([type,label,category])=>`<option value="${ESC(type+':'+category)}" ${preselected===allowed.find(x=>x[0]===type&&x[2]===category)?'selected':''}>${ESC(label)}</option>`).join('');
  const result=await foundry.applications.api.DialogV2.wait({window:{title:'Criar registro'},content:`<div class="mv-ab-dialog"><label>Tipo de registro<select data-mv-ab-new-type>${choices}</select></label><label>Nome<input type="text" data-mv-ab-new-name value="Novo registro" maxlength="120"/></label></div>`,buttons:[{action:'cancel',label:'Cancelar',callback:()=>null},{action:'create',label:'Criar',default:true,callback:(_e,_b,d)=>({value:d.element.querySelector('[data-mv-ab-new-type]')?.value,name:d.element.querySelector('[data-mv-ab-new-name]')?.value?.trim()})}],rejectClose:false});
  if(!result)return null;
  const [type,category] = String(result.value).split(':');
  if(!allowed.some(x=>x[0]===type&&x[2]===category))throw Error('Tipo inválido.');
  if(!result.name)return ui.notifications.warn('Informe um nome para o registro.');
  const [created]=await actor.createEmbeddedDocuments('Item',[{name:result.name,type,system:{categoria:category}}]);
  created?.sheet?.render(true);
  return created;
}
function chatCard(actor,item){
  const s=summary(item);
  const props=[['Nível',s.level],['Custo',s.cost],['Execução',s.action],['Alcance',s.range],['Duração',s.duration]].filter(([,v])=>v);
  return `<section style="background:linear-gradient(145deg,#1a1511,#100f14);color:#f2dfbb;border:1px solid #a9874e;border-radius:12px;padding:15px;box-shadow:0 4px 13px #0007;"><div style="display:flex;align-items:center;gap:12px;"><img src="${ESC(item.img||'icons/svg/item-bag.svg')}" style="width:52px;height:52px;border:1px solid #a9874e;border-radius:9px;object-fit:cover;background:#100e12;" alt=""/><div style="flex:1;"><small style="color:#dab879;letter-spacing:.04em;">${ESC(itemLabel(item))} • ${ESC(actor.name)}</small><h3 style="font:700 22px Georgia,serif;margin:4px 0;color:#f8d898;">${ESC(item.name)}</h3></div></div>${props.length?`<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;">${props.map(([k,v])=>`<span style="padding:5px 8px;border:1px solid #78603b;border-radius:5px;background:#221a13;font-size:12px;">${ESC(k)}: <b>${ESC(v)}</b></span>`).join('')}</div>`:''}<p style="white-space:pre-wrap;margin-top:12px;line-height:1.5;">${s.description?ESC(s.description):'Sem descrição cadastrada.'}</p>${s.effects.length?`<div style="border-top:1px solid #78603b;padding-top:10px;"><strong style="color:#edcb89;">Efeitos</strong>${s.effects.map(e=>`<p style="margin:7px 0 0;"><b>${ESC(e.name)}:</b> ${ESC([e.detail,e.value&&'Valor: '+e.value,e.duration&&'Duração: '+e.duration].filter(Boolean).join(' • ')||'Conforme cadastro da habilidade.')}</p>`).join('')}</div>`:''}</section>`;
}
async function shareItem(actor,item){
  const result=await foundry.applications.api.DialogV2.wait({window:{title:'Enviar habilidade ao chat'},content:`<div class="mv-ab-dialog"><p>Compartilhar <strong>${ESC(item.name)}</strong> com:</p><label><input type="radio" name="mv-ab-audience" value="todos" checked/> Todos os jogadores</label><label><input type="radio" name="mv-ab-audience" value="mestres"/> Somente o mestre</label></div>`,buttons:[{action:'cancel',label:'Cancelar',callback:()=>null},{action:'send',label:'Enviar',default:true,callback:(_e,_b,d)=>d.element.querySelector('[name="mv-ab-audience"]:checked')?.value}],rejectClose:false});
  if(!result)return;
  const gmIds=Array.from(game.users??[]).filter(u=>u.isGM).map(u=>u.id);
  if(result==='mestres'&&!gmIds.length)return ui.notifications.warn('Não há mestre cadastrado neste mundo.');
  const options={speaker:ChatMessage.getSpeaker({actor}),content:chatCard(actor,item)};
  if(result==='mestres')options.whisper=gmIds;
  await ChatMessage.create(options);
}

async function changeAbilityImage(actor,item,sheet){
  if(!owned(actor)||(!item.isOwner&&!game.user?.isGM))throw Error('Sem permissão para alterar a imagem desta habilidade.');
  const Picker=foundry.applications.apps.FilePicker.implementation;
  if(!Picker)throw Error('O seletor de imagens do Foundry não está disponível.');
  new Picker({
    type:'image',current:item.img,
    callback:async path=>{
      if(!path||path===item.img)return;
      try{await item.update({img:path});sheet.render(false);}
      catch(error){console.error('Multiverso | Imagem de habilidade',error);ui.notifications.error(error?.message||'Não foi possível salvar a imagem.');}
    }
  }).render(true);
}

export function bindAbilitiesUI(sheet,root){
  const mount=root.querySelector('[data-mv-abilities-mount]');if(!mount)return;
  const actor=sheet.actor;
  const state=sheet._mvAbilitiesUiState ??= {tab:'skill',type:'todos',query:'',favorites:false,selected:null,detailTab:'descricao'};
  if(!TABS[state.tab])state.tab='skill';
  if(!['descricao','efeitos'].includes(state.detailTab))state.detailTab='descricao';
  const currentItems=()=>Array.from(actor.items??[]).filter(i=>listTypes.has(i.type)&&i.getFlag?.(NS,'manualEffectSourceV1')!==true&&i.getFlag?.(NS,'itemEffectSourceV1')!==true&&i.getFlag?.(NS,'itemCastCloneV1')!==true&&i.getFlag?.(NS,'itemAbilityTemplateV1')!==true&&!isTraitEffectSource(i));
  let searchTimer=null;
  const render=()=>{
    if(searchTimer!==null){clearTimeout(searchTimer);searchTimer=null;}
    const all=currentItems();
    const items=all.filter(i=>itemTab(i)===state.tab);
    const filtered=items.filter(i=>(state.type==='todos'||(state.type==='vantagem'?!isDisadvantage(i)&&i.type!== 'especie':state.type==='desvantagem'?isDisadvantage(i):state.type==='habclasse'?['habilidadeClasse','habilidadeSubclasse'].includes(i.type):i.type===state.type))&&(!state.favorites||isFavorite(actor,i))&&i.name.toLocaleLowerCase('pt-BR').includes(state.query.toLocaleLowerCase('pt-BR')));
    filtered.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
    if(state.selected&&!filtered.some(i=>i.id===state.selected))state.selected=null;
    const selected=all.find(i=>i.id===state.selected)??null;
    const filters=state.tab==='skill'?[['todos','Todas as skills']]:state.tab==='tecnica'?[['todos','Todas as técnicas']]:state.tab==='classe'?[['todos','Todos os registros'],['habclasse','Habilidades de Classe/Subclasse'],['classe','Classes'],['subclasse','Subclasses']]:state.tab==='especie'?[['todos','Todos os traços'],['especie','Espécie'],['vantagem','Vantagens de Espécie'],['desvantagem','Desvantagens de Espécie']]:[['todos','Todas as características'],['vantagem','Vantagens Gerais'],['desvantagem','Desvantagens Gerais']];
    mount.innerHTML=`<div class="mv-abilities-v224 mv-ab-group-${state.tab}"><nav class="mv-ab-tabs" aria-label="Categorias de habilidades">${Object.entries(TABS).map(([key,title])=>`<button type="button" data-mv-ab-tab="${key}" class="${state.tab===key?'is-active':''}">${ESC(title)}</button>`).join('')}</nav><div class="mv-ab-columns"><section class="mv-ab-list-pane"><div class="mv-ab-title-row"><h3>${ESC(TABS[state.tab])}</h3><button type="button" class="mv-ab-create" data-mv-ab-create title="Criar registro"><i class="fa-solid fa-plus"></i> Criar</button></div><div class="mv-ab-list-tools"><input type="search" data-mv-ab-search placeholder="Buscar habilidade..." value="${ESC(state.query)}" aria-label="Buscar habilidade"/><select data-mv-ab-filter aria-label="Filtrar tipos">${options(filters,state.type)}</select><label class="mv-ab-only-faves"><input data-mv-ab-onlyfav type="checkbox" ${state.favorites?'checked':''}/> <i class="fa-solid fa-star"></i> Somente favoritas</label></div><div class="mv-ab-entries">${filtered.length?filtered.map(i=>itemRow(actor,i,state.selected)).join(''):'<div class="mv-ab-list-empty">Nenhum registro encontrado neste filtro.</div>'}</div><div class="mv-ab-list-footer">${filtered.length} ${filtered.length===1?'registro':'registros'} • ${state.tab==='skill'?'Skills':state.tab==='tecnica'?'Técnicas':state.tab==='classe'?'Registros de Classe e Subclasse':state.tab==='especie'?'Traços da Espécie':'Vantagens e Desvantagens Gerais'} </div></section><section class="mv-ab-detail-pane">${details(actor,selected,state.detailTab)}</section></div></div>`;
  };
  render();
  mount.addEventListener('input',event=>{
    const el=event.target;
    if(!el.matches('[data-mv-ab-search]'))return;
    state.query=el.value;
    const begin=el.selectionStart,end=el.selectionEnd;
    if(searchTimer!==null)clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>{
      searchTimer=null;
      if(!mount.isConnected)return;
      render();
      const next=mount.querySelector('[data-mv-ab-search]');
      next?.focus();try{next?.setSelectionRange(begin,end);}catch{}
    },100);
  });
  mount.addEventListener('change',event=>{
    const el=event.target;
    if(el.matches('[data-mv-ab-filter]')){state.type=el.value;state.selected=null;state.detailTab='descricao';render();}
    if(el.matches('[data-mv-ab-onlyfav]')){state.favorites=el.checked;state.selected=null;state.detailTab='descricao';render();}
  });
  mount.addEventListener('click',async event=>{
    const target=event.target.closest('[data-mv-ab-tab],[data-mv-ab-create],[data-mv-ab-select],[data-mv-ab-favorite],[data-mv-ab-edit],[data-mv-ab-delete],[data-mv-ab-use],[data-mv-ab-test],[data-mv-ab-share],[data-mv-ab-change-image],[data-mv-ab-detail-tab],[data-mv-ab-effect-use]');
    if(!target)return;
    const action=(key)=>target.hasAttribute('data-mv-ab-'+key);
    if(action('tab')){state.tab=target.dataset.mvAbTab;state.type='todos';state.query='';state.selected=null;state.favorites=false;state.detailTab='descricao';render();return;}
    if(action('select')){state.selected=state.selected===target.dataset.mvAbSelect?null:target.dataset.mvAbSelect;state.detailTab='descricao';render();return;}
    if(action('detail-tab')){state.detailTab=target.dataset.mvAbDetailTab==='efeitos'?'efeitos':'descricao';render();return;}
    if(target.disabled)return;
    target.disabled=true;
    try{
      if(action('create')){const created=await createItem(actor,state.tab);if(created)state.selected=created.id;render();return;}
      const id=target.dataset.mvAbId||target.dataset.mvAbFavorite||target.dataset.mvAbEdit||target.dataset.mvAbDelete||target.dataset.mvAbUse||target.dataset.mvAbTest||target.dataset.mvAbShare||target.dataset.mvAbChangeImage;
      const item=actor.items.get(id);if(!item)return;
      if(target.dataset.mvAbEffectUse){
        if(!owned(actor))throw Error('Sem permissão para executar este efeito.');
        const slot=Number(target.dataset.mvAbEffectUse);
        await executeNativeEffectTest(item,{onlySlots:[slot]});
        render();return;
      }
      if(action('test')){await openAbilityDiagnostic(item);return;}
      if(action('change-image')){await changeAbilityImage(actor,item,sheet);return;}
      if(action('favorite'))await toggleFavorite(actor,item);
      if(action('edit')){item.sheet?.render(true);return;}
      if(action('delete')){
        if(!owned(actor))throw Error('Sem permissão para excluir.');
        const ok=await foundry.applications.api.DialogV2.confirm({window:{title:'Excluir habilidade'},content:`Excluir <strong>${ESC(item.name)}</strong> da ficha? Esta ação não pode ser desfeita.`});
        if(ok){await deleteTraitEffects(item);await item.delete();state.selected=null;}
      }
      if(action('share'))await shareItem(actor,item);
      if(action('use')){
        if(!owned(actor))throw Error('Sem permissão para executar esta habilidade.');
        if(skillTypes.has(item.type))await executeNativeEffectTest(item);
        else await activateTraitEffects(item);
      }
      render();
    }catch(error){console.error('Multiverso | Habilidades',error);ui.notifications.error(error?.message||'Não foi possível concluir a operação.');render();}
    finally{if(target.isConnected)target.disabled=false;}
  });
  mount.addEventListener('keydown',event=>{
    if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-mv-ab-select]')){event.preventDefault();state.selected=state.selected===event.target.dataset.mvAbSelect?null:event.target.dataset.mvAbSelect;state.detailTab='descricao';render();}
  });
}
