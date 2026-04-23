import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import { Express } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OneCService } from '../integrations/oneC/onec.service';
import * as fs from 'fs';
import * as path from 'path';

type UploadFile = {
  originalname: string;
  buffer?: Buffer;
  path?: string;
  mimetype: string;
};

@Injectable()
export class ProjectsService {
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

  // получить фото обычных секций проекта
  async getProjectPhotos(projectId: number) {
    return this.prisma.projectPhoto.findMany({
      where: { projectId, defectId: null },
      orderBy: [{ section: 'asc' }, { order: 'asc' }],
    });
  }

  // получить дефекты проекта с их фото
  async getDefects(projectId: number) {
    return this.prisma.defect.findMany({
      where: { projectId },
      include: {
        photos: {
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { id: 'asc' },
    });
  }

  // сохранить/обновить дефекты проекта
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

      // пропускаем если typeId или pages не валидны
      if (!typeId || !pages) continue;

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

  // сохраняет метаданные новых фото секций (без дефектов)
  async saveTempPhotos(
    projectId: number,
    photos: { section: string; originalName: string; order: number }[],
  ) {
    const existing = await this.prisma.projectPhoto.findMany({
      where: { projectId, defectId: null },
      select: { originalName: true },
    });

    const existingNames = new Set(existing.map(p => p.originalName));
    const newPhotos = photos.filter(p => !existingNames.has(p.originalName));

    if (!newPhotos.length) return;

    return this.prisma.projectPhoto.createMany({
      data: newPhotos.map(p => ({
        projectId,
        section: p.section,
        originalName: p.originalName,
        order: p.order,
        filename: null,
        yandexPath: null,
      })),
    });
  }

  // сохраняет метаданные новых фото дефекта
  async saveTempDefectPhotos(
    defectId: number,
    projectId: number,
    photos: { originalName: string; order: number }[],
  ) {
    const existing = await this.prisma.projectPhoto.findMany({
      where: { defectId },
      select: { originalName: true },
    });

    const existingNames = new Set(existing.map(p => p.originalName));
    const newPhotos = photos.filter(p => !existingNames.has(p.originalName));

    if (!newPhotos.length) return;

    return this.prisma.projectPhoto.createMany({
      data: newPhotos.map(p => ({
        projectId,
        defectId,
        originalName: p.originalName,
        order: p.order,
        filename: null,
        yandexPath: null,
      })),
    });
  }

  async readTempFiles(
    tmpDir: string,
    photos: { originalName: string }[],
  ): Promise<Express.Multer.File[]> {
    if (!fs.existsSync(tmpDir)) {
      throw new InternalServerErrorException(
        'Временная папка не найдена — сначала нажмите "Сохранить"'
      );
    }

    return photos.map(photo => {
      const filePath = path.join(tmpDir, photo.originalName);

      if (!fs.existsSync(filePath)) {
        throw new InternalServerErrorException(
          `Файл не найден во временной папке: ${photo.originalName}`
        );
      }

      return {
        originalname: Buffer.from(photo.originalName).toString('latin1'),
        path: filePath,
        mimetype: 'application/octet-stream',
        buffer: undefined,
      } as unknown as Express.Multer.File;
    });
  }

  async uploadToYandex(
    files: UploadFile[],
    projectName: string,
    photos: {
      originalName: string;
      section: string | null;
      defectTypeName?: string;
      order: number;
    }[],
  ): Promise<{ message: string; folderUrl: string; renamedPhotos: { originalName: string; filename: string }[] }> {

    await this.createFolder(projectName);

    // создаём папки для секций и для дефектов
    const folders = new Set<string>();
    photos.forEach(p => {
      folders.add(p.section ?? 'Дефекты');
    });
    await Promise.all([...folders].map(f => this.createFolder(`${projectName}/${f}`)));

    const photoMap = new Map<string, { section: string | null; order: number; defectTypeName?: string }>();
    for (const photo of photos) {
      photoMap.set(photo.originalName, {
        section: photo.section,
        order: photo.order,
        defectTypeName: photo.defectTypeName,
      });
    }

    const renamedPhotos: { originalName: string; filename: string }[] = [];

    for (let i = 0; i < files.length; i += this.BATCH_SIZE) {
      const batch = files.slice(i, i + this.BATCH_SIZE);

      await Promise.all(
        batch.map(file => {
          const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
          const meta = photoMap.get(originalName);
          const section = meta?.section ?? 'дефекты';
          const order = meta?.order ?? i + 1;
          const defectTypeName = meta?.defectTypeName;

          const renamedFilename = this.getRenamedFilename(originalName, section, defectTypeName, order);
          renamedPhotos.push({ originalName, filename: renamedFilename });

          const folderPath = `${projectName}/${section}`;
          const renamedFile = { ...file, originalname: Buffer.from(renamedFilename).toString('latin1') };

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
    // удаляем старые фото секций (не дефектов)
    await this.prisma.projectPhoto.deleteMany({
      where: { projectId, defectId: null },
    });

    return this.prisma.projectPhoto.createMany({
      data: photos.map(p => ({ ...p, projectId })),
    });
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

  // возвращает сохранённые данные черновика — количество страниц секций
  async getDraft(projectId: number) {
    const draft = await this.prisma.projectDraft.findUnique({
      where: { projectId },
    });
    // возвращаем sections или null если черновика ещё нет
    return draft?.sections ?? null;
  }
}