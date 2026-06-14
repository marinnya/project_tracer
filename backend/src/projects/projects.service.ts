import { BadRequestException, Injectable, InternalServerErrorException, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OneCService } from '../integrations/oneC/onec.service';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import type { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Файл в памяти/на диске при загрузке на Яндекс (multer кладёт path, readTempFiles читает с диска)
type UploadFile = {
  originalname: string; // имя под которым пользователь грузит
  buffer?: Buffer; // буфер в памяти, если memoryStorage (либо path, либо buffer)
  path?: string; // путь на диске, если diskStorage
  // Метаданные, которые добавляются вручную после того как multer принял файл
  mimetype: string; // mime-тип файла (image/jpeg), нужен для загрузки на Яндекс в заголовке Content-Type
  section?: string | null; // секция, если секционные фото
  defectId?: number; // id дефекта, если дефектные фото
  defectTypeName?: string; // тип дефекта, если дефектные фото
  order?: number; // порядок фото, если секционные фото
};

// Метаданные одного фото из тела запроса (не от multer) «отправить на Яндекс» (секция, дефект, порядок)
export type PhotoMeta = {
  originalName: string; // оригинальное имя
  section: string | null; // секция, если секционные фото (если дефект null)
  defectId?: number;
  defectTypeName?: string;
  order: number; // порядок фото внутри секции или дефекта
  yandexPath?: string | null; // null пока не загружено на Яндекс (по этому полю определяем надо ли гразить или уже там)
};

// Тело PATCH /projects/:id/save — JSON-поля приходят строками из multipart
type SaveDraftBody = {
  // JSON-строки
  sections: string;
  sectionPhotos: string;
  defects: string;

  deletedPhotos?: string; // список id фото, которые пользователь удалил
  fileToSection?: string; // JSON-словарь { clientKey: секция } — говорит в какую секцию положить каждый файл
  fileKeys?: string; // JSON-массив ключей файлов — фронт присваивает каждому файлу уникальный ключ чтобы сопоставить с метаданными. Порядок совпадает с порядком файлов в запросе
};

// Тело PATCH /projects/:id/save-files — только файлы и привязки (после save с defectIdMap)
type SaveDraftFilesBody = {
  fileToSection?: string;
  fileKeys?: string;
  sectionPhotos?: string; // метаданные секционных фото - секция, имя, порядок. необ., тк могут быть только фото дефектов
  defectPhotos?: string; // метаданные дефектных фото - дефектId, имя, порядок
};

@Injectable()
export class ProjectsService implements OnModuleInit {
  private readonly logger = new Logger(ProjectsService.name);
  // Базовый URL API Яндекс.Диска
  private readonly baseUrl = 'https://cloud-api.yandex.net/v1/disk/resources';
  private readonly BATCH_SIZE = 10; // размер пачки файлов для загрузки (параллельно)
  // 3 минуты таймаут на один HTTP-запрос к Яндексу — на слабом канале большой файл может грузиться долго
  private readonly YANDEX_HTTP_TIMEOUT_MS = 180_000; // 3 минуты
  private readonly yandexRootFolder = process.env.YANDEX_ROOT_FOLDER ?? 'Сделки';
  private readonly yandexEngineerDataFolder =
    process.env.YANDEX_ENGINEER_DATA_FOLDER ?? 'Данные инженеров';
  
  // Лимиты — 300 страниц на раздел, 2000 фото на проект, 2.5ГБ на диске
  private readonly MAX_PAGES_PER_SECTION = 300;
  private readonly MAX_PAGES_PER_DEFECT = 300;
  private readonly MAX_PHOTOS_PER_SECTION = 300;
  private readonly MAX_PHOTOS_PER_DEFECT = 300;
  private readonly MAX_PHOTOS_PER_PROJECT = 2000;
  private readonly MAX_PROJECT_LOCAL_BYTES = Math.floor(2.5 * 1024 * 1024 * 1024);
  private readonly TMP_USAGE_FILE = '.usage.json';
  // Временные файлы в uploads/incoming живут максимум 24 часа, чистятся каждый час
  private readonly INCOMING_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 часа
  private readonly INCOMING_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 час

  // Map для хранения соединений SSE для каждого проекта, чтобы слать прогресс (словарь id проекта - SSE-соединение)
  private readonly sseClients = new Map<number, Response>();
  /** Один одновременный запуск выгрузки на Яндекс на проект (асинхронный POST /upload). */
  private readonly yandexUploadInFlight = new Set<number>();

  // если загрузка уже идёт (Set содержит projectId) возвращает false, иначе добавляет в Set и возвращает true
  tryBeginYandexUpload(projectId: number): boolean {
    if (this.yandexUploadInFlight.has(projectId)) return false;
    this.yandexUploadInFlight.add(projectId);
    return true;
  }

  // Убирает проект из Set — загрузка завершена (успешно или с ошибкой)
  // Вызывается в .finally() в контроллере, поэтому выполняется всегда
  endYandexUpload(projectId: number): void {
    this.yandexUploadInFlight.delete(projectId);
  }

  // Сопоставление полных названий разделов с короткими 
  private readonly sectionKeyMap: Record<string, string> = {
    'Титульный лист': 'Титульный',
    'Технические данные объекта контроля': 'Техданные',
    'План-схема склада': 'План',
    'Лист для фиксации повреждений': 'Повреждения',
    'Лист для фиксации отклонений в вертикальной плоскости': 'Отклонения',
    'Лист для фиксации момента затяжки болтовых и анкерных соединений': 'Соединения',
    'Лист для эскизов': 'Эскизы',
    'Протоколы испытаний': 'Испытания',
    'Сканы паспортов': 'Паспорта',
    'Прочностные расчеты': 'Прочность',
    'Дополнительная информация': 'Допинфо',
  };

  // NestJS инжектит сервисы Prisma и OneC
  constructor(
    private readonly prisma: PrismaService,
    private readonly oneCService: OneCService,
  ) {}

  // NestJS вызывает onModuleInit при старте — запускает таймер уборки мусора каждый час
  onModuleInit() {
    // Авто-уборка мусора в uploads/incoming, который остаётся при обрывах загрузки
    setInterval(() => { // запускает функцию каждые INCOMING_CLEANUP_INTERVAL_MS (1 час)
      try {
        this.cleanupIncomingUploads();
      } catch (e: unknown) {
        this.logger.warn(`cleanupIncomingUploads failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, this.INCOMING_CLEANUP_INTERVAL_MS);
  }

  private cleanupIncomingUploads() {
    // process.cwd() — корневая папка запущенного приложения. Если incoming не существует — выходим сразу
    const base = path.join(process.cwd(), 'uploads', 'incoming');
    if (!fs.existsSync(base)) return; // Если папки нет вообще — выходим, нечего чистить

    const now = Date.now();
    // Читает содержимое папки incoming — получает массив имён (['1', '2', '15', ...])
    const projectDirs = fs.readdirSync(base);
    // Перебирает папки проектов внутри incoming
    for (const projectDir of projectDirs) {
      const fullProjectDir = path.join(base, projectDir);
      let st: fs.Stats;
      try {
        st = fs.statSync(fullProjectDir); // получаем информацию о папке/файле
      } catch {
        continue;
      }
      // Пропускает если это файл а не папка — в incoming должны быть только папки проектов
      if (!st.isDirectory()) continue;

      // читает содержимое папки проекта и перебирает файлы внутри
      const entries = fs.readdirSync(fullProjectDir);
      for (const entry of entries) {
        const filePath = path.join(fullProjectDir, entry);
        try {
          const fst = fs.statSync(filePath);
          if (!fst.isFile()) continue; // пропускает если это не файл
          // mtimeMs — время последнего изменения файла. Если прошло больше 24 часов — удаляет файл
          // Это файлы от прерванных загрузок — multer записал но сервер упал до того как файл переместили в tmp
          if (now - fst.mtimeMs > this.INCOMING_MAX_AGE_MS) {
            fs.unlinkSync(filePath);
          }
        } catch {
          // ignore
        }
      }

      // после удаления файлов пречитывает папку: если она пустая — удаляем и ее
      try {
        if (fs.readdirSync(fullProjectDir).length === 0) {
          fs.rmdirSync(fullProjectDir); // удаляет только пустые папки
        }
      } catch {
        // ignore
      }
    }
  }

  // SSE-методы
  // Сохраняет объект ответа — через него потом будут слаться события
  registerSseClient(projectId: number, res: Response) {
    // Сохраняет объект res в Map по ключу projectId
    // res — открытое HTTP-соединение из контроллера, через него можно писать данные клиенту пока соединение живо
    this.sseClients.set(projectId, res);
  }

  removeSseClient(projectId: number) {
    // Убирает объект res из Map по ключу projectId (когда клиент отключился, чтобы не накапливать лишние соединения)
    this.sseClients.delete(projectId);
  }

  // Шлёт на фронт процент загрузки на Яндекс (формат Server-Sent Events)
  sendProgress(projectId: number, percent: number, done = false) {
    const client = this.sseClients.get(projectId); // ищет соединение по projectId
    if (!client) return; // если нет соединения, то клиент уже отключился, выходим
    // Пишет одно SSE-сообщение в открытое соединение
    // JSON.stringify превращает объект в строку: data: {"percent":42,"done":false}
    client.write(`data: ${JSON.stringify({ percent, done })}\n\n`);
    if (done) {
      client.end(); // закрывает соединение
      this.sseClients.delete(projectId); // удаляет соединение из Map
    }
  }

  // SAVE DRAFT

  /**
   * Первый этап сохранения черновика (PATCH /save).
   * Секции, дефекты, удаления, при необходимости — файлы в одном запросе.
   * Фронт чаще шлёт сюда только метаданные, файлы — отдельными пачками на /save-files.
   * Возвращает defectIdMap: временный отрицательный id дефекта → реальный id в БД.
   */
  async saveDraft(
    projectId: number,
    files: Express.Multer.File[],
    body: SaveDraftBody,
  ) {
    this.enforceProjectLocalStorageLimit(projectId, files); // проверяет не превысит ли добавление файлов лимит 2.5гб до операций с БД
    this.validateDraftLimits(body); // лимиты страниц и числа фото до операций с БД

    // multer сохранил файлы в uploads/incoming — переносим в uploads/tmp/{projectId}/...
    const clientKeyToStoredName = this.persistIncomingFiles(
      projectId,
      files,
      body.fileToSection,
      body.fileKeys,
    ); // вернет {photo1: "3b4a-uuid.jpg", photo2: "9c7d-uuid.jpg"} ?

    // Парсим json-строку секций и сохраняем черновик в БД
    const sections = JSON.parse(body.sections) as Record<string, { pages: number }>; // {roof: { pages: 10 }, wall: { pages: 5 }}
    await this.saveDraftSections(projectId, sections);

    // Удаляем помеченные фото
    const deletedPhotos = JSON.parse(body.deletedPhotos ?? '[]') as number[]; // id фото для удаления
    if (deletedPhotos.length) {
      await this.deletePhotos(deletedPhotos);
    }

    // Сохраняем дефекты, приходящие из multipart/form-data?
    const rawDefects = JSON.parse(body.defects) as {
      id?: number; // поле может отсутствовать
      typeId: number | string;
      pages: number | string;
      newPhotos: { originalName: string; clientKey: string; order: number }[]; // {originalName: "photo1.jpg", clientKey: "photo1", order: 1}?
    }[];

    // отбрасываем дефекты с пустым typeId или pages
    const defects = rawDefects
      .filter((d) => d.typeId !== '' && d.typeId !== null && Number(d.pages) > 0)
      // создается новый объект дефекта
      .map((d) => ({
        id: d.id,
        typeId: Number(d.typeId),
        pages: Number(d.pages),
        newPhotos: d.newPhotos,
      }));

    // сохраняет дефекты, возвращает словарь временныйId-реальныйId
    const defectIdMap = await this.saveDefects(projectId, defects);

    // Фото дефектов, пришедшие вместе с save (если фронт не разбивал на save-files)
    for (const d of defects) {
      if (!d.newPhotos?.length) continue;
      // id > 0 — уже в БД; отрицательный id — новый дефект, подставляем из defectIdMap
      const savedDefectId = d.id && d.id > 0 ? d.id : (d.id ? defectIdMap[d.id] : undefined);
      if (!savedDefectId) continue;

      // сопоставляет каждое фото с именем файла на диске через clientKey и сохраняет в БД
      const photosWithStoredName = d.newPhotos.map((p) => ({
        originalName: p.originalName,
        storedName: clientKeyToStoredName[p.clientKey] ?? null, // формат {photo1: "3b4a-uuid.jpg", photo2: "9c7d-uuid.jpg"} ?
        order: p.order,
      }));

      await this.saveTempDefectPhotos(savedDefectId, projectId, photosWithStoredName); // сохраняем фото дефекта в БД
    }

    // если секционные фото пришли в этом же запросе - сохраняем их
    if (body.sectionPhotos) {
      const sectionPhotos = JSON.parse(body.sectionPhotos) as {
        section: string;
        originalName: string;
        clientKey: string;
        order: number;
      }[];

      const sectionPhotosWithStoredName = sectionPhotos.map((p) => ({
        section: p.section,
        originalName: p.originalName,
        storedName: p.clientKey ? (clientKeyToStoredName[p.clientKey] ?? null) : null,
        order: p.order,
      }));

      await this.saveTempPhotos(projectId, sectionPhotosWithStoredName); // сохраняем секционные фото в БД
    }

    return { message: 'Черновик сохранён', defectIdMap }; // подтверждение фронту и маппинг временных id - фронт использует его для след. запроса /save-files
  }

  /**
   * Второй этап: только файлы (PATCH /save-files), пачками с фронта.
   * К этому моменту дефекты уже имеют реальные id в БД (после save).
   */
  async saveDraftFiles(
    projectId: number,
    files: Express.Multer.File[],
    body: SaveDraftFilesBody,
  ) {
    // проверяет не превысит ли добавление файлов лимит 2.5гб до операций с БД
    this.enforceProjectLocalStorageLimit(projectId, files);
    this.validateDraftFileBatchLimits(body); // проверяет не превысит ли добавление файлов лимит 300 фото на секцию/дефект за запрос, проверяет текущий батч

    // переносит файлы из uploads/incoming/{projectId} в uploads/tmp/{projectId}/{subfolder}/.
    const clientKeyToStoredName = this.persistIncomingFiles(
      projectId,
      files,
      body.fileToSection, // {photo1: "roof", photo2: "wall"} - секция для каждого фото?
      body.fileKeys,
    );

    // если секционные фото пришли в этом же запросе - сохраняем их метаданные в БД
    if (body.sectionPhotos) {
      const sectionPhotos = JSON.parse(body.sectionPhotos) as {
        section: string;
        originalName: string;
        clientKey: string;
        order: number;
      }[];
      const sectionPhotosWithStoredName = sectionPhotos.map((p) => ({
        section: p.section,
        originalName: p.originalName,
        storedName: p.clientKey ? (clientKeyToStoredName[p.clientKey] ?? null) : null,
        order: p.order,
      }));
      await this.saveTempPhotos(projectId, sectionPhotosWithStoredName);
    }

    if (body.defectPhotos) {
      const defectPhotos = JSON.parse(body.defectPhotos) as {
        defectId: number;
        originalName: string;
        clientKey: string;
        order: number;
      }[];
      // Защита от временных отрицательных ID — /save-files вызывается после /save, к этому моменту все дефекты уже должны иметь реальные ID. 
      // INT32_MAX — максимальное значение 32-битного целого, проверяет что ID не вышел за пределы допустимого диапазона БД
      // Отрицательные id с фронта сюда не должны попадать — только после save
      const INT32_MAX = 2147483647;
      for (const p of defectPhotos) {
        const defectId = Number(p.defectId);
        if (!Number.isInteger(defectId) || defectId < 1 || defectId > INT32_MAX) {
          throw new BadRequestException(
            'Ошибка сохранения файлов дефектов: получен временный или некорректный defectId. Сначала сохраните черновик, затем повторите сохранение файлов.',
          );
        }
      }
      // Группируем по defectId — saveTempDefectPhotos вызываем отдельно на каждый дефект (вместо одного на каждое фото)

      const byDefect = new Map<number, { originalName: string; storedName: string | null; order: number }[]>();
      // берем каждое фото
      for (const p of defectPhotos) {
        const defectId = Number(p.defectId); // получаем id дефекта
        const list = byDefect.get(defectId) ?? []; // получаем список фото для этого дефекта по id
        // добавляем фото в список
        list.push({
          originalName: p.originalName, // имя файла
          storedName: p.clientKey ? (clientKeyToStoredName[p.clientKey] ?? null) : null, // имя файла на диске
          order: p.order, // порядок
        });
        // сохраняем обратно в Map по id дефекта
        byDefect.set(defectId, list); // добавляем фото в Map по id дефекта
      }
      // сохраняем фото каждого дефекта отдельно
      // Map разворачивается на пары: id дефекта и список фото для этого дефекта
      for (const [defectId, defectFiles] of byDefect) {
        await this.saveTempDefectPhotos(defectId, projectId, defectFiles); // сохраняем фото каждого дефекта отдельно
      }
    }

    return { message: 'Файлы черновика сохранены' };
  }

  /**
   * Переносит файлы из uploads/incoming/{projectId} в uploads/tmp/{projectId}/{subfolder}/.
   * clientKey — стабильный ключ с фронта; storedName — uuid-имя на диске.
   * Возвращает словарь clientKey → storedName для записи в projectPhoto.filename.
   */
  private persistIncomingFiles(
    projectId: number,
    files: Express.Multer.File[], // массив файлов от multer 
    fileToSectionRaw?: string, // в какую секцию положить каждый файл {"photo1":"roof", "photo2":"wall"}
    fileKeysRaw?: string, // ключи файлов с фронта ["photo1", "photo2"]
  ) {
    // парсим метаданные
    const fileToSection: Record<string, string> = fileToSectionRaw
      ? JSON.parse(fileToSectionRaw)
      : {};
    const fileKeys: string[] = fileKeysRaw ? JSON.parse(fileKeysRaw) : [];

    // позже будет {photo1: "3b4a-uuid.jpg", photo2: "9c7d-uuid.jpg"} - словарь с ключами файлов и их именами на диске
    const clientKeyToStoredName: Record<string, string> = {};

    if (!files?.length) return clientKeyToStoredName; // если нет файлов, то возвращаем пустой словарь

    let movedBytes = 0; // счетчик перемещенных байтов, используется в bumpTmpUsageBytes
    // перебираем файлы
    for (let i = 0; i < files.length; i++) {
      const file = files[i]; // берем текущий файл
      // multer отдаёт originalname в latin1 — декодируем в utf8 для кириллицы
      const decodedOriginalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      // clientKey — стабильный ключ (порядок) с фронта; storedName — uuid-имя на диске
      const clientKey = fileKeys[i] ?? decodedOriginalName; // clientKey = "photo1" или "photo2"
      // subfolder = название секции или __defect__id__{id} для дефектов
      // определяет подпапку, если секция не указана - в misc
      const subfolder = fileToSection[clientKey] ?? 'misc'; // subfolder = "roof" или "wall"
      //path.basename берёт только имя файла без пути. Если имени нет — пропускает
      const storedName = path.basename(file.filename ?? '');
      if (!storedName) continue;

      const uploadPath = path.join(process.cwd(), 'uploads', 'tmp', String(projectId), subfolder); 
      const targetPath = path.join(uploadPath, storedName);
      // создаём папку, если её нет, recursive: true - создаёт все промежуточные папки
      fs.mkdirSync(uploadPath, { recursive: true });

      // Пробует переименовать (быстро, атомарно)
      // Если не получилось (разные файловые системы) — копирует и удаляет оригинал
      if (file.path) {
        try {
          fs.renameSync(file.path, targetPath);
        } catch {
          fs.copyFileSync(file.path, targetPath);
          fs.unlinkSync(file.path);
        }
      } else {
        // если multer работает через memoryStorage, то файл в памяти, на диске его еще нет (file.path нет и делаем вручную)
        const ext = path.extname(decodedOriginalName); // расширение
        const fallbackName = `${uuidv4()}${ext}`; // fallbackName = "3b4a-uuid.jpg"
        // создаем файл (байты из памяти записываем на диск)
        fs.writeFileSync(path.join(uploadPath, fallbackName), file.buffer!);
        clientKeyToStoredName[clientKey] = fallbackName; // {photo1: "3b4a-uuid.jpg"}
        this.logger.log(`Сохранён файл: ${decodedOriginalName} -> ${fallbackName} (папка: ${subfolder})`);
        movedBytes += Number(file.size) || 0; // добавляем размер файла в счетчик
        continue;
      }

      // если multer работает через diskStorage, то файл уже на диске
      clientKeyToStoredName[clientKey] = storedName; // {photo1: "3b4a-uuid.jpg"}
      this.logger.log(`Сохранён файл: ${decodedOriginalName} -> ${storedName} (папка: ${subfolder})`);
      movedBytes += Number(file.size) || 0;
    }

    // обновляет счетчик занятого места
    if (movedBytes > 0) {
      try {
        this.bumpTmpUsageBytes(projectId, movedBytes); // обновляем счетчик занятого места в .usage.json
      } catch {
        // если не смогли записать usage — не ломаем сохранение, просто будет медленнее/неточнее
      }
    }

    // возвращаем словарь с ключами файлов (фронт) и их именами на диске (бэк)
    return clientKeyToStoredName; // {photo1: "3b4a-uuid.jpg", photo2: "9c7d-uuid.jpg"}
  }

  // Не даём забить диск: сумма tmp проекта + новые файлы не больше MAX_PROJECT_LOCAL_BYTES
  private enforceProjectLocalStorageLimit(projectId: number, incomingFiles: Express.Multer.File[]) {
    if (!incomingFiles?.length) return; // если нет файлов, нечего проверять

    const tmpDir = path.join(process.cwd(), 'uploads', 'tmp', String(projectId));

    const currentBytes = this.readTmpUsageBytes(projectId) ?? this.safeDirSizeBytes(tmpDir);
    // incomingBytes = сумма всех file.size в incomingFiles
    const incomingBytes = incomingFiles.reduce((s, f) => s + (Number(f.size) || 0), 0);
    const nextBytes = currentBytes + incomingBytes; // считаем сколько будет после добавления

    //  если не превышает лимит, выходим
    if (nextBytes <= this.MAX_PROJECT_LOCAL_BYTES) return;

    // файлы уже записаны multerом в uploads/incoming/... — очищаем их, чтобы не забивать диск
    for (const f of incomingFiles) {
      try {
        if (f?.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); // удаляем файл
      } catch {
        // ignore
      }
    }

    // конвертируем байты в ГБ для сообщения и выбрасываем ошибку
    const maxGb = (this.MAX_PROJECT_LOCAL_BYTES / 1024 / 1024 / 1024).toFixed(1);
    const nextGb = (nextBytes / 1024 / 1024 / 1024).toFixed(2);
    throw new BadRequestException(
      `Превышен лимит локального объёма фото для проекта: максимум ${maxGb} ГБ. ` +
        `Сейчас получилось бы ${nextGb} ГБ. Удалите часть фото и попробуйте снова.`,
    );
  }

  // КОЛИЧЕСТВО БАЙТОВ НА ПРОЕКТ
  // Кэш объёма в .usage.json — быстрее, чем каждый раз обходить дерево tmp
  // возвращает путь к файлу-счетчику .usage.json для проекта
  private usageFilePath(projectId: number) {
    return path.join(process.cwd(), 'uploads', 'tmp', String(projectId), this.TMP_USAGE_FILE);
  }

  private readTmpUsageBytes(projectId: number): number | null {
    try {
      const p = this.usageFilePath(projectId); // получаем путь к файлу-счетчику
      if (!fs.existsSync(p)) return null; // если файл не существует, возвращаем null
      const raw = fs.readFileSync(p, 'utf8'); // читаем файл
      const parsed = JSON.parse(raw) as { bytes?: unknown }; // парсим JSON
      const bytes = Number((parsed as any)?.bytes); // конвертируем байты в число
      // Проверяет что значение валидное конечное неотрицательное число — защита от битого файла
      return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
    } catch {
      return null;
    }
  }

  // обновляет счетчик занятого места в .usage.json?
  private bumpTmpUsageBytes(projectId: number, deltaBytes: number) {
    const p = this.usageFilePath(projectId); // получаем путь к файлу-счетчику
    fs.mkdirSync(path.dirname(p), { recursive: true }); // создаём папку, если её нет (при первом сохранении), recursive: true - создаёт все промежуточные папки
    const current = this.readTmpUsageBytes(projectId) ?? 0; // берем текущее значение байтов или 0 если нет файла
    const next = Math.max(0, current + (Number(deltaBytes) || 0)); // считаем новое значение байтов (не даем уйти в минус 0 макс)
    fs.writeFileSync(p, JSON.stringify({ bytes: next }), 'utf8'); // перезаписывает файл целиком с новым значением или создаем (если его не было)
  }

  // Для фронта: сколько занято локально по проекту и какой потолок (2.5 ГБ)
  async getProjectTmpUsage(projectId: number) {
    const tmpDir = path.join(process.cwd(), 'uploads', 'tmp', String(projectId)); // получаем путь к папке tmp проекта
    const usedBytes = this.readTmpUsageBytes(projectId) ?? this.safeDirSizeBytes(tmpDir); // читаем счетчик или считаем размер папки
    return { usedBytes, maxBytes: this.MAX_PROJECT_LOCAL_BYTES }; // возвращаем сколько занято и максимальный лимит
  }

  // считает размер папки безопасно, не ломаясь на ошибки (обертка над dirSizeBytes)
  private safeDirSizeBytes(dirPath: string): number {
    try {
      return this.dirSizeBytes(dirPath);
    } catch {
      return 0;
    }
  }

  // считает размер папки рекурсивно?
  private dirSizeBytes(dirPath: string): number {
    if (!fs.existsSync(dirPath)) return 0; // если папки/файла нет, возвращаем размер 0
    const stat = fs.statSync(dirPath); // получаем информацию о папке/файле {size: 1024, isFile: true, isDirectory: false}
    if (stat.isFile()) return stat.size; // если это файл, возвращаем его размер, рекурсия дальше не идет
    if (!stat.isDirectory()) return 0; // если это не файл/папка, возвращаем размер 0

    // Обрабатывает три случая: папки нет, это файл (возвращает его размер), 
    // это что-то другое (символическая ссылка и т.д.)
    let total = 0; // счетчик байтов
    // читаем содержимое папки, возвращает список имен ["a.jpg", "b.jpg", "subfolder"]
    for (const entry of fs.readdirSync(dirPath)) {
      total += this.dirSizeBytes(path.join(dirPath, entry)); // строим полный путь /tmp/123/cat.jpg и рекурсивно считаем размер (заходим в подпапки)
    }
    return total;
  }

  // Лимиты для PATCH /save: страницы по секциям/дефектам и фото в этом же запросе
  private validateDraftLimits(body: SaveDraftBody) {
    const sections = JSON.parse(body.sections ?? '{}') as Record<string, { pages: number }>; // {roof: { pages: 10 }, wall: { pages: 5 }}
    const defects = JSON.parse(body.defects ?? '[]') as Array<{ pages: number | string }>; // [{ pages: 10 }, { pages: 5 }]
    const sectionPhotos = JSON.parse(body.sectionPhotos ?? '[]') as Array<{ section: string }>; // [{ section: "roof" }, { section: "wall" }] - секция для каждой фото

    // Проверяет каждый раздел - сообщение об ошибке содержит имя проблемного раздела
    // Накапливает суммарное количество страниц
    let totalPages = 0;
    // приводим к виду ["roof", { pages: 10 }]
    for (const [sectionName, sectionValue] of Object.entries(sections)) {
      const pages = Number(sectionValue?.pages ?? 0); // берем количество страниц из секции
      if (!Number.isInteger(pages) || pages < 0 || pages > this.MAX_PAGES_PER_SECTION) { // проверяем что количество страниц валидное
        throw new BadRequestException(
          `Раздел "${sectionName}": количество страниц должно быть от 0 до ${this.MAX_PAGES_PER_SECTION}`,
        ); // если не валидно, то выбрасываем ошибку
      }
      totalPages += pages; // добавляем количество страниц в общую сумму
    }

    for (const defect of defects) {
      const pages = Number(defect.pages ?? 0); // берем количество страниц из дефекта
      if (!Number.isInteger(pages) || pages < 0 || pages > this.MAX_PAGES_PER_DEFECT) {
        throw new BadRequestException(
          `Для дефекта количество страниц должно быть от 0 до ${this.MAX_PAGES_PER_DEFECT}`,
        );
      }
      totalPages += pages;
    }

    // Проеряет общий лимит по всему проекту - 2000 фото
    if (totalPages > this.MAX_PHOTOS_PER_PROJECT) {
      throw new BadRequestException(
        `Суммарное количество фото/страниц по проекту не может превышать ${this.MAX_PHOTOS_PER_PROJECT}`,
      );
    }

    // Считает фото по секциям через Map — ?? 0 чтобы начать с нуля для новой секции
    // Потом проверяет каждую секцию на превышение лимита 300 фото
    const sectionPhotoCount = new Map<string, number>(); // {roof: 10, wall: 5}
    for (const photo of sectionPhotos) {
      const section = photo.section ?? 'misc'; // берем секцию фото
      sectionPhotoCount.set(section, (sectionPhotoCount.get(section) ?? 0) + 1);
    }
    
    // перебираем пары: секция - количество фото
    for (const [section, count] of sectionPhotoCount) {
      if (count > this.MAX_PHOTOS_PER_SECTION) {
        throw new BadRequestException(
          `Раздел "${section}": нельзя прикрепить больше ${this.MAX_PHOTOS_PER_SECTION} фото`,
        );
      }
    }
  }

  // Лимиты для одной пачки PATCH /save-files (не больше 300 фото на секцию/дефект за запрос, проверяет текущий батч)
  /*body = {
    sectionPhotos: '[{"section":"roof"},{"section":"roof"},{"section":"wall"}]',
    defectPhotos: '[{"defectId":15},{"defectId":15}]'
  }*/
  private validateDraftFileBatchLimits(body: SaveDraftFilesBody) {
    const sectionPhotos = JSON.parse(body.sectionPhotos ?? '[]') as Array<{ section: string }>; // [{ section: "roof" }, { section: "wall" }] - секция для каждого фото
    const defectPhotos = JSON.parse(body.defectPhotos ?? '[]') as Array<{ defectId: number }>; // [{ defectId: 1 }, { defectId: 2 }] - дефект для каждого фото

    // Счётчик по секциям — ключ строка (название секции)
    const sectionPhotoCount = new Map<string, number>();
    for (const photo of sectionPhotos) {
      const section = photo.section ?? 'misc';
      // добавляем в Map секцию и количество фото в этой секции
      sectionPhotoCount.set(section, (sectionPhotoCount.get(section) ?? 0) + 1);
    }
    // перебираем пары: секция - количество фото ['roof': 10, 'wall': 5]
    for (const [section, count] of sectionPhotoCount) {
      if (count > this.MAX_PHOTOS_PER_SECTION) {
        throw new BadRequestException(
          `Раздел "${section}": нельзя прикрепить больше ${this.MAX_PHOTOS_PER_SECTION} фото за сохранение`,
        );
      }
    }

    // Счётчик по дефектам — ключ число (ID дефекта). 
    // Проверяет что в одном батче не пришло больше 300 фото на один дефект
    const defectPhotoCount = new Map<number, number>();
    for (const photo of defectPhotos) {
      const defectId = Number(photo.defectId);
      // добавляем в Map дефект и количество фото в этом дефекте
      defectPhotoCount.set(defectId, (defectPhotoCount.get(defectId) ?? 0) + 1);
    }
    // перебираем пары: дефект - количество фото [1: 10, 2: 5]
    for (const [defectId, count] of defectPhotoCount) {
      if (count > this.MAX_PHOTOS_PER_DEFECT) {
        throw new BadRequestException(
          `Дефект #${defectId}: нельзя прикрепить больше ${this.MAX_PHOTOS_PER_DEFECT} фото за сохранение`,
        );
      }
    }
  }

  // ЗАГРУЗКА НА ЯНДЕКС ДИСК

  /**
   * Полный цикл «отправить проект на Яндекс Диск»:
   * сопоставить метаданные с БД - прочитать tmp - uploadToYandex - записать yandexPath - архив - удалить tmp
   */
  async uploadProjectFiles(
    projectId: number,
    projectName: string,
    photos: PhotoMeta[],
  ) {
    const savedPhotos = await this.getProjectPhotos(projectId);
    const savedDefects = await this.getDefects(projectId);

    // разворачиваем дефектные фото [{ photo A + typeName }, { photo C + typeName }]
    const defectPhotosFlat = savedDefects.flatMap((d) =>
      d.photos.map((p) => ({ ...p, typeName: d.defectType.name })),
    );

    // берем фото, пришедшие с фронта, и пытаемся найти их в БД
    const photosWithMeta = photos.map((p) => {
      // в match кладем найденную запись из БД
      let match: { id: number; yandexPath: string | null; filename: string | null } | undefined;

      // если фото дефекта
      if (p.section === 'Дефекты') {
        // ищем фото в списке дефектных фото
        const found = defectPhotosFlat.find(
          // ищем по 3 условиям: id дефекта, имя файла, порядок (защита от дублирования)
          (sp) =>
            (
              (p.defectId ? sp.defectId === p.defectId : sp.typeName === p.defectTypeName)
            ) &&
            sp.originalName === p.originalName &&
            sp.order === p.order,
        );
        // кладем найденное в match
        match = found
          ? { id: found.id, yandexPath: found.yandexPath, filename: found.filename }
          : undefined;
      } else {
        // если фото секции, то ищем по 3 условиям: секция, имя файла, порядок (защита от дублирования)
        const found = savedPhotos.find(
          (sp) =>
            sp.section === p.section &&
            sp.originalName === p.originalName &&
            sp.order === p.order,
        );
        // кладем найденное в match
        match = found
          ? { id: found.id, yandexPath: found.yandexPath, filename: found.filename }
          : undefined;
      }

      // у каждого фото есть что пришло с фронта и что найдено в БД (id, yandexPath, filename)
      return {
        ...p,
        dbId: match?.id ?? null,
        yandexPath: match?.yandexPath ?? null,
        storedName: match?.filename ?? null,
      };
    });

    // получаем путь к временной папке
    const tmpDir = path.join(process.cwd(), 'uploads', 'tmp', String(projectId));
    this.logger.log(`Всего фото в запросе: ${photos.length}`);

    // Только фото без yandexPath - уже выгруженные на Диск повторно не трогаем
    // читаем файлы из временной папки
    const files = await this.readTempFiles(tmpDir, photosWithMeta); // возвращает массив файлов, готовых к загрузке на Яндекс UploadFile[]?
    // проверяем что количество файлов в спсике совпадает с количеством фото без yandexPath
    const pendingLocalCount = photosWithMeta.filter((p) => !p.yandexPath).length;
    if (files.length !== pendingLocalCount) {
      this.logger.error(
        `Несовпадение числа локальных файлов: ожидалось ${pendingLocalCount}, собрано ${files.length} (project ${projectId})`,
      );
      throw new InternalServerErrorException(
        'Не удалось сопоставить список фото с файлами на сервере. Сохраните черновик ещё раз и повторите попытку.',
      );
    }

    this.logger.log(`Файлов для загрузки: ${files.length}`);

    // загружаем файлы на Яндекс
    const { folderUrl, renamedPhotos } = await this.uploadToYandex(
      files,
      projectName,
      photosWithMeta,
      (uploaded, total) => {
        const percent = total === 0 ? 95 : Math.round(10 + (uploaded / total) * 85);
        // отправляет % в реальном времени
        this.sendProgress(projectId, Math.min(percent, 95));
      },
    );

    // функция для поиска переименованных файлов
    // ищет соотвествие фронтовое фото - файл на Яндекс
    const findRenamed = (p: PhotoMeta) =>
      renamedPhotos.find(
        (r) =>
          r.originalName === p.originalName &&
          r.section === p.section &&
          r.defectTypeName === p.defectTypeName &&
          r.order === p.order,
      );

    // Сохраняем пути для секционных фото
    const sectionPhotosWithPath = photos
      .filter((p) => p.section !== 'Дефекты') // берем только секционные фото
      .map((p) => {
        const match = findRenamed(p);
        const filename = match?.filename ?? p.originalName;
        const yandexPhotosRoot = this.getYandexEngineerDataRoot(projectName);
        return {
          section: p.section,
          defectId: null,
          originalName: p.originalName,
          filename,
          yandexPath: `${yandexPhotosRoot}/${p.section ?? 'Дефекты'}/${filename}`,
          order: p.order,
        };
      });

    // Секционные фото: перезаписываем все записи разделов (не дефекты) актуальными путями
    await this.savePhotos(projectId, sectionPhotosWithPath);

    // Фото дефектов: только update yandexPath/filename по id (записи уже есть после черновика)
    const defectPhotoUpdates = photos
      .filter((p) => p.section === 'Дефекты')
      .flatMap((p) => {
        const match = findRenamed(p);
        const filename = match?.filename ?? p.originalName;
        const yandexPath = `${this.getYandexEngineerDataRoot(projectName)}/${p.section ?? 'Дефекты'}/${filename}`;
        const meta = photosWithMeta.find(
          (pm) =>
            pm.originalName === p.originalName &&
            pm.section === p.section &&
            (
              (p.defectId ? pm.defectId === p.defectId : pm.defectTypeName === p.defectTypeName)
            ) &&
            pm.order === p.order,
        );
        if (!meta?.dbId) return [];
        return [{ id: meta.dbId, yandexPath, filename }];
      });

    await this.saveDefectPhotoYandexPaths(defectPhotoUpdates);
    await this.finalizeProject(projectId, folderUrl);

    // После успешной выгрузки локальные копии больше не нужны
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    return { message: 'Файлы загружены', folderUrl };
  }

  // YANDEX DISK
  // Объект с заголовком авторизации для всех запросов к cloud-api.yandex.net
  private getHeaders() {
    return { Authorization: `OAuth ${process.env.YANDEX_TOKEN}` };
  }

  // Имя файла на Диске: короткий префикс секции или тип дефекта + порядковый номер (001, 002…)
  private getRenamedFilename(
    originalName: string,
    section: string | null,
    defectTypeName: string | undefined,
    order: number,
  ): string {
    const ext = originalName.split('.').pop() ?? 'jpg'; // разбиваем по точке и берем последнее значение или jpg по умолчанию
    // преобразование порядкового номера в строку с ведущими нулями (до 3 символов) - 012
    const orderStr = String(order).padStart(3, '0');
    // делаем первую букву заглавной, убираем пробелы по краям
    const capitalizeFirst = (s: string) => {
      const trimmed = s.trim();
      if (!trimmed) return trimmed;
      return trimmed[0].toUpperCase() + trimmed.slice(1);
    };
    // если это фото дефекта - имя из типа дефекта + порядковый номер
    if (defectTypeName) {
      return `${capitalizeFirst(defectTypeName)}${orderStr}.${ext}`;
    }
    // если это фото секции - имя из названия секции + порядковый номер (короткий префикс из sectionKeyMap)
    const prefix = this.sectionKeyMap[section ?? ''] ?? (section ?? 'файл');
    return `${capitalizeFirst(prefix)}${orderStr}.${ext}`;
  }

  // PUT запрос к API Яндекса /resources? для создания папки; 409 = уже существует, не ошибка
  private async createFolder(folderPath: string): Promise<void> {
    // операция может упасть, поэтому в try/catch
    try {
      await axios.put(
        `${this.baseUrl}?path=${encodeURIComponent(folderPath)}`, // путь к создаваемой папке (кодируем для URL безопасно)
        undefined, // тело запроса пустое (Яндексу не нужно для создания папки)
        { headers: this.getHeaders(), timeout: this.YANDEX_HTTP_TIMEOUT_MS }, // добавляем заголовки и максимальное время ожидания
      );
    } catch (e: unknown) {
      // если ошибка 409 - папка уже существует, не ошибка
      const err = e as { response?: { status?: number }; message?: string };
      if (err.response?.status === 409) return;
      // любая другая - 500 ошибка сервера
      throw new InternalServerErrorException(`Ошибка создания папки: ${err.message}`);
    }
  }

  // Создаёт цепочку вложенных папок: A - A/B - A/B/C
  private async ensureFolderPath(folderPath: string): Promise<void> {
    const normalized = folderPath.replace(/^\/+|\/+$/g, ''); // убираем слеши в начале и в конце пути
    if (!normalized) return; // если после очистки строка пустая нечего создавать
    const parts = normalized.split('/').filter(Boolean); // разбиваем путь на части по / и убираем пустые элементы "a", "b", "c"
    // создаем папки последовательно от корня (сначала а, потом а/в и тд)
    let current = ''; // хранит накопленный путь
    // перебираем все части пути
    for (const part of parts) {
      current = current ? `${current}/${part}` : part; // собираем путь вида a/b/c
      await this.createFolder(current); // создаем папку для текущего пути
    }
  }

  // Двухшаговая загрузка Яндекса: GET upload URL - PUT тела файла по href
  private async uploadFile(file: UploadFile, folderPath: string): Promise<void> {
    const filename = Buffer.from(file.originalname, 'latin1').toString('utf8'); // декодируем имя файла из latin1 в utf8 для кириллицы?
    // кодируем путь и имя файла для URL (отдельно без слеша), encodeURIComponent - экранирует спецсимволы в URL
    const filePath = `${encodeURIComponent(folderPath)}/${encodeURIComponent(filename)}`;

    // Первый шаг — запрашивает у Яндекса URL для загрузки. 
    // overwrite=true — если файл уже существует, перезаписывает.
    const { data } = await axios.get(
      `${this.baseUrl}/upload?path=${filePath}&overwrite=true`,
      { headers: this.getHeaders(), timeout: this.YANDEX_HTTP_TIMEOUT_MS },
    );

    // Второй шаг — загружает файл по полученному URL. 
    // maxBodyLength/maxContentLength: Infinity — снимает ограничение axios на размер тела запроса, иначе большие файлы упадут с ошибкой
    const fileBuffer = file.buffer ?? fs.readFileSync(file.path!); // читаем физический файл из памяти или с диска
    // отправляем сам файл по полученному URL
    await axios.put(data.href, fileBuffer, {
      headers: { 'Content-Type': file.mimetype },
      timeout: this.YANDEX_HTTP_TIMEOUT_MS,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
  }

  // Публикует папку проекта и возвращает public_url для ссылки в интерфейсе
  private async getPublicUrl(folderName: string): Promise<string> {
    // Публикует папку — делает её доступной по публичной ссылке. 
    // PUT /publish — метод API Яндекс.Диска для публикации
    const encodedPath = encodeURIComponent(folderName); // кодируем путь для URL
    // отправляем запрос на публикацию папки (publish делает ресурс публичным)
    await axios.put(`${this.baseUrl}/publish?path=${encodedPath}`, undefined, {
      headers: this.getHeaders(),
      timeout: this.YANDEX_HTTP_TIMEOUT_MS,
    });
    // Получает метаданные папки и возвращает поле public_url — это и есть ссылка которая сохранится в folderUrl
    // отправляем get запрос на получение метаданных папки
    const { data } = await axios.get(`${this.baseUrl}?path=${encodedPath}`, {
      headers: this.getHeaders(),
      timeout: this.YANDEX_HTTP_TIMEOUT_MS,
    });
    return data.public_url; // возвращает публичную ссылку на папку
  }

  // Сделки/НазваниеПроекта
  private getYandexProjectRoot(projectName: string) {
    return `${this.yandexRootFolder}/${projectName}`;
  }

  // Сделки/НазваниеПроекта/Данные инженеров — здесь лежат папки секций и фото
  private getYandexEngineerDataRoot(projectName: string) {
    return `${this.getYandexProjectRoot(projectName)}/${this.yandexEngineerDataFolder}`;
  }

  /**
   * Собирает UploadFile[] для фото, ещё не на Яндексе.
   * Ищет файл в uploads/tmp/{projectId}/{section|__defect__id__}/storedName;
   * при отсутствии — резервный поиск по имени файла во всём дереве tmp.
   */
  async readTempFiles(
    tmpDir: string, // путь к временной папке, где лежат файлы
    photos: {
      originalName: string;
      section: string | null;
      defectId?: number;
      defectTypeName?: string;
      order?: number;
      yandexPath?: string | null;
      storedName?: string | null;
    }[],
  ): Promise<UploadFile[]> {
    // берем только те фото, которые еще не загружены на Яндекс
    const newPhotos = photos.filter((p) => !p.yandexPath);
    if (!newPhotos.length) return [];

    //Рекурсивно индексирует все файлы в tmp-папке проекта в Map имя - полный путь. 
    // withFileTypes: true — получает тип сразу без дополнительного statSync. 
    // !tempFilePathIndex.has(item.name) - не перезаписывает если имя уже есть, берёт первый найденный
    const tempFilePathIndex = new Map<string, string>();
    // функция проходит по всем подпапкам tmpDir
    const indexTmpFiles = (dir: string) => {
      if (!fs.existsSync(dir)) return; // если папка не существует, то выходим
      // читаем содержимое папки
      const items = fs.readdirSync(dir, { withFileTypes: true });
      // перебираем все элементы в папке
      for (const item of items) {
        // собираем полный путь к файлу/папке
        const fullPath = path.join(dir, item.name);
        // если это папка, то рекурсивно заходим внутрь нее
        if (item.isDirectory()) {
          indexTmpFiles(fullPath);
        } else if (!tempFilePathIndex.has(item.name)) { // если это файл и его имя не в Map, то добавляем в Map
          tempFilePathIndex.set(item.name, fullPath); // добавляем в Map имя файла - полный путь
        }
      }
    };
    indexTmpFiles(tmpDir); // запускаем функцию для индексации файлов

    // массив для файлов для загрузки на Яндекс
    const result: UploadFile[] = [];

    // Восстанавливает ожидаемую подпапку — дефектные фото лежат в __defect__id__123, секционные в папке с именем секции
    // берем каждое новое фото
    for (const photo of newPhotos) {
      // определяем подпапку
      const subfolder = photo.defectId
        ? `__defect__id__${photo.defectId}`
        : (photo.section ?? 'misc');

      const fileName = photo.storedName ?? photo.originalName; // Берёт имя файла на диске. storedName — UUID-имя которое дал multer. Если нет — пробует оригинальное имя
      // Сначала ищет файл в ожидаемом месте. Если не нашёл — ищет по всей папке через индекс как резервный вариант
      const filePath = path.join(tmpDir, subfolder, fileName);
      const fallbackPath = tempFilePathIndex.get(fileName);
      const resolvedPath = fs.existsSync(filePath) ? filePath : fallbackPath;

      // Файл не найден нигде — логирует с контекстом (что за фото, какой дефект) и бросает ошибку с понятным сообщением для пользователя
      if (!resolvedPath) {
        const ctx =
          photo.defectId != null
            ? `дефект id ${photo.defectId}, тип: ${photo.defectTypeName ?? '—'}`
            : `секция: ${photo.section ?? '—'}`;
        this.logger.warn(
          `Файл не найден на диске: ${photo.originalName} (storedName: ${fileName}, ${ctx}, порядок: ${photo.order ?? '—'})`,
        );
        throw new BadRequestException(
          `Не найден локальный файл «${photo.originalName}» (${ctx}). ` +
            `Сохраните черновик с фото ещё раз и повторите отправку на Яндекс.Диск.`,
        );
      }

      // Предупреждение если файл нашёлся не там где ожидался — не ошибка, но сигнал что что-то пошло не так при сохранении
      if (!fs.existsSync(filePath) && fallbackPath) {
        this.logger.warn(
          `Файл «${photo.originalName}» найден по резервному пути (ожидалась подпапка ${subfolder}); ` +
            `проверьте, что имена файлов на сервере не дублируются.`,
        );
      }

      // Добавляет файл в результат. latin1 кодировка имени — потому что uploadFile будет конвертировать обратно в utf8.
      //  application/octet-stream — универсальный MIME-тип для бинарных файлов. buffer: undefined — файл на диске, не в памяти
      result.push({
        originalname: Buffer.from(photo.originalName, 'utf8').toString('latin1'),
        path: resolvedPath,
        mimetype: 'application/octet-stream',
        section: photo.section,
        defectId: photo.defectId,
        defectTypeName: photo.defectTypeName,
        order: photo.order,
        buffer: undefined, // файл на диске, не в памяти
      });
    }

    // возвращаем массив файлов, готовых к загрузке на Яндекс
    return result;
  }

  /**
   * Загрузка на Диск пачками по BATCH_SIZE (параллельно внутри пачки).
   * Уже выгруженные (yandexPath) только попадают в renamedPhotos без повторной upload.
   */
  async uploadToYandex(
    files: UploadFile[], // массив файлов, готовых к загрузке на Яндекс (с диска сервера)
    projectName: string, // имя проекта (будет папкой на Яндекс)
    photos: {
      originalName: string;
      section: string | null;
      defectId?: number;
      defectTypeName?: string;
      order: number;
      yandexPath?: string | null;
    }[],
    // callback для отображения прогресса загрузки
    onProgress?: (uploaded: number, total: number) => void, // uploaded - количество загруженных файлов, total - общее количество файлов
  ): Promise<{
    message: string; // сообщение о результате загрузки
    folderUrl: string; // ссылка на папку на Яндекс
    // список переименованных фото
    renamedPhotos: {
      originalName: string; // оригинальное имя файла
      section: string | null; // секция
      defectTypeName?: string; // тип дефекта
      order: number; // порядок
      filename: string; // новое имя файла?
    }[];
  }> {
    // Гарантируем существование корневой папки и папки проекта внутри неё
    // Создаёт корневую папку и папку проекта если их нет — последовательно, сначала корень, потом проект
    await this.ensureFolderPath(this.yandexRootFolder);
    const yandexProjectRoot = this.getYandexProjectRoot(projectName);
    await this.ensureFolderPath(yandexProjectRoot);
    const yandexPhotosRoot = this.getYandexEngineerDataRoot(projectName);
    await this.ensureFolderPath(yandexPhotosRoot);

    const folders = new Set<string>();
    photos.forEach((p) => folders.add(p.section ?? 'Дефекты'));
    for (const folder of folders) {
      await this.ensureFolderPath(`${yandexPhotosRoot}/${folder}`);
    }

    // Делит на две группы - те что нужно загрузить и те что уже на Яндексе
    const newPhotos = photos.filter((p) => !p.yandexPath);
    const alreadyUploaded = photos.filter((p) => p.yandexPath);

    // Индексирует метаданные фото по составному ключу — ||| как разделитель чтобы не было коллизий с именами файлов
    const photoMap = new Map<string, { section: string | null; order: number; defectId?: number; defectTypeName?: string }>();
    for (const photo of newPhotos) {
      const key = `${photo.originalName}|||${photo.section ?? ''}|||${photo.defectId ?? ''}|||${photo.order}`;
      photoMap.set(key, {
        section: photo.section,
        order: photo.order,
        defectId: photo.defectId,
        defectTypeName: photo.defectTypeName,
      });
    }

    const renamedPhotos: {
      originalName: string;
      section: string | null;
      defectTypeName?: string;
      order: number;
      filename: string;
    }[] = [];

    // Для уже загруженных фото извлекает имя файла из пути на Яндексе - split('/').pop() берёт последний сегмент URL
    for (const p of alreadyUploaded) {
      // https://disk.ru/project/file.jpg - последний сегмент - file.jpg
      const existingFilename = p.yandexPath!.split('/').pop() ?? p.originalName; // берёт последний сегмент или оригинальное имя
      // добавляет в список переименованных фото
      renamedPhotos.push({ originalName: p.originalName, section: p.section, defectTypeName: p.defectTypeName, order: p.order, filename: existingFilename });
    }

    const totalNew = files.length; // сколько всего загружаем
    let uploadedCount = 0; // сколько уже загружено

    // Нарезает файлы на батчи по BATCH_SIZE (10). slice(i, i+10) — берёт срез массива
    for (let i = 0; i < files.length; i += this.BATCH_SIZE) {
      const batch = files.slice(i, i + this.BATCH_SIZE); // берем кусок массива [0...9], [10...19]

      // Запускает загрузку всех файлов батча параллельно и ждёт пока все завершатся
      await Promise.all(
        batch.map((file) => {
          // Конвертирует имя обратно в utf8 для работы с ним
          const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
          const fileSection = file.section ?? 'Дефекты'; // секция
          const fileDefectId = file.defectId; // id дефекта
          const fileDefectTypeName = file.defectTypeName; // тип дефекта
          const fileOrder = file.order ?? i + 1; // порядок или позиция в батче
          // Ищет метаданные фото в Map по тому же составному ключу
          const key = `${originalName}|||${fileSection}|||${fileDefectId ?? ''}|||${fileOrder}`;
          const meta = photoMap.get(key);

          // Берёт метаданные из Map если нашёл, иначе из самого файла — ?? как запасной вариант
          const section = meta?.section ?? fileSection;
          const order = meta?.order ?? fileOrder;
          const defectTypeName = meta?.defectTypeName ?? fileDefectTypeName;

          //Генерирует красивое имя файла для загрузки и сразу добавляет в список переименованных
          const renamedFilename = this.getRenamedFilename(originalName, section, defectTypeName, order);
          // добавляет в список переименованных фото новое имя файла
          renamedPhotos.push({ originalName, section, defectTypeName, order, filename: renamedFilename });

          // Создаёт копию объекта файла с новым именем в latin1 — uploadFile будет конвертировать его обратно
          const renamedFile: UploadFile = {
            ...file, // копирует файл
            originalname: Buffer.from(renamedFilename).toString('latin1'), // добавляет новое имя файла
          };

          // Загружает файл в папку секции. .catch — перехватывает ошибку и оборачивает в 500 с именем проблемного файла
          return this.uploadFile(renamedFile, `${yandexPhotosRoot}/${section}`).catch((e: unknown) => {
            const message = e instanceof Error ? e.message : String(e);
            throw new InternalServerErrorException(`Ошибка загрузки файла ${originalName}: ${message}`);
          });
        }),
      );

      // После каждого батча обновляет счётчик количества загруженных. Math.min — последний батч может быть меньше 10, не выходим за пределы. ?. — вызывает колбэк только если он передан
      uploadedCount = Math.min(i + this.BATCH_SIZE, totalNew);
      onProgress?.(uploadedCount, totalNew);
    }

    // После всех батчей публикует папку и возвращает результат — ссылку и список переименованных файлов
    const folderUrl = await this.getPublicUrl(yandexProjectRoot); // https://disk.yandex.ru/d/abc123
    return { message: 'Файлы успешно загружены', folderUrl, renamedPhotos };
  }

  // PHOTOS & DEFECTS
  // Фото секций проекта (defectId = null), не дефекты
  async getProjectPhotos(projectId: number) {
    return this.prisma.projectPhoto.findMany({
      where: { projectId, defectId: null },
      orderBy: [{ section: 'asc' }, { order: 'asc' }],
    });
  }

  // Дефекты с вложенными фото и именем типа для отображения на фронте
  // Один запрос тянет дефект + все его фото + тип дефекта (include)
  async getDefects(projectId: number) {
    const defects = await this.prisma.defect.findMany({
      where: { projectId },
      include: {
        photos: { orderBy: { order: 'asc' } },
        defectType: { select: { name: true } },
      },
      orderBy: { id: 'asc' },
    });
    return defects.map((d) => ({
      ...d,
      typeName: d.defectType.name,
    }));
  }

  /**
   * Синхронизирует список дефектов проекта с телом черновика.
   * Удаляет отсутствующие в запросе, обновляет существующие, создаёт новые.
   * Отрицательный id с фронта — временный; в tempToSavedIdMap возвращаем реальный id.
   */
  async saveDefects(
    projectId: number,
    defects: { id?: number; typeId: number; pages: number }[],
  ) {
    // Один тип дефекта может быть выбран только один раз в рамках проекта
    const seenTypeIds = new Set<number>();
    for (const d of defects) {
      const typeId = Number(d.typeId);
      if (!Number.isInteger(typeId) || typeId <= 0) continue;
      if (seenTypeIds.has(typeId)) {
        throw new BadRequestException('Нельзя добавить два дефекта с одинаковым типом');
      }
      seenTypeIds.add(typeId); // добавляет тип в множество
    }

    // Загружает все текущие дефекты проекта из БД
    const existing = await this.prisma.defect.findMany({ where: { projectId } });
    // Собирает реальные ID из входящих дефектов. d.id > 0 — отрицательные это временные ID новых дефектов с фронта, они не считаются
    const incomingIds = new Set(defects.filter((d) => d.id && d.id > 0).map((d) => d.id!));
    // Находит дефекты которые есть в БД но не пришли от фронта — значит пользователь их удалил
    const toDeleteIds = existing.filter((d) => !incomingIds.has(d.id)).map((d) => d.id);
    // Словарь временныйId → реальныйId — фронт использует отрицательные числа как временные ID для новых дефектов, после сохранения нужно вернуть им реальные
    const tempToSavedIdMap: Record<number, number> = {};


    await this.prisma.$transaction(async (tx) => {
      // Удаляет дефекты которые не пришли от фронта
      if (toDeleteIds.length) {
        await tx.projectPhoto.deleteMany({ where: { defectId: { in: toDeleteIds } } });
        await tx.defect.deleteMany({ where: { id: { in: toDeleteIds } } });
      }

      for (const d of defects) {
        const typeId = Number(d.typeId);
        const pages = Number(d.pages);
        // пропускает мусорные данные не ломая транзакцию
        if (!Number.isInteger(typeId) || typeId <= 0) continue;
        if (!Number.isInteger(pages) || pages <= 0) continue;

        // Три случая: ID положительный и существует в БД - обновляет.
        // ID отрицательный - создаёт новый и запоминает маппинг. 
        // ID не задан вообще - просто создаёт без маппинга
        if (d.id && d.id > 0 && existing.some((e) => e.id === d.id)) {
          await tx.defect.update({ where: { id: d.id }, data: { typeId, pages } });
        } else {
          const created = await tx.defect.create({ data: { projectId, typeId, pages } });
          if (d.id && d.id < 0) {
            tempToSavedIdMap[d.id] = created.id; // временный id - реальный id?
          }
        }
      }
    });

    // если есть id для удаления
    if (toDeleteIds.length) {
      this.purgeDefectTmpFolders(projectId, toDeleteIds);
    }

    return tempToSavedIdMap; // возвращаем словарь временныйId - реальныйId?
  }

  // Добавляет записи projectPhoto для секций (yandexPath пока null) - без дублей по filename
  async saveTempPhotos(
    projectId: number,
    photos: { section: string; originalName: string; storedName: string | null; order: number }[],
  ) {
    // Фильтрует фото которые есть в storedName (нет имени файла на диске - не надо сохранять)
    const newPhotos = photos.filter((p) => p.storedName);
    if (!newPhotos.length) return;

    // Создаёт записи projectPhoto для секций (yandexPath пока null) - без дублей по filename
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.projectPhoto.findMany({
        where: { projectId, defectId: null },
        select: { filename: true },
      });
      const existingNames = new Set(existing.map((p) => p.filename).filter(Boolean));
      // Исключает дубли - если файл с таким именем уже записан в БД, не создаёт повторно
      // Ранний выход если все фото уже есть
      const toCreate = newPhotos.filter((p) => !existingNames.has(p.storedName));
      if (!toCreate.length) return;

      // createMany — один INSERT для всех фото вместо отдельного на каждое. 
      // yandexPath: null — файл пока только на диске, на Яндекс ещё не загружен
      await tx.projectPhoto.createMany({
        data: toCreate.map((p) => ({
          projectId, section: p.section, originalName: p.originalName,
          order: p.order, filename: p.storedName, yandexPath: null,
        })),
      });
    });
  }

  // То же для фото дефекта - привязка к defectId
  async saveTempDefectPhotos(
    defectId: number,
    projectId: number,
    photos: { originalName: string; storedName: string | null; order: number }[],
  ) {
    const newPhotos = photos.filter((p) => p.storedName); // берем только фото, у которых есть имя файлва на диске
    if (!newPhotos.length) return;

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.projectPhoto.findMany({ // ищем фото которые уже есть в БД
        where: { defectId },
        select: { filename: true },
      });
      const existingNames = new Set(existing.map((p) => p.filename).filter(Boolean)); // создаем множество из имен фото которые уже есть в БД: Set {"uuid1.jpg", "uuid2.jpg"}
      // оставляем только те фото, которых еще нет в БД (в existingNames)
      const toCreate = newPhotos.filter((p) => !existingNames.has(p.storedName));
      if (!toCreate.length) return;

      // свзяывам фото с конкретным дефектом
      await tx.projectPhoto.createMany({
        data: toCreate.map((p) => ({
          projectId, defectId, originalName: p.originalName,
          order: p.order, filename: p.storedName, yandexPath: null,
        })),
      });
    });
  }

  // После Яндекса: полная замена секционных фото проекта (deleteMany + createMany)
  async savePhotos(
    projectId: number,
    photos: {
      section: string | null;
      defectId?: number | null;
      originalName: string;
      filename: string;
      yandexPath: string;
      order: number;
    }[],
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.projectPhoto.deleteMany({ where: { projectId, defectId: null } });
      await tx.projectPhoto.createMany({ data: photos.map((p) => ({ ...p, projectId })) });
    });
  }

  // Обновляет только пути на Диске у уже существующих фото дефектов
  async saveDefectPhotoYandexPaths(
    updates: { id: number; yandexPath: string; filename: string }[],
  ) {
    if (!updates.length) return; // не идем в БД, если обновлять нечего - выходим
    // Передаёт в транзакцию массив операций а не колбэк
    // Все update выполняются параллельно внутри одной транзакции
    // Обновляет только два поля
    await this.prisma.$transaction(
      updates.map((u) =>
        this.prisma.projectPhoto.update({
          where: { id: u.id },
          data: { yandexPath: u.yandexPath, filename: u.filename },
        }),
      ),
    );
  }

  /**
   * После удаления дефектов из БД - убираем их папки в uploads/tmp/{projectId}/__defect__id__{id}/.
   * Вызывается только после успешной транзакции saveDefects.
   */
  private purgeDefectTmpFolders(projectId: number, defectIds: number[]): void {
    if (!defectIds.length) return; // если нет id для удаления, выходим

    const tmpBase = path.join(process.cwd(), 'uploads', 'tmp', String(projectId)); // путь к папке с временными файлами
    let freedBytes = 0; // счетчик освобожденных байтов

    for (const defectId of defectIds) {
      const folder = path.join(tmpBase, `__defect__id__${defectId}`); // путь к папке с дефектом
      try {
        if (!fs.existsSync(folder)) continue; // если папка не существует, пропускаем
        freedBytes += this.safeDirSizeBytes(folder); // добавляем размер папки к счетчику
        fs.rmSync(folder, { recursive: true, force: true }); // удаляем папку
      } catch {
        // ignore — БД уже согласована, очистка диска
      }
    }

    // если освободилось место после удаления папки с дефектом
    if (freedBytes > 0) {
      try {
        this.bumpTmpUsageBytes(projectId, -freedBytes); // обновляем счетчик занятого места в .usage.json
      } catch {
        // ignore
      }
    }
  }

  // Удаление из БД + локальный tmp-файл, если ещё не выгружен на Яндекс (уменьшаем .usage.json)
  async deletePhotos(photoIds: number[]) {
    // ?.length — защита если передали null или undefined вместо массива
    if (!photoIds?.length) return;
    // Сначала загружает метаданные - нужны чтобы найти и удалить файлы на диске перед удалением из БД
    const photos = await this.prisma.projectPhoto.findMany({
      where: { id: { in: photoIds } },
      select: { id: true, projectId: true, defectId: true, section: true, filename: true, yandexPath: true },
    });

    // Удаляем локальные temp-файлы, если они ещё не выгружены на Яндекс
    // Накапливает сколько байт освободилось по каждому проекту - чтобы потом одним вызовом обновить счётчик (id проекта - сколько байт освободилось)
    const freedBytesByProject = new Map<number, number>();
    // перебираем фото
    for (const p of photos) {
      if (p.yandexPath) continue; // Файл уже на Яндексе - локальная копия не существует, нечего удалять
      if (!p.filename) continue; // Нет имени файла - не надо удалять

      // Восстанавливает путь к файлу - дефектные фото лежат в __defect__id__123, секционные в папке с именем секции
      const subfolder = p.defectId ? `__defect__id__${p.defectId}` : (p.section ?? 'misc');
      const filePath = path.join(process.cwd(), 'uploads', 'tmp', String(p.projectId), subfolder, p.filename);
      try {
        // Сначала читает размер файла, потом удаляет
        if (fs.existsSync(filePath)) {
          const st = fs.statSync(filePath); // читаем размер файла
          fs.unlinkSync(filePath); // удаляем файл
          freedBytesByProject.set(p.projectId, (freedBytesByProject.get(p.projectId) ?? 0) + st.size);
        }
      } catch {
        // ignore
      }
    }

    // если освободилось
    if (freedBytesByProject.size) {
      try {
        // перебираем проекты и освобожденные байты
        for (const [projectId, bytes] of freedBytesByProject) {
          this.bumpTmpUsageBytes(projectId, -bytes); // Отрицательный delta - уменьшает счётчик на освобожденные байты
        }
      } catch {
        // ignore
      }
    }

    // Удаляет из БД одним запросом все фото сразу - в самом конце, после успешной очистки диска
    return this.prisma.projectPhoto.deleteMany({ where: { id: { in: photoIds } } });
  }

  // PROJECTS
  // Возвращает проект по id (с данными ответственного)
  async getProjectById(projectId: number) {
    return this.prisma.project.findUnique({
      where: { id: projectId },
      include: { responsibleUser: { select: { firstName: true, lastName: true } } },
    });
  }

  // Возвращает все проекты (с данными ответственного), от новых к старым
  async getAllProjects() {
    const projects = await this.prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: { responsibleUser: { select: { firstName: true, lastName: true } } },
    });
    return projects.map((p) => ({
      ...p,
      responsible: p.responsibleUser
        ? `${p.responsibleUser.firstName} ${p.responsibleUser.lastName}`.trim()
        : '',
    }));
  }

  // Список для дашборда: админ — все проекты, сотрудник — только где он ответственный
  async getProjectsForUser(user: User) {
    const include = {
      responsibleUser: { select: { firstName: true, lastName: true } },
    };

    if (user.role === 'ADMIN') {
      const projects = await this.prisma.project.findMany({ orderBy: { createdAt: 'desc' }, include });
      return projects.map((p) => ({
        ...p,
        responsible: p.responsibleUser
          ? `${p.responsibleUser.firstName} ${p.responsibleUser.lastName}`.trim()
          : '',
      }));
    }

    const projects = await this.prisma.project.findMany({
      where: { responsibleId: user.id },
      orderBy: { createdAt: 'desc' },
      include,
    });
    return projects.map((p) => ({
      ...p,
      responsible: p.responsibleUser
        ? `${p.responsibleUser.firstName} ${p.responsibleUser.lastName}`.trim()
        : '',
    }));
  }

  // Обновляет даты проекта, можно передать null чтобы сбросить дату
  async updateDates(projectId: number, startDate: string | null, endDate: string | null) {
    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        startDate: startDate ? new Date(startDate) : null, // если передали строку конвертирует в объект Date
        endDate: endDate ? new Date(endDate) : null,
      },
    });
  }

  // После успешной выгрузки на Яндекс: ссылка на папку, статус «Завершен», дата архивации
  async finalizeProject(projectId: number, folderUrl: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: projectId },
        data: { folderUrl, status: 'Завершен', archivedAt: new Date() }, // обновляем 3 поля
      });
    });
  }

  // Ручной перевод в архив без выгрузки на Яндекс
  async archiveProject(projectId: number) {
    return this.prisma.project.update({
      where: { id: projectId },
      data: { status: 'Завершен', archivedAt: new Date() },
    });
  }

  // Вернуть из архива в «В работе», удаляет дату архивации
  async unarchiveProject(projectId: number) {
    return this.prisma.project.update({
      where: { id: projectId },
      data: { status: 'В работе', archivedAt: null },
    });
  }

  // Черновик «сколько страниц» по каждой секции
  // upsert — если черновик для этого проекта уже есть обновляет sections, если нет — создаёт новую запись
  // sections хранится как JSON-поле в БД
  async saveDraftSections(
    projectId: number,
    sectionsState: Record<string, { pages: number }>,
  ) {
    return this.prisma.projectDraft.upsert({
      where: { projectId },
      update: { sections: sectionsState },
      create: { projectId, sections: sectionsState },
    });
  }

  // Возвращает черновик проекта
  // ?.sections — если черновика нет draft будет null
  async getDraft(projectId: number) {
    const draft = await this.prisma.projectDraft.findUnique({ where: { projectId } });
    return draft?.sections ?? null;
  }

  // Физическое удаление из БД проектов, в архиве дольше 3 месяцев
  async deleteOldArchivedProjects() {
    const threeMonthsAgo = new Date(); // текущая дата
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3); // вычитаем 3 месяца
    return this.prisma.project.deleteMany({ where: { archivedAt: { lt: threeMonthsAgo } } }); // удаляем проекты у которых archivedAt меньше 3 месяцев
  }

  // Cron: раз в сутки автоматически удаляет проекты находящиеся в архиве больше 3 месяцев
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleOldArchivedProjects() {
    const deleted = await this.deleteOldArchivedProjects(); 
    this.logger.log(`Удалено старых архивных проектов: ${deleted.count}`);
  }
}