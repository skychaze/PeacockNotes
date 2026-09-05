const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'heic', 'heif', 'svg'];
const PDF_EXTENSION = 'pdf';

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

const extractExtension = (value: string) => {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/\.([a-z0-9]{2,8})(?:$|[?#;&\s])/);
  return match ? match[1] : '';
};

export const getFileExtension = (
  mimeType: string | null | undefined,
  fileName: string | null | undefined,
  filePath: string | null | undefined
) => {
  const normalizedMime = (mimeType?.split(';')[0]?.trim().toLowerCase()) ?? '';
  const nameExt = fileName ? extractExtension(fileName) : '';
  const pathExt = filePath ? extractExtension(filePath) : '';

  const inferred = nameExt || pathExt;
  if (inferred) {
    return inferred;
  }

  return MIME_TO_EXTENSION[normalizedMime] ?? 'bin';
};

export const getFileMimeType = (extension: string) => {
  const normalized = extension.trim().toLowerCase();
  return EXTENSION_TO_MIME[normalized] ?? 'application/octet-stream';
};

export const isImageMimeType = (mimeType: string | null | undefined) => {
  const normalized = (mimeType?.split(';')[0]?.trim().toLowerCase()) ?? '';
  return normalized.startsWith('image/');
};

export const isPdfMimeType = (mimeType: string | null | undefined) => {
  const normalized = (mimeType?.split(';')[0]?.trim().toLowerCase()) ?? '';
  return normalized === 'application/pdf';
};

export const isImageFile = (mimeType: string | null | undefined, name: string, path: string) => {
  if (isImageMimeType(mimeType)) {
    return true;
  }
  const nameExt = extractExtension(name);
  const pathExt = extractExtension(path);
  return IMAGE_EXTENSIONS.includes(nameExt) || IMAGE_EXTENSIONS.includes(pathExt);
};

export const isPdfFile = (mimeType: string | null | undefined, name: string, path: string) => {
  if (isPdfMimeType(mimeType)) {
    return true;
  }
  const nameExt = extractExtension(name);
  const pathExt = extractExtension(path);
  return nameExt === PDF_EXTENSION || pathExt === PDF_EXTENSION;
};

export const isProbablyFileSource = (mimeType: string | null | undefined, name: string, path: string) => {
  return isImageFile(mimeType, name, path) || isPdfFile(mimeType, name, path);
};

export const getFileIcon = (mimeType: string) => {
  if (isImageMimeType(mimeType)) {
    return 'file-image-outline';
  }
  if (mimeType === 'application/pdf') {
    return 'file-pdf-box';
  }
  return 'file-outline';
};
