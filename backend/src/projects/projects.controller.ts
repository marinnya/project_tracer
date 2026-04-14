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
  Req,
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

  // получить сохранённые фото проекта — для отображения на странице проекта
  @Get(':id/photos')
  async getPhotos(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.getProjectPhotos(projectId);
  }

  // кнопка "Сохранить" — принимает файлы и сохраняет во временную папку на сервере
  @Patch(':id/save')
  @UseInterceptors(FilesInterceptor('files', 200, {
    storage: diskStorage({
      // временная папка: uploads/tmp/<projectId>/
      destination: (req, file, cb) => {
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

    const sections = JSON.parse(body.sections) as Record<string, { pages: number }>;
    await this.projectService.saveDraft(projectId, sections);

    // обновлено: теперь используем originalName
    if (files?.length && body.photos) {
      const photos = JSON.parse(body.photos) as {
        section: string;
        defectType?: string;
        originalName: string;
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
        originalName: string;
        order: number;
      }[];

      const tmpDir = path.join(process.cwd(), 'uploads', 'tmp', String(projectId));

      const files = await this.projectService.readTempFiles(tmpDir, photos);
      this.logger.log(`Файлов прочитано из временной папки: ${files.length}`);

      const { folderUrl, renamedPhotos } =
        await this.projectService.uploadToYandex(
          files,
          body.projectName,
          photos,
        );

      const renamedMap = new Map(
        renamedPhotos.map(r => [r.originalName, r.filename])
      );

      const photosWithPath = photos.map(p => ({
        ...p,
        filename: renamedMap.get(p.originalName) ?? p.originalName,
        yandexPath: `${body.projectName}/${p.section}/${renamedMap.get(p.originalName) ?? p.originalName}`,
      }));

      await this.projectService.savePhotos(projectId, photosWithPath);

      await this.projectService.saveFolderUrl(projectId, folderUrl);
      await this.projectService.archiveProject(projectId);
      await this.projectService.sendProjectToOneC(projectId);

      fs.rmSync(tmpDir, { recursive: true, force: true });

      return { message: 'Файлы загружены', folderUrl };
    } catch (e: any) {
      this.logger.error(`Ошибка: ${e.message}`);
      throw e;
    }
  }

  @Patch(':id/unarchive')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async unarchiveProject(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.unarchiveProject(projectId);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  async getAll(@Req() req) {
    return this.projectService.getProjectsForUser(req.user);
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