import {
  attachmentTextForSharing,
  attachmentTokenPattern,
  encodeAttachmentReference,
  filterAttachmentTags,
  listAttachmentTags,
  parseAttachmentTagId,
  parseAttachmentText,
  renameAttachmentReferences,
  resolveAttachment,
} from './attachmentReferences';
import type { NoteFileDraft } from '../types/models';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const id = '12345678-1234-4123-8123-123456789abc';
const otherId = '87654321-4321-4321-8321-cba987654321';
const name = 'Lecture [1] (draft) বাংলা.pdf';
const token = encodeAttachmentReference({ kind: 'file', id, name });
assert(
  token === `@[Lecture%20%5B1%5D%20(draft)%20%E0%A6%AC%E0%A6%BE%E0%A6%82%E0%A6%B2%E0%A6%BE.pdf](file:${id})`,
  'names are escaped, identities remain portable',
);
assert(attachmentTokenPattern.test(token) && !attachmentTokenPattern.test('@[x](file:not-a-uuid)'), 'only UUIDv4 tokens count');

const content = `Before ${token}\nafter @ordinary person@example.com`;
const parts = parseAttachmentText(content);
assert(parts.length === 3, 'inline token splits text without losing surrounding lines');
assert(parts[1].reference?.id === id && parts[1].reference?.name === name, 'identity and Unicode name round-trip');
assert(attachmentTextForSharing(content) === `Before @${name}\nafter @ordinary person@example.com`, 'sharing text drops internal identity');
assert(attachmentTextForSharing('ordinary @text\nand email@host.com') === 'ordinary @text\nand email@host.com', 'ordinary text is unchanged');
assert(parseAttachmentText('').length === 0, 'empty text is empty');
assert(
  parseAttachmentText(`${token}${encodeAttachmentReference({ kind: 'audio', id: otherId, name: 'Recording' })}`).length === 2,
  'adjacent file and audio references parse',
);
assert(parseAttachmentText('@[bad%ZZ](file:not-a-uuid)')[0].reference === undefined, 'malformed tokens stay literal');

const files: NoteFileDraft[] = [
  { portableId: id, uri: 'file:///files/a.pdf', displayName: 'Physics notes.pdf', mimeType: 'application/pdf' },
  { portableId: otherId, uri: 'file:///files/b.png', displayName: 'Diagram.png', mimeType: 'image/png' },
];
const catalog = {
  audioGroups: [
    {
      groupId: 'audio_1',
      displayName: 'Lecture audio',
      segments: [
        { portableId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', displayName: 'Lecture audio' },
        { portableId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', displayName: 'Lecture audio' },
      ],
    },
  ],
  files,
};
const tags = listAttachmentTags(catalog);
assert(tags.length === 3, 'one tag per audio group plus one per file');
assert(tags[0].kind === 'audio' && tags[0].id === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' && tags[0].segmentCount === 2, 'audio tags reference the first segment of their group');
assert(filterAttachmentTags(tags, 'lect').length === 1, 'keyword filtering is case-insensitive');
assert(filterAttachmentTags(tags, '  ').length === 3, 'a bare trigger lists every attachment');
assert(filterAttachmentTags(tags, 'missing').length === 0, 'unmatched keywords hide every tag');

const byIdentity = resolveAttachment({ kind: 'file', id: otherId, name: 'stale name' }, catalog);
assert(byIdentity?.displayName === 'Diagram.png', 'identity wins over a stale stored name');
const byName = resolveAttachment({ kind: 'file', id: id.replace(/^1234/, '9999'), name: 'Physics notes.pdf' }, catalog);
assert(byName?.displayName === 'Physics notes.pdf', 'a unique name resolves recovered attachment identities');
const ambiguous = resolveAttachment({ kind: 'audio', id: otherId, name: 'Lecture audio' }, catalog);
assert(ambiguous?.kind === 'audio' && ambiguous.groupId === 'audio_1', 'audio names resolve to their group');
const missing = resolveAttachment(
  { kind: 'file', id: '00000000-0000-4000-8000-000000000000', name: 'Deleted.pdf' },
  catalog,
);
assert(missing === undefined, 'unknown references stay unresolved');

const audioTagId = parseAttachmentTagId('audio:12345678-1234-4123-8123-123456789abc');
assert(audioTagId?.kind === 'audio' && audioTagId?.id === id, 'suggestion ids split into kind and identity');
assert(parseAttachmentTagId('file:not-an-identity') === null, 'malformed suggestion ids are rejected');
assert(parseAttachmentTagId('unknown:12345678-1234-4123-8123-123456789abc') === null, 'unknown suggestion kinds are rejected');

const renamed = renameAttachmentReferences(
  `Audio ${encodeAttachmentReference({ kind: 'audio', id, name: 'Old name' })} and file ${token} remain.`,
  (reference) => (reference.kind === 'audio' && reference.id === id ? 'New name' : undefined),
);
assert(renamed.includes('(audio:' + id) && renamed.includes(`@[New%20name](audio:${id})`), 'matched tokens keep identity and take the new name');
assert(renamed.includes(token), 'declined tokens stay byte-for-byte identical');
assert(
  renameAttachmentReferences('no tokens here', () => 'unused') === 'no tokens here',
  'text without tokens is untouched',
);

console.log('Attachment reference tests passed');
