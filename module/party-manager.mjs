// Multiverso RPG 1.0.7 — Cadastro universal de equipes (Party) e interface revisada.
// Não altera fichas nem Journals. Os próximos sistemas podem consultar este registro.
const SYSTEM_ID = 'multiverso-rpg';
const SETTING_KEY = 'partyRegistryV1';
const NAME_LIMIT = 60;
const PARTY_STYLE_URL = `systems/${SYSTEM_ID}/styles/party-manager-v1.0.7.css?v=1.0.7`;

// Carregamento explícito: o Foundry pode manter o manifest de estilos em cache
// durante a atualização do sistema. O link versionado funciona sem reiniciar o servidor.
function ensurePartyStyles() {
  if (typeof document === 'undefined' || !document.head) return;
  if (document.querySelector('link[data-mv-party-styles="1"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = PARTY_STYLE_URL;
  link.dataset.mvPartyStyles = '1';
  document.head.append(link);
}


const cleanName = value => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, NAME_LIMIT);
const sameName = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' }) === 0;
const unique = values => [...new Set(values)];
const html = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

/** Validate persisted data without changing the original setting object. */
export function normalizePartyRegistry(value) {
  const parties = [];
  const ids = new Set();
  const takenActors = new Set();
  for (const entry of (Array.isArray(value?.parties) ? value.parties : [])) {
    if (!entry || typeof entry !== 'object') continue;
    const id = String(entry.id ?? '').trim();
    const name = cleanName(entry.name);
    if (!id || !name || ids.has(id)) continue;
    ids.add(id);
    const memberIds = [];
    for (const actorId of unique((Array.isArray(entry.memberIds) ? entry.memberIds : []).map(x => String(x ?? '').trim()).filter(Boolean))) {
      if (takenActors.has(actorId)) continue;
      takenActors.add(actorId);
      memberIds.push(actorId);
    }
    parties.push({ id, name, memberIds });
  }
  return { schema: 1, parties };
}

export function createParty(registry, name, makeId) {
  const current = normalizePartyRegistry(registry);
  const cleaned = cleanName(name);
  if (!cleaned) throw new Error('Informe o nome da equipe.');
  if (current.parties.some(p => sameName(p.name, cleaned))) throw new Error('Já existe uma equipe com esse nome.');
  const id = makeId();
  if (current.parties.some(p => p.id === id)) throw new Error('Identificador de equipe duplicado.');
  return { schema: 1, parties: [...current.parties, { id, name: cleaned, memberIds: [] }] };
}

export function renameParty(registry, partyId, name) {
  const current = normalizePartyRegistry(registry);
  const cleaned = cleanName(name);
  if (!cleaned) throw new Error('Informe o novo nome da equipe.');
  if (current.parties.some(p => p.id !== partyId && sameName(p.name, cleaned))) throw new Error('Já existe uma equipe com esse nome.');
  const party = current.parties.find(p => p.id === partyId);
  if (!party) throw new Error('Equipe não encontrada.');
  party.name = cleaned;
  return current;
}

export function deleteParty(registry, partyId) {
  const current = normalizePartyRegistry(registry);
  if (!current.parties.some(p => p.id === partyId)) throw new Error('Equipe não encontrada.');
  current.parties = current.parties.filter(p => p.id !== partyId);
  return current;
}

export function addPartyMember(registry, partyId, actorId, actorExists = () => true) {
  const current = normalizePartyRegistry(registry);
  const party = current.parties.find(p => p.id === partyId);
  if (!party) throw new Error('Equipe não encontrada.');
  if (!actorId || !actorExists(actorId)) throw new Error('Selecione um personagem válido.');
  if (party.memberIds.includes(actorId)) throw new Error('Este personagem já está nesta equipe.');
  const other = current.parties.find(p => p.id !== partyId && p.memberIds.includes(actorId));
  if (other) throw new Error(`Este personagem já pertence à equipe ${other.name}.`);
  party.memberIds.push(actorId);
  return current;
}

export function removePartyMember(registry, partyId, actorId) {
  const current = normalizePartyRegistry(registry);
  const party = current.parties.find(p => p.id === partyId);
  if (!party) throw new Error('Equipe não encontrada.');
  party.memberIds = party.memberIds.filter(id => id !== actorId);
  return current;
}

export function getPartyForActor(actorId, registry = readPartyRegistry()) {
  return normalizePartyRegistry(registry).parties.find(p => p.memberIds.includes(String(actorId ?? ''))) ?? null;
}

export function readPartyRegistry() {
  return normalizePartyRegistry(game.settings.get(SYSTEM_ID, SETTING_KEY));
}

async function savePartyRegistry(updated) {
  if (!game.user?.isGM) throw new Error('Somente o mestre pode administrar equipes.');
  await game.settings.set(SYSTEM_ID, SETTING_KEY, normalizePartyRegistry(updated));
}

function availableActors() {
  return [...(game.actors?.contents ?? [])].filter(actor => actor.type === 'personagem').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

let openedDialog = null;
let selectedPartyId = null;
let busy = false;

function partyView() {
  const data = readPartyRegistry();
  const allActors = availableActors();
  if (!data.parties.some(p => p.id === selectedPartyId)) selectedPartyId = data.parties[0]?.id ?? null;
  const selected = data.parties.find(p => p.id === selectedPartyId);
  const alreadyAssigned = new Set(data.parties.flatMap(p => p.memberIds));
  const eligible = allActors.filter(actor => !alreadyAssigned.has(actor.id));
  const choices = data.parties.map(p => `<button type="button" class="mv-party-tab ${selected?.id === p.id ? 'selected' : ''}" data-party-action="select" data-party-id="${html(p.id)}" aria-pressed="${selected?.id === p.id}">
    <i class="fa-solid fa-people-group" aria-hidden="true"></i><span>${html(p.name)}</span><small>${p.memberIds.length}</small></button>`).join('');
  const members = (selected?.memberIds ?? []).map(actorId => {
    const actor = game.actors?.get(actorId);
    const name = actor?.name ?? 'Personagem não encontrado';
    return `<div class="mv-party-member"><img src="${html(actor?.img || 'icons/svg/mystery-man.svg')}" alt="" loading="lazy" />
      <div class="mv-party-member-name"><strong>${html(name)}</strong>${actor ? '<small>Ficha vinculada</small>' : '<small>Ficha ausente — pode remover este vínculo</small>'}</div>
      <button type="button" data-party-action="remove" data-actor-id="${html(actorId)}" title="Remover da equipe" aria-label="Remover ${html(name)}"><i class="fa-solid fa-user-minus" aria-hidden="true"></i></button></div>`;
  }).join('');
  const addOptions = eligible.map(actor => `<option value="${html(actor.id)}">${html(actor.name)}</option>`).join('');
  return `<div class="mv-party-manager-content">
    <header class="mv-party-banner"><i class="fa-solid fa-users" aria-hidden="true"></i><div><strong>Gerenciador de Equipes</strong><small>Cadastre os grupos de personagens para o futuro Diário e as Afinidades.</small></div></header>
    <div class="mv-party-create"><label for="mv-party-new-name">Nova equipe</label><div class="mv-party-field-row"><input id="mv-party-new-name" type="text" maxlength="${NAME_LIMIT}" placeholder="Ex.: Party principal" autocomplete="off"/><button type="button" data-party-action="create"><i class="fa-solid fa-plus" aria-hidden="true"></i> Criar</button></div></div>
    <div class="mv-party-columns"><nav class="mv-party-list" aria-label="Equipes cadastradas"><h3>Equipes <span>${data.parties.length}</span></h3>${choices || '<p class="mv-party-muted">Nenhuma equipe cadastrada.</p>'}</nav>
    <section class="mv-party-details">${selected ? `<div class="mv-party-details-title"><h3>${html(selected.name)}</h3><span>${selected.memberIds.length} membro(s)</span></div>
      <label for="mv-party-rename">Nome da equipe</label><div class="mv-party-field-row"><input id="mv-party-rename" type="text" maxlength="${NAME_LIMIT}" value="${html(selected.name)}" /><button type="button" data-party-action="rename" title="Renomear equipe"><i class="fa-solid fa-pen" aria-hidden="true"></i> Renomear</button></div>
      <h4>Integrantes</h4><div class="mv-party-members">${members || '<p class="mv-party-muted">Nenhum personagem nesta equipe.</p>'}</div>
      <label for="mv-party-add-actor">Adicionar personagem</label><div class="mv-party-field-row"><select id="mv-party-add-actor" ${eligible.length ? '' : 'disabled'}>${addOptions || '<option value="">Nenhum personagem disponível</option>'}</select><button type="button" data-party-action="add" ${eligible.length ? '' : 'disabled'}><i class="fa-solid fa-user-plus" aria-hidden="true"></i> Adicionar</button></div>
      <div class="mv-party-danger-zone"><button type="button" data-party-action="delete"><i class="fa-solid fa-trash" aria-hidden="true"></i> Excluir equipe</button></div>` : `<div class="mv-party-empty"><i class="fa-solid fa-users" aria-hidden="true"></i><strong>Crie uma equipe para começar.</strong><span>Depois, selecione os personagens que fazem parte dela.</span></div>`}</section></div>
    <p class="mv-party-footnote">A equipe é salva no mundo do Foundry. Esta etapa não cria diários nem altera fichas, permissões ou Afinidades.</p>
  </div>`;
}

function refreshView(dialog) {
  const root = dialog.element?.querySelector('[data-mv-party-body]');
  if (root) root.innerHTML = partyView();
}

async function handlePartyAction(event, dialog) {
  const button = event.target.closest('[data-party-action]');
  if (!button || busy || !game.user?.isGM) return;
  const action = button.dataset.partyAction;
  const root = dialog.element?.querySelector('[data-mv-party-body]');
  if (action === 'select') {
    selectedPartyId = button.dataset.partyId;
    refreshView(dialog);
    return;
  }
  const registry = readPartyRegistry();
  const party = registry.parties.find(p => p.id === selectedPartyId);
  try {
    let result;
    if (action === 'create') {
      const name = root?.querySelector('#mv-party-new-name')?.value;
      result = createParty(registry, name, () => foundry.utils.randomID());
      selectedPartyId = result.parties.at(-1).id;
    } else if (action === 'rename') {
      result = renameParty(registry, selectedPartyId, root?.querySelector('#mv-party-rename')?.value);
    } else if (action === 'add') {
      const actorId = root?.querySelector('#mv-party-add-actor')?.value;
      result = addPartyMember(registry, selectedPartyId, actorId, id => game.actors?.get(id)?.type === 'personagem');
    } else if (action === 'remove') {
      result = removePartyMember(registry, selectedPartyId, button.dataset.actorId);
    } else if (action === 'delete') {
      const accepted = await foundry.applications.api.DialogV2.confirm({
        window: { title: 'Excluir equipe?' },
        content: `<p>Excluir a equipe <strong>${html(party?.name)}</strong>?</p><p>As fichas dos personagens não serão excluídas.</p>`,
        yes: { label: 'Excluir equipe' }, no: { label: 'Cancelar' }, rejectClose: false
      });
      if (!accepted) return;
      result = deleteParty(registry, selectedPartyId);
      selectedPartyId = result.parties[0]?.id ?? null;
    } else return;
    busy = true;
    await savePartyRegistry(result);
    refreshView(dialog);
  } catch (error) {
    console.error('Multiverso RPG | Gerenciador de Equipes:', error);
    ui.notifications?.error(error?.message || 'Erro ao salvar equipe.');
  } finally { busy = false; }
}

export async function openPartyManager() {
  if (!game.user?.isGM) return;
  ensurePartyStyles();
  if (openedDialog?.rendered) {
    openedDialog.bringToFront();
    return openedDialog;
  }
  const dialog = new foundry.applications.api.DialogV2({
    classes: ['mv-party-manager-window'],
    window: { title: 'Multiverso RPG • Gerenciar Equipe', resizable: true, minimizable: true },
    // Deixa o Foundry dimensionar a janela pelo conteúdo já existente.
    // O CSS limita o tamanho à tela e habilita rolagem em janelas menores.
    position: { width: 760, height: "auto" },
    content: `<div id="mv-party-layout" class="mv-party-dialog"><div data-mv-party-body>${partyView()}</div></div>`,
    buttons: [{ action: 'close', label: 'Fechar', callback: () => null }],
    rejectClose: false
  });
  openedDialog = dialog;
  await dialog.render(true);
  const root = dialog.element?.querySelector('[data-mv-party-body]');
  root?.addEventListener('click', event => { void handlePartyAction(event, dialog); });
  root?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    if (event.target?.id === 'mv-party-new-name') {
      event.preventDefault();
      root.querySelector('[data-party-action="create"]')?.click();
    } else if (event.target?.id === 'mv-party-rename') {
      event.preventDefault();
      root.querySelector('[data-party-action="rename"]')?.click();
    }
  });
  // O conteúdo inicial já estava presente no primeiro render, evitando uma
  // medição de altura antes de popular a janela.
  return dialog;
}

function injectPartyButton(app, element) {
  if (!game.user?.isGM) return;
  const root = (element?.[0] ?? element ?? app?.element);
  if (!root?.querySelector) return;
  if (root.querySelector('.mv-party-directory-action')) return;
  const actions = root.querySelector('.directory-header .header-actions, .directory-header .action-buttons, .header-actions, .action-buttons');
  const header = actions?.closest('.directory-header') ?? root.querySelector('.directory-header');
  if (!header) return;
  const row = document.createElement('div');
  row.className = 'mv-party-directory-action';
  // Tamanho/margens essenciais mesmo antes de o CSS carregar.
  row.style.cssText = 'box-sizing:border-box;display:block;flex:0 0 100%;grid-column:1/-1;width:100%;padding:0;margin:0;';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mv-party-directory-button';
  button.style.cssText = 'box-sizing:border-box;display:flex;justify-content:center;align-items:center;gap:8px;width:100%;min-height:33px;margin:0;border-radius:6px;';
  button.innerHTML = '<i class="fa-solid fa-people-group" aria-hidden="true"></i> Gerenciar Equipe';
  button.addEventListener('click', () => { void openPartyManager().catch(error => {
    console.error('Multiverso RPG | Falha ao abrir gerenciador:', error);
    ui.notifications?.error('Não foi possível abrir o gerenciador de equipes.');
  }); });
  row.append(button);
  if (actions) {
    // O botão faz parte da própria faixa de ações do Foundry. Inseri-lo
    // após essa faixa criava uma linha de layout extra e o espaço vazio.
    actions.classList.add('mv-party-action-host');
    actions.append(row);
  } else {
    // Compatibilidade defensiva com temas que não forneçam action-buttons.
    header.classList.add('mv-party-directory-header');
    header.prepend(row);
  }
}

/** Register during init; the directory injection is idempotent across rerenders. */
export function registerPartyManager() {
  ensurePartyStyles();
  game.settings.register(SYSTEM_ID, SETTING_KEY, {
    name: 'Equipes do Multiverso',
    hint: 'Cadastro de equipes usado futuramente pelos Diários e Afinidades.',
    scope: 'world', config: false, type: Object,
    default: { schema: 1, parties: [] }
  });
  Hooks.on('renderJournalDirectory', injectPartyButton);
  // Explicit fallback for v14 ApplicationV2 and detached sidebar tabs.
  Hooks.on('renderApplicationV2', (app, element) => {
    if (app?.constructor?.name === 'JournalDirectory') injectPartyButton(app, element);
  });
  Hooks.once('ready', () => {
    const app = ui.journal;
    if (app?.element) injectPartyButton(app, app.element);
  });
}
