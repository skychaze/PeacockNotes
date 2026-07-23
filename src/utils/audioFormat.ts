const KNOWN_AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'flac', 'opus', 'amr', 'oga'];
const SHARE_SAFE_EXTENSIONS = ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'amr'];

const MIME_TO_EXTENSION: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/x-aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'application/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/amr': 'amr',
};

const EXTENSION_TO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  amr: 'audio/amr',
};

const extractExtension = (value: string) => {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/\.([a-z0-9]{2,8})(?:$|[?#;&\s])/);
  return match ? match[1] : '';
};

export const normalizeMimeType = (mimeType: string | null | undefined) => {
  if (!mimeType) {
    return '';
  }
  return mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
};

export const isProbablyAudioSource = (mimeType: string | null | undefined, name: string, path: string) => {
  const normalizedMime = normalizeMimeType(mimeType);
  if (normalizedMime.startsWith('audio/')) {
    return true;
  }
  if (normalizedMime === 'application/ogg') {
    return true;
  }

  const nameExt = extractExtension(name);
  const pathExt = extractExtension(path);
  return KNOWN_AUDIO_EXTENSIONS.includes(nameExt) || KNOWN_AUDIO_EXTENSIONS.includes(pathExt);
};

export const getBestAudioExtension = (
  mimeType: string | null | undefined,
  fileName: string | null | undefined,
  filePath: string | null | undefined
) => {
  const normalizedMime = normalizeMimeType(mimeType);
  const nameExt = fileName ? extractExtension(fileName) : '';
  const pathExt = filePath ? extractExtension(filePath) : '';

  const inferred = nameExt || pathExt;
  if (KNOWN_AUDIO_EXTENSIONS.includes(inferred)) {
    return inferred;
  }

  return MIME_TO_EXTENSION[normalizedMime] ?? 'm4a';
};

export const getPreferredShareExtension = (extension: string) => {
  const normalized = extension.trim().toLowerCase();
  if (normalized === 'opus' || normalized === 'oga') {
    return 'ogg';
  }
  if (KNOWN_AUDIO_EXTENSIONS.includes(normalized)) {
    return normalized;
  }
  return 'm4a';
};

export const isShareFriendlyAudioExtension = (extension: string) => {
  const normalized = extension.trim().toLowerCase();
  return SHARE_SAFE_EXTENSIONS.includes(normalized);
};

export const getMimeTypeForAudioExtension = (extension: string) => {
  const normalized = extension.trim().toLowerCase();
  return EXTENSION_TO_MIME[normalized] ?? 'audio/*';
};
