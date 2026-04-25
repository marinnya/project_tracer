import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import { Express } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OneCService } from '../integrations/oneC/onec.service';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';

type UploadFile = {
  originalname: string;
  buffer?: Buffer;
  path?: string;
  mimetype: string;
  section?: string | null;
  defectTypeName?: string;
  order?: number;
};

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);
  private readonly baseUrl = 'https://cloud-api.yandex.net/v1/disk/resources';
  private readonly BATCH_SIZE = 10;

  private readonly sectionKeyMap: Record<string, string> = {
    'Титульный лист': 'титульный',
    'Технические данные объекта контроля': 'техданные',
    'План-схема склада': 'план',
    'Лист для фиксации повреждений': 'повреждения',
    'Лист для фиксации отклонений в вертикальной плоскости': 'отклонения',
    'Лист для фиксации момента затяжки болтовых и анкерных соединений': 'болты',
    'Лист для эскизов': 'эскизы',
    'Дополнительная информация': 'допинфо',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly oneCService: OneCService,
  ) {}

  private getHeaders() {
    return { Authorization: `OAuth ${process.env.YANDEX_TOKEN}` };
  }

  private getRenamedFilename(
    originalName: string,
    section: string | null,
    defectTypeName: string | undefined,
    order: number
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
      const err = e as { response?: { status?: number; data?: unknown }; message?: string };
      if (err.response?.status === 409) return;
      throw new InternalServerErrorException(`Ошибка создания папки: ${err.message}`);
    }
  }

  async getProjectPhotos(projectId: number) {
    return this.prisma.projectPhoto.findMany({
      where: { projectId, defectId: null },
      orderBy: [{ section: 'asc' }, { order: 'asc' }],
    });
  }

  async getDefects(projectId: number) {
    return this.prisma.defect.findMany({
      where: { projectId },
      include: { photos: { orderBy: { order: 'asc' } } },
      orderBy: { id: 'asc' },
    });
  }

  async saveDefects(projectId: number, defects: {
    id?: number;
    typeId: number;
    typeName: string;
    pages: number;
  }[]) {
    const existing = await this.prisma.defect.findMany({ where: { projectId } });
    const existingIds = new Set(existing.map(d => d.id));

    for (const d of defects) {
      const typeId = Number(d.typeId);
      const pages = Number(d.pages);
      if (!Number.isInteger(typeId) || typeId <= 0) continue;
      if (!Number.isInteger(pages) || pages <= 0) continue;

      if (d.id && existingIds.has(d.id)) {
        await this.prisma.defect.update({
          where: { id: d.id },
          data: { typeId, typeName: d.typeName, pages },
        });
      } else {
        await this.prisma.defect.create({
          data: { projectId, typeId, typeName: d.typeName, pages },
        });
      }
    }

    const incomingIds = new Set(defects.filter(d => d.id).map(d => d.id!));
    const toDelete = existing.filter(d => !incomingIds.has(d.id)).map(d => d.id);
    if (toDelete.length) {
      await this.prisma.defect.deleteMany({ where: { id: { in: toDelete } } });
    }
  }

  async saveTempPhotos(
    projectId: number,
    photos: { section: string; originalName: string; storedName: string | null; order: number }[],
  ) {
    const existing = await this.prisma.projectPhoto.findMany({
      where: { projectId, defectId: null },
      select: { filename: true },
    });
    const existingStoredNames = new Set(existing.map(p => p.filename).filter(Boolean));
    const newPhotos = photos.filter(p => p.storedName && !existingStoredNames.has(p.storedName));
    if (!newPhotos.length) return;

    return this.prisma.projectPhoto.createMany({
      data: newPhotos.map(p => ({
        projectId,
        section: p.section,
        originalName: p.originalName,
        order: p.order,
        filename: p.storedName,
        yandexPath: null,
      })),
    });
  }

  async saveTempDefectPhotos(
    defectId: number,
    projectId: number,
    photos: { originalName: string; storedName: string | null; order: number }[],
  ) {
    const existing = await this.prisma.projectPhoto.findMany({
      where: { defectId },
      select: { filename: true },
    });
    const existingStoredNames = new Set(existing.map(p => p.filename).filter(Boolean));
    const newPhotos = photos.filter(p => p.storedName && !existingStoredNames.has(p.storedName));
    if (!newPhotos.length) return;

    return this.prisma.projectPhoto.createMany({
      data: newPhotos.map(p => ({
        projectId,
        defectId,
        originalName: p.originalName,
        order: p.order,
        filename: p.storedName,
        yandexPath: null,
      })),
    });
  }

  // читаем только НОВЫЕ файлы — те у которых нет yandexPath.
  // если файл не найден на диске — пропускаем с предупреждением:
  // это фото из уже загруженного проекта у которого match не сработал,
  // оно уже есть на Яндекс.Диске и будет взято из alreadyUploaded в uploadToYandex.
  async readTempFiles(
    tmpDir: string,
    photos: {
      originalName: string;
      section: string | null;
      defectTypeName?: string;
      order?: number;
      yandexPath?: string | null;
      storedName?: string | null;
    }[],
  ): Promise<UploadFile[]> {
    const newPhotos = photos.filter(p => !p.yandexPath);
    if (!newPhotos.length) return [];

    const result: UploadFile[] = [];

    for (const photo of newPhotos) {
      const subfolder = photo.defectTypeName
        ? `__defect__${photo.defectTypeName}`
        : (photo.section ?? 'misc');

      const fileName = photo.storedName ?? photo.originalName;
      const filePath = path.join(tmpDir, subfolder, fileName);

      if (!fs.existsSync(filePath)) {
        // файл не найден на диске — скорее всего уже был загружен на Яндекс.Диск ранее
        this.logger.warn(
          `Файл не найден на диске, пропускаем: ${photo.originalName} ` +
          `(storedName: ${fileName}, подпапка: ${subfolder}) — возможно уже загружен на Яндекс.Диск`
        );
        continue;
      }

      result.push({
        originalname: Buffer.from(photo.originalName, 'utf8').toString('latin1'),
        path: filePath,
        mimetype: 'application/octet-stream',
        section: photo.section,
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
      defectTypeName?: string;
      order: number;
      yandexPath?: string | null;
    }[],
  ): Promise<{
    message: string;
    folderUrl: string;
    renamedPhotos: { originalName: string; section: string | null; defectTypeName?: string; order: number; filename: string }[];
  }> {
    await this.createFolder(projectName);

    const folders = new Set<string>();
    photos.forEach(p => folders.add(p.section ?? 'дефекты'));
    for (const folder of folders) {
      await this.createFolder(`${projectName}/${folder}`);
    }

    const newPhotos = photos.filter(p => !p.yandexPath);
    const alreadyUploaded = photos.filter(p => p.yandexPath);

    // составной ключ: originalName + section + defectTypeName + order
    const photoMap = new Map<string, { section: string | null; order: number; defectTypeName?: string }>();
    for (const photo of newPhotos) {
      const key = `${photo.originalName}|||${photo.section ?? ''}|||${photo.defectTypeName ?? ''}|||${photo.order}`;
      photoMap.set(key, {
        section: photo.section,
        order: photo.order,
        defectTypeName: photo.defectTypeName,
      });
    }

    const renamedPhotos: { originalName: string; section: string | null; defectTypeName?: string; order: number; filename: string }[] = [];

    // уже загруженные — берём имя из существующего yandexPath
    for (const p of alreadyUploaded) {
      const existingFilename = p.yandexPath!.split('/').pop() ?? p.originalName;
      renamedPhotos.push({
        originalName: p.originalName,
        section: p.section,
        defectTypeName: p.defectTypeName,
        order: p.order,
        filename: existingFilename,
      });
    }

    for (let i = 0; i < files.length; i += this.BATCH_SIZE) {
      const batch = files.slice(i, i + this.BATCH_SIZE);

      await Promise.all(
        batch.map(file => {
          const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
          const fileSection = file.section ?? 'дефекты';
          const fileDefectTypeName = file.defectTypeName;
          const fileOrder = file.order ?? i + 1;
          const key = `${originalName}|||${fileSection}|||${fileDefectTypeName ?? ''}|||${fileOrder}`;
          const meta = photoMap.get(key);

          const section = meta?.section ?? fileSection;
          const order = meta?.order ?? fileOrder;
          const defectTypeName = meta?.defectTypeName ?? fileDefectTypeName;

          const renamedFilename = this.getRenamedFilename(originalName, section, defectTypeName, order);
          renamedPhotos.push({ originalName, section, defectTypeName, order, filename: renamedFilename });

          const folderPath = `${projectName}/${section}`;
          const renamedFile: UploadFile = {
            ...file,
            originalname: Buffer.from(renamedFilename).toString('latin1'),
          };

          return this.uploadFile(renamedFile, folderPath).catch((e: unknown) => {
            const message = e instanceof Error ? e.message : String(e);
            throw new InternalServerErrorException(`Ошибка загрузки файла ${originalName}: ${message}`);
          });
        })
      );
    }

    const folderUrl = await this.getPublicUrl(projectName);
    return { message: 'Файлы успешно загружены', folderUrl, renamedPhotos };
  }

  // сохраняет yandexPath для секционных фото (пересоздаёт записи)
  async savePhotos(
    projectId: number,
    photos: {
      section: string | null;
      defectId?: number | null;
      originalName: string;
      filename: string;
      yandexPath: string;
      order: number;
    }[]
  ) {
    // пересоздаём только секционные фото (не дефекты)
    await this.prisma.projectPhoto.deleteMany({
      where: { projectId, defectId: null },
    });

    return this.prisma.projectPhoto.createMany({
      data: photos.map(p => ({ ...p, projectId })),
    });
  }

  // обновляет yandexPath для фото дефектов по id записи
  async saveDefectPhotoYandexPaths(
    updates: { id: number; yandexPath: string; filename: string }[]
  ) {
    if (!updates.length) return;
    await Promise.all(
      updates.map(u =>
        this.prisma.projectPhoto.update({
          where: { id: u.id },
          data: { yandexPath: u.yandexPath, filename: u.filename },
        })
      )
    );
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
    await axios.put(`${this.baseUrl}/publish?path=${encodedPath}`, undefined, { headers: this.getHeaders() });
    const { data } = await axios.get(`${this.baseUrl}?path=${encodedPath}`, { headers: this.getHeaders() });
    return data.public_url;
  }

  async saveDraft(projectId: number, sectionsState: Record<string, { pages: number }>) {
    return this.prisma.projectDraft.upsert({
      where: { projectId },
      update: { sections: sectionsState },
      create: { projectId, sections: sectionsState },
    });
  }

  async saveFolderUrl(projectId: number, folderUrl: string) {
    return this.prisma.project.update({
      where: { id: projectId },
      data: { folderUrl },
    });
  }

  async getProjectById(projectId: number) {
    return this.prisma.project.findUnique({ where: { id: projectId } });
  }

  async deletePhotos(photoIds: number[]) {
    if (!photoIds?.length) return;
    return this.prisma.projectPhoto.deleteMany({ where: { id: { in: photoIds } } });
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

  async deleteOldArchivedProjects() {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    return this.prisma.project.deleteMany({ where: { archivedAt: { lt: threeMonthsAgo } } });
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleOldArchivedProjects() {
    const deleted = await this.deleteOldArchivedProjects();
    console.log(`Удалено старых архивных проектов: ${deleted.count}`);
  }

  async getAllProjects() {
    return this.prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getProjectsForUser(user: User) {
    if (user.role === 'ADMIN') return this.prisma.project.findMany();
    return this.prisma.project.findMany({ where: { responsibleId: user.id } });
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

  async sendProjectToOneC(projectId: number) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project || !project.oneCId) return;
    await this.oneCService.sendProjectUpdate({
      oneCId: project.oneCId,
      startDate: project.startDate,
      endDate: project.endDate,
      folderUrl: project.folderUrl,
    });
  }

  async getDraft(projectId: number) {
    const draft = await this.prisma.projectDraft.findUnique({ where: { projectId } });
    return draft?.sections ?? null;
  }
}