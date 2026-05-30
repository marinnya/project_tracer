type CompressOptions = {
  /** Максимальная длина стороны (px); больше — лучше для мелкого текста при том же лимите байт */
  maxSide: number;
  /** Потолок размера после сжатия (~1 МБ для тяжёлых исходников) */
  targetMaxBytes: number;
  /** Исходники не больше этого размера отправляем как есть (без сжатия) */
  skipBelowBytes: number;
};

// Значения по умолчанию — максимальная сторона 1920px, потолок 1МБ, файлы меньше 1МБ не трогать. 
// Math.floor убирает дробную часть от умножения
const DEFAULT_OPTS: CompressOptions = {
  maxSide: 1920,
  targetMaxBytes: Math.floor(1 * 1024 * 1024),
  skipBelowBytes: Math.floor(1 * 1024 * 1024),
};

// Диапазон качества JPEG — от 0.28 (минимум при котором ещё читаемо) до 0.99 (почти без потерь). 
// 1.0 не используется — браузеры иногда дают больший файл чем оригинал
const MIN_JPEG_Q = 0.28;
const MAX_JPEG_Q = 0.99;

// минимальный размер длинной стороны при уменьшении холста - не дает сжать до нечитаемого
const MIN_CANVAS_LONG_SIDE = 280;

// проверяет является ли файл изображением
function canCompress(file: File) {
  return file.type?.startsWith("image/");
}

// Конвертирует canvas в JPEG с заданным качеством.
// toBlob работает через колбэк — оборачивает в Promise чтобы можно было использовать await
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
  // Двоичный поиск по качеству — 22 итерации дают точность (0.99-0.28)/2^22 ≈ 0.00000017.
  // Берёт среднее между границами
  let best: Blob | null = null;
  let lo = MIN_JPEG_Q;
  let hi = MAX_JPEG_Q;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    // Если blob не получился — уменьшает верхнюю границу и пробует снова
    const b = await canvasToJpegBlob(canvas, mid);
    if (!b) {
      hi = mid;
      continue;
    }
    // Если сжатый файл тяжелее оригинала — качество слишком высокое, уменьшаем
    if (b.size >= originalFileSize) {
      hi = mid;
      continue;
    }
    // Файл вписывается в лимит — сохраняем как лучший результат и пробуем качество выше. Не вписывается — снижаем качество
    if (b.size <= targetMaxBytes) {
      best = b;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  // Если двоичный поиск не нашёл ничего — перебирает качество с шагом 0.04 как запасной вариант. 
  // Если и это не помогло — возвращает null
  if (best) return best;
  for (let q = MIN_JPEG_Q; q <= MAX_JPEG_Q; q += 0.04) {
    const b = await canvasToJpegBlob(canvas, q);
    if (b && b.size < originalFileSize && b.size <= targetMaxBytes) return b;
  }
  return null;
}

// Если файл PNG — заменяет расширение на .jpg. /i — регистронезависимо (.PNG тоже заменит)
function jpgFileName(originalName: string): string {
  if (/\.png$/i.test(originalName)) return originalName.replace(/\.png$/i, ".jpg");
  // Для остальных форматов — находит последнюю точку и заменяет расширение на .jpg.
  // dot <= 0 — если точки нет или она в самом начале, просто добавляет .jpg
  const dot = originalName.lastIndexOf(".");
  if (dot <= 0) return `${originalName}.jpg`;
  return `${originalName.slice(0, dot)}.jpg`;
}

function shrinkDimensions(w: number, h: number): { w: number; h: number } {
  // Находит длинную сторону. Если она уже меньше минимума — не уменьшаем
  const long = Math.max(w, h);
  if (long <= MIN_CANVAS_LONG_SIDE) return { w, h };
  // Уменьшает размеры на 14% (множитель 0.86). 
  // Math.max(1, ...) — минимум 1px, не даёт получить нулевой холст
  let nw = Math.max(1, Math.round(w * 0.86));
  let nh = Math.max(1, Math.round(h * 0.86));
  // Если после уменьшения на 14% длинная сторона стала меньше минимума — пересчитывает до минимально допустимого размера
  if (Math.max(nw, nh) < MIN_CANVAS_LONG_SIDE) {
    const f = MIN_CANVAS_LONG_SIDE / long;
    nw = Math.max(1, Math.round(w * f));
    nh = Math.max(1, Math.round(h * f));
  }
  // Если размеры не изменились (уже на минимуме) — возвращает как есть, сигнал для вызывающего кода остановить итерации
  if (nw === w && nh === h) return { w, h };
  return { w: nw, h: nh };
}

export async function compressImageFile(file: File, opts: Partial<CompressOptions> = {}): Promise<File> {
  // Мержит переданные опции с дефолтными — переданные перезаписывают дефолтные
  const { maxSide, targetMaxBytes, skipBelowBytes } = { ...DEFAULT_OPTS, ...opts };
  if (!canCompress(file)) return file; // Если не изображение — возвращает как есть

  try {
    if (file.size <= skipBelowBytes) return file; // маленький файл не трогаем

    // Декодирует изображение в ImageBitmap — эффективный способ получить пиксели без создания <img> тега
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    // Вычисляет масштаб чтобы длинная сторона не превышала maxSide.
    // Math.min(1, ...) — не увеличивает маленькие изображения, только уменьшает большие
    const baseScale = Math.min(1, maxSide / Math.max(width, height));
    let w = Math.max(1, Math.round(width * baseScale));
    let h = Math.max(1, Math.round(height * baseScale));

    // Создаёт canvas для перерисовки. 
    // Если контекст не получен (редко, но бывает) — освобождает память и возвращает оригинал
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }

    // PNG обрабатывается иначе — сначала пробует сохранить как PNG, потом как JPEG
    const isPng = file.type === "image/png";

    // Функция перерисовки — устанавливает размер холста и рисует изображение. 
    // Для PNG заливает белым фоном перед рисованием — PNG может быть прозрачным, при конвертации в JPEG прозрачность стала бы чёрной
    const draw = () => {
      canvas.width = w;
      canvas.height = h;
      if (isPng) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(bitmap, 0, 0, w, h);
    };

    // Короткий псевдоним для вызова функции поиска лучшего качества — чтобы не повторять параметры
    const buildJpegBlob = async (): Promise<Blob | null> =>
      jpegBestQualityUnderCap(canvas, targetMaxBytes, file.size);

    let blob: Blob | null = null;
    let outFileName = file.name;
    let outType: string;

    // Пробует сжать как PNG. pngOk — три условия: blob создался, вписывается в лимит, меньше оригинала
    if (isPng) {
      draw();
      const pngBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/png");
      });
      const pngOk =
        pngBlob && pngBlob.size <= targetMaxBytes && pngBlob.size < file.size;

      // PNG сжался хорошо — берём PNG. Не сжался — конвертируем в JPEG. 
      // До 8 попыток: пробует сжать, если не влезает — уменьшает холст через shrinkDimensions и пробует снова. if (next.w === w && next.h === h) break — если размеры не изменились (достигли минимума), останавливаемся
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
      // для jpeg
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

    bitmap.close(); // освобождает память от ImageBitmap

    // Если не получилось сжать или результат тяжелее орига — возвращает оригинал
    if (!blob) return file;

    if (blob.size >= file.size) return file;

    // Создаёт новый объект File из blob с правильным именем и типом. 
    // lastModified: file.lastModified — сохраняет оригинальную дату изменения файла
    return new File([blob], outFileName, {
      type: outType,
      lastModified: file.lastModified,
    });
  } catch {
    return file; // Если что-то пошло не так — возвращает оригинал
  }
}
