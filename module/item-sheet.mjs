import {openItemMotorWindow} from './item-motor-window.mjs';
import {getOrCreateItemSource,sourceForItem} from './item-effect-links.mjs';
import {sourceForTrait,getOrCreateTraitSource,TRAIT_TYPES} from './trait-effect-links.mjs';
import {kindForTrait,kindsForTraitGroup,groupForTraitType,matchesTraitKind} from './trait-entry-kinds.mjs';
import {mountMultiversoSkillEditor} from "./skill-editor-original.mjs";
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
export class MultiversoItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = { classes:["multiverso-item-sheet"], window:{resizable:true}, position:{width:820,height:720} };
  static PARTS = {form:{template:"systems/multiverso-rpg/templates/item.hbs"}};

  get title() {
    const labels = {equipamento:"Equipamento",skill:"Skill",tecnica:"Técnica",classe:"Classe",subclasse:"Subclasse",especie:"Espécie",habilidadeClasse:"Habilidade de Classe",habilidadeSubclasse:"Habilidade de Subclasse",habilidadeEspecie:"Habilidade de Espécie",vantagem:"Vantagem"};
    const itemName = String(this.item?.name || "Item").trim() || "Item";
    const isManualEffect=this.item?.getFlag?.('multiverso-rpg','manualEffectSourceV1')===true;
    const traitOrigin=this.item?.getFlag?.('multiverso-rpg','traitEffectSourceV1') ? this.item.parent?.items?.get(this.item.getFlag('multiverso-rpg','originItemId')) : null;
    const traitVariant = this.item?.type==='habilidadeEspecie' ? (['desvantagem','negativo'].includes(String(this.item.system?.categoria??'').toLowerCase())?'Desvantagem de Espécie':'Vantagem de Espécie') : this.item?.type==='vantagem' ? (['desvantagem','negativo'].includes(String(this.item.system?.categoria??'').toLowerCase())?'Desvantagem Geral':'Vantagem Geral') : null;
    const typeLabel = isManualEffect?'Efeito':traitOrigin?('Efeitos de '+(labels[traitOrigin.type]??'Característica')):(traitVariant??labels[this.item?.type] ?? "Item");
    return `Multiverso RPG • ${typeLabel}: ${itemName}`;
  }
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.item = this.item;
    context.system = this.item.system.toObject();
    context.isManualEffect = this.item.getFlag?.('multiverso-rpg','manualEffectSourceV1')===true;
    context.isTraitSource = this.item.getFlag?.('multiverso-rpg','traitEffectSourceV1')===true;
    const negative=['desvantagem','negativo'].includes(String(this.item.system?.categoria??'').toLowerCase());
    const traitTitle=this.item.type==='habilidadeEspecie'?(negative?'Desvantagem de Espécie':'Vantagem de Espécie'):this.item.type==='vantagem'?(negative?'Desvantagem Geral':'Vantagem Geral'):null;
    context.typeLabel = context.isManualEffect?'Efeito':context.isTraitSource?'Configuração de Efeitos':(traitTitle??({equipamento:"Equipamento",skill:"Skill",tecnica:"Técnica",classe:"Classe",subclasse:"Subclasse",especie:"Espécie",habilidadeClasse:"Habilidade de Classe",habilidadeSubclasse:"Habilidade de Subclasse"}[this.item.type] ?? this.item.type));
    context.isEquipment = this.item.type === "equipamento";
    context.consumeOnUse = this.item.getFlag?.('multiverso-rpg','itemConsumeOnUseV1');
    if(context.consumeOnUse===undefined)context.consumeOnUse=String(this.item.system?.categoria??'')==='consumivel';

    context.isTrait = ['habilidadeEspecie','vantagem'].includes(this.item.type);
    context.traitEffects = TRAIT_TYPES.has(this.item.type);
    context.traitLinked = !!sourceForTrait(this.item);
    context.isNegative = ['desvantagem','negativo'].includes(String(this.item.system?.categoria??'').toLowerCase());
    context.traitHint = ({especie:'Características e origens da espécie',habilidadeEspecie:'Traço de espécie: vantagem ou desvantagem',classe:'Identidade e progressão da classe',subclasse:'Especialização e seus recursos',habilidadeClasse:'Poder da classe',habilidadeSubclasse:'Poder da subclasse',vantagem:'Vantagem ou desvantagem geral'})[this.item.type] ?? '';
    context.traitCategoryLabel = ['especie','habilidadeEspecie'].includes(this.item.type)?'Espécie':['classe','subclasse','habilidadeClasse','habilidadeSubclasse'].includes(this.item.type)?'Classe':'Geral';
    context.isSkill = ["skill","tecnica"].includes(this.item.type);
    return context;
  }
  _onRender(context, options) {
    super._onRender(context, options);
    const categorySelect=this.element.querySelector('select[name="system.categoria"]');
    if(categorySelect){
      const value=String(this.item.system?.categoria??'');
      if(value&&!Array.from(categorySelect.options).some(option=>option.value===value)){
        const legacy=document.createElement('option');legacy.value=value;legacy.textContent=value;categorySelect.append(legacy);
      }
      categorySelect.value=value;
    }
    this.element.querySelector('[data-mv-item-image]')?.addEventListener('click',()=>{
      if(!this.item.isOwner&&!game.user?.isGM)return;
      const Picker=foundry.applications.apps.FilePicker.implementation;
      new Picker({type:'image',current:this.item.img,callback:async(path)=>{if(path){await this.item.update({img:path});const source=sourceForTrait(this.item);if(source)await source.update({img:path});}}}).render(true);
    });
    if(this.item.type==='equipamento'){
      const root=this.element;
      const pages=[...root.querySelectorAll('[data-mv-item-page]')];
      const tabs=[...root.querySelectorAll('[data-mv-item-tab]')];
      let request=0;
      const showPage=(tab)=>{
        this._mvItemTab=tab;
        tabs.forEach(button=>{const active=button.dataset.mvItemTab===tab;button.classList.toggle('is-active',active);button.setAttribute('aria-selected',String(active));});
        pages.forEach(page=>page.hidden=page.dataset.mvItemPage!==tab);
      };
      tabs.forEach(button=>button.addEventListener('click',async()=>{
        const tab=button.dataset.mvItemTab;
        showPage(tab);
        if(tab!=='efeitos')return;
        const box=root.querySelector('[data-mv-item-effects-source]');
        const status=root.querySelector('[data-mv-item-effects-loading]');
        if(!box)return;
        const id=++request;
        if(status){status.hidden=false;status.textContent='Carregando configurações do item...';}
        try{
          const source=await getOrCreateItemSource(this.item);
          if(id!==request||!root.isConnected)return;
          box.replaceChildren();
          const editor=document.createElement('div');
          editor.setAttribute('data-mv-skill-editor','');
          box.append(editor);
          if(status)status.hidden=true;
          mountMultiversoSkillEditor(box,source,{effectsOnly:true});
        }catch(error){
          console.error('Multiverso | Efeitos do item',error);
          if(status){status.hidden=false;status.textContent=error?.message??'Não foi possível abrir os efeitos.';}
          ui.notifications.error(error?.message??'Não foi possível abrir os efeitos.');
        }
      }));
      const consume=root.querySelector('[data-mv-item-consume]');
      consume?.addEventListener('change',async()=>{
        try{await this.item.setFlag('multiverso-rpg','itemConsumeOnUseV1',consume.checked);}
        catch(error){console.error('Multiverso | Consumo do item',error);ui.notifications.error(error.message);consume.checked=!consume.checked;}
      });
      root.querySelector('[data-mv-open-item-motor]')?.addEventListener('click',async event=>{
        const button=event.currentTarget;
        button.disabled=true;
        try{await openItemMotorWindow(this);}
        catch(error){console.error('Multiverso | Abrir Motor do Item',error);ui.notifications.error(error?.message??'Não foi possível abrir o Motor do Item.');}
        finally{if(button.isConnected)button.disabled=false;}
      });
      if(this._mvItemTab==='efeitos')tabs.find(x=>x.dataset.mvItemTab==='efeitos')?.click();
      else showPage('descricao');
    }
    if (this.item.type === "skill" || this.item.type === "tecnica") {
      mountMultiversoSkillEditor(this.element, this.item,{effectsOnly:!!context.isTraitSource});
    }
    if(TRAIT_TYPES.has(this.item.type)){
      const root=this.element;
      const pages=[...root.querySelectorAll('[data-mv-trait-page]')];
      const buttons=[...root.querySelectorAll('[data-mv-trait-tab]')];
      const targetBox=root.querySelector('[data-mv-trait-source-editor]');
      const msg=root.querySelector('[data-mv-trait-source-placeholder]');
      let request=0;
      const uiState=this._mvTraitUiState??={tab:'descricao'};
      const loadSource=async()=>{
        const seq=++request;
        if(this.item.parent?.documentName!=='Actor'){
          if(msg){msg.hidden=false;msg.textContent='Adicione esta característica a uma ficha para configurar seus efeitos.';}
          if(targetBox){targetBox.hidden=true;targetBox.replaceChildren();}
          return;
        }
        if(msg){msg.hidden=false;msg.textContent='Carregando efeitos próprios de '+this.item.name+'...';}
        if(targetBox)targetBox.hidden=true;
        try{
          const source=await getOrCreateTraitSource(this.item);
          if(seq!==request||!root.isConnected)return;
          if(msg)msg.hidden=true;
          if(targetBox){
            targetBox.hidden=false;
            targetBox.replaceChildren();
            const host=document.createElement('div');
            host.dataset.mvSkillEditor='';
            targetBox.append(host);
            mountMultiversoSkillEditor(targetBox,source,{effectsOnly:true});
          }
        }catch(error){
          console.error('Multiverso | Efeitos próprios da característica',error);
          if(msg){msg.hidden=false;msg.textContent=error?.message??'Não foi possível abrir os efeitos.';}
          ui.notifications.error(error?.message??'Não foi possível abrir os efeitos.');
        }
      };
      for(const button of buttons){
        button.addEventListener('click',()=>{
          const tab=button.dataset.mvTraitTab;
          uiState.tab=tab;
          for(const control of buttons){
            const active=control===button;
            control.classList.toggle('is-active',active);
            control.setAttribute('aria-selected',String(active));
          }
          for(const page of pages)page.hidden=page.dataset.mvTraitPage!==tab;
          if(tab==='efeitos')void loadSource();
        });
      }
      if(uiState.tab==='efeitos'){
        const activeButton=buttons.find(button=>button.dataset.mvTraitTab==='efeitos');
        if(activeButton)activeButton.click();
      }
    }
    this.element.querySelector(".mv-item-fields")?.addEventListener("change", async (event) => {
      const input=event.target;
      if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) return;
      const key=input.name;
      if (!key || (key!=="name" && !key.startsWith("system."))) return;
      const schema=this.item.system.schema?.fields ?? {};
      if (key==='system.props.capacidadeExtra' && this.item.type==='equipamento') {
        const extra=Number(input.value);if(!Number.isFinite(extra)||extra<0)return;
        try {await this.item.update({'system.props':{...(this.item.system.props??{}),capacidadeExtra:extra}});}
        catch(error){console.error('Multiverso | Armazenamento',error);ui.notifications.error('Não foi possível atualizar o armazenamento.');}
        return;
      }
      if (key.startsWith("system.") && !Object.hasOwn(schema,key.slice(7))) return;
      const value=input.type==="checkbox"?input.checked:input.type==="number"?input.valueAsNumber:input.value;
      if (input.type==="number" && !Number.isFinite(value)) return;
      try {await this.item.update({[key]:value});
        if(key==='name') {const source=sourceForTrait(this.item)||sourceForItem(this.item);if(source)await source.update({name:value});}
      }
      catch(error) {console.error("Multiverso | Erro ao salvar item",error); ui.notifications.error("Não foi possível salvar o item (F12).");}
    });
  }
}
