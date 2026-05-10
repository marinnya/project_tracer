type CompressOptions = {
  /** Максимальная длина стороны (px) */
  maxSide: number;
  /** Качество JPEG 0..1 (стартовое; при необходимости понижается до целевого размера) */
  jpegQuality: number;
  /** Потолок размера после сжатия (~1.5–2 МБ) — для JPEG и для PNG после перевода в JPEG */
  targetMaxBytes: number;
  /**
   * Нижняя граница размера файла для JPEG после сжатия (байт): ниже — поднимаем качество.
   * На очень маленьких кадрах цель может быть недостижима без увеличения maxSide.
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

async function encodeCanvasToTargetJpeg(
  canvas: HTMLCanvasElement,
  jpegQuality: number,
  targetMaxBytes: number,
): Promise<Blob | null> {
  let q = jpegQuality;
  let blob = await canvasToJpegBlob(canvas, q);
  let guard = 0;
  while (blob && blob.size > targetMaxBytes && q > 0.45 && guard < 12) {
    guard++;
    const nextQ = Math.max(0.45, q * 0.9 - 0.02);
    if (nextQ >= q) break;
    q = nextQ;
    const next = await canvasToJpegBlob(canvas, q);
    if (!next) break;
    blob = next;
  }
  return blob;
}

/**
 * Поднимает качество JPEG с того же canvas, пока размер < minBytes (но не больше оригинала).
 */
async function raiseJpegToMinBytes(
  canvas: HTMLCanvasElement,
  minBytes: number,
  originalFileSize: number,
): Promise<Blob | null> {
  let best: Blob | null = null;
  for (const q of [0.78, 0.82, 0.85, 0.88, 0.9, 0.92, 0.94, 0.96, 0.98]) {
    const b = await canvasToJpegBlob(canvas, q);
    if (!b || b.size >= originalFileSize) continue;
    if (!best || b.size > best.size) best = b;
    if (b.size >= minBytes) return b;
  }
  return best;
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
    // createImageBitmap быстрее и экономнее, чем Image()
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    // Если размер уже небольшой — оставляем как есть (не делаем лишнюю перекодировку)
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
    // Прозрачность PNG при выводе в JPEG даёт артефакты; для типичных снимков/сканов — белый фон
    if (isPng) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetW, targetH);
    }

    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close();

    let blob: Blob | null;
    let outFileName = file.name;
    let outType: string;

    if (isPng) {
      // Сначала пробуем PNG (мелкая графика/скриншоты иногда меньше); иначе — как JPEG с тем же потолком
      const pngBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/png");
      });
      if (pngBlob && pngBlob.size <= targetMaxBytes && pngBlob.size < file.size) {
        blob = pngBlob;
        outType = "image/png";
      } else {
        blob = await encodeCanvasToTargetJpeg(canvas, jpegQuality, targetMaxBytes);
        outFileName = jpgFileName(file.name);
        outType = "image/jpeg";
      }
    } else {
      blob = await encodeCanvasToTargetJpeg(canvas, jpegQuality, targetMaxBytes);
      outType = "image/jpeg";
    }

    if (!blob) return file;

    if (outType === "image/jpeg" && blob.size < minJpegBytes) {
      const raised = await raiseJpegToMinBytes(canvas, minJpegBytes, file.size);
      if (raised) blob = raised;
    }

    // Если стало больше — смысла нет, оставляем оригинал
    if (blob.size >= file.size) return file;

    return new File([blob], outFileName, {
      type: outType,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}

