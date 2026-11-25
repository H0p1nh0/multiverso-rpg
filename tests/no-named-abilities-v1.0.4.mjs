// Executar: node tests/no-named-abilities-v1.0.4.mjs
// Verifica ausência de rotas exclusivas por nome no código e equivalência de diagnóstico.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url));
const root=join(dir,'..');
assert.equal(existsSync(join(root,'module','hoshuko.mjs')),false);
function mjsFiles(folder){return readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{
  const p=join(folder,entry.name);
  return entry.isDirectory()?mjsFiles(p):entry.name.endsWith('.mjs')?[p]:[];
});}
for(const file of mjsFiles(join(root,'module'))){
  assert.equal(/hoshuko|markPenalty|useHoshuko/i.test(readFileSync(file,'utf8')),false,`Found name-based exception in ${file}`);
}
const main=readFileSync(join(root,'main.mjs'),'utf8');
assert.equal(/hoshuko|registerHoshuko/i.test(main),false);
const ui=readFileSync(join(root,'module','abilities-ui.mjs'),'utf8');
assert.match(ui,/\$\{buttons\}/);
assert.match(ui,/mvShowUseButton\$\{e\.index\}`\]\s*===\s*'sim'/);
assert.match(ui,/await executeNativeEffectTest\(item,\{onlySlots:\[slot\]\}\)/);
globalThis.game={combat:null,user:{targets:new Set()}};
const {buildAbilityReport}=await import('../module/ability-diagnostics.mjs');
const props={mvEffectCount:2,
  efeitotecnicatipo:'dano',efeitotecnicareceptor:'alvo',efeitotecnicaafetado:'pv',
  efeitotecnicaescala:'dado',efeitotecnicavalor:'1d6',efeitotecnicaduracao:'Instantânea',
  efeitotecnicacusto:'8 STA',ativacaotempotecnica:'completa',
  efeitotecnicatipo2:'recurso',efeitotecnicareceptor2:'proprio',efeitotecnicaafetado2:'pv',
  efeitotecnicaoperacao2:'subtrair',efeitotecnicaescala2:'dado',efeitotecnicavalor2:'1d3',
  efeitotecnicaduracao2:'Instantânea',ativacaotempotecnica2:'completa'};
const actor={id:'a',uuid:'Actor.a',name:'Personagem',documentName:'Actor',items:[],isOwner:true,
 system:{pv_atual:20,pv_max:20,pm_atual:10,pm_max:10,sta_atual:20,sta_max:20,san_atual:10,san_max:10}};
const diagnosticFor=name=>buildAbilityReport({type:'tecnica',id:'t',name,system:{props},parent:actor});
const marked=diagnosticFor('Hoshuko');
const neutral=diagnosticFor('Técnica Genérica');
assert.deepEqual(marked.issues,neutral.issues);
assert.deepEqual(marked.checks,neutral.checks);
assert.equal(marked.rolls.length,neutral.rolls.length);
assert(marked.checks.some(s=>s.includes('Execução composta')));
console.log('OK: módulo especial removido e Hoshuko segue a mesma rota genérica.');
