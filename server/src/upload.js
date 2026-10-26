import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const AUDIO_TYPES = ['audio/mpeg', 'audio/mp3'];
const AUDIO_EXT = ['.mp3'];

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const MAX_GALLERY = 3;

/** Campos de archivo que acepta el alta/edición de ítems */
export const UPLOAD_FIELDS = [
  { name: 'cover', maxCount: 1 },
  { name: 'gallery', maxCount: MAX_GALLERY },
  { name: 'audio', maxCount: 1 }
];

export function createUploader(dataDir) {
  const tempDir = path.join(dataDir, 'media', '_temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      cb(null, tempDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.bin';
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      cb(null, `temp-${uniqueSuffix}${ext}`);
    }
  });

  const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const isAudio = file.fieldname === 'audio';
    const ok = isAudio
      ? AUDIO_TYPES.includes(file.mimetype) || AUDIO_EXT.includes(ext)
      : IMAGE_TYPES.includes(file.mimetype) || IMAGE_EXT.includes(ext);
    if (ok) return cb(null, true);
    const err = new Error(isAudio ? 'El audio tiene que ser un archivo .mp3.' : 'Formato de imagen no soportado. Usá JPG, PNG o WEBP.');
    err.status = 400;
    cb(err);
  };

  // el límite general es el del audio; las imágenes se controlan aparte (8 MB)
  return multer({ storage, fileFilter, limits: { fileSize: MAX_AUDIO_BYTES, files: 1 + MAX_GALLERY + 1 } });
}

/** Archivos subidos en la request, como lista plana */
export function uploadedFiles(req) {
  if (!req.files) return [];
  return Object.values(req.files).flat();
}

/** Valida tamaños por tipo. Devuelve un mensaje de error o null. */
export function checkUploadSizes(req) {
  for (const f of uploadedFiles(req)) {
    if (f.fieldname !== 'audio' && f.size > MAX_IMAGE_BYTES) return 'Cada imagen puede pesar hasta 8 MB.';
  }
  return null;
}

/**
 * Mueve un archivo temporal a su carpeta definitiva: media/<roomId>/<container>/<prefix>-<ts>.<ext>
 */
export function finalizeUpload(tempFile, dataDir, roomId, container, prefix = 'upload') {
  if (!tempFile || !tempFile.path) return null;

  try {
    const ext = path.extname(tempFile.path).toLowerCase() || '.jpg';
    const targetDir = path.join(dataDir, 'media', roomId, container);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filename = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e4)}${ext}`;
    const targetPath = path.join(targetDir, filename);

    fs.copyFileSync(tempFile.path, targetPath);
    try {
      fs.unlinkSync(tempFile.path);
    } catch {
      // ignore
    }

    return `/media/${roomId}/${container}/${filename}`;
  } catch (err) {
    console.error('[Upload] Error moving uploaded file:', err);
    cleanupTempFile(tempFile);
    return null;
  }
}

/** Borra archivos temporales si la request falló. Acepta un archivo o la request entera. */
export function cleanupTempFile(fileOrReq) {
  const list = fileOrReq && fileOrReq.files !== undefined ? uploadedFiles(fileOrReq) : [fileOrReq];
  for (const f of list) {
    if (f && f.path && fs.existsSync(f.path)) {
      try {
        fs.unlinkSync(f.path);
      } catch {}
    }
  }
}

/**
 * Borra un archivo de /media que ya no se usa (al editar o borrar un ítem).
 * Solo toca lo que subió/descargó la app; las portadas de ejemplo de items.json no se borran.
 */
export function removeMedia(urlPath, dataDir) {
  if (!urlPath || typeof urlPath !== 'string' || !urlPath.startsWith('/media/')) return;
  if (!/^(upload|lookup|cover|gallery|audio)-/.test(path.basename(urlPath))) return;
  const rel = path.normalize(urlPath.slice('/media/'.length)).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = path.join(dataDir, 'media', rel);
  if (full.startsWith(path.join(dataDir, 'media')) && fs.existsSync(full)) {
    try {
      fs.unlinkSync(full);
    } catch {}
  }
}
