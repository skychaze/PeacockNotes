export type Folder = {
  id: number;
  name: string;
  createdAt: string;
};

export type FolderListItem = Folder & {
  noteCount: number;
};

export type Note = {
  id: number;
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
  noteId: number;
  uri: string;
  displayName: string;
  groupId: string;
  segmentIndex: number;
  orderIndex: number;
  createdAt: string;
};

export type NoteAudioDraft = {
  uri: string;
  displayName: string;
  groupId?: string;
  segmentIndex?: number;
};

export type NoteFile = {
  id: number;
  noteId: number;
  uri: string;
  displayName: string;
  mimeType: string;
  orderIndex: number;
  createdAt: string;
};

export type NoteFileDraft = {
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
