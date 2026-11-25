// Multiverso RPG 1.0.8 — Diários automáticos para personagens.
// Somente os diários sinalizados pelo sistema são sincronizados; Journals manuais
// já existentes não são renomeados, movidos, apagados ou reivindicados.
const SYSTEM_ID = 'multiverso-rpg';
const ACTOR_LINK = 'autoDiaryJournalId';
const JOURNAL_LINK = 'autoDiaryActorId';
const OWNER = 3; // CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
const NONE = 0;
const runningByActor = new Map();
let folderCreation = null;

export function normalizeFolderLabel(value) {
  return String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

export function isDiaryFolder(folder) {
  return folder?.type === 'JournalEntry' && normalizeFolderLabel(folder.name) === 'diarios';
}

export function automaticDiaryName(actor) {
  const name = String(actor?.name ?? '').trim() || 'Personagem';
  return `Diário — ${name}`;
}

// Apenas OWNER pode modificar o diário. Permissões de leitura de terceiros
// não são copiadas: os registros pessoais permanecem privados.
export function diaryOwnershipForActor(actor, users) {
  const ownership = { default: NONE };
  for (const user of (users ?? [])) {
    if (!user?.id || user.isGM) continue;
    ownership[user.id] = actor.testUserPermission(user, 'OWNER') ? OWNER : NONE;
  }
  return ownership;
}

function primaryGM() {
  if (!game.user?.isGM) return false;
  const activeGMs = (game.users?.contents ?? []).filter(user => user.isGM && user.active);
  if (!activeGMs.length) return true;
  activeGMs.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return activeGMs[0].id === game.user.id;
}

function journalActorId(journal) {
  return journal?.getFlag?.(SYSTEM_ID, JOURNAL_LINK) ?? null;
}

export function findManagedJournal(actor) {
  const referenced = actor.getFlag?.(SYSTEM_ID, ACTOR_LINK);
  const linked = referenced ? game.journal?.get(referenced) : null;
  if (linked && journalActorId(linked) === actor.id) return linked;
  return (game.journal?.contents ?? []).find(entry => journalActorId(entry) === actor.id) ?? null;
}

async function ensureDiaryFolder() {
  const folders = game.folders?.contents ?? [];
  const existing = folders.filter(isDiaryFolder).sort((a, b) => Number(Boolean(a.folder)) - Number(Boolean(b.folder)))[0];
  if (existing) return existing;
  if (folderCreation) return folderCreation;
  folderCreation = Folder.create({ name: 'Diários', type: 'JournalEntry' });
  try {
    const created = await folderCreation;
    if (!created) throw new Error('O Foundry não conseguiu criar a pasta Diários.');
    return created;
  } finally {
    folderCreation = null;
  }
}

async function synchronizeManagedDiary(actor, journal) {
  const expected = diaryOwnershipForActor(actor, game.users?.contents);
  const old = journal.ownership ?? {};
  // O Foundry mescla atualizações parciais de ownership. Declarar explicitamente
  // os usuários antigos evita deixar acesso de OWNER depois de uma troca de dono.
  const merged = { default: NONE };
  for (const id of Object.keys(old)) if (id !== 'default') merged[id] = NONE;
  for (const [id, level] of Object.entries(expected)) merged[id] = level;
  const changes = {};
  // Jornals antigos vinculados manualmente mantêm seu nome original.
  if (!journal.getFlag?.(SYSTEM_ID, 'autoDiaryKeepName') && journal.name !== automaticDiaryName(actor)) changes.name = automaticDiaryName(actor);
  if (Object.keys(merged).some(id => Number(old[id] ?? NONE) !== Number(merged[id]))) changes.ownership = merged;
  if (Object.keys(changes).length) await journal.update(changes);
  if (actor.getFlag?.(SYSTEM_ID, ACTOR_LINK) !== journal.id) await actor.setFlag(SYSTEM_ID, ACTOR_LINK, journal.id);
  return journal;
}

/**
 * create=true no nascimento OU na criação manual retroativa. Ao iniciar o mundo,
 * reconciliamos APENAS diários gerenciados que já existem, para não criar
 * duplicatas dos Journals antigos feitos manualmente pelos jogadores.
 */
export async function ensureActorDiary(actor, { create = false } = {}) {
  if (!actor || actor.type !== 'personagem' || actor.pack || !primaryGM()) return null;
  if (runningByActor.has(actor.id)) return runningByActor.get(actor.id);
  const pending = (async () => {
    let journal = findManagedJournal(actor);
    if (journal) return synchronizeManagedDiary(actor, journal);
    if (!create) return null;
    const folder = await ensureDiaryFolder();
    // Uma segunda consulta após a operação assíncrona protege contra duplicação.
    journal = findManagedJournal(actor);
    if (journal) return synchronizeManagedDiary(actor, journal);
    const created = await JournalEntry.create({
      name: automaticDiaryName(actor),
      folder: folder.id,
      ownership: diaryOwnershipForActor(actor, game.users?.contents),
      flags: { [SYSTEM_ID]: { [JOURNAL_LINK]: actor.id, autoDiarySchema: 1 } },
      pages: [{ name: 'Primeira página', type: 'text', text: { content: '', format: 1 } }]
    });
    if (!created) throw new Error('O Foundry não conseguiu criar o Journal do personagem.');
    await actor.setFlag(SYSTEM_ID, ACTOR_LINK, created.id);
    return created;
  })();
  runningByActor.set(actor.id, pending);
  try { return await pending; }
  finally { runningByActor.delete(actor.id); }
}

/**
 * Vincula um Journal EXISTENTE a uma ficha já existente. Nenhuma página é
 * recriada ou sobrescrita. O nome escolhido anteriormente é preservado;
 * somente a organização na pasta Diários, os vínculos e as permissões de
 * proprietários são sincronizados.
 */
export async function linkExistingDiary(actor, journal) {
  if (!primaryGM()) throw new Error('Somente o mestre responsável pode vincular diários.');
  if (!actor || actor.type !== 'personagem' || actor.pack || game.actors?.get(actor.id) !== actor) {
    throw new Error('Selecione uma ficha de personagem válida deste mundo.');
  }
  if (!journal || journal.pack || game.journal?.get(journal.id) !== journal) {
    throw new Error('Selecione um Journal existente neste mundo.');
  }
  const existing = findManagedJournal(actor);
  if (existing) throw new Error(`A ficha ${actor.name} já possui um diário vinculado. Desvincule primeiro se desejar substituí-lo.`);
  const linkedActorId = journalActorId(journal);
  if (linkedActorId) throw new Error('Este Journal já está vinculado a uma ficha. Desvincule-o primeiro.');
  if (runningByActor.has(actor.id)) throw new Error('Aguarde a operação atual deste personagem.');
  const operation = (async () => {
    const folder = await ensureDiaryFolder();
    // Garantias reavaliadas depois do await: nenhum vínculo pode ser roubado.
    if (journalActorId(journal) || findManagedJournal(actor)) throw new Error('O vínculo mudou durante a operação. Reabra o gerenciador.');
    const oldOwnership = journal.ownership ?? {};
    const desired = diaryOwnershipForActor(actor, game.users?.contents);
    const ownership = { default: NONE };
    for (const id of Object.keys(oldOwnership)) if (id !== 'default') ownership[id] = NONE;
    for (const [id, level] of Object.entries(desired)) ownership[id] = level;
    const flags = {
      ...(journal.flags ?? {}),
      [SYSTEM_ID]: {
        ...(journal.flags?.[SYSTEM_ID] ?? {}),
        [JOURNAL_LINK]: actor.id,
        autoDiarySchema: 2,
        autoDiaryKeepName: true
      }
    };
    await journal.update({ flags, folder: folder.id, ownership });
    await actor.setFlag(SYSTEM_ID, ACTOR_LINK, journal.id);
    return journal;
  })();
  runningByActor.set(actor.id, operation);
  try { return await operation; }
  finally { runningByActor.delete(actor.id); }
}

/** Desvincula sem excluir o Journal, suas páginas ou a ficha. */
export async function unlinkDiary(actor) {
  if (!primaryGM()) throw new Error('Somente o mestre responsável pode desvincular diários.');
  if (!actor || actor.type !== 'personagem' || game.actors?.get(actor.id) !== actor) throw new Error('Personagem inválido.');
  if (runningByActor.has(actor.id)) throw new Error('Aguarde a operação atual deste personagem.');
  const operation = (async () => {
    const journal = findManagedJournal(actor);
    if (!journal) throw new Error('Esta ficha não possui um diário vinculado.');
    const flags = {
      ...(journal.flags ?? {}),
      [SYSTEM_ID]: { ...(journal.flags?.[SYSTEM_ID] ?? {}), [JOURNAL_LINK]: null }
    };
    await journal.update({ flags });
    if (actor.unsetFlag) await actor.unsetFlag(SYSTEM_ID, ACTOR_LINK);
    else await actor.setFlag(SYSTEM_ID, ACTOR_LINK, null);
    return journal;
  })();
  runningByActor.set(actor.id, operation);
  try { return await operation; }
  finally { runningByActor.delete(actor.id); }
}

function safeSync(actor, options) {
  void ensureActorDiary(actor, options).catch(error => {
    console.error(`Multiverso RPG | Falha ao sincronizar diário de ${actor?.name ?? 'personagem'}:`, error);
    if (game.user?.isGM) ui.notifications?.warn(`Não foi possível sincronizar o diário de ${actor?.name ?? 'personagem'}. Consulte o console.`);
  });
}

export function registerAutoDiaries() {
  Hooks.on('createActor', actor => safeSync(actor, { create: true }));
  Hooks.on('updateActor', (actor, changes) => {
    if (!Object.hasOwn(changes ?? {}, 'name') && !Object.hasOwn(changes ?? {}, 'ownership')) return;
    safeSync(actor, { create: false });
  });
  Hooks.once('ready', () => {
    if (!primaryGM()) return;
    // Repara vínculos/permissões de Journals AUTOMÁTICOS já existentes.
    for (const actor of game.actors?.contents ?? []) {
      if (actor.type !== 'personagem') continue;
      if (findManagedJournal(actor)) safeSync(actor, { create: false });
    }
  });
}
