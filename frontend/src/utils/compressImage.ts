type CompressOptions = {
  /** Максимальная длина стороны (px); больше — лучше для мелкого текста при том же лимите байт */
  maxSide: number;
  /** Потолок размера после сжатия (~1 МБ для тяжёлых исходников) */
  targetMaxBytes: number;
  /** Исходники не больше этого размера отправляем как есть (без сжатия) */
  skipBelowBytes: number;
};

const DEFAULT_OPTS: CompressOptions = {
  maxSide: 1920,
  targetMaxBytes: Math.floor(1 * 1024 * 1024),
  skipBelowBytes: Math.floor(1 * 1024 * 1024),
};

const MIN_JPEG_Q = 0.28;
const MAX_JPEG_Q = 0.99;

/** Минимальная длинная сторона при дополнительном уменьшении canvas */
const MIN_CANVAS_LONG_SIDE = 280;

function canCompress(file: File) {
  return file.type?.startsWith("image/");
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });
}

/**
 * Максимально возможное качество JPEG при ограничениях: размер ≤ targetMaxBytes и < исходника.
 * Даёт файл ближе к потолку по байтам (обычно ближе к 1 МБ), без хака — обычный двоичный поиск по q.
 */
async function jpegBestQualityUnderCap(
  canvas: HTMLCanvasElement,
  targetMaxBytes: number,
  originalFileSize: number,
): Promise<Blob | null> {
  let best: Blob | null = null;
  let lo = MIN_JPEG_Q;
  let hi = MAX_JPEG_Q;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    const b = await canvasToJpegBlob(canvas, mid);
    if (!b) {
      hi = mid;
      continue;
    }
    if (b.size >= originalFileSize) {
      hi = mid;
      continue;
    }
    if (b.size <= targetMaxBytes) {
      best = b;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  if (best) return best;
  for (let q = MIN_JPEG_Q; q <= MAX_JPEG_Q; q += 0.04) {
    const b = await canvasToJpegBlob(canvas, q);
    if (b && b.size < originalFileSize && b.size <= targetMaxBytes) return b;
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

function shrinkDimensions(w: number, h: number): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= MIN_CANVAS_LONG_SIDE) return { w, h };
  let nw = Math.max(1, Math.round(w * 0.86));
  let nh = Math.max(1, Math.round(h * 0.86));
  if (Math.max(nw, nh) < MIN_CANVAS_LONG_SIDE) {
    const f = MIN_CANVAS_LONG_SIDE / long;
    nw = Math.max(1, Math.round(w * f));
    nh = Math.max(1, Math.round(h * f));
  }
  if (nw === w && nh === h) return { w, h };
  return { w: nw, h: nh };
}

export async function compressImageFile(file: File, opts: Partial<CompressOptions> = {}): Promise<File> {
  const { maxSide, targetMaxBytes, skipBelowBytes } = { ...DEFAULT_OPTS, ...opts };
  if (!canCompress(file)) return file;

  try {
    if (file.size <= skipBelowBytes) return file;

    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const baseScale = Math.min(1, maxSide / Math.max(width, height));
    let w = Math.max(1, Math.round(width * baseScale));
    let h = Math.max(1, Math.round(height * baseScale));

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }

    const isPng = file.type === "image/png";

    const draw = () => {
      canvas.width = w;
      canvas.height = h;
      if (isPng) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(bitmap, 0, 0, w, h);
    };

    const buildJpegBlob = async (): Promise<Blob | null> =>
      jpegBestQualityUnderCap(canvas, targetMaxBytes, file.size);

    let blob: Blob | null = null;
    let outFileName = file.name;
    let outType: string;

    if (isPng) {
      draw();
      const pngBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/png");
      });
      const pngOk =
        pngBlob && pngBlob.size <= targetMaxBytes && pngBlob.size < file.size;

      if (pngOk) {
        blob = pngBlob;
        outType = "image/png";
      } else {
        outFileName = jpgFileName(file.name);
        outType = "image/jpeg";
        for (let attempt = 0; attempt < 8; attempt++) {
          draw();
          blob = await buildJpegBlob();
          if (blob) break;
          const next = shrinkDimensions(w, h);
          if (next.w === w && next.h === h) break;
          w = next.w;
          h = next.h;
        }
      }
    } else {
      outType = "image/jpeg";
      for (let attempt = 0; attempt < 8; attempt++) {
        draw();
        blob = await buildJpegBlob();
        if (blob) break;
        const next = shrinkDimensions(w, h);
        if (next.w === w && next.h === h) break;
        w = next.w;
        h = next.h;
      }
    }

    bitmap.close();

    if (!blob) return file;

    if (blob.size >= file.size) return file;

    return new File([blob], outFileName, {
      type: outType,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
