export const toggleFolderSelection = (selected: ReadonlySet<number>, folderId: number): ReadonlySet<number> => {
  const next = new Set(selected);
  if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
  return next;
};

export const reconcileFolderSelection = (
  selected: ReadonlySet<number>,
  availableFolderIds: ReadonlySet<number>,
): ReadonlySet<number> => new Set([...selected].filter((id) => availableFolderIds.has(id)));
