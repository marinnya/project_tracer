import {
  Controller,
  Post,
  Patch,
  Get,
  Param,
  UseInterceptors,
  UploadedFiles,
  Body,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { Express } from 'express';
import { ProjectsService } from './projects.service';
import { Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import * as path from 'path';
import * as fs from 'fs';

@Controller('projects')
export class ProjectsController {
  private readonly logger = new Logger(ProjectsController.name);

  constructor(private readonly projectService: ProjectsService) {}

  // кнопка "Сохранить" — принимает файлы и сохраняет во временную папку на сервере
  @Patch(':id/save')
  @UseInterceptors(FilesInterceptor('files', 200, {
    storage: diskStorage({
      // временная папка: uploads/tmp/<projectId>/
      destination: (req, file, cb) => {
        //const projectId = req.params.id;
        const projectId = String(req.params.id);
        const uploadPath = path.join(process.cwd(), 'uploads', 'tmp', projectId);
        // создаём папку если не существует
        fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
      },
      // сохраняем файл под оригинальным именем
      filename: (req, file, cb) => {
        const filename = Buffer.from(file.originalname, 'latin1').toString('utf8');
        cb(null, filename);
      },
    }),
  }))
  async saveDraft(
    @Param('id', ParseIntPipe) projectId: number,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: { sections: string; photos: string },
  ) {
    this.logger.log(`Сохранение черновика. projectId: ${projectId}`);
    this.logger.log(`Файлов получено: ${files?.length ?? 0}`);

    // сохраняем метаданные секций в БД (количество страниц)
    const sections = JSON.parse(body.sections) as Record<string, { pages: number }>;
    await this.projectService.saveDraft(projectId, sections);

    // если есть файлы — сохраняем их метаданные в БД (без yandexPath — ещё не загружены)
    if (files?.length && body.photos) {
      const photos = JSON.parse(body.photos) as {
        section: string;
        defectType?: string;
        filename: string;
        order: number;
      }[];

      await this.projectService.saveTempPhotos(projectId, photos);
      this.logger.log(`Метаданные временных файлов сохранены в БД`);
    }

    return { message: 'Черновик сохранён' };
  }

  // кнопка "Записать" — читает файлы из временной папки и загружает на Яндекс.Диск
@Post(':id/upload')
  async uploadFiles(
    @Param('id', ParseIntPipe) projectId: number,
    @Body() body: { projectName: string; photos: string },
  ) {
    this.logger.log(`Получен запрос на загрузку. projectId: ${projectId}`);
    this.logger.log(`projectName: ${body?.projectName}`);

    try {
      const photos = JSON.parse(body.photos) as {
        section: string;
        defectType?: string;
        filename: string;
        order: number;
      }[];

      // читаем файлы из временной папки на сервере
      const tmpDir = path.join(process.cwd(), 'uploads', 'tmp', String(projectId));
      const files = await this.projectService.readTempFiles(tmpDir, photos);
      this.logger.log(`Файлов прочитано из временной папки: ${files.length}`);

      // загружаем на Яндекс.Диск
      const { folderUrl } = await this.projectService.uploadToYandex(
        files,
        body.projectName,
        photos,
      );
      this.logger.log(`Яндекс.Диск — папка создана: ${folderUrl}`);

      // сохраняем метаданные фото с путём на Яндекс.Диске
      const photosWithPath = photos.map(p => ({
        ...p,
        yandexPath: `${body.projectName}/${p.section}/${p.filename}`,
      }));
      await this.projectService.savePhotos(projectId, photosWithPath);
      this.logger.log(`Метаданные фото сохранены в БД`);

      // СОХРАНЯЕМ ССЫЛКУ НА ПАПКУ В ПРОЕКТЕ
      await this.projectService.saveFolderUrl(projectId, folderUrl);
      this.logger.log(`Ссылка на папку сохранена в проекте`);

      // архивируем проект после успешной загрузки
      await this.projectService.archiveProject(projectId);
      this.logger.log(`Проект ${projectId} перемещён в архив`);

      // ОТПРАВЛЯЕМ ДАННЫЕ В 1С ОДНИМ ЗАПРОСОМ
      await this.projectService.sendProjectToOneC(projectId);
      this.logger.log(`Данные отправлены в 1С`);

      // удаляем временную папку — файлы уже на Яндекс.Диске
      fs.rmSync(tmpDir, { recursive: true, force: true });
      this.logger.log(`Временная папка удалена: ${tmpDir}`);

      return { message: 'Файлы загружены', folderUrl };
    } catch (e: any) {
      this.logger.error(`Ошибка: ${e.message}`);
      throw e;
    }
  }

  // только админ может вернуть проект из архива
  @Patch(':id/unarchive')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async unarchiveProject(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.unarchiveProject(projectId);
  }

  // возвращает список всех проектов
  @Get()
  async getAll() {
    return this.projectService.getAllProjects();
  }

  @Get(':id')
  async getOne(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.getProjectById(projectId);
  }


  @Patch(':id/dates')
  async updateDates(
    @Param('id', ParseIntPipe) projectId: number,
    @Body() body: { startDate: string | null; endDate: string | null },
  ) {
    return this.projectService.updateDates(projectId, body.startDate, body.endDate);
  }
}