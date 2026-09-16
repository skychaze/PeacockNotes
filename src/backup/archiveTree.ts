import type { ArchivedFolderPreview, ArchivedNotePreview, ImportPreview } from '../services/archive';

export type ArchiveTreeFolder = ArchivedFolderPreview & Readonly<{
  children: readonly ArchiveTreeFolder[];
  notes: readonly ArchivedNotePreview[];
  descendantNoteIds: readonly string[];
}>;

export type CheckState = 'checked' | 'unchecked' | 'indeterminate' | 'disabled';

// Binaries before the folder tree return notes without a folder list, and an
// OTA bundle can run on them, so rebuild flat folder rows from the notes.
export const resolvePreviewFolders = (
  preview: Pick<ImportPreview, 'notes'> & { folders?: ImportPreview['folders'] },
): readonly ArchivedFolderPreview[] => {
  if (preview.folders?.length) return preview.folders;
  const folders = new Map<string, ArchivedFolderPreview>();
  for (const note of preview.notes) {
    if (folders.has(note.folderPortableId)) continue;
    const name = note.folderName ?? note.folderPortableId;
    folders.set(note.folderPortableId, {
      portableId: note.folderPortableId,
      parentPortableId: null,
      name,
      path: [name],
      sortOrder: folders.size,
    });
  }
  return [...folders.values()];
};

const byArchiveOrder = (left: ArchivedFolderPreview, right: ArchivedFolderPreview): number =>
  left.sortOrder - right.sortOrder || left.portableId.localeCompare(right.portableId);

// Builds the visible hierarchy. A folder whose parent is missing from the
// archive becomes a root so legacy or damaged archives still render fully.
export const buildArchiveTree = (
  folders: readonly ArchivedFolderPreview[],
  notes: readonly ArchivedNotePreview[],
): readonly ArchiveTreeFolder[] => {
  const folderIds = new Set(folders.map((folder) => folder.portableId));
  const children = new Map<string | null, ArchivedFolderPreview[]>();
  for (const folder of folders) {
    const parentId = folder.parentPortableId && folderIds.has(folder.parentPortableId)
      ? folder.parentPortableId
      : null;
    children.set(parentId, [...(children.get(parentId) ?? []), folder]);
  }

  const notesByFolder = new Map<string, ArchivedNotePreview[]>();
  for (const note of notes) {
    notesByFolder.set(note.folderPortableId, [...(notesByFolder.get(note.folderPortableId) ?? []), note]);
  }

  const make = (folder: ArchivedFolderPreview): ArchiveTreeFolder => {
    const nested = (children.get(folder.portableId) ?? []).sort(byArchiveOrder).map(make);
    const ownNotes = notesByFolder.get(folder.portableId) ?? [];
    return {
      ...folder,
      children: nested,
      notes: ownNotes,
      descendantNoteIds: [...ownNotes.map((note) => note.portableId), ...nested.flatMap((child) => child.descendantNoteIds)],
    };
  };

  return (children.get(null) ?? []).sort(byArchiveOrder).map(make);
};

export const folderCheckState = (noteIds: readonly string[], selected: ReadonlySet<string>): CheckState => {
  if (noteIds.length === 0) return 'disabled';
  const count = noteIds.filter((id) => selected.has(id)).length;
  if (count === 0) return 'unchecked';
  return count === noteIds.length ? 'checked' : 'indeterminate';
};

export const toggleArchiveNotes = (
  selected: ReadonlySet<string>,
  noteIds: readonly string[],
  checked: boolean,
): ReadonlySet<string> => {
  const next = new Set(selected);
  for (const id of noteIds) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  return next;
};
