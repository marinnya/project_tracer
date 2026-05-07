type CompressOptions = {
  /** Максимальная длина стороны (px) */
  maxSide: number;
  /** Качество JPEG 0..1 */
  jpegQuality: number;
};

const DEFAULT_OPTS: CompressOptions = {
  maxSide: 3000,
  jpegQuality: 0.9,
};

function canCompress(file: File) {
  return file.type?.startsWith("image/");
}

export async function compressImageFile(file: File, opts: Partial<CompressOptions> = {}): Promise<File> {
  const { maxSide, jpegQuality } = { ...DEFAULT_OPTS, ...opts };
  if (!canCompress(file)) return file;

  try {
    // createImageBitmap быстрее и экономнее, чем Image()
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    // Если размер уже небольшой — оставляем как есть (не делаем лишнюю перекодировку)
    if (scale === 1 && file.size <= 2 * 1024 * 1024) {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }

    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();

    const isPng = file.type === "image/png";
    const mime = isPng ? "image/png" : "image/jpeg";
    const blob: Blob | null = await new Promise((resolve) => {
      if (mime === "image/png") {
        canvas.toBlob((b) => resolve(b), mime);
      } else {
        canvas.toBlob((b) => resolve(b), mime, jpegQuality);
      }
    });

    if (!blob) return file;

    // Если стало больше — смысла нет, оставляем оригинал
    if (blob.size >= file.size) return file;

    return new File([blob], file.name, {
      type: blob.type,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}

