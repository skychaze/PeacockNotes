import * as SQLite from 'expo-sqlite';
import type {
  FolderListItem,
  Note,
  NoteAudio,
  NoteAudioDraft,
  NoteFile,
  NoteFileDraft,
  NoteDraft,
} from '../types/models';

export type SortField = 'custom' | 'name' | 'createdAt';
export type SortDirection = 'asc' | 'desc';

export type ListSortOptions = {
  field: SortField;
  direction?: SortDirection;
};

export type StorageSnapshot = {
  noteCount: number;
  notesTextBytes: number;
  databaseBytes: number;
  audioUris: string[];
  fileUris: string[];
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export const getDb = async () => {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('peacocknotes.db');
  }
  return dbPromise;
};

export const initDb = async () => {
  const db = await getDb();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS Folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      sortOrder INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS Notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folderId INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      audioUri TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      sortOrder INTEGER NOT NULL,
      FOREIGN KEY (folderId) REFERENCES Folders(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS NoteAudios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      noteId INTEGER NOT NULL,
      uri TEXT NOT NULL,
      displayName TEXT,
      groupId TEXT,
      segmentIndex INTEGER,
      orderIndex INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (noteId) REFERENCES Notes(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS NoteFiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      noteId INTEGER NOT NULL,
      uri TEXT NOT NULL,
      displayName TEXT,
      mimeType TEXT,
      orderIndex INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (noteId) REFERENCES Notes(id) ON DELETE CASCADE
    );
  `);

  const noteColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(Notes);');
  const hasUpdatedAt = noteColumns.some((column) => column.name === 'updatedAt');
  const hasNoteSortOrder = noteColumns.some((column) => column.name === 'sortOrder');

  if (!hasUpdatedAt) {
    await db.execAsync('ALTER TABLE Notes ADD COLUMN updatedAt TEXT;');
  }
  if (!hasNoteSortOrder) {
    await db.execAsync('ALTER TABLE Notes ADD COLUMN sortOrder INTEGER;');
  }

  const folderColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(Folders);');
  const hasFolderSortOrder = folderColumns.some((column) => column.name === 'sortOrder');
  if (!hasFolderSortOrder) {
    await db.execAsync('ALTER TABLE Folders ADD COLUMN sortOrder INTEGER;');
  }

  const noteAudioColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(NoteAudios);');
  const hasDisplayName = noteAudioColumns.some((column) => column.name === 'displayName');
  if (!hasDisplayName) {
    await db.execAsync('ALTER TABLE NoteAudios ADD COLUMN displayName TEXT;');
  }
  const hasGroupId = noteAudioColumns.some((column) => column.name === 'groupId');
  if (!hasGroupId) {
    await db.execAsync('ALTER TABLE NoteAudios ADD COLUMN groupId TEXT;');
  }
  const hasSegmentIndex = noteAudioColumns.some((column) => column.name === 'segmentIndex');
  if (!hasSegmentIndex) {
    await db.execAsync('ALTER TABLE NoteAudios ADD COLUMN segmentIndex INTEGER;');
  }

  await db.execAsync(`
    UPDATE Notes
    SET updatedAt = COALESCE(updatedAt, createdAt)
    WHERE updatedAt IS NULL;
  `);

  await db.execAsync(`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY createdAt DESC, id DESC) AS nextOrder
      FROM Folders
    )
    UPDATE Folders
    SET sortOrder = (
      SELECT nextOrder FROM ranked WHERE ranked.id = Folders.id
    )
    WHERE sortOrder IS NULL OR sortOrder <= 0;
  `);

  await db.execAsync(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY folderId ORDER BY updatedAt DESC, id DESC) AS nextOrder
      FROM Notes
    )
    UPDATE Notes
    SET sortOrder = (
      SELECT nextOrder FROM ranked WHERE ranked.id = Notes.id
    )
    WHERE sortOrder IS NULL OR sortOrder <= 0;
  `);

  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_notes_folderId ON Notes(folderId);
    CREATE INDEX IF NOT EXISTS idx_notes_updatedAt ON Notes(updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_notes_folderId_sortOrder ON Notes(folderId, sortOrder ASC);
    CREATE INDEX IF NOT EXISTS idx_folders_sortOrder ON Folders(sortOrder ASC);
    CREATE INDEX IF NOT EXISTS idx_note_audios_noteId_order ON NoteAudios(noteId, orderIndex ASC);
    CREATE INDEX IF NOT EXISTS idx_note_files_noteId_order ON NoteFiles(noteId, orderIndex ASC);
  `);

  await db.execAsync(`
    INSERT INTO NoteAudios (noteId, uri, orderIndex, createdAt)
    SELECT N.id, N.audioUri, 1, N.createdAt
    FROM Notes N
    WHERE N.audioUri IS NOT NULL
      AND LENGTH(TRIM(N.audioUri)) > 0
      AND NOT EXISTS (
        SELECT 1 FROM NoteAudios A WHERE A.noteId = N.id
      );
  `);

  await db.execAsync(`
    UPDATE NoteAudios
    SET displayName = COALESCE(NULLIF(TRIM(displayName), ''), 'Audio ' || orderIndex)
    WHERE displayName IS NULL OR LENGTH(TRIM(displayName)) = 0;
  `);

  await db.execAsync(`
    UPDATE NoteAudios
    SET groupId = COALESCE(NULLIF(TRIM(groupId), ''), 'legacy_' || noteId || '_' || orderIndex)
    WHERE groupId IS NULL OR LENGTH(TRIM(groupId)) = 0;
  `);

  await db.execAsync(`
    UPDATE NoteAudios
    SET segmentIndex = COALESCE(segmentIndex, 1)
    WHERE segmentIndex IS NULL OR segmentIndex <= 0;
  `);
};

const nowIso = () => new Date().toISOString();
const createAudioGroupId = () => `audio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

type FolderRow = {
  id: number;
  name: string;
  createdAt: string;
  sortOrder: number;
  noteCount: number | string;
};

type NoteRow = {
  id: number;
  folderId: number;
  title: string;
  content: string | null;
  audioCount: number | string;
  fileCount: number | string;
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
};

type NoteAudioRow = {
  id: number;
  noteId: number;
  uri: string;
  displayName: string | null;
  groupId: string | null;
  segmentIndex: number | null;
  orderIndex: number;
  createdAt: string;
};

type NoteFileRow = {
  id: number;
  noteId: number;
  uri: string;
  displayName: string | null;
  mimeType: string | null;
  orderIndex: number;
  createdAt: string;
};

const mapNote = (row: NoteRow): Note => ({
  id: row.id,
  folderId: row.folderId,
  title: row.title,
  content: row.content ?? '',
  audioCount: Number(row.audioCount ?? 0),
  fileCount: Number(row.fileCount ?? 0),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapNoteAudio = (row: NoteAudioRow): NoteAudio => ({
  id: row.id,
  noteId: row.noteId,
  uri: row.uri,
  displayName: row.displayName?.trim() ? row.displayName : `Audio ${row.orderIndex}`,
  groupId: row.groupId?.trim() ? row.groupId : `legacy_${row.noteId}_${row.orderIndex}`,
  segmentIndex: Number(row.segmentIndex ?? 1),
  orderIndex: row.orderIndex,
  createdAt: row.createdAt,
});

const mapNoteFile = (row: NoteFileRow): NoteFile => ({
  id: row.id,
  noteId: row.noteId,
  uri: row.uri,
  displayName: row.displayName?.trim() ? row.displayName : `File ${row.orderIndex}`,
  mimeType: row.mimeType?.trim() ?? 'application/octet-stream',
  orderIndex: row.orderIndex,
  createdAt: row.createdAt,
});

const resolveFolderSortClause = (sort: ListSortOptions): string => {
  if (sort.field === 'name') {
    return `LOWER(F.name) ${sort.direction === 'desc' ? 'DESC' : 'ASC'}, F.id ASC`;
  }
  if (sort.field === 'createdAt') {
    return `F.createdAt ${sort.direction === 'asc' ? 'ASC' : 'DESC'}, F.id ASC`;
  }
  return 'F.sortOrder ASC, F.id ASC';
};

const resolveNoteSortClause = (sort: ListSortOptions): string => {
  if (sort.field === 'name') {
    return `LOWER(N.title) ${sort.direction === 'desc' ? 'DESC' : 'ASC'}, N.id ASC`;
  }
  if (sort.field === 'createdAt') {
    return `N.createdAt ${sort.direction === 'asc' ? 'ASC' : 'DESC'}, N.id ASC`;
  }
  return 'N.sortOrder ASC, N.id ASC';
};

export const listFolders = async (
  sort: ListSortOptions = { field: 'custom', direction: 'asc' }
): Promise<FolderListItem[]> => {
  const db = await getDb();
  const orderBy = resolveFolderSortClause(sort);
  const rows = await db.getAllAsync<FolderRow>(`
    SELECT
      F.id,
      F.name,
      F.createdAt,
      F.sortOrder,
      COUNT(N.id) AS noteCount
    FROM Folders F
    LEFT JOIN Notes N ON N.folderId = F.id
    GROUP BY F.id
    ORDER BY ${orderBy};
  `);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    noteCount: Number(row.noteCount ?? 0),
  }));
};

export const createFolder = async (name: string): Promise<number> => {
  const db = await getDb();
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Folder name is required');
  }
  const orderRow = await db.getFirstAsync<{ maxSortOrder: number | null }>(
    'SELECT MAX(sortOrder) AS maxSortOrder FROM Folders;'
  );
  const nextSortOrder = Number(orderRow?.maxSortOrder ?? 0) + 1;
  const result = await db.runAsync(
    'INSERT INTO Folders (name, createdAt, sortOrder) VALUES (?, ?, ?);',
    [trimmedName, nowIso(), nextSortOrder]
  );
  return Number(result.lastInsertRowId);
};

export const updateFolderName = async (folderId: number, name: string): Promise<void> => {
  const db = await getDb();
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Folder name is required');
  }
  await db.runAsync('UPDATE Folders SET name = ? WHERE id = ?;', [trimmedName, folderId]);
};

export const moveFolderPosition = async (
  folderId: number,
  direction: 'up' | 'down'
): Promise<boolean> => {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: number; sortOrder: number }>(
    'SELECT id, sortOrder FROM Folders ORDER BY sortOrder ASC, id ASC;'
  );
  const index = rows.findIndex((row) => row.id === folderId);
  if (index < 0) {
    return false;
  }
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= rows.length) {
    return false;
  }

  const current = rows[index];
  const target = rows[targetIndex];
  await db.runAsync('UPDATE Folders SET sortOrder = ? WHERE id = ?;', [target.sortOrder, current.id]);
  await db.runAsync('UPDATE Folders SET sortOrder = ? WHERE id = ?;', [current.sortOrder, target.id]);
  return true;
};

export const deleteFolder = async (folderId: number): Promise<void> => {
  const db = await getDb();
  await db.runAsync('DELETE FROM Folders WHERE id = ?;', [folderId]);
};

export const listNotesByFolder = async (
  folderId: number,
  sort: ListSortOptions = { field: 'custom', direction: 'asc' }
): Promise<Note[]> => {
  const db = await getDb();
  const orderBy = resolveNoteSortClause(sort);
  const rows = await db.getAllAsync<NoteRow>(
    `
    SELECT
      N.id,
      N.folderId,
      N.title,
      N.content,
      COUNT(DISTINCT A.id) AS audioCount,
      COUNT(DISTINCT F.id) AS fileCount,
      N.createdAt,
      N.updatedAt,
      N.sortOrder
    FROM Notes N
    LEFT JOIN NoteAudios A ON A.noteId = N.id
    LEFT JOIN NoteFiles F ON F.noteId = N.id
    WHERE folderId = ?
    GROUP BY N.id
    ORDER BY ${orderBy};
    `,
    [folderId]
  );

  return rows.map(mapNote);
};

export const getNoteById = async (noteId: number): Promise<Note | null> => {
  const db = await getDb();
  const row = await db.getFirstAsync<NoteRow>(
    `
    SELECT
      N.id,
      N.folderId,
      N.title,
      N.content,
      COUNT(DISTINCT A.id) AS audioCount,
      COUNT(DISTINCT F.id) AS fileCount,
      N.createdAt,
      N.updatedAt,
      N.sortOrder
    FROM Notes N
    LEFT JOIN NoteAudios A ON A.noteId = N.id
    LEFT JOIN NoteFiles F ON F.noteId = N.id
    WHERE N.id = ?
    GROUP BY N.id;
    `,
    [noteId]
  );

  if (!row) {
    return null;
  }

  const note = mapNote(row);
  const audios = await listNoteAudios(noteId);
  const files = await listNoteFiles(noteId);
  return { ...note, audios, files };
};

export const listNoteAudios = async (noteId: number): Promise<NoteAudio[]> => {
  const db = await getDb();
  const rows = await db.getAllAsync<NoteAudioRow>(
    `
    SELECT id, noteId, uri, displayName, groupId, segmentIndex, orderIndex, createdAt
    FROM NoteAudios
    WHERE noteId = ?
    ORDER BY orderIndex ASC, id ASC;
    `,
    [noteId]
  );

  return rows.map(mapNoteAudio);
};

export const listNoteFiles = async (noteId: number): Promise<NoteFile[]> => {
  const db = await getDb();
  const rows = await db.getAllAsync<NoteFileRow>(
    `
    SELECT id, noteId, uri, displayName, mimeType, orderIndex, createdAt
    FROM NoteFiles
    WHERE noteId = ?
    ORDER BY orderIndex ASC, id ASC;
    `,
    [noteId]
  );

  return rows.map(mapNoteFile);
};

const saveNoteFiles = async (
  db: SQLite.SQLiteDatabase,
  noteId: number,
  files: NoteFileDraft[]
) => {
  const normalizedFiles = files
    .map((file, index) => {
      const uri = file.uri.trim();
      const displayName = file.displayName.trim() || `File ${index + 1}`;
      const mimeType = file.mimeType.trim() || 'application/octet-stream';
      return { uri, displayName, mimeType };
    })
    .filter((file) => Boolean(file.uri));

  await db.runAsync('DELETE FROM NoteFiles WHERE noteId = ?;', [noteId]);

  for (const [index, file] of normalizedFiles.entries()) {
    await db.runAsync(
      `
      INSERT INTO NoteFiles (noteId, uri, displayName, mimeType, orderIndex, createdAt)
      VALUES (?, ?, ?, ?, ?, ?);
      `,
      [noteId, file.uri, file.displayName, file.mimeType, index + 1, nowIso()]
    );
  }
};

export const appendFilesToNote = async (
  noteId: number,
  files: NoteFileDraft[]
): Promise<void> => {
  const db = await getDb();
  const normalizedFiles = files
    .map((file) => ({
      uri: file.uri.trim(),
      displayName: file.displayName.trim(),
      mimeType: file.mimeType.trim() || 'application/octet-stream',
    }))
    .filter((file) => Boolean(file.uri));

  if (normalizedFiles.length === 0) {
    return;
  }

  const orderRow = await db.getFirstAsync<{ maxOrder: number | null }>(
    'SELECT MAX(orderIndex) as maxOrder FROM NoteFiles WHERE noteId = ?;',
    [noteId]
  );
  const baseOrder = Number(orderRow?.maxOrder ?? 0);

  for (const [index, file] of normalizedFiles.entries()) {
    await db.runAsync(
      `
      INSERT INTO NoteFiles (noteId, uri, displayName, mimeType, orderIndex, createdAt)
      VALUES (?, ?, ?, ?, ?, ?);
      `,
      [
        noteId,
        file.uri,
        file.displayName || `File ${baseOrder + index + 1}`,
        file.mimeType,
        baseOrder + index + 1,
        nowIso(),
      ]
    );
  }

  await db.runAsync('UPDATE Notes SET updatedAt = ? WHERE id = ?;', [nowIso(), noteId]);
};

const saveNoteAudios = async (
  db: SQLite.SQLiteDatabase,
  noteId: number,
  audios: NoteAudioDraft[]
) => {
  const normalizedAudios = audios
    .map((audio, index) => {
      const uri = audio.uri.trim();
      const displayName = audio.displayName.trim() || `Audio ${index + 1}`;
      const groupId = audio.groupId?.trim() || createAudioGroupId();
      const segmentIndex = Number(audio.segmentIndex ?? 1);
      return { uri, displayName, groupId, segmentIndex: segmentIndex > 0 ? segmentIndex : 1 };
    })
    .filter((audio) => Boolean(audio.uri));

  await db.runAsync('DELETE FROM NoteAudios WHERE noteId = ?;', [noteId]);

  for (const [index, audio] of normalizedAudios.entries()) {
    await db.runAsync(
      `
      INSERT INTO NoteAudios (noteId, uri, displayName, groupId, segmentIndex, orderIndex, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?);
      `,
      [noteId, audio.uri, audio.displayName, audio.groupId, audio.segmentIndex, index + 1, nowIso()]
    );
  }
};

export const createNote = async (
  folderId: number,
  draft: NoteDraft
): Promise<number> => {
  const db = await getDb();
  const timestamp = nowIso();
  const title = draft.title.trim();
  if (!title) {
    throw new Error('Note title is required');
  }
  const orderRow = await db.getFirstAsync<{ maxSortOrder: number | null }>(
    'SELECT MAX(sortOrder) AS maxSortOrder FROM Notes WHERE folderId = ?;',
    [folderId]
  );
  const nextSortOrder = Number(orderRow?.maxSortOrder ?? 0) + 1;
  const result = await db.runAsync(
    `
    INSERT INTO Notes (folderId, title, content, audioUri, createdAt, updatedAt, sortOrder)
    VALUES (?, ?, ?, ?, ?, ?, ?);
    `,
    [folderId, title, draft.content, null, timestamp, timestamp, nextSortOrder]
  );
  const noteId = Number(result.lastInsertRowId);
  await saveNoteAudios(db, noteId, draft.audios);
  await saveNoteFiles(db, noteId, draft.files);
  return noteId;
};

export const moveNotePosition = async (
  folderId: number,
  noteId: number,
  direction: 'up' | 'down'
): Promise<boolean> => {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: number; sortOrder: number }>(
    'SELECT id, sortOrder FROM Notes WHERE folderId = ? ORDER BY sortOrder ASC, id ASC;',
    [folderId]
  );
  const index = rows.findIndex((row) => row.id === noteId);
  if (index < 0) {
    return false;
  }
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= rows.length) {
    return false;
  }

  const current = rows[index];
  const target = rows[targetIndex];
  await db.runAsync('UPDATE Notes SET sortOrder = ? WHERE id = ?;', [target.sortOrder, current.id]);
  await db.runAsync('UPDATE Notes SET sortOrder = ? WHERE id = ?;', [current.sortOrder, target.id]);
  return true;
};

export const updateNote = async (
  noteId: number,
  draft: NoteDraft
): Promise<void> => {
  const db = await getDb();
  const title = draft.title.trim();
  if (!title) {
    throw new Error('Note title is required');
  }
  await db.runAsync(
    `
    UPDATE Notes
    SET title = ?, content = ?, audioUri = NULL, updatedAt = ?
    WHERE id = ?;
    `,
    [title, draft.content, nowIso(), noteId]
  );
  await saveNoteAudios(db, noteId, draft.audios);
  await saveNoteFiles(db, noteId, draft.files);
};

export const deleteNote = async (noteId: number): Promise<void> => {
  const db = await getDb();
  await db.runAsync('DELETE FROM Notes WHERE id = ?;', [noteId]);
};

export const appendAudiosToNote = async (
  noteId: number,
  audios: NoteAudioDraft[]
): Promise<void> => {
  const db = await getDb();
  const normalizedAudios = audios
    .map((audio) => ({
      uri: audio.uri.trim(),
      displayName: audio.displayName.trim(),
      groupId: audio.groupId?.trim() || createAudioGroupId(),
      segmentIndex: Number(audio.segmentIndex ?? 1),
    }))
    .filter((audio) => Boolean(audio.uri));

  if (normalizedAudios.length === 0) {
    return;
  }

  const orderRow = await db.getFirstAsync<{ maxOrder: number | null }>(
    'SELECT MAX(orderIndex) as maxOrder FROM NoteAudios WHERE noteId = ?;',
    [noteId]
  );
  const baseOrder = Number(orderRow?.maxOrder ?? 0);

  for (const [index, audio] of normalizedAudios.entries()) {
    await db.runAsync(
      `
      INSERT INTO NoteAudios (noteId, uri, displayName, groupId, segmentIndex, orderIndex, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?);
      `,
      [
        noteId,
        audio.uri,
        audio.displayName || `Audio ${baseOrder + index + 1}`,
        audio.groupId,
        audio.segmentIndex > 0 ? audio.segmentIndex : 1,
        baseOrder + index + 1,
        nowIso(),
      ]
    );
  }

  await db.runAsync('UPDATE Notes SET updatedAt = ? WHERE id = ?;', [nowIso(), noteId]);
};

export const getStorageSnapshot = async (): Promise<StorageSnapshot> => {
  const db = await getDb();

  const noteStats = await db.getFirstAsync<{ noteCount: number | null; notesTextBytes: number | null }>(
    `
    SELECT
      COUNT(*) AS noteCount,
      SUM(LENGTH(COALESCE(title, '')) + LENGTH(COALESCE(content, ''))) AS notesTextBytes
    FROM Notes;
    `
  );

  const audioRows = await db.getAllAsync<{ uri: string | null }>(
    `
    SELECT uri
    FROM NoteAudios
    WHERE uri IS NOT NULL AND LENGTH(TRIM(uri)) > 0;
    `
  );

  const fileRows = await db.getAllAsync<{ uri: string | null; mimeType: string | null }>(
    `
    SELECT uri, mimeType
    FROM NoteFiles
    WHERE uri IS NOT NULL AND LENGTH(TRIM(uri)) > 0;
    `
  );

  const pageCountRow = await db.getFirstAsync<{ page_count: number | null }>('PRAGMA page_count;');
  const pageSizeRow = await db.getFirstAsync<{ page_size: number | null }>('PRAGMA page_size;');

  const pageCount = Number(pageCountRow?.page_count ?? 0);
  const pageSize = Number(pageSizeRow?.page_size ?? 0);

  return {
    noteCount: Number(noteStats?.noteCount ?? 0),
    notesTextBytes: Number(noteStats?.notesTextBytes ?? 0),
    databaseBytes: Math.max(0, pageCount * pageSize),
    audioUris: audioRows
      .map((row) => row.uri?.trim() ?? '')
      .filter((uri) => Boolean(uri)),
    fileUris: fileRows
      .map((row) => row.uri?.trim() ?? '')
      .filter((uri) => Boolean(uri)),
  };
};
