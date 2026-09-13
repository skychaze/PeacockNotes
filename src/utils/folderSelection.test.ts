import { normalizeFolderIds } from './folderDeletion';
import { reconcileFolderSelection, toggleFolderSelection } from './folderSelection';

const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };

const selected = toggleFolderSelection(new Set<number>(), 4);
assert(selected.has(4), 'selecting a folder must add its ID');
assert(!toggleFolderSelection(selected, 4).has(4), 'selecting a selected folder must remove its ID');
assert([...reconcileFolderSelection(new Set([1, 2]), new Set([2, 3]))].join() === '2', 'refresh must remove stale selection IDs');
assert(normalizeFolderIds([3, 3, 0, -1, 2.5, 4]).join() === '3,4', 'batch deletion must only receive unique positive integer IDs');
