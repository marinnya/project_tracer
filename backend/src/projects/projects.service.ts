import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import { Express } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OneCService } from '../integrations/oneC/onec.service';
import * as fs from 'fs';
import * as path from 'path';

// тип файла для загрузки — buffer или путь на диске
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly oneCService: OneCService,
  ) {}

  private getHeaders() {
    return { Authorization: `OAuth ${process.env.YANDEX_TOKEN}` };
  }

  // создаёт папку на Яндекс.Диске (игнорирует 409 — папка уже существует)
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
      console.error('Яндекс ответил:', err.response?.status, JSON.stringify(err.response?.data));
      throw new InternalServerErrorException(`Ошибка создания папки: ${err.message}`);
    }
  }

  // загружает один файл — принимает buffer или читает с диска
  private async uploadFile(file: UploadFile, folderPath: string): Promise<void> {
    const filename = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const filePath = `${encodeURIComponent(folderPath)}/${encodeURIComponent(filename)}`;

    const { data } = await axios.get(
      `${this.baseUrl}/upload?path=${filePath}&overwrite=true`,
      { headers: this.getHeaders() },
    );

    // читаем файл с диска если buffer не передан
    const fileBuffer = file.buffer ?? fs.readFileSync(file.path!);

    await axios.put(data.href, fileBuffer, {
      headers: { 'Content-Type': file.mimetype },
    });
  }

  private async getPublicUrl(folderName: string): Promise<string> {
    const encodedPath = encodeURIComponent(folderName);

    await axios.put(
      `${this.baseUrl}/publish?path=${encodedPath}`,
      undefined,
      { headers: this.getHeaders() },
    );

    const { data } = await axios.get(
      `${this.baseUrl}?path=${encodedPath}`,
      { headers: this.getHeaders() },
    );

    return data.public_url;
  }

  // читает файлы из временной папки и возвращает в формате совместимом с uploadToYandex
  async readTempFiles(
    tmpDir: string,
    photos: { filename: string; section: string; order: number; defectType?: string }[],
  ): Promise<Express.Multer.File[]> {
    // проверяем что временная папка существует
    if (!fs.existsSync(tmpDir)) {
      throw new InternalServerErrorException(
        'Временная папка не найдена — сначала нажмите "Сохранить"'
      );
    }

    // читаем каждый файл из папки и собираем в массив
    return photos.map(photo => {
      const filePath = path.join(tmpDir, photo.filename);

      if (!fs.existsSync(filePath)) {
        throw new InternalServerErrorException(
          `Файл не найден во временной папке: ${photo.filename}`
        );
      }

      return {
        originalname: Buffer.from(photo.filename).toString('latin1'), // обратное преобразование для uploadFile
        path: filePath,
        mimetype: 'image/jpeg', // определяем по расширению если нужно
        buffer: undefined,
      } as unknown as Express.Multer.File;
    });
  }

  // сохраняет метаданные временных файлов в БД (без yandexPath)
  async saveTempPhotos(
    projectId: number,
    photos: { section: string; defectType?: string; filename: string; order: number }[],
  ) {
    // удаляем старые временные записи
    await this.prisma.projectPhoto.deleteMany({ where: { projectId } });

    // сохраняем новые без yandexPath — он заполнится после загрузки на Яндекс.Диск
    return this.prisma.projectPhoto.createMany({
      data: photos.map(p => ({ ...p, projectId, yandexPath: null })),
    });
  }

  // основной метод: создаёт папку проекта, внутри — подпапки по секциям, загружает файлы
  async uploadToYandex(
    files: UploadFile[],
    projectName: string,
    // метаданные нужны чтобы знать какой файл в какую секцию кладём
    photos: { section: string; filename: string; order: number; defectType?: string }[],
  ): Promise<{ message: string; folderUrl: string }> {

    // 1. создаём корневую папку проекта
    await this.createFolder(projectName);

    // 2. собираем уникальные названия секций из метаданных
    const sections = [...new Set(photos.map(p => p.section))];

    // 3. создаём подпапки для каждой секции параллельно
    await Promise.all(
      sections.map(section =>
        this.createFolder(`${projectName}/${section}`)
      )
    );

    // 4. строим map: имя файла → секция (чтобы при загрузке знать куда класть)
    const fileToSection = new Map<string, string>();
    for (const photo of photos) {
      fileToSection.set(photo.filename, photo.section);
    }

    // 5. загружаем файлы батчами по 10, каждый в свою подпапку секции
    for (let i = 0; i < files.length; i += this.BATCH_SIZE) {
      const batch = files.slice(i, i + this.BATCH_SIZE);
      await Promise.all(
        batch.map(file => {
          const filename = Buffer.from(file.originalname, 'latin1').toString('utf8');
          const section = fileToSection.get(filename) ?? 'прочее';
          const folderPath = `${projectName}/${section}`;

          return this.uploadFile(file, folderPath).catch((e: unknown) => {
            const message = e instanceof Error ? e.message : String(e);
            throw new InternalServerErrorException(
              `Ошибка загрузки файла ${file.originalname}: ${message}`
            );
          });
        })
      );
    }

    // 6. получаем публичную ссылку на корневую папку проекта
    const folderUrl = await this.getPublicUrl(projectName);

    return { message: 'Файлы успешно загружены', folderUrl };
  }

  async saveDraft(projectId: number, sectionsState: Record<string, { pages: number }>) {
    return this.prisma.projectDraft.upsert({
      where: { projectId },
      update: { sections: sectionsState },
      create: { projectId, sections: sectionsState },
    });
  }

  async savePhotos(
    projectId: number,
    photos: { section: string; defectType?: string; filename: string; yandexPath: string; order: number }[]
  ) {
    // удаляем старые фото проекта если были
    await this.prisma.projectPhoto.deleteMany({ where: { projectId } });

    // записываем новые с путём на Яндекс.Диске
    return this.prisma.projectPhoto.createMany({
      data: photos.map(p => ({ ...p, projectId })),
    });
  }

  // сохраняет ссылку на папку Яндекс.Диска в проекте
  async saveFolderUrl(projectId: number, folderUrl: string) {
    return this.prisma.project.update({
      where: { id: projectId },
      data: { folderUrl },
    });
  }

  async getProjectById(projectId: number) {
    return this.prisma.project.findUnique({ where: { id: projectId } });
  }

  // архивирует проект после записи на Яндекс.Диск
  async archiveProject(projectId: number) {
    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'Завершен',
        archivedAt: new Date(),
      },
    });
  }

  // возвращает проект из архива (только для админа)
  async unarchiveProject(projectId: number) {
    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'В работе',
        archivedAt: null,
      },
    });
  }

  // удаляет проекты которые в архиве более 3 месяцев
  async deleteOldArchivedProjects() {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    return this.prisma.project.deleteMany({
      where: {
        archivedAt: { lt: threeMonthsAgo },
      },
    });
  }

  // удаление старых проектов: запускается каждый день в полночь
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleOldArchivedProjects() {
    const deleted = await this.deleteOldArchivedProjects();
    console.log(`Удалено старых архивных проектов: ${deleted.count}`);
  }

  async getAllProjects() {
    return this.prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  // Выводим проекты для сотрудника/админа
  async getProjectsForUser(user: User) {
    console.log('User:', user.id, user.oneCId);
    console.log('Projects query filter:', { responsibleId: user.id, oneCResponsibleId: user.oneCId });
    if (user.role === 'ADMIN') {
      return this.prisma.project.findMany();
    }
    
    return this.prisma.project.findMany({
      where: { responsibleId: user.id },
    });
  }

  // для обновления дат проекта
  async updateDates(projectId: number, startDate: string | null, endDate: string | null) {
    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
      },
    });
  }

  /**
   * Собирает данные проекта и отправляет в 1С одним запросом
   */
  async sendProjectToOneC(projectId: number) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      console.warn(`Проект ${projectId} не найден`);
      return;
    }

    // если проект не из 1С — ничего не отправляем
    if (!project.oneCId) {
      console.log(`Проект ${projectId} не связан с 1С`);
      return;
    }

    try {
      await this.oneCService.sendProjectUpdate({
        oneCId: project.oneCId,
        startDate: project.startDate,
        endDate: project.endDate,
        folderUrl: project.folderUrl,
      });

      console.log(`Проект ${projectId} отправлен в 1С`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`Ошибка отправки проекта ${projectId} в 1С:`, message);
    }
  }
}