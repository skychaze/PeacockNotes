export const FULL_REPLACEMENT_UNDO_HOURS = 168;

export const isWithinFullReplacementUndoWindow = (expiresAt: number, now: number): boolean =>
  now < expiresAt;
