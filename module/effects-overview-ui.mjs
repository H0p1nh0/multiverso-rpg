// Multiverso RPG v0.2.31 — editor nativo Multiverso: descrição, modificadores e imagem clicável.
// Preserva as rotinas do motor de dano, duração, condições e manutenção existentes.
import {collectDamageProtections} from './damage-protection.mjs';
import {readTracked} from './effect-tracking.mjs';
import {listCombatConditions} from './combat-conditions.mjs';
import {endMaintainedEffect} from './maintained-attributes.mjs';
import {createManualEffectSource,getOrCreateSourceForLegacy,manualSources,openManualEffectSource} from './manual-effect-sources.mjs';

const NS='multiverso-rpg';
const esc=value=>foundry.utils.escapeHTML(String(value??''));
const dmgTypes=['todos','fisico','elemental','fogo','frio','eletrico','quimico','psiquico','sagrado','sombrio','verdadeiro','outro'];
const damageNames={todos:'Todos os danos',fisico:'Físico',elemental:'Elemental',fogo:'Fogo',frio:'Frio / Gelo',eletrico:'Elétrico',quimico:'Químico / Ácido',psiquico:'Psíquico',sagrado:'Sagrado',sombrio:'Sombrio / Necrótico',verdadeiro:'Verdadeiro',outro:'Outro'};
const n=value=>Number(value);
const isOwner=actor=>!!(actor.isOwner||game.user?.isGM);
const describeType=value=>damageNames[value]??String(value??'Outro').replaceAll('_',' ');

function effectDescription(effect){
  const raw=effect?.description??effect?.system?.description??effect?.flags?.[NS]?.manualOverviewConfig?.description??'';
  return typeof raw==='string'?raw:'';
}
function manualConfigFromEffect(effect){
  const root=effect?.flags?.[NS]??{};
  const cfg=root.manualOverviewConfig??{};
  return {
    category:String(cfg.category??root.manualOverviewCategory??'').trim(),
    source:String(cfg.source??root.manualOverviewSource??'').trim(),
    duration:String(cfg.duration??root.manualOverviewDuration??'').trim(),
    description:String(cfg.description??effectDescription(effect)??'').trim(),
    icon:String(cfg.icon??effect?.img??'icons/svg/aura.svg').trim()||'icons/svg/aura.svg',
    modifiers:Array.isArray(cfg.modifiers)?cfg.modifiers:[],
    canonicalEffects:Array.isArray(cfg.canonicalEffects)?cfg.canonicalEffects:null
  };
}
function protections(actor){
  const discovered=new Set(dmgTypes);
  for(const ae of actor.effects??[]){
    const meta=ae.flags?.[NS]??ae.flags?.multiverso??ae.flags?.['multiverso-automacao']??{};
    if(meta.protecaoDano?.tipoDano)discovered.add(String(meta.protecaoDano.tipoDano));
    for(const p of Array.isArray(meta.efeitos)?meta.efeitos:[])if(p.tipodano||p.tipoDano)discovered.add(String(p.tipodano??p.tipoDano));
  }
  const unique=new Map(),warnings=new Map();
  for(const type of discovered){
    const result=collectDamageProtections(actor,type);
    for(const e of result.entries??[]){
      const key=JSON.stringify([e.natureza,e.tipoDano,e.modo,e.valor,e.fonte,e.acumulo]);
      unique.set(key,e);
    }
    for(const e of result.unsupported??[])warnings.set(JSON.stringify(e),e);
  }
  const all=[...unique.values()];
  return {resistances:all.filter(p=>p.natureza==='resistencia'),immunities:all.filter(p=>p.natureza==='imunidade'),vulnerabilities:all.filter(p=>p.natureza==='vulnerabilidade'),warnings:[...warnings.values()]};
}
function protectionValue(entry){
  if(entry.natureza==='imunidade')return 'Imune ao dano';
  if(entry.natureza==='vulnerabilidade')return 'Dano ×2';
  if(entry.modo==='percentual')return entry.valor===50?'Metade (50%)':`Reduz ${entry.valor}%`;
  return `Flat ${entry.valor}`;
}
function protectionGroup(title,list,icon,variant,empty){
  const entries=list.map(p=>`<div class="mv-ef-protection-item" title="Origem: ${esc(p.fonte)}"><span>${esc(describeType(p.tipoDano))}</span><strong>${esc(protectionValue(p))}</strong><small>${esc(p.fonte)}</small></div>`).join('');
  return `<section class="mv-ef-protection mv-ef-protection-${variant}"><h3><i class="fa-solid ${icon}" aria-hidden="true"></i>${title}<span>${list.length}</span></h3><div class="mv-ef-protection-rows">${entries||`<p class="mv-ef-muted">${empty}</p>`}</div></section>`;
}
function trackedInfo(t){
  if(!t)return '';
  if(t.maintainedEffect?.condition&&/inspirad/i.test(String(t.name??'')))return 'Até o fim da cena ou até ser consumido';
  if(t.auraController||t.mode==='sustained')return 'Sustentado';
  if(t.mode==='scene'||t.sceneBound||Number(t.remaining)>=100000000)return 'Até o fim da cena';
  const mode=t.mode==='turns'?'turno':t.mode==='rounds'?'rodada':'ciclo';
  if(!Number.isFinite(n(t.remaining)))return 'Duração acompanhada';
  const rem=n(t.remaining);
  return `${rem} ${mode}${rem===1?'':'s'} restante${rem===1?'':'s'}`;
}
function rows(actor){
  const tracked=readTracked(actor);
  const trackedById=new Map(tracked.map(t=>[t.id,t]));
  const conditions=new Set(listCombatConditions(actor,tracked).map(c=>c.id));
  const entries=[];const linked=new Set();
  for(const ae of actor.effects??[]){
    if(ae.disabled||ae.isSuppressed)continue;
    const manual=ae.getFlag?.(NS,'manualOverviewEffectV1')?manualConfigFromEffect(ae):null;
    const tId=ae.getFlag?.(NS,'trackingId');
    const t=tId?trackedById.get(tId):null;
    if(t)linked.add(t.id);
    const condition=conditions.has(ae.id)||t?.maintainedEffect?.condition===true;
    const category=manual?.category || (condition?'Condição':t?'Temporário':'Efeito ativo');
    const source=manual?.source || t?.source || (ae.getFlag?.(NS,'manualOverviewEffectV1')?'Adicionado na ficha':'Efeito no personagem');
    const duration=trackedInfo(t)||manual?.duration||'Ativo';
    entries.push({
      key:`ae:${ae.id}`,
      name:ae.name||'Efeito ativo',
      img:manual?.icon||ae.img||'icons/svg/aura.svg',
      category,
      source,
      descriptionText:manual?.description||effectDescription(ae),
      duration,
      activeEffect:ae,
      tracked:t
    });
  }
  for(const t of tracked){
    if(linked.has(t.id))continue;
    const condition=t.maintainedEffect?.condition===true;
    entries.push({
      key:`track:${t.id}`,
      name:t.name||'Duração',
      img:'icons/svg/aura.svg',
      category:condition?'Condição':'Temporário',
      source:t.source||'Habilidade',
      descriptionText:'',
      duration:trackedInfo(t),
      activeEffect:null,
      tracked:t
    });
  }
  // Os registros manuais são efeitos contínuos; mantêm o formato de Item para reutilizar os coletores passivos.
  for(const item of manualSources(actor)){
    const level=Number(item.system?.props?.mvEffectCount??0);
    const legacyId=item.getFlag(NS,'legacyEffectId');
    const kinds=Array.from({length:level},(_,i)=>{
      const suffix=i===0?'':String(i+1);
      const props=item.system?.props??{};
      return {kind:String(props[`efeitoskilltipo${suffix}`]??'').trim(),affected:String(props[`efeitoskillafetado${suffix}`]??'').trim()};
    });
    const configured=kinds.some(({kind})=>Boolean(kind));
    // Não rotular uma mecânica não suportada como automaticamente aplicada.
    const supported=kinds.every(({kind,affected})=>!kind || ['resistencia','imunidade','vulnerabilidade','modificador_custo'].includes(kind) ||
      ['teste','bonus','penalidade','vantagem','desvantagem'].includes(kind) || (kind==='dano'&&affected==='dano_adicional'));
    const status=!configured?'A configurar':supported?'Ativo':'Configuração especial';
    const sourceCategory=kinds.some(({kind})=>kind==='condicao')?'Condição':'Efeito ativo';
    entries.push({key:`source:${item.id}`,name:item.name||'Efeito',img:item.img||'icons/svg/aura.svg',category:sourceCategory,status,description:item.system?.descricao||'',source:'Efeito do personagem',duration:`${level} ${level===1?'modificador':'modificadores'}`,activeEffect:null,tracked:null,sourceItem:item,legacyId,passive:true});
  }
  return entries;
}

// Combate e Efeitos devem exibir a mesma lista de registros. Os efeitos são
// somente apresentados aqui; aplicação, duração e remoção seguem seus motores.
export function combatEffectSections(actor){
  const entries=rows(actor);
  const normalized=entries.map(entry=>{
    const source=String(entry.source??entry.description??'').trim();
    const description=String(entry.descriptionText??'').trim();
    const duration=String(entry.duration??'').trim();
    const state=String(entry.status??'').trim();
    const parts=[];
    if(source&&source!=='Efeito no personagem'&&source!=='Efeito do personagem')parts.push(source);
    if(entry.sourceItem){
      if(state)parts.push(state);
      // Em registros manuais, duration descreve a quantidade de modificadores,
      // e não uma duração rastreada em combate.
    }else if(duration&&duration!=='Ativo')parts.push(duration);
    if(description&&!source)parts.push(description.slice(0,100));
    return {
      id:entry.key,
      name:entry.name,
      img:entry.img,
      description:parts.join(' • ')|| (entry.category==='Condição'?'Condição ativa':'Efeito ativo'),
      duration:entry.sourceItem?'':duration,
      category:entry.category
    };
  });
  return {
    conditions:normalized.filter(entry=>entry.category==='Condição'),
    effects:normalized.filter(entry=>entry.category!=='Condição')
  };
}

function detailEntry(actor,entry){
  if(!entry)return `<div class="mv-ef-empty-detail"><i class="fa-solid fa-shield-heart" aria-hidden="true"></i><h3>Estado do personagem</h3><p>Selecione um efeito ou cadastro para consultar detalhes.</p></div>`;
  const item=entry.sourceItem,ae=entry.activeEffect,t=entry.tracked;
  if(item){
    const props=item.system?.props??{};
    const count=Math.max(0,Math.min(5,Number(props.mvEffectCount)||0));
    const legacyActive=entry.legacyId && [...(actor.effects??[])].some(a=>a.id===entry.legacyId&&!a.disabled);
    const effectList=Array.from({length:count},(_,j)=>{
      const ix=j===0?'':String(j+1);
      const label=String(props[`mvEffectTitle${j+1}`]??'').trim()||`Efeito ${j+1}`;
      const type=String(props[`efeitoskilltipo${ix}`]??'').trim()||'A configurar';
      const detail=String(props[`efeitoskilldetalhe${ix}`]??'').trim();
      return `<div class="mv-ef-impact-row"><i class="fa-solid fa-sparkles" aria-hidden="true"></i><div><strong>${esc(label)}</strong> • ${esc(type)}${detail?`<small style="display:block">${esc(detail)}</small>`:''}</div></div>`;
    }).join('');
    return `<article class="mv-ef-detail-inner"><div class="mv-ef-detail-head"><button type="button" class="mv-ef-detail-photo" data-mv-ef-photo="${esc(entry.key)}" title="Alterar imagem"><img src="${esc(item.img||'icons/svg/aura.svg')}" alt="Imagem do efeito"/><i class="fa-solid fa-camera" aria-hidden="true"></i></button><div><small>EFEITO</small><h3>${esc(item.name)}</h3><span>${esc(entry.duration)}</span></div></div>
      <section class="mv-ef-detail-description"><h4>DESCRIÇÃO</h4><p>${esc(props.descricaoskill??item.system?.descricao??'Sem descrição.')}</p></section>
      <section class="mv-ef-detail-impact"><h4>EFEITOS CONFIGURADOS</h4>${effectList||'<p class="mv-ef-muted">Abra o efeito para configurar os modificadores.</p>'}</section>
      ${legacyActive?'<p class="mv-ef-legacy-warning"><i class="fa-solid fa-triangle-exclamation"></i> A versão antiga ainda está ativa. Seus modificadores ficam protegidos contra duplicação.</p>':''}
      ${(item.getFlag(NS,'legacyNotes')??[]).map(note=>`<p class="mv-ef-legacy-warning">${esc(note)}</p>`).join('')}
      
      <div class="mv-ef-actions"><button type="button" data-mv-ef-edit="${esc(entry.key)}"><i class="fa-solid fa-folder-open"></i> Abrir</button><button type="button" data-mv-ef-share="${esc(entry.key)}"><i class="fa-solid fa-comment-dots"></i> Enviar</button><button type="button" class="mv-ef-danger" data-mv-ef-end="${esc(entry.key)}"><i class="fa-solid fa-trash"></i> Excluir</button></div>
    </article>`;
  }
  const flag=ae?.flags?.[NS]??{};
  const stored=flag.storedAttributeDelta??(t?.maintainedEffect?.storedOnSheet?t.maintainedEffect:null);
  const prot=flag.protecaoDano??t?.maintainedEffect?.protection??null;
  const impacts=[];
  if(prot)impacts.push(`${({resistencia:'Resistência',imunidade:'Imunidade',vulnerabilidade:'Vulnerabilidade'})[prot.natureza]??'Proteção'}: ${describeType(prot.tipoDano??prot.tipodano)} • ${prot.valor??''}`);
  if(stored?.attributeKey)impacts.push(`${stored.attributeKey}: ${stored.delta>=0?'+':''}${stored.delta}`);
  if(flag.blocksAction)impacts.push('Restringe ações');
  if(t?.periodic)impacts.push('Efeito periódico');
  if(t?.maintainedEffect)impacts.push('Efeito mantido');
  if(t?.auraController)impacts.push('Aura controlada pelo conjurador');
  for(const change of (ae?.changes??[]).slice(0,12))impacts.push(`${change.key}: ${change.value}`);
  const legacy=Boolean(ae?.getFlag?.(NS,'manualOverviewEffectV1'));
  const canEnd=isOwner(actor)&&Boolean(ae||t);
  const canEdit=isOwner(actor)&&legacy;
  return `<article class="mv-ef-detail-inner"><div class="mv-ef-detail-head">${legacy&&isOwner(actor)?`<button type="button" class="mv-ef-detail-photo" data-mv-ef-photo="${esc(entry.key)}" title="Alterar imagem"><img src="${esc(entry.img)}" alt="Imagem"/><i class="fa-solid fa-camera"></i></button>`:`<img src="${esc(entry.img)}" alt=""/>`}<div><small>${esc(entry.category)}</small><h3>${esc(entry.name)}</h3><span>${esc(entry.duration)}</span></div></div>
    <div class="mv-ef-detail-facts"><div><span>Origem</span><strong>${esc(entry.source??'Não informada')}</strong></div><div><span>Estado</span><strong>${esc(entry.category)}</strong></div><div><span>Duração</span><strong>${esc(entry.duration)}</strong></div></div>
    <section class="mv-ef-detail-description"><h4>INFORMAÇÕES</h4><p>${esc(entry.descriptionText||'Consulte a habilidade ou condição de origem.')}</p></section>
    <section class="mv-ef-detail-impact"><h4>IMPACTO NO PERSONAGEM</h4>${impacts.length?impacts.map(x=>`<div class="mv-ef-impact-row"><i class="fa-solid fa-diamond" aria-hidden="true"></i>${esc(x)}</div>`).join(''):'<p class="mv-ef-muted">Não há modificadores numéricos legíveis neste registro.</p>'}</section>
    ${legacy?'<p class="mv-ef-legacy-warning">Esse registro foi criado pelo editor manual anterior. Editar cria uma origem com o editor original, preservando o efeito ativo até sua remoção.</p>':''}
    <div class="mv-ef-actions"><button type="button" data-mv-ef-share="${esc(entry.key)}"><i class="fa-solid fa-comment-dots"></i> Enviar ao chat</button>${canEdit?`<button type="button" data-mv-ef-edit="${esc(entry.key)}"><i class="fa-solid fa-folder-open"></i> Abrir</button>`:''}${canEnd?`<button type="button" class="mv-ef-danger" data-mv-ef-end="${esc(entry.key)}"><i class="fa-solid fa-xmark"></i>${t?.auraController?'Encerrar aura':t?'Encerrar duração':'Remover efeito'}</button>`:''}</div>
  </article>`;
}
function chatHtml(actor,entry){
  return `<div style="border:1px solid #a6814d;border-radius:10px;background:#15131a;color:#f0d8aa;padding:14px;"><h3 style="color:#f4d398;font-family:Georgia,serif;">${esc(entry.name)}</h3><p><strong>${esc(actor.name)}</strong> • ${esc(entry.category)}</p><p>Origem: ${esc(entry.source??'Manual')} • ${esc(entry.duration)}</p>${entry.descriptionText?`<p>${esc(entry.descriptionText)}</p>`:''}<small>Consulta de efeito — nenhuma ativação executada.</small></div>`;
}
async function share(actor,entry){
  const choice=await foundry.applications.api.DialogV2.wait({window:{title:'Compartilhar efeito'},content:`<div style="display:grid;gap:10px;"><p>Enviar <strong>${esc(entry.name)}</strong> para:</p><label><input type="radio" name="mv-ef-audience" value="todos" checked/> Todos os jogadores</label><label><input type="radio" name="mv-ef-audience" value="gm"/> Somente o mestre</label></div>`,buttons:[{action:'cancel',label:'Cancelar',callback:()=>null},{action:'send',label:'Enviar',default:true,callback:(_e,_b,d)=>d.element.querySelector('[name="mv-ef-audience"]:checked')?.value}],rejectClose:false});
  if(!choice)return;
  const options={speaker:ChatMessage.getSpeaker({actor}),content:chatHtml(actor,entry)};
  if(choice==='gm'){
    const gmIds=[...(game.users??[])].filter(x=>x.isGM).map(x=>x.id);
    if(!gmIds.length)throw Error('Nenhum mestre encontrado neste mundo.');
    options.whisper=gmIds;
  }
  await ChatMessage.create(options);
}
async function endEntry(sheet,entry){
  const actor=sheet.actor;
  if(!isOwner(actor))throw Error('Você não tem permissão para encerrar esse efeito.');
  const ae=entry.activeEffect,t=entry.tracked;
  if(entry.sourceItem){
    const yes=await foundry.applications.api.DialogV2.confirm({window:{title:'Excluir cadastro'},content:`Excluir o cadastro <strong>${esc(entry.name)}</strong>? Efeitos já aplicados pelo motor não serão removidos automaticamente.`});
    if(!yes)return false;
    await entry.sourceItem.delete();return true;
  }
  const yes=await foundry.applications.api.DialogV2.confirm({window:{title:'Encerrar efeito'},content:`Encerrar <strong>${esc(entry.name)}</strong>? Bônus mantidos e durações associadas serão removidos, sem desfazer recursos já aplicados.`});
  if(!yes)return false;
  if(t?.auraController){await sheet._endOwnAura(t);return true;}
  if(t){
    if(t.maintainedEffect)await endMaintainedEffect(actor,t);
    else if(ae)await ae.delete();
    await actor.setFlag(NS,'trackedDurations',readTracked(actor).filter(e=>e.id!==t.id));
  }else if(ae){
    if(ae.getFlag(NS,'storedAttributeDelta'))throw Error('Esse modificador exige revisão manual: falta o registro de duração associado.');
    await ae.delete();
  }
  return true;
}
async function changeImage(sheet,entry){
  const document=entry.sourceItem||entry.activeEffect;
  if(!document||!isOwner(sheet.actor))return;
  if(!entry.sourceItem&&!document.getFlag?.(NS,'manualOverviewEffectV1'))return;
  const Picker=foundry.applications.apps.FilePicker.implementation;
  if(!Picker)throw Error('O seletor de imagens não está disponível.');
  new Picker({type:'image',current:document.img,callback:async path=>{if(!path)return;await document.update({img:path});sheet.render(false);}}).render(true);
}
export function bindEffectsOverviewUI(sheet,root){
  const mount=root.querySelector('[data-mv-effects-overview]');if(!mount)return;
  const actor=sheet.actor;
  const state=sheet._mvEffectsOverviewState??={query:'',filter:'todos',selected:null};
  let searchTimer=null;
  const render=()=>{
    if(searchTimer!==null){clearTimeout(searchTimer);searchTimer=null;}
    const p=protections(actor),all=rows(actor);
    if(state.selected&&!all.some(e=>e.key===state.selected))state.selected=null;
    const visible=all.filter(e=>(state.filter==='todos'||state.filter===e.category)&&e.name.toLocaleLowerCase('pt-BR').includes(state.query.toLocaleLowerCase('pt-BR')));
    const detail=all.find(e=>e.key===state.selected)??null;
    const count=category=>all.filter(e=>e.category===category).length;
    const options=[['todos','Todos'],['Condição','Condições'],['Temporário','Temporários'],['Efeito ativo','Efeitos ativos']];
    mount.innerHTML=`<div class="mv-ef-overview"><header class="mv-ef-title"><div><span class="mv-ef-eyebrow">ESTADO ATUAL</span><h2><i class="fa-solid fa-shield-heart" aria-hidden="true"></i> Efeitos</h2><p>Proteções, alterações e cadastros de origem que afetam o personagem.</p></div><span class="mv-ef-title-counter">${all.length} registros</span></header>
      <section class="mv-ef-defenses"><div class="mv-ef-section-heading"><h3><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> RESISTÊNCIAS, IMUNIDADES E VULNERABILIDADES</h3><small>Proteções contra dano registradas no personagem</small></div>
        <div class="mv-ef-protection-grid">${protectionGroup('RESISTÊNCIAS',p.resistances,'fa-shield','resistance','Nenhuma resistência registrada.')}${protectionGroup('IMUNIDADES',p.immunities,'fa-ban','immunity','Nenhuma imunidade registrada.')}${protectionGroup('VULNERABILIDADES',p.vulnerabilities,'fa-triangle-exclamation','vulnerability','Nenhuma vulnerabilidade registrada.')}</div>
        ${p.warnings.length?`<div class="mv-ef-warn"><i class="fa-solid fa-triangle-exclamation"></i> ${p.warnings.length} proteção(ões) sem valor legível pelo motor.</div>`:''}
      </section>
      <div class="mv-ef-main"><section class="mv-ef-panel mv-ef-list"><div class="mv-ef-pane-head"><h3><i class="fa-solid fa-list"></i> CONDIÇÕES E EFEITOS</h3><span>${all.length}</span>${isOwner(actor)?`<button type="button" class="mv-ef-add-button" data-mv-ef-add><i class="fa-solid fa-plus"></i> Adicionar Efeito</button>`:''}</div>
        <div class="mv-ef-tools"><input type="search" data-mv-ef-search value="${esc(state.query)}" placeholder="Buscar efeito..." aria-label="Buscar efeito"/><select data-mv-ef-filter aria-label="Filtrar efeitos">${options.map(([id,name])=>`<option value="${esc(id)}" ${state.filter===id?'selected':''}>${name} (${id==='todos'?all.length:count(id)})</option>`).join('')}</select></div>
        <div class="mv-ef-rows">${visible.length?visible.map(e=>`<button type="button" class="mv-ef-effect ${e.key===state.selected?'is-selected':''}" data-mv-ef-select="${esc(e.key)}" aria-pressed="${e.key===state.selected}"><img src="${esc(e.img)}" alt="Imagem do efeito"/><span class="mv-ef-effect-content"><span class="mv-ef-effect-top"><strong>${esc(e.name)}</strong><span class="mv-ef-effect-chip">${esc(e.category)}</span></span><small>${esc(e.source)}</small></span><span class="mv-ef-effect-side"><span class="mv-ef-effect-state">${esc(e.status||'Ativo')}</span><small>${esc(e.duration)}</small><i class="fa-solid fa-chevron-right"></i></span></button>`).join(''):'<div class="mv-ef-no-results"><i class="fa-solid fa-circle-check"></i> Nenhum efeito encontrado neste filtro.</div>'}</div></section>
        <section class="mv-ef-panel mv-ef-detail">${detailEntry(actor,detail)}</section></div></div>`;
  };
  render();
  mount.addEventListener('input',event=>{
    const el=event.target;if(!el.matches('[data-mv-ef-search]'))return;
    state.query=el.value;
    const a=el.selectionStart,b=el.selectionEnd;
    if(searchTimer!==null)clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>{
      searchTimer=null;
      if(!mount.isConnected)return;
      render();
      const next=mount.querySelector('[data-mv-ef-search]');
      next?.focus();try{next?.setSelectionRange(a,b);}catch{}
    },100);
  });
  mount.addEventListener('change',event=>{const el=event.target;if(el.matches('[data-mv-ef-filter]')){state.filter=el.value;render();}});
  mount.addEventListener('click',async event=>{
    const button=event.target.closest('[data-mv-ef-select],[data-mv-ef-share],[data-mv-ef-end],[data-mv-ef-add],[data-mv-ef-edit],[data-mv-ef-photo]');
    if(!button||button.disabled)return;
    if(button.hasAttribute('data-mv-ef-photo')||(button.hasAttribute('data-mv-ef-select')&&event.target.closest('img'))){
      const key=button.dataset.mvEfPhoto??button.dataset.mvEfSelect,entry=rows(actor).find(x=>x.key===key);
      if(entry?.sourceItem||entry?.activeEffect?.getFlag?.(NS,'manualOverviewEffectV1')){
        try{await changeImage(sheet,entry);}catch(error){ui.notifications.error(error.message);}return;
      }
    }
    if(button.hasAttribute('data-mv-ef-select')){state.selected=state.selected===button.dataset.mvEfSelect?null:button.dataset.mvEfSelect;render();return;}
    if(button.hasAttribute('data-mv-ef-add')){
      button.disabled=true;
      try{const item=await createManualEffectSource(actor);if(item){state.query='';state.filter='todos';state.selected=`source:${item.id}`;render();}}
      catch(error){console.error('Multiverso | Adicionar Efeito',error);ui.notifications.error(error?.message??'Não foi possível adicionar o efeito.');}
      finally{if(button.isConnected)button.disabled=false;}return;
    }
    const key=button.dataset.mvEfShare??button.dataset.mvEfEnd??button.dataset.mvEfEdit;
    const entry=rows(actor).find(e=>e.key===key);
    if(!entry)return ui.notifications.warn('Esse efeito não foi encontrado.');
    button.disabled=true;
    try{
      if(button.hasAttribute('data-mv-ef-edit')){
        if(!isOwner(actor))throw Error('Sem permissão para editar.');
        const item=entry.sourceItem??(entry.activeEffect?.getFlag?.(NS,'manualOverviewEffectV1')?await getOrCreateSourceForLegacy(actor,entry.activeEffect):null);
        if(!item)throw Error('Esse efeito é controlado pela habilidade de origem. Edite a habilidade correspondente.');
        state.selected=`source:${item.id}`;state.filter='todos';render();await openManualEffectSource(item);return;
      }
      if(button.hasAttribute('data-mv-ef-share'))await share(actor,entry);
      else if(await endEntry(sheet,entry)){state.selected=null;sheet.render(false);return;}
      render();
    }catch(error){console.error('Multiverso | Efeitos',error);ui.notifications.error(error?.message??'Não foi possível concluir a operação.');render();}
    finally{if(button.isConnected)button.disabled=false;}
  });
}
