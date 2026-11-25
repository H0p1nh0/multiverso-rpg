import {PersonagemData} from './data-models.mjs';
import {npcBuild,npcDefaultAttributes} from './npc-rules.mjs';
const {StringField,BooleanField,ObjectField,NumberField}=foundry.data.fields;
// Estende os campos comuns para continuar compatível com rolagens/recursos do sistema.
// Somente o tipo "npc" usa esta lógica; personagens nunca são alterados.
export class NPCData extends PersonagemData {
  static defineSchema() {
    const schema=super.defineSchema();
    for(const [key,value] of Object.entries(npcDefaultAttributes('comum'))){
      schema[key]=new NumberField({required:true,initial:value,min:0,integer:true});
    }
    return {
      ...schema,
      npcCategoria:new StringField({required:true,initial:'comum'}),
      npcCortantesAttr:new StringField({required:true,initial:'forcanumero'}),
      npcTraining:new ObjectField({required:true,initial:()=>({})}),
      npcSpecialization:new ObjectField({required:true,initial:()=>({})}),
      npcFluxOverrides:new ObjectField({required:true,initial:()=>({})}),
      npcAbilities:new ObjectField({required:true,initial:()=>({})}),
      npcSupportAbilities:new ObjectField({required:true,initial:()=>({})}),
      npcRole:new StringField({required:true,initial:'Inimigo'}),
      npcNotes:new StringField({required:true,initial:''}),
      npcInitResources:new BooleanField({required:true,initial:false})
    };
  }
  prepareDerivedData(){
    super.prepareDerivedData();
    const build=npcBuild(this);
    for(const [key,value] of Object.entries(build.skillValues)) this[key]=value;
    for(const key of ['pv','sta','pm','san']) {
      this[`${key}_max`]=build.max[key];
    }
  }
}
