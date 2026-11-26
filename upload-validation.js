const sharp = require('sharp');

const MAX_CHAT_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_COURSE_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_PROFILE_IMAGE_BYTES = 400 * 1024;
const blockedMimeTypes = new Set([
  'application/java-archive',
  'application/vnd.microsoft.portable-executable',
  'application/x-dosexec',
  'application/x-elf',
  'application/x-executable',
  'application/x-mach-binary',
  'application/x-msdownload',
  'application/x-sharedlib'
]);

class UploadValidationError extends Error {}

const detectFileType = async buffer => {
  const { fileTypeFromBuffer } = await import('file-type');
  return fileTypeFromBuffer(buffer);
};

const inspectUpload = async buffer => {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new UploadValidationError('The uploaded file is empty or invalid');
  }
  const detected = await detectFileType(buffer);
  if (detected) {
    if (blockedMimeTypes.has(detected.mime)) {
      throw new UploadValidationError('Executable files are not allowed');
    }
    return { mimeType: detected.mime };
  }

  if (buffer.includes(0)) throw new UploadValidationError('This file type is not supported');
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new UploadValidationError('This file type is not supported');
  }
  return { mimeType: 'text/plain' };
};

const sanitizeProfileImage = async buffer => {
  const detected = await detectFileType(buffer);
  if (detected?.mime !== 'image/webp') {
    throw new UploadValidationError('Profile picture must be a compressed WebP image');
  }

  try {
    const image = sharp(buffer, { limitInputPixels: 1000000 });
    const metadata = await image.metadata();
    if (metadata.format !== 'webp' || !metadata.width || !metadata.height || metadata.pages > 1) {
      throw new UploadValidationError('Profile picture must be a valid, non-animated WebP image');
    }
    const sanitized = await image
      .rotate()
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    if (sanitized.length > MAX_PROFILE_IMAGE_BYTES) {
      throw new UploadValidationError('Profile picture must be 400 KB or smaller');
    }
    return sanitized;
  } catch (error) {
    if (error instanceof UploadValidationError) throw error;
    throw new UploadValidationError('Profile picture must be a valid WebP image');
  }
};

module.exports = {
  MAX_CHAT_UPLOAD_BYTES,
  MAX_COURSE_UPLOAD_BYTES,
  MAX_PROFILE_IMAGE_BYTES,
  UploadValidationError,
  inspectUpload,
  sanitizeProfileImage
};
