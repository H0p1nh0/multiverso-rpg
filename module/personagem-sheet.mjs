import {passiveAttributeBonuses} from './passive-attributes.mjs';
import {reactionStatus} from './reaction-combat.mjs';
import {actionStatus} from './action-economy.mjs';
import {combatUiContext,bindCombatUi} from './combat-native-ui.mjs';
import {itemDefenseBonus,itemMotorConfig,useItemMotor} from './item-motor.mjs';
import {initVisionGeneral} from "./vision-general.mjs";
import {rememberLastActor} from "./chat-roll-apply.mjs";
import {readTracked} from './effect-tracking.mjs';
import {endMaintainedEffect,isStoredAttribute} from './maintained-attributes.mjs';
import {usageStatus,manualRecharge} from './skill-uses.mjs';
import {sendPrivateUsageCard} from './usage-card.mjs';
import {openRestDialog} from './rest-system.mjs';
import {openSheetSettings} from './sheet-settings.mjs';
import {rollCharacterInitiative} from './combat-tools.mjs';
import {finishPersistentArea} from './persistent-areas.mjs';
import {executeNativeEffectTest} from './native-effects.mjs';
import {bindInventoryUI,useInventoryItem} from './inventory-ui.mjs';
import {bindAbilitiesUI} from './abilities-ui.mjs';
import {bindEffectsOverviewUI,combatEffectSections} from './effects-overview-ui.mjs';
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class MultiversoPersonagemSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["multiverso-personagem"],
    window: { resizable: true },
    position: { width: 1150, height: 830 },
    // Foundry v14 dispatches window button data-action via this table.
    actions: { 'multiverso-sheet-settings': this._openMultiversoSheetSettings }
  };

  static PARTS = {
    form: { template: "systems/multiverso-rpg/templates/personagem.hbs" }
  };

  get title() {
    const actorName = String(this.actor?.name || "Personagem").trim() || "Personagem";
    return `Multiverso RPG • ${actorName}`;
  }

  // Engrenagem compacta no cabeçalho nativo do Foundry v14.
  // Não ocupa espaço dentro do cartão de Fluxo Extra ou das abas da ficha.
  _getFrameButtons(options) {
    return [
      ...super._getFrameButtons(options),
      {
        action: 'multiverso-sheet-settings',
        icon: 'fa-solid fa-gear',
        label: 'Configurações da Ficha',
        visible: () => Boolean(this.actor?.isOwner || game.user?.isGM)
      }
    ];
  }

  // Handler registrado para a engrenagem: funciona em qualquer aba da ficha.
  static async _openMultiversoSheetSettings(_event, _button) {
    try {
      await openSheetSettings(this.actor, this);
    } catch (error) {
      console.error('Multiverso | Configurações da ficha', error);
      ui.notifications.error(error?.message || 'Não foi possível abrir ou salvar as configurações. Confira F12.');
    }
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor = this.actor;
    context.system = this.actor.system.toObject();
    // Exibir os valores finais sem gravar o bônus no atributo base.
    const passiveBonuses=passiveAttributeBonuses(this.actor);
    for(const [key,delta] of Object.entries(passiveBonuses)){
      context.system[key]=Number(context.system[key]??0)+delta;
    }
    // O mesmo cabeçalho acompanha todas as abas. Reaproveita os itens existentes
    // de classe/espécie/subclasse e os campos legados, sem criar cópias.
    const identityItem = (type) => Array.from(this.actor.items ?? []).find(item => item.type === type)?.name || '';
    const identityClass = String(this.actor.system?.classepersonagem || identityItem('classe') || 'A definir').trim();
    const identitySpecies = String(this.actor.system?.especiepersonagem || identityItem('especie') || 'A definir').trim();
    const identitySubclass = String(this.actor.system?.subclassepersonagem || identityItem('subclasse') || '').trim();
    context.heroClassFull = identitySubclass && identitySubclass.toLowerCase() !== identityClass.toLowerCase()
      ? `${identityClass} — ${identitySubclass}` : identityClass;
    context.heroSpecies = identitySpecies;
    context.heroLevel = Math.max(1, Number(this.actor.system?.nivelpersonagem) || 1);
    context.portrait = this.actor.img || 'icons/svg/mystery-man.svg';
    context.canEditHero = Boolean(this.actor.isOwner || game.user?.isGM);
    context.esquivaFinal=Number(context.system.agilidadenumero??0)+Number(context.system.esquivabonus??0)+itemDefenseBonus(this.actor,'esquiva');
    context.bloqueioFinal=Number(context.system.resistencianumero??0)+Number(context.system.bloqueiobonus??0)+itemDefenseBonus(this.actor,'bloqueio');
    const senses=this.actor.getFlag('multiverso-rpg','combatSpecialSensesV1')??{};
    context.combatSense={enabled:senses.enabled===true,name:String(senses.name??'Visão no Escuro').slice(0,64),range:String(senses.range??'').slice(0,64)};
    const combatant=[...(game.combat?.combatants??[])].find(c=>c.actorId===this.actor.id);
    const agilityInitiative=Number(this.actor.system?.agilidadenumero??0);
    context.combatInitiative=combatant?.initiative!=null ? combatant.initiative : `${agilityInitiative>=0?'+':''}${agilityInitiative}`;
    context.combatLegacy = combatUiContext(this.actor);
    context.combatReactions = reactionStatus(this.actor);
    context.combatActions = Object.fromEntries(['acao','movimento','bonus'].map(id=>[id,actionStatus(this.actor,id).ok?'Disponível':'Indisponível']));
    // Barra global de descanso: identificação equivalente ao resumo do legado.
    const restProps=this.actor.system;
    const restItem=(type,fallback)=>Array.from(this.actor.items??[]).find(item=>item.type===type)?.name??fallback;
    const restSpecies=restProps.especiepersonagem||restItem('especie','Espécie a definir');
    const restClass=restProps.classepersonagem||restItem('classe','Classe a definir');
    const restLevel=Number(restProps.nivelpersonagem)||1;
    const restSub=restLevel>=5?(restProps.subclassepersonagem||restItem('subclasse','')):'';
    context.restIdentity=[restSpecies,restClass,`Nível ${restLevel}`,restSub].filter(Boolean).join(' • ');
    // v0.1.83: atributos de Skills mantidas entram no valor real da ficha.
    const items = Array.from(this.actor.items ?? []);
    const typed = (type, category = null) => items.filter(item => item.type === type && item.getFlag?.('multiverso-rpg','manualEffectSourceV1')!==true && item.getFlag?.('multiverso-rpg','itemEffectSourceV1')!==true && item.getFlag?.('multiverso-rpg','itemCastCloneV1')!==true && item.getFlag?.('multiverso-rpg','traitEffectSourceV1')!==true && (category === null || (item.system?.categoria || "") === category)).map(item => ({id:item.id, name:item.name, img:item.img}));
    for (const [key, type, category] of [
      ["inventoryArmas", "equipamento", "arma"], ["inventoryProtecoes", "equipamento", "protecao"],
      ["inventoryConsumiveis", "equipamento", "consumivel"], ["inventoryGerais", "equipamento", "geral"],
      ["inventoryArmazenamento", "equipamento", "armazenamento"], ["itemsSkills", "skill", null],
      ["itemsTecnicas", "tecnica", null], ["itemsEspecies", "especie", null],
      ["itemsHabEspecie", "habilidadeEspecie", null], ["itemsClasses", "classe", null],
      ["itemsSubclasses", "subclasse", null], ["itemsHabClasse", "habilidadeClasse", null],
      ["itemsHabSubclasse", "habilidadeSubclasse", null], ["itemsVantagens", "vantagem", "vantagem"],
      ["itemsDesvantagens", "vantagem", "desvantagem"]
    ]) context[key] = typed(type, category);
    const combatFavIds=Array.isArray(this.actor.getFlag('multiverso-rpg','combatFavoritesV1')) ? this.actor.getFlag('multiverso-rpg','combatFavoritesV1') : [];
    const favoriteSkillItems=[...new Set(combatFavIds)].map(id=>items.find(item=>item.id===id&&['skill','tecnica'].includes(item.type)&&item.getFlag?.('multiverso-rpg','manualEffectSourceV1')!==true && item.getFlag?.('multiverso-rpg','itemEffectSourceV1')!==true && item.getFlag?.('multiverso-rpg','itemCastCloneV1')!==true && item.getFlag?.('multiverso-rpg','traitEffectSourceV1')!==true)).filter(Boolean);
    const favoriteEquipment=items.filter(item=>item.type==='equipamento'&&item.getFlag('multiverso-rpg','inventoryFavoriteV1')===true);
    context.combatFavorites=[...favoriteSkillItems,...favoriteEquipment].map(item=>({
      id:item.id,name:item.name,img:item.img||'icons/svg/item-bag.svg',
      typeLabel:item.type==='skill'?'Skill':item.type==='tecnica'?'Técnica':'Item',
      canConjure:item.type==='equipamento'&&itemMotorConfig(item).castSources.some(Boolean),
      canUse:item.type!=='equipamento'||itemMotorConfig(item).enableAttack||itemMotorConfig(item).enableRecovery||itemMotorConfig(item).kind==='utilitario'||!itemMotorConfig(item).castSources.some(Boolean),
      activity:item.type==='equipamento'?`Qtd. ${Math.max(0,Number(item.system?.quantidade??1))}`:
        String(item.system?.props?.[item.type==='skill'?'ativacaotempotiposkill':'ativacaotempotipotecnica']??'').replaceAll('_',' ').slice(0,45)
    }));
    context.inventoryOutros = items.filter(item => item.type === "equipamento" && !["arma","protecao","consumivel","geral","armazenamento"].includes(item.system?.categoria ?? "")).map(item => ({id:item.id,name:item.name,img:item.img}));
    context.activeEffects = Array.from(this.actor.effects ?? []).filter(effect => !effect.disabled).map(effect => ({id: effect.id, name: effect.name, img: effect.img || "icons/svg/aura.svg"}));
    const combatEffects = combatEffectSections(this.actor);
    context.combatConditions = combatEffects.conditions;
    context.combatActiveEffects = combatEffects.effects;
    context.usageCards=items.filter(x=>['skill','tecnica'].includes(x.type)&&x.getFlag?.('multiverso-rpg','manualEffectSourceV1')!==true && x.getFlag?.('multiverso-rpg','itemEffectSourceV1')!==true && x.getFlag?.('multiverso-rpg','traitEffectSourceV1')!==true).map(item=>({id:item.id,name:item.name,status:usageStatus(this.actor,item)})).filter(x=>x.status.limited||x.status.error).map(x=>({...x,remaining:x.status.remaining??0,limit:x.status.config?.limit??0,recharge:x.status.config?.recharge??'',error:x.status.error??'',disabled:x.status.config?.recharge!=='manual'}));
    context.trackedDurations=readTracked(this.actor).map(e=>({id:e.id,name:e.name,source:e.source,remaining:e.remaining,mode:e.mode,modeLabel:e.mode==='sustained'?'Sustentado':e.mode==='scene'?'Até o fim da cena':e.mode==='turns'?'turnos':e.mode==='rounds'?'rodadas':'ciclos',periodic:!!e.periodic,maintained:!!e.maintainedEffect,combatId:e.combatId,sceneBound:!!e.sceneBound,auraController:!!e.auraController}));
    return context;
  }

  async _endOwnAura(entry){
    const ns='multiverso-rpg';
    const marker=Array.from(this.actor.effects??[]).find(e=>e.getFlag(ns,'persistentAreaCastId')===entry.areaOwner);
    if(game.user?.isGM){
      for(const scene of game.scenes??[])for(const template of scene.templates?.contents??[])
        if(template.getFlag(ns,'persistentArea')?.castId===entry.areaOwner){await finishPersistentArea(template);return;}
    }
    if(!marker)throw Error('Marcador de aura não encontrado; peça ao mestre para conferir a área.');
    if(!this.actor.isOwner&&!game.user?.isGM)throw Error('Somente o conjurador pode encerrar esta aura.');
    // Player can delete their OWN ActiveEffect; GM observes deletion and removes
    // linked template and bonuses from all actors.
    await marker.delete();
    ui.notifications.info('Encerramento da aura solicitado; o mestre sincronizará a área.');
  }
  _onRender(context, options) {
    super._onRender(context, options);
    rememberLastActor(this.actor);
    this.element?.addEventListener("pointerdown",()=>rememberLastActor(this.actor),{capture:true});
    // ActorSheetV2 não salva os inputs automaticamente apenas pelo atributo name.
    // Um único listener delegado atende os campos atuais e as futuras abas.
    const root = this.element.querySelector(".mv-native");
    if (!root) return;
    // Retrato do Actor: FilePicker nativo da versão 14, salvo no documento real.
    root.querySelector('[data-mv-portrait-change]')?.addEventListener('click', async () => {
      if (!this.actor.isOwner && !game.user?.isGM) return;
      try {
        const Picker = foundry.applications.apps.FilePicker.implementation;
        const picker = new Picker({
          type: 'image',
          current: this.actor.img,
          callback: async (path) => {
            if (path && path !== this.actor.img) await this.actor.update({img: path});
          }
        });
        picker.render(true);
      } catch (error) {
        console.error('Multiverso | Falha ao alterar retrato', error);
        ui.notifications.error('Não foi possível alterar o retrato. Confira F12.');
      }
    });
    const pages = [...root.querySelectorAll("[data-mv-page]")];
    const tabs = [...root.querySelectorAll("[data-mv-tab]")];
    const selectTab = (tab) => {
      for (const page of pages) {
        const active = page.dataset.mvPage === tab;
        page.classList.toggle("is-active", active);
        // Não usar `hidden`: o navegador/estilos da janela podem manter a página invisível.
        page.removeAttribute("hidden");
        page.setAttribute("aria-hidden", String(!active));
      }
      for (const button of tabs) {
        const active = button.dataset.mvTab === tab;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
      }
      // Visão Geral preserva o retrato grande. Combate tem identidade tática própria.
      root.classList.toggle('mv-view-combat',tab==='combate');
      root.classList.toggle('mv-view-general',tab==='geral');
      root.classList.toggle('mv-view-inventory',tab==='inventario');
      root.classList.toggle('mv-view-abilities',tab==='habilidades');
      root.classList.toggle('mv-view-effects',tab==='efeitos');
      root.classList.toggle('mv-view-other',!['geral','combate','inventario','habilidades','efeitos'].includes(tab));
      const rest=root.querySelector('.mv-rest-global');
      const combatPage=root.querySelector('[data-mv-page="combate"]');
      const nav=root.querySelector('.mv-tabs-nav');
      if(rest&&combatPage&&nav){
        if(tab==='combate')combatPage.append(rest);
        else nav.after(rest);
      }
      this._mvActiveTab = tab;
    };
    for (const button of tabs) button.addEventListener("click", () => selectTab(button.dataset.mvTab));
    selectTab(["combate", "inventario", "habilidades", "efeitos"].includes(this._mvActiveTab) ? this._mvActiveTab : "geral");
    initVisionGeneral(this,root,selectTab);
    bindInventoryUI(this,root);
    bindAbilitiesUI(this,root);
    bindEffectsOverviewUI(this,root);
    bindCombatUi(this,root);
    root.querySelector('[data-mv-combat-open-effects]')?.addEventListener('click',()=>selectTab('efeitos'));
    root.querySelector('[data-mv-combat-manage-favorites]')?.addEventListener('click',async()=>{
      if(!this.actor.isOwner&&!game.user?.isGM)return ui.notifications.warn('Sem permissão para alterar favoritos.');
      const all=[...(this.actor.items??[])].filter(item=>['skill','tecnica'].includes(item.type)&&item.getFlag?.('multiverso-rpg','manualEffectSourceV1')!==true && item.getFlag?.('multiverso-rpg','itemEffectSourceV1')!==true && item.getFlag?.('multiverso-rpg','itemCastCloneV1')!==true && item.getFlag?.('multiverso-rpg','traitEffectSourceV1')!==true);
      if(!all.length)return ui.notifications.info('Adicione uma Skill ou Técnica na aba Habilidades primeiro.');
      const saved=new Set(this.actor.getFlag('multiverso-rpg','combatFavoritesV1')??[]);
      const esc=value=>foundry.utils.escapeHTML(String(value??''));
      const entries=all.map(item=>`<label class="mv-fav-select-line"><input type="checkbox" data-mv-favorite-id="${esc(item.id)}" ${saved.has(item.id)?'checked':''}/><img src="${esc(item.img||'icons/svg/item-bag.svg')}" alt=""/><span>${esc(item.name)} <small>${item.type==='skill'?'Skill':'Técnica'}</small></span></label>`).join('');
      try{
        const result=await foundry.applications.api.DialogV2.wait({
          window:{title:'Gerenciar ações favoritas',resizable:true},
          content:`<div class="mv-combat-fav-picker"><p>Escolha Skills e Técnicas. Itens favoritos são marcados diretamente no Inventário e aparecem aqui automaticamente.</p>${entries}</div>`,
          buttons:[{action:'cancel',label:'Cancelar',callback:()=>null},{action:'save',label:'Salvar favoritos',default:true,callback:(_event,button,dialog)=>
            Array.from((dialog?.element??button?.form)?.querySelectorAll('[data-mv-favorite-id]:checked')??[]).map(el=>el.dataset.mvFavoriteId)}],rejectClose:false
        });
        if(!result)return;
        const valid=new Set(all.map(item=>item.id));
        await this.actor.setFlag('multiverso-rpg','combatFavoritesV1',[...new Set(result.filter(id=>valid.has(id)))]);
        this.render(false);
      }catch(error){console.error('Multiverso | Favoritos',error);ui.notifications.error('Não foi possível salvar os favoritos.');}
    });
    root.querySelectorAll('[data-mv-combat-edit-favorite]').forEach(button=>button.addEventListener('click',()=>{
      this.actor.items.get(button.dataset.mvCombatEditFavorite)?.sheet?.render(true);
    }));
    root.querySelectorAll('[data-mv-combat-cast-favorite]').forEach(button=>button.addEventListener('click',async()=>{
      const item=this.actor.items.get(button.dataset.mvCombatCastFavorite);
      if(!item||item.type!=='equipamento')return ui.notifications.warn('Item favorito não encontrado.');
      if(!this.actor.isOwner&&!game.user?.isGM)return ui.notifications.warn('Sem permissão para conjurar.');
      if(button.disabled)return;
      button.disabled=true;
      try{await useItemMotor(item,{operationMode:'cast'});}catch(error){console.error('Multiverso | Conjuração favorita',error);ui.notifications.error(error?.message??'Falha ao conjurar.');}
      finally{if(button.isConnected)button.disabled=false;}
    }));
    root.querySelectorAll('[data-mv-combat-use-favorite]').forEach(button=>button.addEventListener('click',async()=>{
      const item=this.actor.items.get(button.dataset.mvCombatUseFavorite);
      if(!item||!['skill','tecnica','equipamento'].includes(item.type))return ui.notifications.warn('Favorito não encontrado.');
      if(!this.actor.isOwner&&!game.user?.isGM)return ui.notifications.warn('Sem permissão para utilizar esse favorito.');
      if(button.disabled)return;
      button.disabled=true;
      try{
        if(item.type==='equipamento')await useInventoryItem(this.actor,item);
        else await executeNativeEffectTest(item);
      }
      catch(error){console.error('Multiverso | Favorito em combate',error);ui.notifications.error(error?.message??'Falha ao usar favorito.');}
      finally{if(button.isConnected)button.disabled=false;}
    }));
    root.querySelectorAll('[data-mv-roll-initiative]').forEach(button=>button.addEventListener('click',()=>{
      void rollCharacterInitiative(this.actor).catch(error=>{console.error('Multiverso | Iniciativa',error);ui.notifications.error(error.message);});
    }));
    root.querySelectorAll("[data-mv-item-create]").forEach(button => button.addEventListener("click", async () => {
      const type = button.dataset.mvType;
      const allowed = new Set(["equipamento","skill","tecnica","classe","subclasse","especie","habilidadeClasse","habilidadeSubclasse","habilidadeEspecie","vantagem"]);
      if (!allowed.has(type)) return;
      const categoria = button.dataset.mvCategory || "";
      try {
        const [item] = await this.actor.createEmbeddedDocuments("Item", [{name:"Novo item",type,system:{categoria}}]);
        item?.sheet?.render(true);
      } catch(error) {console.error("Multiverso | Falha ao criar item",error);ui.notifications.error("Erro ao criar item. Confira F12.");}
    }));
    root.querySelectorAll("[data-mv-item-open]").forEach(btn=>btn.addEventListener("click",()=>{
      this.actor.items.get(btn.dataset.mvItemOpen)?.sheet?.render(true);
    }));
    root.querySelectorAll("[data-mv-item-delete]").forEach(btn=>btn.addEventListener("click",async()=>{
      const item=this.actor.items.get(btn.dataset.mvItemDelete);
      if (!item) return;
      try {
        const confirmed=await foundry.applications.api.DialogV2.confirm({window:{title:"Excluir item"},content:`Excluir o item <strong>${foundry.utils.escapeHTML(item.name)}</strong> deste personagem?`});
        if (confirmed) await item.delete();
      } catch(error) {console.error("Multiverso | Falha ao excluir item",error);ui.notifications.error("Não foi possível excluir o item.");}
    }));
    // Remoção manual segura: nunca alterar atributos-base ou desfazer PV já aplicado.
    // A associação é feita EXCLUSIVAMENTE pelo trackingId, e não por nome.
    root.querySelectorAll("[data-mv-effect-remove]").forEach(button => button.addEventListener("click", async () => {
      const effect=this.actor.effects.get(button.dataset.mvEffectRemove);
      if(!effect) { ui.notifications.warn("O efeito não existe mais. Reabra a ficha."); return; }
      const ns="multiverso-rpg";
      const trackingId=effect.getFlag(ns,"trackingId");
      const escaped=foundry.utils.escapeHTML(effect.name);
      try {
        const confirmed=await foundry.applications.api.DialogV2.confirm({
          window:{title:"Remover efeito ativo"},
          content:`Remover <strong>${escaped}</strong> e encerrar sua duração vinculada, se existir? Esta ação não desfaz PV ou PM já alterados.`
        });
        if(!confirmed)return;
        const tracked=readTracked(this.actor);
        const entry=tracked.find(e=>e.id===trackingId);
        // Um marcador aplicado diretamente na ficha não pode ser excluído sem reversão.
        if(entry?.auraController){await this._endOwnAura(entry);this.render();return;}
        if(entry)await endMaintainedEffect(this.actor,entry);
        else if(effect.getFlag(ns,'storedAttributeDelta'))throw new Error('Efeito sem registro de duração: é necessária revisão manual para não perder o bônus.');
        else await effect.delete();
        if(entry)await this.actor.setFlag(ns,"trackedDurations",readTracked(this.actor).filter(e=>e.id!==trackingId));
        this.render();
      } catch(error) {
        console.error("Multiverso RPG | Remoção de efeito",error);
        ui.notifications.error("Falha ao remover o efeito ou limpar sua duração. Confira F12.");
      }
    }));
    root.querySelectorAll('[data-mv-rest]').forEach(btn=>btn.addEventListener('click',async()=>{
      try{await openRestDialog(this.actor,btn.dataset.mvRest);}catch(e){console.error('Multiverso | Descanso',e);ui.notifications.error(e?.message??'Erro ao realizar descanso. Confira F12.');}
    }));
    root.querySelectorAll('[data-mv-usage-reset]').forEach(btn=>btn.addEventListener('click',async()=>{
      const item=this.actor.items.get(btn.dataset.mvUsageReset);if(!item)return;
      const ok=await foundry.applications.api.DialogV2.confirm({window:{title:'Recarregar usos manualmente'},content:`Restaurar usos de <strong>${foundry.utils.escapeHTML(item.name)}</strong>?`});
      if(ok)try{const result=await manualRecharge(this.actor,item);this.render();void sendPrivateUsageCard(this.actor,{kind:'recarga',name:item.name,event:'manual',restored:result?.limited?[{name:item.name,remaining:result.remaining,limit:result.config.limit}]:[]}).catch(console.warn);}catch(e){console.error(e);ui.notifications.error('Falha na recarga manual.');}
    }));
    root.querySelectorAll("[data-mv-duration-end]").forEach(button => button.addEventListener("click", async () => {
      const id=button.dataset.mvDurationEnd;
      const ns="multiverso-rpg";
      const tracked=readTracked(this.actor);
      const entry=tracked.find(e=>e.id===id);
      if(!entry){ui.notifications.warn("Esta duração não existe mais. Reabra a ficha.");return;}
      const escaped=foundry.utils.escapeHTML(entry.name??"Efeito");
      try {
        const confirmed=await foundry.applications.api.DialogV2.confirm({
          window:{title:"Encerrar duração"},
          content:`Encerrar a duração de <strong>${escaped}</strong>? Se houver um bônus contínuo ligado a ela, ele será removido. Valores de PV já aplicados permanecem.`
        });
        if(!confirmed)return;
        // Encerrar também a modificação REAL do atributo, quando existir.
        if(entry.auraController){await this._endOwnAura(entry);this.render();return;}
        if(entry.maintainedEffect)await endMaintainedEffect(this.actor,entry);
        await this.actor.setFlag(ns,"trackedDurations",readTracked(this.actor).filter(e=>e.id!==id));
        this.render();
      } catch(error) {
        console.error("Multiverso RPG | Encerramento manual",error);
        ui.notifications.error("Falha ao encerrar duração. Confira F12.");
      }
    }));
    root.addEventListener("change", async (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) return;
      const key = input.name;
      if (!key || (key !== "name" && !key.startsWith("system."))) return;

      // Somente campos existentes no modelo são gravados.
      const schema = this.actor.system.schema?.fields ?? {};
      if (key.startsWith("system.") && !Object.hasOwn(schema, key.slice(7))) return;
      const previous = key === "name" ? this.actor.name : this.actor.system[key.slice(7)];
      let value;
      if (input.type === "checkbox") value = input.checked;
      else if (input.type === "number") {
        if (input.value.trim() === "" || !Number.isFinite(input.valueAsNumber)) return;
        value = input.valueAsNumber;
      } else value = input.value;
      // Os campos exibem base + passivos; salvar apenas o valor-base.
      if(key.startsWith("system.") && typeof value==="number") {
        const bonus=passiveAttributeBonuses(this.actor)[key.slice(7)]??0;
        value-=bonus;
      }
      if (previous === value) return;
      try {
        await this.actor.update({ [key]: value });
      } catch (error) {
        console.error("Multiverso RPG | Falha ao salvar campo", key, error);
        ui.notifications.error("Multiverso RPG: não foi possível salvar o campo. Confira o console (F12).");
      }
    });
  }
}
