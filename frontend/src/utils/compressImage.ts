type CompressOptions = {
  /** Максимальная длина стороны (px) */
  maxSide: number;
  /** Качество JPEG 0..1 (стартовое; при необходимости понижается до targetMaxBytes) */
  jpegQuality: number;
  /** Потолок размера после сжатия (~2 МБ) */
  targetMaxBytes: number;
  /**
   * Нижняя граница при сжатии (байт): не уменьшаем качество/шаг так, чтобы результат был меньше.
   * Не применяется, если исходный файл уже меньше этого порога — тогда берём исходник как есть.
   */
  minJpegBytes: number;
};

const DEFAULT_OPTS: CompressOptions = {
  maxSide: 1280,
  jpegQuality: 0.74,
  targetMaxBytes: Math.floor(2 * 1024 * 1024),
  minJpegBytes: Math.floor(500 * 1024),
};

function canCompress(file: File) {
  return file.type?.startsWith("image/");
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });
}

/**
 * Жмём до targetMaxBytes, но не принимаем шаг, если размер ушёл ниже minJpegBytes.
 */
async function encodeCanvasToTargetJpeg(
  canvas: HTMLCanvasElement,
  jpegQuality: number,
  targetMaxBytes: number,
  minJpegBytes: number,
): Promise<Blob | null> {
  let q = jpegQuality;
  let blob = await canvasToJpegBlob(canvas, q);
  let guard = 0;
  while (blob && blob.size > targetMaxBytes && q > 0.45 && guard < 12) {
    guard++;
    const nextQ = Math.max(0.45, q * 0.9 - 0.02);
    if (nextQ >= q) break;
    const next = await canvasToJpegBlob(canvas, nextQ);
    if (!next) break;
    if (next.size < minJpegBytes) break;
    q = nextQ;
    blob = next;
  }
  return blob;
}

/** Поднимаем качество, пока не достигнем minBytes (и меньше оригинала). */
async function raiseJpegToMinBytes(
  canvas: HTMLCanvasElement,
  minBytes: number,
  originalFileSize: number,
): Promise<Blob | null> {
  for (const q of [0.76, 0.8, 0.84, 0.87, 0.9, 0.92, 0.94, 0.96, 0.98]) {
    const b = await canvasToJpegBlob(canvas, q);
    if (!b || b.size >= originalFileSize) continue;
    if (b.size >= minBytes) return b;
  }
  return null;
}

/** PNG на сервер часто тяжёлее JPEG; сохраняем имя логичным для типа image/jpeg */
function jpgFileName(originalName: string): string {
  if (/\.png$/i.test(originalName)) return originalName.replace(/\.png$/i, ".jpg");
  const dot = originalName.lastIndexOf(".");
  if (dot <= 0) return `${originalName}.jpg`;
  return `${originalName.slice(0, dot)}.jpg`;
}

export async function compressImageFile(file: File, opts: Partial<CompressOptions> = {}): Promise<File> {
  const { maxSide, jpegQuality, targetMaxBytes, minJpegBytes } = { ...DEFAULT_OPTS, ...opts };
  if (!canCompress(file)) return file;

  try {
    if (file.size < minJpegBytes) return file;

    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    if (scale === 1 && file.size <= targetMaxBytes) {
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

    const isPng = file.type === "image/png";
    if (isPng) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetW, targetH);
    }

    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();

    let blob: Blob | null;
    let outFileName = file.name;
    let outType: string;

    const toJpeg = async () => {
      let b = await encodeCanvasToTargetJpeg(canvas, jpegQuality, targetMaxBytes, minJpegBytes);
      if (b && b.size < minJpegBytes) {
        const r = await raiseJpegToMinBytes(canvas, minJpegBytes, file.size);
        if (r) b = r;
      }
      return b;
    };

    if (isPng) {
      const pngBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/png");
      });
      const pngOk =
        pngBlob &&
        pngBlob.size <= targetMaxBytes &&
        pngBlob.size < file.size &&
        pngBlob.size >= minJpegBytes;

      if (pngOk) {
        blob = pngBlob;
        outType = "image/png";
      } else {
        blob = await toJpeg();
        outFileName = jpgFileName(file.name);
        outType = "image/jpeg";
      }
    } else {
      blob = await toJpeg();
      outType = "image/jpeg";
    }

    if (!blob) return file;

    if (file.size >= minJpegBytes && blob.size < minJpegBytes) return file;

    if (blob.size >= file.size) return file;

    return new File([blob], outFileName, {
      type: outType,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
