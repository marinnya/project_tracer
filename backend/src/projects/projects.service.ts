import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
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

type UploadFile = {
  originalname: string;
  buffer?: Buffer;
  path?: string;
  mimetype: string;
  section?: string | null;
  defectId?: number;
  defectTypeName?: string;
  order?: number;
};

type PhotoMeta = {
  originalName: string;
  section: string | null;
  defectId?: number;
  defectTypeName?: string;
  order: number;
  yandexPath?: string | null;
};

type SaveDraftBody = {
  sections: string;
  sectionPhotos: string;
  defects: string;
  deletedPhotos?: string;
  fileToSection?: string;
  fileKeys?: string;
};

type SaveDraftFilesBody = {
  fileToSection?: string;
  fileKeys?: string;
  sectionPhotos?: string;
  defectPhotos?: string;
};

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);
  private readonly baseUrl = 'https://cloud-api.yandex.net/v1/disk/resources';
  private readonly BATCH_SIZE = 10;
  private readonly MAX_PAGES_PER_SECTION = 300;
  private readonly MAX_PAGES_PER_DEFECT = 300;
  private readonly MAX_PHOTOS_PER_SECTION = 300;
  private readonly MAX_PHOTOS_PER_DEFECT = 300;
  private readonly MAX_PHOTOS_PER_PROJECT = 2000;

  private readonly sseClients = new Map<number, Response>();

  private readonly sectionKeyMap: Record<string, string> = {
    'Титульный лист': 'Титульный',
    'Технические данные объекта контроля': 'Техданные',
    'План-схема склада': 'План',
    'Лист для фиксации повреждений': 'Повреждения',
    'Лист для фиксации отклонений в вертикальной плоскости': 'Отклонения',
    'Лист для фиксации момента затяжки болтовых и анкерных соединений': 'Соединения',
    'Лист для эскизов': 'Эскизы',
    'Протоколы испытаний': 'Испытания',
    'Дополнительная информация': 'Допинфо',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly oneCService: OneCService,
  ) {}

  // ─── SSE ────────────────────────────────────────────────────────────────────

  registerSseClient(projectId: number, res: Response) {
    this.sseClients.set(projectId, res);
  }

  removeSseClient(projectId: number) {
    this.sseClients.delete(projectId);
  }

  sendProgress(projectId: number, percent: number, done = false) {
    const client = this.sseClients.get(projectId);
    if (!client) return;
    client.write(`data: ${JSON.stringify({ percent, done })}\n\n`);
    if (done) {
      client.end();
      this.sseClients.delete(projectId);
    }
  }

  // ─── SAVE DRAFT ─────────────────────────────────────────────────────────────

  // Вся логика сохранения черновика перенесена из контроллера сюда
  async saveDraft(
    projectId: number,
    files: Express.Multer.File[],
    body: SaveDraftBody,
  ) {
    this.validateDraftLimits(body);

    const clientKeyToStoredName = this.persistIncomingFiles(
      projectId,
      files,
      body.fileToSection,
      body.fileKeys,
    );

    // Сохраняем черновик секций
    const sections = JSON.parse(body.sections) as Record<string, { pages: number }>;
    await this.saveDraftSections(projectId, sections);

    // Удаляем помеченные фото
    const deletedPhotos = JSON.parse(body.deletedPhotos ?? '[]') as number[];
    if (deletedPhotos.length) {
      await this.deletePhotos(deletedPhotos);
    }

    // Сохраняем дефекты
    const rawDefects = JSON.parse(body.defects) as {
      id?: number;
      typeId: number | string;
      pages: number | string;
      newPhotos: { originalName: string; clientKey: string; order: number }[];
    }[];

    const defects = rawDefects
      .filter((d) => d.typeId !== '' && d.typeId !== null && Number(d.pages) > 0)
      .map((d) => ({
        id: d.id,
        typeId: Number(d.typeId),
        pages: Number(d.pages),
        newPhotos: d.newPhotos,
      }));

    const defectIdMap = await this.saveDefects(projectId, defects);

    for (const d of defects) {
      if (!d.newPhotos?.length) continue;
      const savedDefectId = d.id && d.id > 0 ? d.id : (d.id ? defectIdMap[d.id] : undefined);
      if (!savedDefectId) continue;

      const photosWithStoredName = d.newPhotos.map((p) => ({
        originalName: p.originalName,
        storedName: clientKeyToStoredName[p.clientKey] ?? null,
        order: p.order,
      }));

      await this.saveTempDefectPhotos(savedDefectId, projectId, photosWithStoredName);
    }

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

    return { message: 'Черновик сохранён', defectIdMap };
  }

  async saveDraftFiles(
    projectId: number,
    files: Express.Multer.File[],
    body: SaveDraftFilesBody,
  ) {
    this.validateDraftFileBatchLimits(body);

    const clientKeyToStoredName = this.persistIncomingFiles(
      projectId,
      files,
      body.fileToSection,
      body.fileKeys,
    );

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
      if (defectPhotos.some((p) => Number(p.defectId) <= 0)) {
        throw new BadRequestException(
          'Ошибка сохранения файлов дефектов: получен временный defectId. Сначала сохраните черновик, затем повторите сохранение файлов.',
        );
      }
      const byDefect = new Map<number, { originalName: string; storedName: string | null; order: number }[]>();
      for (const p of defectPhotos) {
        const list = byDefect.get(p.defectId) ?? [];
        list.push({
          originalName: p.originalName,
          storedName: p.clientKey ? (clientKeyToStoredName[p.clientKey] ?? null) : null,
          order: p.order,
        });
        byDefect.set(p.defectId, list);
      }
      for (const [defectId, defectFiles] of byDefect) {
        await this.saveTempDefectPhotos(defectId, projectId, defectFiles);
      }
    }

    return { message: 'Файлы черновика сохранены' };
  }

  private persistIncomingFiles(
    projectId: number,
    files: Express.Multer.File[],
    fileToSectionRaw?: string,
    fileKeysRaw?: string,
  ) {
    const fileToSection: Record<string, string> = fileToSectionRaw
      ? JSON.parse(fileToSectionRaw)
      : {};
    const fileKeys: string[] = fileKeysRaw ? JSON.parse(fileKeysRaw) : [];
    const clientKeyToStoredName: Record<string, string> = {};

    if (!files?.length) return clientKeyToStoredName;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const decodedOriginalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const clientKey = fileKeys[i] ?? decodedOriginalName;
      const subfolder = fileToSection[clientKey] ?? 'misc';
      const storedName = path.basename(file.filename ?? '');
      if (!storedName) continue;

      const uploadPath = path.join(process.cwd(), 'uploads', 'tmp', String(projectId), subfolder);
      const targetPath = path.join(uploadPath, storedName);
      fs.mkdirSync(uploadPath, { recursive: true });

      if (file.path) {
        try {
          fs.renameSync(file.path, targetPath);
        } catch {
          fs.copyFileSync(file.path, targetPath);
          fs.unlinkSync(file.path);
        }
      } else {
        const ext = path.extname(decodedOriginalName);
        const fallbackName = `${uuidv4()}${ext}`;
        fs.writeFileSync(path.join(uploadPath, fallbackName), file.buffer!);
        clientKeyToStoredName[clientKey] = fallbackName;
        this.logger.log(`Сохранён файл: ${decodedOriginalName} -> ${fallbackName} (папка: ${subfolder})`);
        continue;
      }

      clientKeyToStoredName[clientKey] = storedName;
      this.logger.log(`Сохранён файл: ${decodedOriginalName} -> ${storedName} (папка: ${subfolder})`);
    }

    return clientKeyToStoredName;
  }

  private validateDraftLimits(body: SaveDraftBody) {
    const sections = JSON.parse(body.sections ?? '{}') as Record<string, { pages: number }>;
    const defects = JSON.parse(body.defects ?? '[]') as Array<{ pages: number | string }>;
    const sectionPhotos = JSON.parse(body.sectionPhotos ?? '[]') as Array<{ section: string }>;

    let totalPages = 0;
    for (const [sectionName, sectionValue] of Object.entries(sections)) {
      const pages = Number(sectionValue?.pages ?? 0);
      if (!Number.isInteger(pages) || pages < 0 || pages > this.MAX_PAGES_PER_SECTION) {
        throw new BadRequestException(
          `Раздел "${sectionName}": количество страниц должно быть от 0 до ${this.MAX_PAGES_PER_SECTION}`,
        );
      }
      totalPages += pages;
    }

    for (const defect of defects) {
      const pages = Number(defect.pages ?? 0);
      if (!Number.isInteger(pages) || pages < 0 || pages > this.MAX_PAGES_PER_DEFECT) {
        throw new BadRequestException(
          `Для дефекта количество страниц должно быть от 0 до ${this.MAX_PAGES_PER_DEFECT}`,
        );
      }
      totalPages += pages;
    }

    if (totalPages > this.MAX_PHOTOS_PER_PROJECT) {
      throw new BadRequestException(
        `Суммарное количество фото/страниц по проекту не может превышать ${this.MAX_PHOTOS_PER_PROJECT}`,
      );
    }

    const sectionPhotoCount = new Map<string, number>();
    for (const photo of sectionPhotos) {
      const section = photo.section ?? 'misc';
      sectionPhotoCount.set(section, (sectionPhotoCount.get(section) ?? 0) + 1);
    }
    for (const [section, count] of sectionPhotoCount) {
      if (count > this.MAX_PHOTOS_PER_SECTION) {
        throw new BadRequestException(
          `Раздел "${section}": нельзя прикрепить больше ${this.MAX_PHOTOS_PER_SECTION} фото`,
        );
      }
    }
  }

  private validateDraftFileBatchLimits(body: SaveDraftFilesBody) {
    const sectionPhotos = JSON.parse(body.sectionPhotos ?? '[]') as Array<{ section: string }>;
    const defectPhotos = JSON.parse(body.defectPhotos ?? '[]') as Array<{ defectId: number }>;

    const sectionPhotoCount = new Map<string, number>();
    for (const photo of sectionPhotos) {
      const section = photo.section ?? 'misc';
      sectionPhotoCount.set(section, (sectionPhotoCount.get(section) ?? 0) + 1);
    }
    for (const [section, count] of sectionPhotoCount) {
      if (count > this.MAX_PHOTOS_PER_SECTION) {
        throw new BadRequestException(
          `Раздел "${section}": нельзя прикрепить больше ${this.MAX_PHOTOS_PER_SECTION} фото за сохранение`,
        );
      }
    }

    const defectPhotoCount = new Map<number, number>();
    for (const photo of defectPhotos) {
      const defectId = Number(photo.defectId);
      defectPhotoCount.set(defectId, (defectPhotoCount.get(defectId) ?? 0) + 1);
    }
    for (const [defectId, count] of defectPhotoCount) {
      if (count > this.MAX_PHOTOS_PER_DEFECT) {
        throw new BadRequestException(
          `Дефект #${defectId}: нельзя прикрепить больше ${this.MAX_PHOTOS_PER_DEFECT} фото за сохранение`,
        );
      }
    }
  }

  // ─── UPLOAD TO YANDEX ───────────────────────────────────────────────────────

  // Вся логика загрузки перенесена из контроллера сюда
  async uploadProjectFiles(
    projectId: number,
    projectName: string,
    photos: PhotoMeta[],
  ) {
    const savedPhotos = await this.getProjectPhotos(projectId);
    const savedDefects = await this.getDefects(projectId);

    const defectPhotosFlat = savedDefects.flatMap((d) =>
      d.photos.map((p) => ({ ...p, typeName: d.defectType.name })),
    );

    // Обогащаем метаданные фото данными из БД
    const photosWithMeta = photos.map((p) => {
      let match: { id: number; yandexPath: string | null; filename: string | null } | undefined;

      if (p.section === 'Дефекты') {
        const found = defectPhotosFlat.find(
          (sp) =>
            (
              (p.defectId ? sp.defectId === p.defectId : sp.typeName === p.defectTypeName)
            ) &&
            sp.originalName === p.originalName &&
            sp.order === p.order,
        );
        match = found
          ? { id: found.id, yandexPath: found.yandexPath, filename: found.filename }
          : undefined;
      } else {
        const found = savedPhotos.find(
          (sp) =>
            sp.section === p.section &&
            sp.originalName === p.originalName &&
            sp.order === p.order,
        );
        match = found
          ? { id: found.id, yandexPath: found.yandexPath, filename: found.filename }
          : undefined;
      }

      return {
        ...p,
        dbId: match?.id ?? null,
        yandexPath: match?.yandexPath ?? null,
        storedName: match?.filename ?? null,
      };
    });

    const tmpDir = path.join(process.cwd(), 'uploads', 'tmp', String(projectId));
    this.logger.log(`Всего фото в запросе: ${photos.length}`);

    const files = await this.readTempFiles(tmpDir, photosWithMeta);
    this.logger.log(`Файлов для загрузки: ${files.length}`);

    const { folderUrl, renamedPhotos } = await this.uploadToYandex(
      files,
      projectName,
      photosWithMeta,
      (uploaded, total) => {
        const percent = total === 0 ? 95 : Math.round(10 + (uploaded / total) * 85);
        this.sendProgress(projectId, Math.min(percent, 95));
      },
    );

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
      .filter((p) => p.section !== 'Дефекты')
      .map((p) => {
        const match = findRenamed(p);
        const filename = match?.filename ?? p.originalName;
        return {
          section: p.section,
          defectId: null,
          originalName: p.originalName,
          filename,
          yandexPath: `${projectName}/${p.section ?? 'Дефекты'}/${filename}`,
          order: p.order,
        };
      });

    await this.savePhotos(projectId, sectionPhotosWithPath);

    // Обновляем пути для фото дефектов
    const defectPhotoUpdates = photos
      .filter((p) => p.section === 'Дефекты')
      .flatMap((p) => {
        const match = findRenamed(p);
        const filename = match?.filename ?? p.originalName;
        const yandexPath = `${projectName}/${p.section ?? 'Дефекты'}/${filename}`;
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

    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    return { message: 'Файлы загружены', folderUrl };
  }

  // ─── YANDEX DISK ────────────────────────────────────────────────────────────

  private getHeaders() {
    return { Authorization: `OAuth ${process.env.YANDEX_TOKEN}` };
  }

  private getRenamedFilename(
    originalName: string,
    section: string | null,
    defectTypeName: string | undefined,
    order: number,
  ): string {
    const ext = originalName.split('.').pop() ?? 'jpg';
    if (defectTypeName) {
      return `${defectTypeName.toLowerCase()}${order}.${ext}`;
    }
    const prefix = this.sectionKeyMap[section ?? ''] ?? (section ?? 'файл').toLowerCase();
    return `${prefix}${order}.${ext}`;
  }

  private async createFolder(folderPath: string): Promise<void> {
    try {
      await axios.put(
        `${this.baseUrl}?path=${encodeURIComponent(folderPath)}`,
        undefined,
        { headers: this.getHeaders() },
      );
    } catch (e: unknown) {
      const err = e as { response?: { status?: number }; message?: string };
      if (err.response?.status === 409) return;
      throw new InternalServerErrorException(`Ошибка создания папки: ${err.message}`);
    }
  }

  private async uploadFile(file: UploadFile, folderPath: string): Promise<void> {
    const filename = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const filePath = `${encodeURIComponent(folderPath)}/${encodeURIComponent(filename)}`;

    const { data } = await axios.get(
      `${this.baseUrl}/upload?path=${filePath}&overwrite=true`,
      { headers: this.getHeaders() },
    );

    const fileBuffer = file.buffer ?? fs.readFileSync(file.path!);
    await axios.put(data.href, fileBuffer, {
      headers: { 'Content-Type': file.mimetype },
    });
  }

  private async getPublicUrl(folderName: string): Promise<string> {
    const encodedPath = encodeURIComponent(folderName);
    await axios.put(`${this.baseUrl}/publish?path=${encodedPath}`, undefined, {
      headers: this.getHeaders(),
    });
    const { data } = await axios.get(`${this.baseUrl}?path=${encodedPath}`, {
      headers: this.getHeaders(),
    });
    return data.public_url;
  }

  async readTempFiles(
    tmpDir: string,
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
    const newPhotos = photos.filter((p) => !p.yandexPath);
    if (!newPhotos.length) return [];

    const tempFilePathIndex = new Map<string, string>();
    const indexTmpFiles = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          indexTmpFiles(fullPath);
        } else if (!tempFilePathIndex.has(item.name)) {
          tempFilePathIndex.set(item.name, fullPath);
        }
      }
    };
    indexTmpFiles(tmpDir);

    const result: UploadFile[] = [];

    for (const photo of newPhotos) {
      const subfolder = photo.defectId
        ? `__defect__id__${photo.defectId}`
        : (photo.section ?? 'misc');

      const fileName = photo.storedName ?? photo.originalName;
      const filePath = path.join(tmpDir, subfolder, fileName);
      const fallbackPath = tempFilePathIndex.get(fileName);
      const resolvedPath = fs.existsSync(filePath) ? filePath : fallbackPath;

      if (!resolvedPath) {
        this.logger.warn(
          `Файл не найден на диске, пропускаем: ${photo.originalName} ` +
          `(storedName: ${fileName}, подпапка: ${subfolder})`,
        );
        continue;
      }

      result.push({
        originalname: Buffer.from(photo.originalName, 'utf8').toString('latin1'),
        path: resolvedPath,
        mimetype: 'application/octet-stream',
        section: photo.section,
        defectId: photo.defectId,
        defectTypeName: photo.defectTypeName,
        order: photo.order,
        buffer: undefined,
      });
    }

    return result;
  }

  async uploadToYandex(
    files: UploadFile[],
    projectName: string,
    photos: {
      originalName: string;
      section: string | null;
      defectId?: number;
      defectTypeName?: string;
      order: number;
      yandexPath?: string | null;
    }[],
    onProgress?: (uploaded: number, total: number) => void,
  ): Promise<{
    message: string;
    folderUrl: string;
    renamedPhotos: {
      originalName: string;
      section: string | null;
      defectTypeName?: string;
      order: number;
      filename: string;
    }[];
  }> {
    await this.createFolder(projectName);

    const folders = new Set<string>();
    photos.forEach((p) => folders.add(p.section ?? 'Дефекты'));
    for (const folder of folders) {
      await this.createFolder(`${projectName}/${folder}`);
    }

    const newPhotos = photos.filter((p) => !p.yandexPath);
    const alreadyUploaded = photos.filter((p) => p.yandexPath);

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

    for (const p of alreadyUploaded) {
      const existingFilename = p.yandexPath!.split('/').pop() ?? p.originalName;
      renamedPhotos.push({ originalName: p.originalName, section: p.section, defectTypeName: p.defectTypeName, order: p.order, filename: existingFilename });
    }

    const totalNew = files.length;
    let uploadedCount = 0;

    for (let i = 0; i < files.length; i += this.BATCH_SIZE) {
      const batch = files.slice(i, i + this.BATCH_SIZE);

      await Promise.all(
        batch.map((file) => {
          const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
          const fileSection = file.section ?? 'Дефекты';
          const fileDefectId = file.defectId;
          const fileDefectTypeName = file.defectTypeName;
          const fileOrder = file.order ?? i + 1;
          const key = `${originalName}|||${fileSection}|||${fileDefectId ?? ''}|||${fileOrder}`;
          const meta = photoMap.get(key);

          const section = meta?.section ?? fileSection;
          const order = meta?.order ?? fileOrder;
          const defectTypeName = meta?.defectTypeName ?? fileDefectTypeName;

          const renamedFilename = this.getRenamedFilename(originalName, section, defectTypeName, order);
          renamedPhotos.push({ originalName, section, defectTypeName, order, filename: renamedFilename });

          const renamedFile: UploadFile = {
            ...file,
            originalname: Buffer.from(renamedFilename).toString('latin1'),
          };

          return this.uploadFile(renamedFile, `${projectName}/${section}`).catch((e: unknown) => {
            const message = e instanceof Error ? e.message : String(e);
            throw new InternalServerErrorException(`Ошибка загрузки файла ${originalName}: ${message}`);
          });
        }),
      );

      uploadedCount = Math.min(i + this.BATCH_SIZE, totalNew);
      onProgress?.(uploadedCount, totalNew);
    }

    const folderUrl = await this.getPublicUrl(projectName);
    return { message: 'Файлы успешно загружены', folderUrl, renamedPhotos };
  }

  // ─── PHOTOS & DEFECTS ───────────────────────────────────────────────────────

  async getProjectPhotos(projectId: number) {
    return this.prisma.projectPhoto.findMany({
      where: { projectId, defectId: null },
      orderBy: [{ section: 'asc' }, { order: 'asc' }],
    });
  }

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
      seenTypeIds.add(typeId);
    }

    const existing = await this.prisma.defect.findMany({ where: { projectId } });
    const incomingIds = new Set(defects.filter((d) => d.id && d.id > 0).map((d) => d.id!));
    const toDeleteIds = existing.filter((d) => !incomingIds.has(d.id)).map((d) => d.id);
    const tempToSavedIdMap: Record<number, number> = {};

    await this.prisma.$transaction(async (tx) => {
      if (toDeleteIds.length) {
        await tx.projectPhoto.deleteMany({ where: { defectId: { in: toDeleteIds } } });
        await tx.defect.deleteMany({ where: { id: { in: toDeleteIds } } });
      }

      for (const d of defects) {
        const typeId = Number(d.typeId);
        const pages = Number(d.pages);
        if (!Number.isInteger(typeId) || typeId <= 0) continue;
        if (!Number.isInteger(pages) || pages <= 0) continue;

        if (d.id && d.id > 0 && existing.some((e) => e.id === d.id)) {
          await tx.defect.update({ where: { id: d.id }, data: { typeId, pages } });
        } else {
          const created = await tx.defect.create({ data: { projectId, typeId, pages } });
          if (d.id && d.id < 0) {
            tempToSavedIdMap[d.id] = created.id;
          }
        }
      }
    });

    return tempToSavedIdMap;
  }

  async saveTempPhotos(
    projectId: number,
    photos: { section: string; originalName: string; storedName: string | null; order: number }[],
  ) {
    const newPhotos = photos.filter((p) => p.storedName);
    if (!newPhotos.length) return;

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.projectPhoto.findMany({
        where: { projectId, defectId: null },
        select: { filename: true },
      });
      const existingNames = new Set(existing.map((p) => p.filename).filter(Boolean));
      const toCreate = newPhotos.filter((p) => !existingNames.has(p.storedName));
      if (!toCreate.length) return;

      await tx.projectPhoto.createMany({
        data: toCreate.map((p) => ({
          projectId, section: p.section, originalName: p.originalName,
          order: p.order, filename: p.storedName, yandexPath: null,
        })),
      });
    });
  }

  async saveTempDefectPhotos(
    defectId: number,
    projectId: number,
    photos: { originalName: string; storedName: string | null; order: number }[],
  ) {
    const newPhotos = photos.filter((p) => p.storedName);
    if (!newPhotos.length) return;

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.projectPhoto.findMany({
        where: { defectId },
        select: { filename: true },
      });
      const existingNames = new Set(existing.map((p) => p.filename).filter(Boolean));
      const toCreate = newPhotos.filter((p) => !existingNames.has(p.storedName));
      if (!toCreate.length) return;

      await tx.projectPhoto.createMany({
        data: toCreate.map((p) => ({
          projectId, defectId, originalName: p.originalName,
          order: p.order, filename: p.storedName, yandexPath: null,
        })),
      });
    });
  }

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

  async saveDefectPhotoYandexPaths(
    updates: { id: number; yandexPath: string; filename: string }[],
  ) {
    if (!updates.length) return;
    await this.prisma.$transaction(
      updates.map((u) =>
        this.prisma.projectPhoto.update({
          where: { id: u.id },
          data: { yandexPath: u.yandexPath, filename: u.filename },
        }),
      ),
    );
  }

  async deletePhotos(photoIds: number[]) {
    if (!photoIds?.length) return;
    return this.prisma.projectPhoto.deleteMany({ where: { id: { in: photoIds } } });
  }

  // ─── PROJECTS ───────────────────────────────────────────────────────────────

  async getProjectById(projectId: number) {
    return this.prisma.project.findUnique({
      where: { id: projectId },
      include: { responsibleUser: { select: { firstName: true, lastName: true } } },
    });
  }

  async getAllProjects() {
    return this.prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: { responsibleUser: { select: { firstName: true, lastName: true } } },
    });
  }

  async getProjectsForUser(user: User) {
    const include = {
      responsibleUser: { select: { firstName: true, lastName: true } },
    };

    if (user.role === 'ADMIN') {
      return this.prisma.project.findMany({ orderBy: { createdAt: 'desc' }, include });
    }

    return this.prisma.project.findMany({
      where: { responsibleId: user.id },
      orderBy: { createdAt: 'desc' },
      include,
    });
  }

  async updateDates(projectId: number, startDate: string | null, endDate: string | null) {
    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
      },
    });
  }

  async finalizeProject(projectId: number, folderUrl: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: projectId },
        data: { folderUrl, status: 'Завершен', archivedAt: new Date() },
      });
    });
    // отправка в 1С — вне транзакции, чтобы не откатывать коммит при ошибке 1С
    await this.oneCService.sendProjectUpdate(projectId).catch((e: unknown) => {
      this.logger.warn(`Ошибка отправки в 1С: ${e instanceof Error ? e.message : e}`);
    });
  }

  async archiveProject(projectId: number) {
    return this.prisma.project.update({
      where: { id: projectId },
      data: { status: 'Завершен', archivedAt: new Date() },
    });
  }

  async unarchiveProject(projectId: number) {
    return this.prisma.project.update({
      where: { id: projectId },
      data: { status: 'В работе', archivedAt: null },
    });
  }

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

  async getDraft(projectId: number) {
    const draft = await this.prisma.projectDraft.findUnique({ where: { projectId } });
    return draft?.sections ?? null;
  }

  async deleteOldArchivedProjects() {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    return this.prisma.project.deleteMany({ where: { archivedAt: { lt: threeMonthsAgo } } });
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleOldArchivedProjects() {
    const deleted = await this.deleteOldArchivedProjects();
    this.logger.log(`Удалено старых архивных проектов: ${deleted.count}`);
  }
}