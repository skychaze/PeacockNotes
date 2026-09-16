import type { ArchivedFolderPreview, ArchivedNotePreview } from '../services/archive';
import { buildArchiveTree, folderCheckState, resolvePreviewFolders, toggleArchiveNotes } from './archiveTree';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const folder = (
  portableId: string,
  parentPortableId: string | null,
  sortOrder = 1,
): ArchivedFolderPreview => ({
  portableId,
  parentPortableId,
  name: portableId,
  path: [portableId],
  sortOrder,
});

const note = (portableId: string, folderPortableId: string): ArchivedNotePreview => ({
  portableId,
  folderPortableId,
  title: portableId,
  contentPreview: '',
  updatedAt: '',
  audioCount: 0,
  fileCount: 0,
});

export function testTreeKeepsHierarchyAndArchiveOrder() {
  const tree = buildArchiveTree(
    [folder('work', null), folder('drafts', 'work'), folder('personal', null, 2)],
    [note('one', 'work'), note('two', 'drafts'), note('three', 'personal')],
  );
  assert(tree.length === 2, 'root folders must be grouped at the top level');
  assert(tree[0].portableId === 'work' && tree[1].portableId === 'personal', 'roots must follow archive sort order');
  assert(tree[0].children[0].portableId === 'drafts', 'nested folder must attach to its portable parent');
  assert(
    tree[0].descendantNoteIds.join(',') === 'one,two',
    'folder selection set must include notes from nested folders',
  );
}

export function testMissingParentFallsBackToRoot() {
  const tree = buildArchiveTree([folder('orphan', 'absent')], [note('one', 'orphan')]);
  assert(tree.length === 1 && tree[0].portableId === 'orphan', 'folder with a missing parent must still render');
}

export function testFolderCheckStateCoversEveryTriState() {
  const ids = ['one', 'two'];
  assert(folderCheckState(ids, new Set()) === 'unchecked', 'empty selection must be unchecked');
  assert(folderCheckState(ids, new Set(['one'])) === 'indeterminate', 'partial selection must be indeterminate');
  assert(folderCheckState(ids, new Set(ids)) === 'checked', 'full selection must be checked');
  assert(folderCheckState([], new Set()) === 'disabled', 'folder without notes must be disabled');
}

export function testFolderToggleExpandsToDescendantNoteIds() {
  const tree = buildArchiveTree(
    [folder('work', null), folder('drafts', 'work')],
    [note('one', 'work'), note('two', 'drafts')],
  );
  const all = tree[0].descendantNoteIds;
  const selected = toggleArchiveNotes(new Set(['unrelated']), all, true);
  assert(selected.has('one') && selected.has('two'), 'checking a folder must select every descendant note');
  assert(selected.has('unrelated'), 'folder toggle must not disturb unrelated selections');
  const cleared = toggleArchiveNotes(selected, all, false);
  assert(!cleared.has('one') && !cleared.has('two') && cleared.has('unrelated'), 'unchecking a folder must clear only its descendants');
}

export function testOlderPreviewWithoutFolderListStillRendersFlat() {
  const notes = [{ ...note('one', 'folder-a'), folderName: 'Work' }];
  const resolved = resolvePreviewFolders({ folders: undefined, notes });
  assert(resolved.length === 1 && resolved[0].name === 'Work', 'notes without a folder list must fall back to flat folders');
  const tree = buildArchiveTree(resolved, notes);
  assert(tree[0].descendantNoteIds[0] === 'one', 'fallback folders must own their notes');
}

export function runArchiveTreeTests() {
  testTreeKeepsHierarchyAndArchiveOrder();
  testMissingParentFallsBackToRoot();
  testFolderCheckStateCoversEveryTriState();
  testFolderToggleExpandsToDescendantNoteIds();
  testOlderPreviewWithoutFolderListStillRendersFlat();
}

void Promise.resolve(runArchiveTreeTests()).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
