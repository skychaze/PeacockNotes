import type { NoteFileDraft } from '../types/models';

export type AttachmentKind = 'audio' | 'file';

export type AttachmentReference = {
  kind: AttachmentKind;
  id: string;
  name: string;
};

export type AttachmentTextPart = {
  text: string;
  reference?: AttachmentReference;
};

/** UUIDv4, the only portable identity shape a reference token stores. */
const PORTABLE_ID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const NAME_SOURCE = '[^\\]\\n]*';
const KIND_SOURCE = 'audio|file';

/**
 * Matches one stored reference token. The single outer group lets the mentions
 * editor split on it, so the kind stays non-capturing here; the parser below
 * captures the same pieces for its own reads. Kept stateless: the shared
 * pattern carries no `g` flag, so a global copy is built wherever repeated
 * scanning is needed.
 */
export const attachmentTokenPattern = new RegExp(
  `(@\\[${NAME_SOURCE}\\]\\((?:${KIND_SOURCE}):${PORTABLE_ID_SOURCE}\\))`,
  'i',
);

/** Groups: 1 = name, 2 = kind, 3 = identity. */
const attachmentTokenExpression = new RegExp(
  `^@\\[(${NAME_SOURCE})\\]\\((${KIND_SOURCE}):(${PORTABLE_ID_SOURCE})\\)$`,
  'i',
);
/** Groups: 1 = kind, 2 = identity. */
const attachmentTagIdExpression = new RegExp(`^(${KIND_SOURCE}):(${PORTABLE_ID_SOURCE})$`, 'i');

const toAttachmentKind = (value: string): AttachmentKind =>
  value.toLowerCase() === 'audio' ? 'audio' : 'file';

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const encodeAttachmentReference = (reference: AttachmentReference): string =>
  `@[${encodeURIComponent(reference.name)}](${reference.kind}:${reference.id})`;

/** Identity used by the mentions editor suggestions; kind prefix keeps audio and file ids apart. */
export const attachmentTagId = (reference: Pick<AttachmentReference, 'kind' | 'id'>): string =>
  `${reference.kind}:${reference.id}`;

export const parseAttachmentTagId = (tagId: string): Pick<AttachmentReference, 'kind' | 'id'> | null => {
  const match = attachmentTagIdExpression.exec(tagId);
  if (!match) return null;
  return { kind: toAttachmentKind(match[1]), id: match[2].toLowerCase() };
};

export const parseAttachmentToken = (token: string): AttachmentReference | null => {
  const match = attachmentTokenExpression.exec(token);
  if (!match) return null;
  return {
    kind: toAttachmentKind(match[2]),
    id: match[3].toLowerCase(),
    name: safeDecode(match[1]),
  };
};

export const parseAttachmentText = (value: string): AttachmentTextPart[] => {
  const parts: AttachmentTextPart[] = [];
  let end = 0;
  const scanPattern = new RegExp(attachmentTokenPattern.source, 'gi');
  for (const match of value.matchAll(scanPattern)) {
    const reference = parseAttachmentToken(match[1]);
    if (!reference || match.index < end) continue;
    if (match.index > end) parts.push({ text: value.slice(end, match.index) });
    parts.push({ text: `@${reference.name}`, reference });
    end = match.index + match[0].length;
  }
  if (end < value.length) parts.push({ text: value.slice(end) });
  return parts;
};

/** Visible text with the stored identity tokens reduced to their names. */
export const attachmentTextForSharing = (value: string): string =>
  parseAttachmentText(value).map((part) => part.text).join('');

/**
 * Rewrite every token the callback resolves, keeping the identity untouched.
 * Tokens the callback declines stay byte-for-byte as they were.
 */
export const rewriteAttachmentReferences = (
  content: string,
  rewrite: (reference: AttachmentReference) => string | undefined,
): string =>
  content.replace(
    new RegExp(attachmentTokenPattern.source, 'gi'),
    (token) => {
      const reference = parseAttachmentToken(token);
      if (!reference) return token;
      const replacement = rewrite(reference);
      return replacement == null ? token : replacement;
    },
  );

export type AudioGroupAttachment = {
  groupId: string;
  displayName: string;
  segments: readonly { portableId?: string }[];
};

export type AttachmentCatalog = {
  audioGroups: readonly AudioGroupAttachment[];
  files: readonly NoteFileDraft[];
};

export type AttachmentTag =
  | { kind: 'audio'; id: string; tagId: string; groupId: string; displayName: string; segmentCount: number }
  | { kind: 'file'; id: string; tagId: string; displayName: string; file: NoteFileDraft };

const audioTagForGroup = (group: AudioGroupAttachment): AttachmentTag | null => {
  const portableId = group.segments[0]?.portableId;
  if (!portableId) return null;
  return {
    kind: 'audio',
    id: portableId,
    tagId: attachmentTagId({ kind: 'audio', id: portableId }),
    groupId: group.groupId,
    displayName: group.displayName,
    segmentCount: group.segments.length,
  };
};

const fileTagForFile = (file: NoteFileDraft): AttachmentTag | null => {
  if (!file.portableId) return null;
  return {
    kind: 'file',
    id: file.portableId,
    tagId: attachmentTagId({ kind: 'file', id: file.portableId }),
    displayName: file.displayName,
    file,
  };
};

/** One tag per audio group and per file, in the order the editor lists them. */
export const listAttachmentTags = (catalog: AttachmentCatalog): AttachmentTag[] => {
  const audio = catalog.audioGroups
    .map(audioTagForGroup)
    .filter((tag): tag is AttachmentTag => tag !== null);
  const files = catalog.files
    .map(fileTagForFile)
    .filter((tag): tag is AttachmentTag => tag !== null);
  return [...audio, ...files];
};

export const filterAttachmentTags = (tags: readonly AttachmentTag[], keyword: string): AttachmentTag[] => {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return [...tags];
  return tags.filter((tag) => tag.displayName.toLowerCase().includes(needle));
};

/**
 * Resolve a stored reference to a current attachment. Portable identity decides;
 * a unique name match keeps restored copies of a note working after their
 * attachment identities were regenerated.
 */
export const resolveAttachment = (
  reference: AttachmentReference,
  catalog: AttachmentCatalog,
): AttachmentTag | undefined => {
  const tags = listAttachmentTags(catalog);
  const byId = tags.find((tag) => tag.kind === reference.kind && tag.id === reference.id);
  if (byId) return byId;
  const name = reference.name.trim().toLowerCase();
  if (!name) return undefined;
  const byName = tags.filter(
    (tag) => tag.kind === reference.kind && tag.displayName.trim().toLowerCase() === name,
  );
  return byName.length === 1 ? byName[0] : undefined;
};
