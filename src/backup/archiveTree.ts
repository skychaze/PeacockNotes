import type { ArchivedFolderPreview, ArchivedNotePreview } from '../services/archive';

export type ArchiveTreeFolder = ArchivedFolderPreview & Readonly<{
  children: readonly ArchiveTreeFolder[];
  notes: readonly ArchivedNotePreview[];
  descendantNoteIds: readonly string[];
}>;

export type CheckState = 'checked' | 'unchecked' | 'indeterminate' | 'disabled';

export const buildArchiveTree = (
  folders: readonly ArchivedFolderPreview[],
  notes: readonly ArchivedNotePreview[],
): readonly ArchiveTreeFolder[] => {
  const children = new Map<string | null, ArchivedFolderPreview[]>();
  for (const folder of folders) {
    const key = folder.parentPortableId && folders.some((candidate) => candidate.portableId === folder.parentPortableId)
      ? folder.parentPortableId : null;
    children.set(key, [...(children.get(key) ?? []), folder]);
  }
  const notesByFolder = new Map<string, ArchivedNotePreview[]>();
  for (const note of notes) notesByFolder.set(note.folderPortableId, [...(notesByFolder.get(note.folderPortableId) ?? []), note]);
  const make = (folder: ArchivedFolderPreview): ArchiveTreeFolder => {
    const nested = (children.get(folder.portableId) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.portableId.localeCompare(b.portableId)).map(make);
    const ownNotes = notesByFolder.get(folder.portableId) ?? [];
    return { ...folder, children: nested, notes: ownNotes, descendantNoteIds: [...ownNotes.map((note) => note.portableId), ...nested.flatMap((child) => child.descendantNoteIds)] };
  };
  return (children.get(null) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.portableId.localeCompare(b.portableId)).map(make);
};

export const folderCheckState = (noteIds: readonly string[], selected: ReadonlySet<string>): CheckState => {
  if (noteIds.length === 0) return 'disabled';
  const count = noteIds.filter((id) => selected.has(id)).length;
  return count === 0 ? 'unchecked' : count === noteIds.length ? 'checked' : 'indeterminate';
};

export const toggleArchiveNotes = (selected: ReadonlySet<string>, noteIds: readonly string[], checked: boolean): ReadonlySet<string> => {
  const next = new Set(selected);
  noteIds.forEach((id) => checked ? next.add(id) : next.delete(id));
  return next;
};
