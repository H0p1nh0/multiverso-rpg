// Multiverso RPG v1.0.12 — Afinidades gerenciadas exclusivamente por Journals vinculados.
// Sem mexer nas páginas do diário, nas fichas de personagem ou no motor de regras.
import { findManagedJournal } from './auto-diaries.mjs';
import { getPartyForActor, readPartyRegistry } from './party-manager.mjs';

const SYSTEM_ID = 'multiverso-rpg';
const FLAG_KEY = 'affinitiesV1';
const JOURNAL_ACTOR_FLAG = 'autoDiaryActorId';
const STYLES = `systems/${SYSTEM_ID}/styles/affinity-journals-v1.0.12.css?v=1.0.12`;
const MAX_RELATIONS = 500;
const NAME_LIMIT = 100;
const AFFINITY_LEVELS = 3;
const dialogs = new Map();
const saveQueues = new Map();

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const textName = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_LIMIT);
const cleanInt = value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > AFFINITY_LEVELS) throw new Error('Selecione de 0 a 3 bolinhas para Afinidade.');
  return number;
};

export function normalizeAffinityData(value) {
  const entries = [];
  const unique = new Set();
  for (const entry of (Array.isArray(value?.entries) ? value.entries : []).slice(0, MAX_RELATIONS)) {
    const key = String(entry?.key ?? '');
    const isActor = /^actor:[a-zA-Z0-9_-]+$/.test(key);
    const isManual = /^npc:[a-zA-Z0-9_-]+$/.test(key);
    if ((!isActor && !isManual) || unique.has(key)) continue;
    const name = isManual ? textName(entry.name) : '';
    if (isManual && !name) continue;
    unique.add(key);
    const affection = Number(entry.afeicao);
    const admiration = Number(entry.admiracao);
    entries.push({
      key, name,
      afeicao: Number.isSafeInteger(affection) ? affection : 0,
      admiracao: Number.isSafeInteger(admiration) ? admiration : 0
    });
  }
  return { schema: 1, entries };
}

export function updateAffinityValue(registry, key, field, value) {
  if (field !== 'afeicao' && field !== 'admiracao') throw new Error('Campo de afinidade inválido.');
  if (!/^actor:[a-zA-Z0-9_-]+$/.test(key) && !/^npc:[a-zA-Z0-9_-]+$/.test(key)) throw new Error('Relacionamento inválido.');
  const number = cleanInt(value);
  const data = normalizeAffinityData(registry);
  let entry = data.entries.find(e => e.key === key);
  if (!entry) {
    if (!key.startsWith('actor:')) throw new Error('Relacionamento manual não encontrado.');
    if (data.entries.length >= MAX_RELATIONS) throw new Error('O limite técnico de relacionamentos foi atingido.');
    entry = { key, name: '', afeicao: 0, admiracao: 0 };
    data.entries.push(entry);
  }
  entry[field] = number;
  return data;
}

export function addNamedRelationship(registry, name, id) {
  const data = normalizeAffinityData(registry);
  const cleaned = textName(name);
  if (!cleaned) throw new Error('Digite o nome do NPC.');
  if (data.entries.length >= MAX_RELATIONS) throw new Error('O limite técnico de relacionamentos foi atingido.');
  if (data.entries.some(e => e.name && e.name.localeCompare(cleaned, 'pt-BR', { sensitivity: 'base' }) === 0)) {
    throw new Error('Já existe um relacionamento manual com esse nome.');
  }
  const key = `npc:${String(id ?? '').trim()}`;
  if (!/^npc:[a-zA-Z0-9_-]+$/.test(key) || data.entries.some(e => e.key === key)) throw new Error('Identificador de relacionamento inválido.');
  data.entries.push({ key, name: cleaned, afeicao: 0, admiracao: 0 });
  return data;
}

export function addActorRelationship(registry, actorId) {
  const data = normalizeAffinityData(registry);
  const key = `actor:${String(actorId ?? '').trim()}`;
  if (!/^actor:[a-zA-Z0-9_-]+$/.test(key)) throw new Error('Selecione um personagem válido.');
  if (data.entries.some(e => e.key === key)) throw new Error('Esse personagem já está nos seus relacionamentos.');
  if (data.entries.length >= MAX_RELATIONS) throw new Error('O limite técnico de relacionamentos foi atingido.');
  data.entries.push({ key, name: '', afeicao: 0, admiracao: 0 });
  return data;
}

export function removeAffinityRelationship(registry, key) {
  const data = normalizeAffinityData(registry);
  data.entries = data.entries.filter(e => e.key !== key);
  return data;
}

export function affinityJournalActor(journal, { actors = game.actors, journals = game.journal } = {}) {
  if (!journal || journal.pack || journals?.get(journal.id) !== journal) return null;
  const actorId = journal.getFlag?.(SYSTEM_ID, JOURNAL_ACTOR_FLAG);
  if (!actorId) return null;
  const actor = actors?.get(actorId);
  if (!actor || actor.type !== 'personagem') return null;
  // Um Journal desvinculado ou com flag antiga não é uma interface de afinidades.
  if (findManagedJournal(actor)?.id !== journal.id) return null;
  return actor;
}

export function canEditJournalAffinity(journal, actor, user = game.user) {
  return Boolean(user && journal && actor && (user.isGM || (
    journal.testUserPermission?.(user, 'OWNER') && actor.testUserPermission?.(user, 'OWNER')
  )));
}

function ensureStyles() {
  if (typeof document === 'undefined' || !document.head || document.querySelector('[data-mv-affinities-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = STYLES; link.dataset.mvAffinitiesStyle = '1';
  document.head.append(link);
}

function partyActorIds(actorId) {
  const team = getPartyForActor(actorId, readPartyRegistry());
  return (team?.memberIds ?? []).filter(id => id !== actorId);
}

function actorCanBeNamed(actor) {
  if (!actor || actor.type !== 'personagem') return false;
  return Boolean(game.user?.isGM || actor.testUserPermission?.(game.user, 'LIMITED'));
}

export function describeAffinityGroups(actor, data, partyIds, actors = game.actors) {
  const stored = new Map(normalizeAffinityData(data).entries.map(e => [e.key, e]));
  const party = [...new Set(partyIds)].filter(id => id !== actor.id).map(id => {
    const key = `actor:${id}`;
    return { ...stored.get(key), key, name: actors?.get(id)?.name ?? 'Personagem da equipe', image: actors?.get(id)?.img ?? '', isParty: true };
  });
  const partyKeys = new Set(party.map(item => item.key));
  const others = [...stored.values()].filter(entry => {
    if (partyKeys.has(entry.key)) return false;
    if (!entry.key.startsWith('actor:')) return true;
    // Não revelar nomes/imagens de fichas ocultas por relacionamentos antigos.
    return actorCanBeNamed(actors?.get(entry.key.slice(6)));
  }).map(entry => {
    const id = entry.key.startsWith('actor:') ? entry.key.slice(6) : null;
    const otherActor = id ? actors?.get(id) : null;
    return { ...entry, name: otherActor?.name ?? (id ? 'Personagem indisponível' : entry.name), image: otherActor?.img ?? '', isParty: false };
  });
  return { party, others };
}

function normalizeFields(item) {
  return { afeicao: item?.afeicao ?? 0, admiracao: item?.admiracao ?? 0 };
}

// Três marcadores por campo: clicar no mesmo nível ativo zera; clicar em outro define 1-3.
// Valores legados fora da nova escala permanecem armazenados até o jogador escolher um nível.
export function nextAffinityLevel(current, clicked) {
  const level = cleanInt(clicked);
  if (level === 0) return 0;
  return Number(current) === level ? 0 : level;
}

function affinityDots(item, field, value) {
  const kind = field === 'afeicao' ? 'affection' : 'admiration';
  const label = field === 'afeicao' ? 'Afeição' : 'Admiração';
  const icon = field === 'afeicao' ? 'heart' : 'star';
  const valid = Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= AFFINITY_LEVELS;
  const display = valid ? Number(value) : Math.max(0, Math.min(AFFINITY_LEVELS, Number(value) || 0));
  const dots = Array.from({ length: AFFINITY_LEVELS }, (_, index) => {
    const level = index + 1;
    const active = level <= display;
    const selected = level === display && valid;
    return `<button type="button" class="mv-aff-dot${active ? ' is-active' : ''}" data-aff-action="level" data-aff-value="${field}" data-aff-key="${esc(item.key)}" data-aff-level="${level}" aria-label="${esc(label)} por ${esc(item.name)}: ${level} de 3; clique novamente no nível atual para zerar" aria-pressed="${selected ? 'true' : 'false'}" title="${esc(label)} — ${level} de 3${selected ? ' (clique para zerar)' : ''}"><span class="mv-aff-dot-core" aria-hidden="true"></span></button>`;
  }).join('');
  return `<div class="mv-aff-track mv-aff-${kind}" role="group" aria-label="${esc(label)} por ${esc(item.name)}" data-aff-current="${esc(value)}">
    <span class="mv-aff-track-label"><i class="fa-solid fa-${icon}" aria-hidden="true"></i> ${label}</span>
    <div class="mv-aff-dot-row">${dots}</div>
    ${!valid ? '<small class="mv-aff-legacy-note">Valor antigo fora da escala. Escolha um nível.</small>' : ''}
  </div>`;
}

function relationCard(item) {
  const values = normalizeFields(item);
  return `<article class="mv-aff-relation" data-mv-relation="${esc(item.key)}">
      <div class="mv-aff-identity"><img src="${esc(item.image || 'icons/svg/mystery-man.svg')}" alt="" loading="lazy" />
        <div class="mv-aff-person"><strong>${esc(item.name)}</strong><small>${item.isParty ? 'Membro da equipe' : (item.key.startsWith('npc:') ? 'Relacionamento adicionado' : 'Personagem relacionado')}</small></div>
        ${item.isParty ? '<span class="mv-aff-pill">Party</span>' : `<button type="button" class="mv-aff-remove" data-aff-action="remove" data-aff-key="${esc(item.key)}" title="Remover relacionamento" aria-label="Remover relacionamento com ${esc(item.name)}"><i class="fa-solid fa-trash"></i></button>`}
      </div>
      <div class="mv-aff-values">
        ${affinityDots(item, 'afeicao', values.afeicao)}
        ${affinityDots(item, 'admiracao', values.admiracao)}
      </div></article>`;
}

export function affinityView(actor, journal) {
  const data = normalizeAffinityData(journal.getFlag(SYSTEM_ID, FLAG_KEY));
  const team = getPartyForActor(actor.id, readPartyRegistry());
  const group = describeAffinityGroups(actor, data, partyActorIds(actor.id));
  return `<div class="mv-aff-content">
    <header class="mv-aff-banner"><i class="fa-solid fa-heart-circle-check" aria-hidden="true"></i><div><strong>Afinidades de ${esc(actor.name)}</strong><small>Relacionamentos registrados no diário ${esc(journal.name)}.</small></div></header>
    <section class="mv-aff-section"><div class="mv-aff-section-heading"><h3><i class="fa-solid fa-users"></i> Membros da equipe</h3><span>${group.party.length} relação(ões)</span></div>
      ${team ? `<p class="mv-aff-context">Equipe: <b>${esc(team.name)}</b>. Os integrantes são atualizados automaticamente pelo Gerenciador de Equipes.</p>` : '<p class="mv-aff-context">Este personagem ainda não pertence a uma equipe. O mestre pode cadastrá-lo em Gerenciar Equipe.</p>'}
      <div class="mv-aff-cards">${group.party.map(relationCard).join('') || '<p class="mv-aff-empty">Nenhum outro integrante cadastrado na equipe.</p>'}</div>
    </section>
    <section class="mv-aff-section"><div class="mv-aff-section-heading"><h3><i class="fa-solid fa-address-book"></i> Outros relacionamentos</h3><span>${group.others.length} cadastrado(s)</span></div>
      <div class="mv-aff-cards">${group.others.map(relationCard).join('') || '<p class="mv-aff-empty">Nenhum NPC ou relacionamento extra adicionado.</p>'}</div>
      <details class="mv-aff-add"><summary><i class="fa-solid fa-user-plus"></i> Adicionar relacionamento</summary>
        <div class="mv-aff-add-fields"><label>Nome do relacionamento / NPC<input data-mv-aff-name maxlength="${NAME_LIMIT}" type="text" placeholder="Ex.: Ferreiro da vila" autocomplete="off" /></label>
          <button type="button" data-aff-action="add"><i class="fa-solid fa-plus"></i> Adicionar</button>
        </div><p>Digite somente o nome. Fichas e NPCs do mundo não são listados para evitar spoilers.</p>
      </details>
    </section>
    <p class="mv-aff-footnote"><i class="fa-solid fa-lock"></i> Os valores são individuais, salvos neste Journal e atualizados ao editar. Nenhuma rolagem ou recurso é alterado nesta versão.</p>
  </div>`;
}

function assertManageable(journal) {
  const actor = affinityJournalActor(journal);
  if (!actor) throw new Error('Este diário não está vinculado a um personagem válido.');
  if (!canEditJournalAffinity(journal, actor)) throw new Error('Você não tem permissão para editar as afinidades deste diário.');
  return actor;
}

async function queuedSave(journal, modify) {
  const previous = saveQueues.get(journal.id) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    assertManageable(journal);
    const current = normalizeAffinityData(journal.getFlag(SYSTEM_ID, FLAG_KEY));
    const next = modify(current);
    await journal.setFlag(SYSTEM_ID, FLAG_KEY, next);
    return next;
  });
  saveQueues.set(journal.id, operation);
  try { return await operation; }
  finally { if (saveQueues.get(journal.id) === operation) saveQueues.delete(journal.id); }
}

export async function setJournalAffinity(journal, key, field, value) {
  const owner = assertManageable(journal);
  const party = partyActorIds(owner.id);
  if (key.startsWith('actor:')) {
    const id = key.slice(6);
    const existing = normalizeAffinityData(journal.getFlag(SYSTEM_ID, FLAG_KEY)).entries.some(e => e.key === key);
    if (!party.includes(id) && !existing) throw new Error('Relacionamento não cadastrado para este personagem.');
  }
  return queuedSave(journal, data => updateAffinityValue(data, key, field, value));
}

export async function createJournalAffinity(journal, { name = '', makeId = () => foundry.utils.randomID() } = {}) {
  const owner = assertManageable(journal);
  if (!textName(name)) throw new Error('Digite o nome do relacionamento.');
  const partyNames = partyActorIds(owner.id).map(id => game.actors?.get(id)?.name).filter(Boolean);
  if (partyNames.some(n => String(n).localeCompare(textName(name), 'pt-BR', { sensitivity: 'base' }) === 0)) {
    throw new Error('Esse personagem já aparece na equipe.');
  }
  return queuedSave(journal, data => addNamedRelationship(data, name, makeId()));
}

export async function deleteJournalAffinity(journal, key) {
  const owner = assertManageable(journal);
  if (partyActorIds(owner.id).some(id => key === `actor:${id}`)) throw new Error('Membros da Party são removidos em Gerenciar Equipe.');
  return queuedSave(journal, data => removeAffinityRelationship(data, key));
}

function updateWindow(journal, dialog, { preserveScroll = true } = {}) {
  const target = dialog.element?.querySelector('[data-mv-aff-body]');
  if (!target) return;
  const actor = assertManageable(journal);
  const area = dialog.element?.querySelector('.dialog-content');
  const scroll = preserveScroll ? area?.scrollTop ?? 0 : 0;
  const detailsOpen = Boolean(target.querySelector('.mv-aff-add[open]'));
  target.innerHTML = affinityView(actor, journal);
  if (detailsOpen) target.querySelector('.mv-aff-add')?.setAttribute('open', '');
  if (area) area.scrollTop = scroll;
}

async function confirmRemoval(name) {
  return foundry.applications.api.DialogV2.confirm({
    window: { title: 'Remover relacionamento?' },
    content: `<p>Remover o relacionamento com <b>${esc(name)}</b>? Os valores registrados de Afeição e Admiração serão apagados.</p>`,
    yes: { label: 'Remover' }, no: { label: 'Cancelar' }, rejectClose: false
  });
}

function report(error) {
  console.error('Multiverso RPG | Afinidades:', error);
  ui.notifications?.error(error?.message || 'Não foi possível atualizar a afinidade.');
}

async function handleClick(event, journal, dialog) {
  const button = event.target.closest('[data-aff-action]');
  if (!button) return;
  const action = button.dataset.affAction;
  try {
    if (action === 'level') {
      const field = button.dataset.affValue;
      const key = button.dataset.affKey;
      const clicked = Number(button.dataset.affLevel);
      const data = normalizeAffinityData(journal.getFlag(SYSTEM_ID, FLAG_KEY));
      const current = data.entries.find(entry => entry.key === key)?.[field] ?? 0;
      const newValue = nextAffinityLevel(current, clicked);
      const track = button.closest('.mv-aff-track');
      track?.querySelectorAll('.mv-aff-dot').forEach(dot => { dot.disabled = true; });
      await setJournalAffinity(journal, key, field, newValue);
      updateWindow(journal, dialog);
      return;
    }

    if (action === 'add') {
      const root = dialog.element?.querySelector('[data-mv-aff-body]');
      const name = root?.querySelector('[data-mv-aff-name]')?.value ?? '';
      button.disabled = true;
      await createJournalAffinity(journal, { name });
      updateWindow(journal, dialog);
      return;
    }
    if (action === 'remove') {
      const key = button.dataset.affKey;
      const data = normalizeAffinityData(journal.getFlag(SYSTEM_ID, FLAG_KEY));
      const found = data.entries.find(e => e.key === key);
      if (!found) return;
      const name = key.startsWith('actor:') ? game.actors?.get(key.slice(6))?.name || 'Personagem' : found.name;
      if (!await confirmRemoval(name)) return;
      button.disabled = true;
      await deleteJournalAffinity(journal, key);
      updateWindow(journal, dialog);
    }
  } catch (error) { report(error); updateWindow(journal, dialog); button.disabled = false; }
}


export async function openAffinityJournal(journal) {
  const actor = assertManageable(journal);
  ensureStyles();
  const existing = dialogs.get(journal.id);
  if (existing?.rendered) { updateWindow(journal, existing); existing.bringToFront(); return existing; }
  const dialog = new foundry.applications.api.DialogV2({
    classes: ['mv-affinity-window'],
    window: { title: `Multiverso RPG • Afinidades — ${actor.name}`, resizable: true, minimizable: true },
    position: { width: 780, height: 'auto' },
    content: `<div id="mv-affinity-layout"><div data-mv-aff-body>${affinityView(actor, journal)}</div></div>`,
    buttons: [{ action: 'close', label: 'Fechar', callback: () => null }],
    rejectClose: false
  });
  dialogs.set(journal.id, dialog);
  await dialog.render(true);
  const root = dialog.element?.querySelector('[data-mv-aff-body]');
  root?.addEventListener('click', e => void handleClick(e, journal, dialog));
  root?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target?.matches('[data-mv-aff-name]')) {
      e.preventDefault(); root.querySelector('[data-aff-action="add"]')?.click();
    }
  });
  return dialog;
}

// O Foundry 14 renderiza o Journal por partes e não garante uma classe `.sidebar`.
// Identificar o botão pelo seu próprio controle evita depender da árvore do tema.
const ADD_PAGE_SELECTORS = [
  '[data-action="createPageDialog"]', '[data-action="createPage"]',
  '[data-action="addPage"]', '[data-action="create-page"]',
  'button.create-page', 'button.add-page', '[data-tooltip="JOURNAL.AddPage"]'
];
const ADD_PAGE_LABEL = /(?:^|\s)(?:add page|adicionar p[aá]gina|nova p[aá]gina)(?:\s|$)/i;

function locateAddPage(root) {
  for (const selector of ADD_PAGE_SELECTORS) {
    const candidate = root.querySelector(selector);
    if (candidate) return candidate;
  }
  return [...root.querySelectorAll('button, a, [role="button"]')].find(node => {
    const labels = [node.textContent, node.getAttribute('aria-label'), node.getAttribute('title')];
    return labels.some(label => ADD_PAGE_LABEL.test(String(label ?? '').replace(/\s+/g, ' ').trim()));
  }) ?? null;
}

function journalOfSheet(app) {
  for (const candidate of [app?.document, app?.entry, app?.object]) {
    if (candidate?.documentName === 'JournalEntry') return candidate;
    // Compatibilidade com aplicações de Journal que não expõem `documentName` no mock.
    if (candidate?.id && game.journal?.get(candidate.id) === candidate) return candidate;
  }
  return null;
}

export function injectAffinityButton(app, element) {
  const journal = journalOfSheet(app);
  const actor = affinityJournalActor(journal);
  if (!actor || !canEditJournalAffinity(journal, actor)) return false;
  const possibleRoots = [element?.[0], element, app?.element].filter(root => root?.querySelector);
  for (const root of possibleRoots) {
    if (root.querySelector('.mv-aff-journal-action')) return true;
    const addPage = locateAddPage(root);
    if (!addPage) continue;
    // O controle inferior (anterior / Add Page / próximo) é preservado inteiro.
    // Preferimos inserir antes da barra, mas não dependemos da classe do sidebar.
    const footer = addPage.closest('footer, .sidebar-footer, .journal-footer, .page-controls, .page-navigation, .footer-controls, .page-buttons, .toc-footer');
    const location = footer && footer !== root ? footer : (addPage.parentElement && addPage.parentElement !== root ? addPage.parentElement : addPage);
    if (!location.parentElement) continue;
    if (location.parentElement.querySelector(':scope > .mv-aff-journal-action')) return true;
    ensureStyles();
    const wrapper = document.createElement('div');
    wrapper.className = 'mv-aff-journal-action';
    wrapper.style.cssText = 'box-sizing:border-box;width:100%;flex:0 0 auto;margin:0 0 8px;padding:0 8px;';
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'mv-aff-journal-button';
    button.style.cssText = 'width:100%;min-height:33px;display:flex;align-items:center;justify-content:center;gap:8px;margin:0;';
    button.innerHTML = '<i class="fa-solid fa-heart" aria-hidden="true"></i> Afinidades';
    button.addEventListener('click', () => void openAffinityJournal(journal).catch(report));
    wrapper.append(button);
    location.before(wrapper);
    return true;
  }
  return false;
}

function isJournalEntrySheet(app) {
  return Boolean(journalOfSheet(app) && (
    app?.constructor?.name?.includes('Journal') ||
    app?.document?.documentName === 'JournalEntry' ||
    app?.entry?.documentName === 'JournalEntry'
  ));
}

function onJournalRender(app, element) {
  if (!isJournalEntrySheet(app)) return;
  // O hook V2 pode entregar HTML parcial ainda fora do DOM. Tentar imediatamente
  // e uma segunda vez depois da inserção/reconciliação das partes do Journal.
  injectAffinityButton(app, element);
  if (typeof setTimeout === 'function') setTimeout(() => {
    if (app?.rendered) injectAffinityButton(app, app.element);
  }, 0);
}

export function registerAffinityJournals() {
  ensureStyles();
  Hooks.on('renderJournalEntrySheet', onJournalRender);
  Hooks.on('renderJournalSheet', onJournalRender); // Compatibilidade com a ficha antiga
  Hooks.on('renderApplicationV2', onJournalRender);
  Hooks.on('updateSetting', setting => {
    if (setting?.key !== `${SYSTEM_ID}.partyRegistryV1`) return;
    for (const [journalId, dialog] of dialogs) {
      if (!dialog?.rendered) { dialogs.delete(journalId); continue; }
      const journal = game.journal?.get(journalId);
      if (journal) try { updateWindow(journal, dialog); } catch(error) { report(error); }
    }
  });
  Hooks.on('updateJournalEntry', journal => {
    const dialog = dialogs.get(journal?.id);
    if (dialog?.rendered) {
      try { updateWindow(journal, dialog); } catch(error) { report(error); }
    }
  });
}
