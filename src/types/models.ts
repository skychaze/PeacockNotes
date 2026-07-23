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
  audios?: NoteAudio[];
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

export type NoteDraft = {
  title: string;
  content: string;
  audios: NoteAudioDraft[];
};
