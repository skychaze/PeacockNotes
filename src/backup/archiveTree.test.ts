import { buildArchiveTree, folderCheckState, toggleArchiveNotes } from './archiveTree';

const folders = [{ portableId: 'a', parentPortableId: null, name: 'A', path: ['A'], sortOrder: 1 }, { portableId: 'b', parentPortableId: 'a', name: 'B', path: ['A', 'B'], sortOrder: 1 }] as const;
const notes = [{ portableId: 'one', folderPortableId: 'a', title: 'One', contentPreview: '', updatedAt: '', audioCount: 0, fileCount: 0 }, { portableId: 'two', folderPortableId: 'b', title: 'Two', contentPreview: '', updatedAt: '', audioCount: 0, fileCount: 0 }] as const;

const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
const tree = buildArchiveTree(folders, notes);
assert(tree[0].children[0].descendantNoteIds[0] === 'two', 'nested folder must retain its portable parent');
assert(folderCheckState(tree[0].descendantNoteIds, new Set(['one'])) === 'indeterminate', 'partial folder selection must be indeterminate');
assert(toggleArchiveNotes(new Set(['one']), tree[0].descendantNoteIds, true).has('two'), 'folder selection must add descendants');
