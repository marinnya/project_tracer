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
import * as multer from 'multer';
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

  // получить фото обычных секций проекта
  @Get(':id/photos')
  async getPhotos(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.getProjectPhotos(projectId);
  }

  // получить дефекты проекта с фото
  @Get(':id/defects')
  async getDefects(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.getDefects(projectId);
  }

  // сохранить черновик — файлы хранятся в памяти и сохраняются вручную в подпапки по секциям
  @Patch(':id/save')
  @UseInterceptors(FilesInterceptor('files', 200, {
    storage: multer.memoryStorage(), // храним в памяти — сохраняем вручную после получения body
  }))
  async saveDraft(
    @Param('id', ParseIntPipe) projectId: number,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: {
      sections: string;
      sectionPhotos: string;
      defects: string;
      deletedPhotos?: string;
      fileToSection?: string; // маппинг: имя файла → подпапка
    },
  ) {
    this.logger.log(`Сохранение черновика. projectId: ${projectId}`);

    this.logger.log(`fileToSection: ${body.fileToSection}`);
    this.logger.log(`Файлов получено: ${files?.length ?? 0}`);

    // маппинг имя файла → подпапка (секция или __defect__<typeName>)
    const fileToSection: Record<string, string> = body.fileToSection
      ? JSON.parse(body.fileToSection)
      : {};

    this.logger.log(`Маппинг: ${JSON.stringify(fileToSection)}`);

    // сохраняем файлы в подпапки по секциям
    if (files?.length) {
      for (const file of files) {
        const subfolder = fileToSection[file.originalname] ?? 'misc';
        const uploadPath = path.join(
          process.cwd(), 'uploads', 'tmp', String(projectId), subfolder
        );
        fs.mkdirSync(uploadPath, { recursive: true });
        const filePath = path.join(uploadPath, file.originalname);
        fs.writeFileSync(filePath, file.buffer!);
      }
    }

    // сохраняем количество страниц секций
    const sections = JSON.parse(body.sections) as Record<string, { pages: number }>;
    await this.projectService.saveDraft(projectId, sections);

    // удаляем помеченные фото
    const deletedPhotos = JSON.parse(body.deletedPhotos ?? '[]') as number[];
    if (deletedPhotos.length) {
      await this.projectService.deletePhotos(deletedPhotos);
    }

    // сохраняем/обновляем дефекты — пропускаем незаполненные
    const rawDefects = JSON.parse(body.defects) as {
      id?: number;
      typeId: number | string;
      typeName: string;
      pages: number | string;
      newPhotos: { originalName: string; order: number }[];
    }[];

    const defects = rawDefects
      .filter(d => d.typeId !== "" && d.typeId !== null && Number(d.pages) > 0)
      .map(d => ({
        id: d.id,
        typeId: Number(d.typeId),
        typeName: d.typeName,
        pages: Number(d.pages),
        newPhotos: d.newPhotos,
      }));

    await this.projectService.saveDefects(projectId, defects);

    // получаем актуальные дефекты из БД чтобы знать их id
    const savedDefects = await this.projectService.getDefects(projectId);

    // сохраняем новые фото дефектов
    for (const d of defects) {
      if (!d.newPhotos?.length) continue;
      const savedDefect = savedDefects.find(
        sd => sd.typeId === d.typeId && sd.typeName === d.typeName
      );
      if (!savedDefect) continue;

      await this.projectService.saveTempDefectPhotos(savedDefect.id, projectId, d.newPhotos);
    }

    // сохраняем новые фото обычных секций
    if (body.sectionPhotos) {
      const sectionPhotos = JSON.parse(body.sectionPhotos) as {
        section: string;
        originalName: string;
        order: number;
      }[];
      await this.projectService.saveTempPhotos(projectId, sectionPhotos);
    }

    return { message: 'Черновик сохранён' };
  }

  // загрузка на Яндекс.Диск
  @Post(':id/upload')
  async uploadFiles(
    @Param('id', ParseIntPipe) projectId: number,
    @Body() body: { projectName: string; photos: string },
  ) {
    try {
      const photos = JSON.parse(body.photos) as {
        originalName: string;
        section: string | null;
        defectTypeName?: string;
        order: number;
        yandexPath?: string | null;
      }[];

      // загружаем актуальные фото из БД — нужно знать у каких уже есть yandexPath
      const savedPhotos = await this.projectService.getProjectPhotos(projectId);
      const savedDefects = await this.projectService.getDefects(projectId);

      // строим map: originalName → yandexPath
      const yandexPathMap = new Map<string, string | null>();
      savedPhotos.forEach(p => yandexPathMap.set(p.originalName, p.yandexPath ?? null));
      savedDefects.forEach(d => d.photos.forEach(p => yandexPathMap.set(p.originalName, p.yandexPath ?? null)));

      // добавляем yandexPath к каждому фото
      const photosWithYandex = photos.map(p => ({
        ...p,
        yandexPath: yandexPathMap.get(p.originalName) ?? null,
      }));

      const tmpDir = path.join(process.cwd(), 'uploads', 'tmp', String(projectId));

      this.logger.log(`Всего фото в запросе: ${photos.length}`);
      this.logger.log(`Фото: ${JSON.stringify(photos.map(p => ({ name: p.originalName, section: p.section, hasYandex: !!p.yandexPath })))}`);

      // читаем только новые файлы
      const files = await this.projectService.readTempFiles(tmpDir, photosWithYandex);
      this.logger.log(`Файлов для загрузки: ${files.length}`);

      const { folderUrl, renamedPhotos } = await this.projectService.uploadToYandex(
        files,
        body.projectName,
        photosWithYandex,
      );

      const renamedMap = new Map(renamedPhotos.map(r => [r.originalName, r.filename]));

      const photosWithPath = photos.map(p => ({
        section: p.section,
        defectId: null,
        originalName: p.originalName,
        filename: renamedMap.get(p.originalName) ?? p.originalName,
        yandexPath: `${body.projectName}/${p.section ?? 'дефекты'}/${renamedMap.get(p.originalName) ?? p.originalName}`,
        order: p.order,
      }));

      await this.projectService.savePhotos(projectId, photosWithPath);
      await this.projectService.saveFolderUrl(projectId, folderUrl);
      await this.projectService.archiveProject(projectId);
      await this.projectService.sendProjectToOneC(projectId);

      // удаляем временную папку только если она существует
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }

      return { message: 'Файлы загружены', folderUrl };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(message);
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
  async getAll(@Req() req: { user: { id: string; role: string } }) {
    return this.projectService.getProjectsForUser(req.user as never);
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

  // получить черновик проекта — для восстановления количества страниц
  @Get(':id/draft')
  async getDraft(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.getDraft(projectId);
  }
}