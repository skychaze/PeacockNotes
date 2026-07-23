export type RootStackParamList = {
  Folders: undefined;
  StorageUsage: undefined;
  NotesList: { folderId: number; folderName: string };
  NoteEditor: { folderId: number; folderName: string; noteId?: number };
  ShareImport:
    | {
        sharedFiles?: Array<{
          path: string;
          fileName: string;
          mimeType: string;
        }>;
      }
    | undefined;
};
