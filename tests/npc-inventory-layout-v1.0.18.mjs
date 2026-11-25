import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>readFileSync(path.join(root,f),'utf8');
const manifest=JSON.parse(read('system.json'));
const inventory=read('module/inventory-ui.mjs');
const sheet=read('module/npc-sheet.mjs');
const css=read('styles/npc-v1.0.18.css');
assert.ok(['1.0.18','1.0.19','1.0.20'].includes(manifest.version));
assert.ok(manifest.styles.includes('styles/npc-v1.0.18.css'));
assert.ok(sheet.includes("npc-v1.0.18.css?v=1.0.18"));
assert.ok(sheet.includes("link.dataset.mvNpcStyle='1.0.18'"));
// NPC: não repete nome e retrato, preserva carga/moedas e estoque de itens.
assert.ok(inventory.includes("const identitySummary = isNPC ? ''"));
assert.ok(inventory.includes("const capacityFormula = isNPC"));
assert.ok(inventory.includes("mv-inv-summary ${isNPC?\'mv-npc-inv-summary\':\'\'}"));
assert.ok(inventory.includes('${identitySummary}'));
assert.ok(inventory.includes('${capacityFormula}'));
assert.ok(inventory.includes('mv-inv-carry-head'));
assert.ok(inventory.includes('mv-inv-money'));
for(const token of ['data-mv-inv-storage-extra','data-mv-inv-currency-add','data-mv-inv-create','data-mv-inv-filter-category','data-mv-inv-sort','data-mv-inv-selected','data-mv-inv-use','data-mv-inv-cast'])assert.ok(inventory.includes(token),token);
// CSS adaptado à largura REAL da ficha, não à viewport do monitor.
assert.ok(css.includes('container-type:inline-size'));
assert.ok(css.includes('@container npcInventory (max-width: 800px)'));
assert.ok(css.includes('@container npcInventory (max-width: 500px)'));
assert.ok(css.includes('.mv-inv-carry > .mv-inv-loadbar'));
assert.ok(css.includes('.mv-npc-capacity-pills'));
// Preservação dos fluxos, vínculos e motor.
assert.ok(sheet.includes('npcRelationGroups'));
assert.ok(sheet.includes('executeNativeEffectTest'));
assert.ok(sheet.includes('bindInventoryUI(this,root)'));
console.log('OK: v1.0.18 — painel NPC com resumo de carga/moedas, fórmulas legíveis, toolbar responsiva e ações de inventário preservadas.');
