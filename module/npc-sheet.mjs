import {NPC_CATEGORIES,NPC_ATTRIBUTES,NPC_SKILLS,npcBuild,npcDefaultAttributes} from './npc-rules.mjs';
import {readPartyRegistry} from './party-manager.mjs';
import {NPC_RELATIONS_FLAG,npcRelationGroups,setNPCRelationLevel,addNPCNamedRelation,removeNPCNamedRelation} from './npc-relations.mjs';
import {bindInventoryUI} from './inventory-ui.mjs';
import {rollOriginalResistance} from './resistance-test.mjs';
import {npcFixedTestDisplay} from './npc-test-display.mjs';
import {bindCombatUi,npcDefenseSummary} from './combat-native-ui.mjs';
import {reactionStatus} from './reaction-combat.mjs';
import {executeNativeEffectTest} from './native-effects.mjs';
const {HandlebarsApplicationMixin}=foundry.applications.api;
const {ActorSheetV2}=foundry.applications.sheets;
const NS='multiverso-rpg';
const NPC_STYLE_URL='systems/multiverso-rpg/styles/npc-v1.0.18.css?v=1.0.18';
const NPC_DEFENSE_STYLE_URL='systems/multiverso-rpg/styles/npc-defenses-v1.0.20.css?v=1.0.20';
const OPEN_NPC_WINDOWS=new Set();
export function ensureNPCStyles(){
  if(typeof document==='undefined'||!document.head)return;
  if(!document.querySelector('link[data-mv-npc-style="1.0.18"]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href=NPC_STYLE_URL;link.dataset.mvNpcStyle='1.0.18';document.head.append(link);
  }
  if(!document.querySelector('link[data-mv-npc-defense-style="1.0.20"]')){
    const link=document.createElement('link');link.rel='stylesheet';link.href=NPC_DEFENSE_STYLE_URL;
    link.dataset.mvNpcDefenseStyle='1.0.20';document.head.append(link);
  }
}
const esc=value=>foundry.utils.escapeHTML(String(value??''));
const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const MAX_ABILITIES=80;
function orderedEntries(actor,support=false){
  const stored=actor.getFlag(NS,support?'npcSupportAbilitiesV1':'npcAbilitiesV1');
  return Array.isArray(stored)?stored.filter(x=>x&&typeof x==='object').slice(0,MAX_ABILITIES):[];
}
function readInput(root,name){return root?.querySelector(`[name="${name}"]`);}
// O motor é o editor original de Itens Skill/Técnica, importado só ao abrir.
async function npcEditor(item){const {openMultiversoSkillEffectEditor}=await import('./skill-editor-original.mjs');openMultiversoSkillEffectEditor(item);}
function npcCombatItems(actor){return [...(actor.items??[])].filter(i=>['skill','tecnica'].includes(i.type)&&i.getFlag('multiverso-rpg','npcCombatAbilityV1')===true);}
function npcSupportItem(actor,id,level){return [...(actor.items??[])].find(i=>['skill','tecnica'].includes(i.type)&&i.getFlag('multiverso-rpg','npcSupportEffectV1')?.id===id&&i.getFlag('multiverso-rpg','npcSupportEffectV1')?.level===level);}
function npcItemSummary(item){const p=item.system?.props??{},t=item.type;return {id:item.id,name:item.name,description:String(item.system?.descricao||''),typeLabel:t==='tecnica'?'Técnica (STA)':'Skill (Mana)',costLabel:p[`efeito${t}custo`]||'Configurar custo',actionLabel:p[`ativacaotempototipo${t}`]||'Ação'};}
async function npcCreateCombatItem(actor,{name,type='skill',description='',cost='',action='acao'}={}){
 if(!game.user?.isGM)throw Error('Somente o mestre pode criar habilidades de NPC.');
 if(!['skill','tecnica'].includes(type))throw Error('Escolha Skill ou Técnica.');
 const text=String(name||'').trim();if(!text)throw Error('Informe o nome da habilidade.');
 const props={mvEffectCount:1,[`ativacaotempototipo${type}`]:action};if(cost)props[`efeito${type}custo`]=cost;
 const [item]=await actor.createEmbeddedDocuments('Item',[{name:text,type,system:{descricao:description,props},flags:{'multiverso-rpg':{npcCombatAbilityV1:true}}}]);
 if(!item)throw Error('Não foi possível criar a habilidade.');return item;
}
async function npcNewCombat(actor){
 const data=await foundry.applications.api.DialogV2.wait({window:{title:'Nova habilidade de NPC'},position:{width:490},content:`<form class="mv-npc-ability-edit"><label>Nome<input name="nome" maxlength="90" placeholder="Ex.: Barreira Arcana"></label><label>Tipo / Motor<select name="tipo"><option value="skill">Skill — Mana</option><option value="tecnica">Técnica — Stamina</option></select></label><p>Ao criar, abre o mesmo editor de efeitos utilizado pelos personagens jogadores.</p></form>`,buttons:[{action:'cancel',label:'Cancelar',callback:()=>null},{action:'ok',label:'Criar e configurar',default:true,callback:(_a,_b,d)=>({name:d.element?.querySelector('[name="nome"]')?.value,type:d.element?.querySelector('[name="tipo"]')?.value})}],rejectClose:false});
 if(!data)return;await npcEditor(await npcCreateCombatItem(actor,data));
}
async function npcMigrateAbility(actor,id){
 const old=orderedEntries(actor,false).find(x=>x.id===id);if(!old)throw Error('Habilidade anterior não encontrada.');
 if(npcCombatItems(actor).some(i=>i.getFlag('multiverso-rpg','npcMigratedFromV1')===id))return;
 const accepted=await foundry.applications.api.DialogV2.confirm({window:{title:'Conectar ao motor original'},content:`<p>Converter <b>${esc(old.name)}</b> em uma Skill/Técnica real? As descrições, fórmulas e custos antigos serão preservados, mas você precisará configurar os efeitos no editor.</p><p>O cadastro anterior será mantido como backup.</p>`,yes:{label:'Converter'},no:{label:'Cancelar'},rejectClose:false});if(!accepted)return;
 const type=old.resource==='sta'?'tecnica':'skill';const resource={sta:'STA',pm:'PM',pv:'PV',san:'SAN'}[old.resource]||'';
 const notes=[old.summary,old.description,old.test&&`Teste antigo: ${old.test}`,old.damage&&`Dano/cura antigo: ${old.damage}`].filter(Boolean).join('\n');
 const action={Principal:'acao',Bônus:'bonus',Reação:'reacao',Livre:'livre',Passiva:'passiva'}[old.action]||'acao';
 const item=await npcCreateCombatItem(actor,{name:old.name,type,description:notes,cost:resource&&Number(old.cost)>0?`${old.cost} ${resource}`:'',action});
 await item.setFlag('multiverso-rpg','npcMigratedFromV1',id);await npcEditor(item);
}
async function npcSupportEditorItem(actor,id,level){
 const entry=orderedEntries(actor,true).find(x=>x.id===id);if(!entry)throw Error('Ação de Apoio não encontrada.');
 const found=npcSupportItem(actor,id,level);if(found)return found;
 const kind=await foundry.applications.api.DialogV2.wait({window:{title:`Motor de apoio • Admiração ${level}`},position:{width:490},content:`<form class="mv-npc-ability-edit"><p>Crie o efeito de <b>${esc(entry.name)}</b> no nível ${level}. A configuração de alvos, custos, dano, cura e condições será no motor original.</p><label>Tipo de habilidade<select name="kind"><option value="skill">Skill — Mana</option><option value="tecnica">Técnica — Stamina</option></select></label></form>`,buttons:[{action:'cancel',label:'Cancelar',callback:()=>null},{action:'ok',label:'Criar motor',default:true,callback:(_a,_b,d)=>d.element?.querySelector('[name="kind"]')?.value||'skill'}],rejectClose:false});
 if(!kind)return null;
 const [item]=await actor.createEmbeddedDocuments('Item',[{name:`${entry.name} • Admiração ${level}`,type:kind,system:{descricao:String(entry[`level${level}`]||''),props:{mvEffectCount:1,[`ativacaotempototipo${kind}`]:'livre'}},flags:{'multiverso-rpg':{npcSupportEffectV1:{id,level}}}}]);
 if(!item)throw Error('Falha ao criar o motor de apoio.');return item;
}
function abilityDialogContent(entry={},support=false){
  const e=key=>esc(entry[key]);
  if(support)return `<div class="mv-npc-support-form mv-npc-ability-edit">
    <header class="mv-npc-support-banner"><div class="mv-npc-support-banner-icon"><i class="fa-solid fa-handshake-angle" aria-hidden="true"></i></div><div><strong>Configurar Ação de Apoio</strong><small>Defina a ação uma única vez. Cada nível de Admiração pode ter um efeito próprio.</small></div></header>
    <div class="mv-npc-support-details">
      <label><span><i class="fa-solid fa-scroll" aria-hidden="true"></i> Nome da ação</span><input type="text" name="name" maxlength="90" value="${e('name')}" placeholder="Ex.: Socorro Emergencial" required></label>
      <label><span><i class="fa-solid fa-clock" aria-hidden="true"></i> Ativação, alcance ou condição</span><input type="text" name="trigger" maxlength="180" value="${e('trigger')}" placeholder="Ex.: Quando um aliado ficar incapacitado"></label>
    </div>
    <div class="mv-npc-support-separator"><strong><i class="fa-solid fa-star" aria-hidden="true"></i> Progressão da Admiração</strong><small>Os quatro níveis são editáveis. O motor de efeitos de cada um é configurado depois.</small></div>
    <div class="mv-npc-support-levels">${[0,1,2,3].map(i=>`<label class="mv-npc-support-level-card" data-level="${i}"><span class="mv-npc-support-level-header"><span class="mv-npc-support-number">${i}</span><span class="mv-npc-support-level-label"><strong>Admiração ${i}</strong><small>${['Apoio mínimo','Apoio básico','Apoio avançado','Apoio excepcional'][i]}</small></span><span class="mv-npc-support-stars" aria-hidden="true">${Array.from({length:3},(_,j)=>`<i class="fa-${j<i?'solid':'regular'} fa-star"></i>`).join('')}</span></span><textarea name="level${i}" rows="3" maxlength="1800" placeholder="Descreva o efeito disponível no nível ${i}...">${e(`level${i}`)}</textarea></label>`).join('')}</div>
    <p class="mv-npc-support-footnote"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> Em combate, utilize a maior Admiração que o NPC sente por alguém presente na Party. A reserva coletiva de apoios é controlada pelo mestre.</p>
  </div>`;
  return `<form class="mv-npc-ability-edit"><label>Nome da habilidade<input name="name" maxlength="90" value="${e('name')}" required></label>
  <div class="mv-npc-dialog-grid"><label>Tipo de ação<select name="action">${['Principal','Bônus','Reação','Livre','Passiva'].map(t=>`<option value="${t}" ${entry.action===t?'selected':''}>${t}</option>`).join('')}</select></label>
  <label>Recurso<select name="resource">${[['none','Nenhum'],['sta','STA'],['pm','Mana'],['pv','Vida'],['san','Sanidade']].map(([v,t])=>`<option value="${v}" ${entry.resource===v?'selected':''}>${t}</option>`).join('')}</select></label>
  <label>Custo<input type="number" name="cost" min="0" step="1" value="${Math.max(0,finite(entry.cost))}"></label></div>
  <label>Efeito resumido<input name="summary" maxlength="260" value="${e('summary')}" placeholder="O que acontece no combate?"></label>
  <div class="mv-npc-dialog-grid"><label>Fórmula de teste (opcional)<input name="test" maxlength="110" value="${e('test')}" placeholder="Ex.: 1d20 + 5"></label>
  <label>Fórmula de dano / cura (opcional)<input name="damage" maxlength="110" value="${e('damage')}" placeholder="Ex.: 2d6 + 3"></label></div>
  <label>Descrição completa<textarea name="description" rows="4" maxlength="4500">${e('description')}</textarea></label>
  <p>As fórmulas são opcionais. Se vazias, o mestre resolve os testes manualmente. A habilidade pode consumir STA e Mana em ações diferentes.</p></form>`;
}
async function editAbility(actor,{support=false,id=null}={}){
  if(!game.user?.isGM)throw Error('Somente o mestre pode editar habilidades de NPC.');
  const key=support?'npcSupportAbilitiesV1':'npcAbilitiesV1';
  const existing=orderedEntries(actor,support);
  const previous=existing.find(x=>x.id===id)??{};
  const result=await foundry.applications.api.DialogV2.wait({
    classes:support?['mv-npc-support-modal']:['mv-npc-generic-modal'],
    window:{title:`${previous.name?'Editar':'Adicionar'} ${support?'Ação de Apoio':'habilidade'} • ${actor.name}`,resizable:true},
    position:{width:support?770:630,height:support?780:undefined},content:abilityDialogContent(previous,support),
    buttons:[{action:'cancel',label:'Cancelar',callback:()=>null},{action:'save',label:'Salvar',default:true,callback:(_event,_button,dialog)=>{
      const form=dialog.element?.querySelector('.mv-npc-ability-edit');
      const get=k=>String(readInput(form,k)?.value??'').trim();
      if(!get('name'))return {error:'Digite o nome da habilidade.'};
      if(support)return {name:get('name'),trigger:get('trigger'),...Object.fromEntries([0,1,2,3].map(i=>[`level${i}`,get(`level${i}`)]))};
      return {name:get('name'),action:get('action'),resource:get('resource'),cost:Math.max(0,Math.floor(finite(get('cost')))),summary:get('summary'),test:get('test'),damage:get('damage'),description:get('description')};
    }}],rejectClose:false
  });
  if(!result)return;
  if(result.error)throw Error(result.error);
  if(!previous.id&&existing.length>=MAX_ABILITIES)throw Error('Limite técnico de habilidades atingido.');
  const record={...result,id:previous.id??foundry.utils.randomID()};
  const next=previous.id?existing.map(x=>x.id===previous.id?record:x):[...existing,record];
  await actor.setFlag(NS,key,next);
}
async function removeAbility(actor,{support,id}){
  if(!game.user?.isGM)return;
  const key=support?'npcSupportAbilitiesV1':'npcAbilitiesV1';
  const entries=orderedEntries(actor,support);
  const entry=entries.find(x=>x.id===id);
  if(!entry)return;
  const ok=await foundry.applications.api.DialogV2.confirm({window:{title:'Remover habilidade?'},content:`Excluir <strong>${esc(entry.name)}</strong> da ficha de ${esc(actor.name)}?`,yes:{label:'Remover'},no:{label:'Cancelar'},rejectClose:false});
  if(ok)await actor.setFlag(NS,key,entries.filter(x=>x.id!==id));
}
async function useAbility(actor,id){
  if(!game.user?.isGM)throw Error('Somente o mestre pode usar habilidades de NPC.');
  const ability=orderedEntries(actor).find(a=>a.id===id);
  if(!ability)throw Error('Habilidade não encontrada.');
  const resource=['pv','sta','pm','san'].includes(ability.resource)?ability.resource:null;
  const cost=Math.max(0,Math.floor(finite(ability.cost)));
  const current=resource?finite(actor.system[`${resource}_atual`]):0;
  if(resource&&cost>current)throw Error(`Não há ${resource.toUpperCase()} suficiente para esta habilidade.`);
  // Preparar as rolagens antes de consumir qualquer recurso, para fórmulas inválidas não cobrarem custo.
  const rolls=[];
  for(const [label,formula] of [['Teste',ability.test],['Dano / cura',ability.damage]]){
    if(String(formula??'').trim()){
      const roll=new Roll(String(formula).trim());
      await roll.evaluate();
      rolls.push({label,roll});
    }
  }
  if(resource&&cost)await actor.update({[`system.${resource}_atual`]:current-cost});
  const costLine=resource&&cost?`<small>Gasto: ${cost} ${esc(resource.toUpperCase())}</small>`:'';
  await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<section class="mv-npc-chat"><h3>${esc(actor.name)} • ${esc(ability.name)}</h3><p><b>${esc(ability.action||'Ação')}</b></p><p>${esc(ability.summary||ability.description||'A habilidade é utilizada.')}</p>${costLine}</section>`});
  for(const {label,roll} of rolls)await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:`${esc(actor.name)} — ${esc(ability.name)} (${label})`});
}
async function announceSupport(actor,id){
  if(!game.user?.isGM)return;
  const ability=orderedEntries(actor,true).find(a=>a.id===id);
  if(!ability)return;
  await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor}),content:`<section class="mv-npc-chat"><h3>Ação de Apoio • ${esc(actor.name)}</h3><p><strong>${esc(ability.name)}</strong></p><p>O mestre escolhe a versão de Admiração efetiva e desconta uma ação da reserva coletiva.</p></section>`});
}
// Relações pertencem ao NPC (direção NPC -> personagem); não são escritas no diário do PJ.
const npcRelationSaveQueues=new Map();
async function updateNPCRelations(actor,modify){
  if(!game.user?.isGM)throw Error('Somente o mestre pode administrar relações dos NPCs.');
  const prior=npcRelationSaveQueues.get(actor.id)??Promise.resolve();
  const next=prior.catch(()=>{}).then(async()=>{
    const value=modify(actor.getFlag(NS,NPC_RELATIONS_FLAG),readPartyRegistry(),game.actors);
    await actor.setFlag(NS,NPC_RELATIONS_FLAG,value);
    return value;
  });
  npcRelationSaveQueues.set(actor.id,next);
  try{return await next;}
  finally{if(npcRelationSaveQueues.get(actor.id)===next)npcRelationSaveQueues.delete(actor.id);}
}
export async function initializeNPC(actor){
  if(!game.user?.isGM||actor?.type!=='npc'||actor.pack||actor.system?.npcInitResources===true)return false;
  const build=npcBuild(actor.system);
  await actor.update({
    'system.npcInitResources':true,
    'system.pv_atual':build.max.pv,'system.sta_atual':build.max.sta,
    'system.pm_atual':build.max.pm,'system.san_atual':build.max.san
  });
  return true;
}
export function registerNPCInitialization(){
  ensureNPCStyles();
  Hooks.on('createActor',actor=>{
    void initializeNPC(actor).catch(error=>console.error('Multiverso NPC | Falha ao iniciar Fluxos',error));
  });
  // Atualiza apenas as janelas de NPC que estão abertas. NPCs sem iniciativa
  // recuperam Reações quando a rodada avança; não varrer todos os Actors.
  Hooks.on('updateCombat',(_combat,changes)=>{
    if(!Object.hasOwn(changes??{},'round'))return;
    for(const sheet of OPEN_NPC_WINDOWS){
      if(sheet.rendered&&sheet.actor?.type==='npc')sheet.render(false);
    }
  });
}
export class MultiversoNPCSheet extends HandlebarsApplicationMixin(ActorSheetV2){
  static DEFAULT_OPTIONS={classes:['multiverso-npc-window'],window:{resizable:true},position:{width:1030,height:830}};
  static PARTS={form:{template:'systems/multiverso-rpg/templates/npc.hbs'}};
  get title(){return `Multiverso RPG • NPC • ${this.actor?.name||'Sem nome'}`;}
  async _prepareContext(options){
    const context=await super._prepareContext(options);
    const actor=this.actor;const system=actor.system;const build=npcBuild(system);
    const canEdit=!!game.user?.isGM;
    context.actor=actor;
    context.canEdit=canEdit;
    context.system=system;
    context.portrait=actor.img||'icons/svg/mystery-man.svg';
    context.categoryName=build.cat.name;
    context.categories=Object.entries(NPC_CATEGORIES).map(([id,cat])=>({id,name:cat.name,selected:id===system.npcCategoria}));
    context.roles=['Inimigo','Aliado','Neutro','Chefe','Outro'].map(name=>({name,selected:name===system.npcRole}));
    context.attributes=NPC_ATTRIBUTES.map(a=>({...a,value:build.attrs[a.key],minimum:build.cat.min,maximum:build.cat.max}));
    context.attributeTotal=build.attributeTotal;context.attributeBudget=build.cat.attributes;context.attributeRemaining=build.attributeRemaining;
    context.trainedCount=build.trainedCount;context.trainedBudget=build.cat.trained;
    context.specializationUsed=build.specializationUsed;context.specializationBudget=build.cat.specialization;
    context.specializationCap=build.cat.specializationCap;
    context.abilityBudget=build.cat.abilities;
    context.errors=build.errors;
    context.skills=build.skills.map(s=>{
      const passive=npcFixedTestDisplay(actor,s.label,s.key);
      const final=s.bonus+passive.bonus;
      const signed=n=>n>=0?`+${n}`:String(n);
      const description=passive.details.map(x=>`${x.name}: ${signed(x.amount)}`).join(' | ');
      return {...s,
        attributeShort:NPC_ATTRIBUTES.find(a=>a.key===s.attributeKey)?.short||'',
        signed:signed(s.bonus),
        finalSigned:signed(final),
        hasPassive:passive.bonus!==0,
        displayTitle:[`Rolar teste de ${s.label}`, `Base: ${signed(s.bonus)}`,
          description && `Passivos: ${description}`,passive.variable && 'Há outros efeitos variáveis aplicados na rolagem',
          passive.errors.length && 'Há erros na configuração dos passivos'].filter(Boolean).join(' • ')
      };
    });
    context.npcDefenses=npcDefenseSummary(actor);
    context.npcReactions=reactionStatus(actor);
    context.cortantesForca=build.cutsAttribute==='forcanumero';
    context.cortantesAgilidade=build.cutsAttribute==='agilidadenumero';
    context.fluxes=[
      {id:'pv',label:'Vida',icon:'heart',color:'pv',current:finite(system.pv_atual),max:build.max.pv,computed:build.raw.pv,manual:system.npcFluxOverrides?.pv??''},
      {id:'sta',label:'Stamina',icon:'bolt',color:'sta',current:finite(system.sta_atual),max:build.max.sta,computed:build.raw.sta,manual:system.npcFluxOverrides?.sta??''},
      {id:'pm',label:'Mana',icon:'wand-magic-sparkles',color:'pm',current:finite(system.pm_atual),max:build.max.pm,computed:build.raw.pm,manual:system.npcFluxOverrides?.pm??''},
      {id:'san',label:'Sanidade',icon:'brain',color:'san',current:finite(system.san_atual),max:build.max.san,computed:build.raw.san,manual:system.npcFluxOverrides?.san??''}
    ];
    context.combatAbilities=npcCombatItems(actor).map(npcItemSummary);
    const migrated=new Set(npcCombatItems(actor).map(i=>i.getFlag(NS,'npcMigratedFromV1')).filter(Boolean));
    context.legacyAbilities=orderedEntries(actor).filter(x=>!migrated.has(x.id));
    context.abilitiesCount=context.combatAbilities.length+context.legacyAbilities.length;
    context.supportAbilities=orderedEntries(actor,true).map(x=>({...x,levels:[0,1,2,3].map(level=>({number:level,description:x[`level${level}`],ready:!!npcSupportItem(actor,x.id,level)}))}));
    context.supportCount=context.supportAbilities.length;
    // Somente o GM recebe dados de relacionamentos no contexto/template.
    context.npcRelations={party:[],others:[],maxRecorded:0};
    if(canEdit){
      const groups=npcRelationGroups(actor.getFlag(NS,NPC_RELATIONS_FLAG),readPartyRegistry(),game.actors);
      const decorate=entry=>({...entry,afeicaoDots:[1,2,3].map(level=>({level,active:level<=entry.afeicao,selected:level===entry.afeicao})),admiracaoDots:[1,2,3].map(level=>({level,active:level<=entry.admiracao,selected:level===entry.admiracao})),image:entry.image||'icons/svg/mystery-man.svg'});
      context.npcRelations={party:groups.party.map(decorate),others:groups.others.map(decorate),
        maxRecorded:groups.party.reduce((n,e)=>Math.max(n,e.admiracao),0)};
    }
    return context;
  }
  _onRender(context,options){
    super._onRender(context,options);
    ensureNPCStyles();
    const root=this.element?.querySelector('.mv-npc');if(!root)return;
    if(!(this instanceof MultiversoNPCCreationSheet)){
      OPEN_NPC_WINDOWS.add(this);
      bindCombatUi(this,root);
    }
    const canEdit=!!game.user?.isGM;
    const switchTab=tab=>{
      this._npcTab=tab;
      root.querySelectorAll('[data-npc-tab]').forEach(el=>{const active=el.dataset.npcTab===tab;el.classList.toggle('is-active',active);el.setAttribute('aria-selected',String(active));});
      root.querySelectorAll('[data-npc-panel]').forEach(el=>{el.hidden=el.dataset.npcPanel!==tab;});
    };
    root.querySelectorAll('[data-npc-tab]').forEach(el=>el.addEventListener('click',()=>switchTab(el.dataset.npcTab)));
    switchTab(this instanceof MultiversoNPCCreationSheet?'criacao':(['combate','inventario','apoio','relacionamentos'].includes(this._npcTab)?this._npcTab:'combate'));
    // Inventário nativo compartilhado com a ficha de personagem: mesmos Itens
    // e mesmo Motor de Efeitos, sem criar registros paralelos para NPCs.
    if(canEdit && !(this instanceof MultiversoNPCCreationSheet)) bindInventoryUI(this,root);
    // Dados persistidos com change, sem depender do envio de formulário do Foundry v14.
    root.addEventListener('change',event=>{
      if(!canEdit)return;
      const input=event.target;
      if(!(input instanceof HTMLInputElement||input instanceof HTMLSelectElement||input instanceof HTMLTextAreaElement))return;
      void (async()=>{
        const key=input.name;
        if(key==='name'){await this.actor.update({name:input.value.trim()||this.actor.name});return;}
        if(key==='system.npcCategoria'||key==='system.npcRole'||key==='system.npcNotes'||key==='system.npcCortantesAttr'){
          await this.actor.update({[key]:input.value});return;
        }
        if(key?.startsWith('system.')&&NPC_ATTRIBUTES.some(a=>`system.${a.key}`===key)){
          const n=Number(input.value);if(!Number.isInteger(n)||n<0||n>9999)throw Error('Informe um número inteiro válido de 0 a 9999.');
          await this.actor.update({[key]:n});return;
        }
        if(input.dataset.npcTrain){
          const skill=input.dataset.npcTrain;const next={...(this.actor.system.npcTraining??{}),[skill]:input.checked};
          const change={'system.npcTraining':next};
          if(!input.checked)change['system.npcSpecialization']={...(this.actor.system.npcSpecialization??{}),[skill]:0};
          await this.actor.update(change);return;
        }
        if(input.dataset.npcSpecial){
          const skill=input.dataset.npcSpecial;const n=Number(input.value);
          if(!Number.isInteger(n)||n<0||n>100)throw Error('Especialização deve ser um número de 0 a 100.');
          if(n>0 && this.actor.system.npcTraining?.[skill]!==true)throw Error('Treine a perícia antes de distribuir especialização.');
          const next={...(this.actor.system.npcSpecialization??{}),[skill]:n};
          await this.actor.update({'system.npcSpecialization':next});return;
        }
        if(input.dataset.npcFluxCurrent){
          const k=input.dataset.npcFluxCurrent;const n=Number(input.value);
          if(!['pv','sta','pm','san'].includes(k)||!Number.isInteger(n)||n<0)throw Error('Valor atual inválido.');
          await this.actor.update({[`system.${k}_atual`]:n});return;
        }
        if(input.dataset.npcFluxOverride){
          const k=input.dataset.npcFluxOverride;if(!['pv','sta','pm','san'].includes(k))return;
          const value=input.value.trim()===''?null:Number(input.value);
          if(value!==null&&(!Number.isInteger(value)||value<0))throw Error('O máximo manual deve ser um inteiro positivo.');
          const next={...(this.actor.system.npcFluxOverrides??{}),[k]:value};
          await this.actor.update({'system.npcFluxOverrides':next});return;
        }
      })().catch(error=>{console.error('Multiverso NPC | Salvar campo',error);ui.notifications?.error(error.message||'Falha ao salvar campo de NPC.');this.render(false);});
    });
    root.addEventListener('click',event=>{
      const button=event.target.closest('[data-npc-action]');if(!button||!canEdit)return;
      const action=button.dataset.npcAction;
      const id=button.dataset.id;
      void (async()=>{
        if(action==='preset'){
          const ok=await foundry.applications.api.DialogV2.confirm({window:{title:'Aplicar atributos sugeridos?'},content:'Substituir os seis atributos deste NPC pela distribuição sugerida para sua categoria? Perícias, especializações e habilidades serão preservadas.',yes:{label:'Aplicar'},no:{label:'Cancelar'},rejectClose:false});
          if(ok)await this.actor.update(Object.fromEntries(Object.entries(npcDefaultAttributes(this.actor.system.npcCategoria)).map(([k,v])=>[`system.${k}`,v])));
        }else if(action==='fill'){
          const ok=await foundry.applications.api.DialogV2.confirm({window:{title:'Restaurar todos os Fluxos?'},content:'Preencher PV, STA, Mana e Sanidade até seus máximos atuais?',yes:{label:'Restaurar'},no:{label:'Cancelar'},rejectClose:false});
          if(ok){const b=npcBuild(this.actor.system);await this.actor.update(Object.fromEntries(['pv','sta','pm','san'].map(k=>[`system.${k}_atual`,b.max[k]])));}
        }else if(action==='roll-skill'){
          const skill=npcBuild(this.actor.system).skills.find(x=>x.key===button.dataset.skill);
          if(!skill)throw Error('Perícia não encontrada.');
          await rollOriginalResistance(this.actor,skill.label,skill.key);
        }else if(action==='roll-attribute'){
          const attr=NPC_ATTRIBUTES.find(x=>x.key===button.dataset.attribute);
          if(!attr)throw Error('Atributo não encontrado.');
          await rollOriginalResistance(this.actor,attr.label,attr.key);
        }else if(action==='open-creation'){
          if(this instanceof MultiversoNPCCreationSheet)return;
          if(!this._npcCreationSheet || this._npcCreationSheet.actor?.id!==this.actor.id){
            this._npcCreationSheet=new MultiversoNPCCreationSheet({document:this.actor});
          }
          await this._npcCreationSheet.render(true);
        }else if(action==='relation-level'){
          const field=button.dataset.field;const level=Number(button.dataset.level);
          if(!['afeicao','admiracao'].includes(field)||!Number.isInteger(level)||level<1||level>3)throw Error('Nível de vínculo inválido.');
          const current=button.closest('[data-npc-relation-track]');
          const old=Number(current?.dataset.current??0);
          const newLevel=old===level?0:level;
          button.disabled=true;
          try{await updateNPCRelations(this.actor,(data,registry,actors)=>setNPCRelationLevel(data,id,field,newLevel,registry,actors));}
          finally{if(button.isConnected)button.disabled=false;}
        }else if(action==='relation-add'){
          const input=root.querySelector('[data-npc-relation-name]');
          const name=input?.value?.trim();if(!name)throw Error('Digite o nome do relacionamento.');
          button.disabled=true;
          try{await updateNPCRelations(this.actor,(data,registry,actors)=>addNPCNamedRelation(data,name,foundry.utils.randomID(),registry,actors));}
          finally{if(button.isConnected)button.disabled=false;}
        }else if(action==='relation-remove'){
          const groups=npcRelationGroups(this.actor.getFlag(NS,NPC_RELATIONS_FLAG),readPartyRegistry(),game.actors);
          const item=groups.others.find(x=>x.key===id);
          if(!item)throw Error('Relacionamento não encontrado.');
          const yes=await foundry.applications.api.DialogV2.confirm({window:{title:'Remover relacionamento?'},content:`Excluir a relação de ${esc(this.actor.name)} com <b>${esc(item.name)}</b>? Os valores registrados serão apagados.`,yes:{label:'Remover'},no:{label:'Cancelar'},rejectClose:false});
          if(yes)await updateNPCRelations(this.actor,data=>removeNPCNamedRelation(data,id));
        }else if(action==='add-engine-ability'){await npcNewCombat(this.actor);
        }else if(action==='edit-engine-ability'){
          const item=this.actor.items.get(id);if(!item?.getFlag(NS,'npcCombatAbilityV1'))throw Error('Item não encontrado.');await npcEditor(item);
        }else if(action==='use-engine-ability'){
          const item=this.actor.items.get(id);if(!item?.getFlag(NS,'npcCombatAbilityV1'))throw Error('Item não encontrado.');
          button.disabled=true;try{await executeNativeEffectTest(item);}finally{if(button.isConnected)button.disabled=false;}
        }else if(action==='remove-engine-ability'){
          const item=this.actor.items.get(id);if(!item?.getFlag(NS,'npcCombatAbilityV1'))return;
          const ok=await foundry.applications.api.DialogV2.confirm({window:{title:'Excluir habilidade?'},content:`Excluir <b>${esc(item.name)}</b> e todos os seus efeitos?`,yes:{label:'Excluir'},no:{label:'Cancelar'},rejectClose:false});if(ok)await item.delete();
        }else if(action==='convert-legacy-ability'){await npcMigrateAbility(this.actor,id);
        }else if(action==='edit-support-engine'){
          const item=await npcSupportEditorItem(this.actor,id,Number(button.dataset.level));if(item)await npcEditor(item);
        }else if(action==='use-support-engine'){
          const level=Number(button.dataset.level);const item=npcSupportItem(this.actor,id,level);
          if(!item)throw Error('Configure o motor de efeitos deste nível antes de usar o apoio.');
          button.disabled=true;
          try{const ok=await executeNativeEffectTest(item,{skipAction:true});if(ok)ui.notifications?.info('Ação de Apoio executada. Registre o gasto na reserva coletiva manual da Party.');}
          finally{if(button.isConnected)button.disabled=false;}
        }else if(action==='portrait'){
          const Picker=foundry.applications.apps.FilePicker.implementation;
          new Picker({type:'image',current:this.actor.img,callback:path=>path&&this.actor.update({img:path})}).render(true);
        }else if(action==='add-ability'||action==='edit-ability')await editAbility(this.actor,{support:false,id});
        else if(action==='add-support'||action==='edit-support')await editAbility(this.actor,{support:true,id});
        else if(action==='remove-ability'||action==='remove-support')await removeAbility(this.actor,{support:action==='remove-support',id});
        else if(action==='use-ability')await useAbility(this.actor,id);
        else if(action==='announce-support')await announceSupport(this.actor,id);
      })().catch(error=>{console.error('Multiverso NPC | Ação',error);ui.notifications?.error(error.message||'Não foi possível executar a ação.');});
    });
  }
  async _onClose(options){
    OPEN_NPC_WINDOWS.delete(this);
    return super._onClose(options);
  }
}


// Janela de criação isolada: reaproveita os mesmos campos, validações e salvamento
// da ficha de NPC sem duplicar estado ou substituir o documento original.
export class MultiversoNPCCreationSheet extends MultiversoNPCSheet {
  static DEFAULT_OPTIONS={
    classes:['multiverso-npc-window','multiverso-npc-editor-window'],
    window:{resizable:true},
    position:{width:940,height:780}
  };
  get title(){return `Multiverso RPG • Criação de NPC • ${this.actor?.name||'Sem nome'}`;}
}
