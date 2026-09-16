export const shouldAutoSaveBeforeHome = (hasUnsavedChanges: boolean, hasActiveRecording: boolean) =>
  hasUnsavedChanges || hasActiveRecording;
