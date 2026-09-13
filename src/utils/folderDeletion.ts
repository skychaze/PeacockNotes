export const normalizeFolderIds = (folderIds: readonly number[]): number[] =>
  [...new Set(folderIds)].filter((id) => Number.isInteger(id) && id > 0);
