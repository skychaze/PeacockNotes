export type Folder = {
  id: number;
  portableId: string;
  name: string;
  createdAt: string;
};

export type FolderListItem = Folder & {
  noteCount: number;
};

export type NoteListItem = {
  id: number;
  portableId: string;
  folderId: number;
  title: string;
  contentPreview: string;
  audioCount: number;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Note = {
  id: number;
  portableId: string;
  folderId: number;
  title: string;
  content: string;
  audioCount: number;
  fileCount: number;
  audios?: NoteAudio[];
  files?: NoteFile[];
  createdAt: string;
  updatedAt: string;
};

export type NoteAudio = {
  id: number;
  portableId: string;
  noteId: number;
  uri: string;
  displayName: string;
  groupId: string;
  segmentIndex: number;
  orderIndex: number;
  createdAt: string;
};

export type NoteAudioDraft = {
  portableId?: string;
  uri: string;
  displayName: string;
  groupId?: string;
  segmentIndex?: number;
};

export type NoteFile = {
  id: number;
  portableId: string;
  noteId: number;
  uri: string;
  displayName: string;
  mimeType: string;
  orderIndex: number;
  createdAt: string;
};

export type NoteFileDraft = {
  portableId?: string;
  uri: string;
  displayName: string;
  mimeType: string;
};

export type NoteDraft = {
  title: string;
  content: string;
  audios: NoteAudioDraft[];
  files: NoteFileDraft[];
};
