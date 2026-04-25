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
import { v4 as uuidv4 } from 'uuid';

@Controller('projects')
export class ProjectsController {
  private readonly logger = new Logger(ProjectsController.name);

  constructor(private readonly projectService: ProjectsService) {}

  @Get(':id/photos')
  async getPhotos(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.getProjectPhotos(projectId);
  }

  @Get(':id/defects')
  async getDefects(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.getDefects(projectId);
  }

  @Patch(':id/save')
  @UseInterceptors(FilesInterceptor('files', 200, {
    storage: multer.memoryStorage(),
  }))
  async saveDraft(
    @Param('id', ParseIntPipe) projectId: number,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: {
      sections: string;
      sectionPhotos: string;
      defects: string;
      deletedPhotos?: string;
      fileToSection?: string;
      fileKeys?: string;
    },
  ) {
    this.logger.log(`Сохранение черновика. projectId: ${projectId}`);
    this.logger.log(`fileToSection: ${body.fileToSection}`);
    this.logger.log(`Файлов получено: ${files?.length ?? 0}`);

    const fileToSection: Record<string, string> = body.fileToSection
      ? JSON.parse(body.fileToSection)
      : {};

    const fileKeys: string[] = body.fileKeys ? JSON.parse(body.fileKeys) : [];

    this.logger.log(`Маппинг: ${JSON.stringify(fileToSection)}`);

    const clientKeyToStoredName: Record<string, string> = {};

    if (files?.length) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const decodedOriginalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

        const clientKey = fileKeys[i] ?? decodedOriginalName;
        const subfolder = fileToSection[clientKey] ?? 'misc';

        const ext = path.extname(decodedOriginalName);
        const storedName = `${uuidv4()}${ext}`;

        const uploadPath = path.join(
          process.cwd(), 'uploads', 'tmp', String(projectId), subfolder
        );
        fs.mkdirSync(uploadPath, { recursive: true });
        fs.writeFileSync(path.join(uploadPath, storedName), file.buffer!);

        clientKeyToStoredName[clientKey] = storedName;

        this.logger.log(`Сохранён файл: ${decodedOriginalName} → ${storedName} (папка: ${subfolder})`);
      }
    }

    const sections = JSON.parse(body.sections) as Record<string, { pages: number }>;
    await this.projectService.saveDraft(projectId, sections);

    const deletedPhotos = JSON.parse(body.deletedPhotos ?? '[]') as number[];
    if (deletedPhotos.length) {
      await this.projectService.deletePhotos(deletedPhotos);
    }

    const rawDefects = JSON.parse(body.defects) as {
      id?: number;
      typeId: number | string;
      typeName: string;
      pages: number | string;
      newPhotos: { originalName: string; clientKey: string; order: number }[];
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

    const savedDefects = await this.projectService.getDefects(projectId);

    for (const d of defects) {
      if (!d.newPhotos?.length) continue;
      const savedDefect = savedDefects.find(
        sd => sd.typeId === d.typeId && sd.typeName === d.typeName
      );
      if (!savedDefect) continue;

      const photosWithStoredName = d.newPhotos.map(p => ({
        originalName: p.originalName,
        storedName: clientKeyToStoredName[p.clientKey] ?? null,
        order: p.order,
      }));

      await this.projectService.saveTempDefectPhotos(savedDefect.id, projectId, photosWithStoredName);
    }

    if (body.sectionPhotos) {
      const sectionPhotos = JSON.parse(body.sectionPhotos) as {
        section: string;
        originalName: string;
        clientKey: string;
        order: number;
      }[];

      const sectionPhotosWithStoredName = sectionPhotos.map(p => ({
        section: p.section,
        originalName: p.originalName,
        storedName: p.clientKey ? (clientKeyToStoredName[p.clientKey] ?? null) : null,
        order: p.order,
      }));

      await this.projectService.saveTempPhotos(projectId, sectionPhotosWithStoredName);
    }

    return { message: 'Черновик сохранён' };
  }

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

      const savedPhotos = await this.projectService.getProjectPhotos(projectId);
      const savedDefects = await this.projectService.getDefects(projectId);

      // плоский список фото дефектов с typeName — для точного поиска по дефекту
      const defectPhotosFlat = savedDefects.flatMap(d =>
        d.photos.map(p => ({ ...p, typeName: d.typeName }))
      );

      // добавляем yandexPath и storedName к каждому фото
      // для дефектов ищем по typeName + originalName + order — исключает коллизии между дефектами
      // для секций ищем по section + originalName + order
      const photosWithMeta = photos.map(p => {
        let match: { yandexPath: string | null; filename: string | null } | undefined;

        if (p.section === 'дефекты' && p.defectTypeName) {
          const found = defectPhotosFlat.find(sp =>
            sp.typeName === p.defectTypeName &&
            sp.originalName === p.originalName &&
            sp.order === p.order
          );
          match = found ? { yandexPath: found.yandexPath, filename: found.filename } : undefined;
        } else {
          const found = savedPhotos.find(sp =>
            sp.section === p.section &&
            sp.originalName === p.originalName &&
            sp.order === p.order
          );
          match = found ? { yandexPath: found.yandexPath, filename: found.filename } : undefined;
        }

        return {
          ...p,
          yandexPath: match?.yandexPath ?? null,
          storedName: match?.filename ?? null,
        };
      });

      const tmpDir = path.join(process.cwd(), 'uploads', 'tmp', String(projectId));

      this.logger.log(`Всего фото в запросе: ${photos.length}`);
      this.logger.log(`Фото: ${JSON.stringify(photos.map(p => ({
        name: p.originalName,
        section: p.section,
        defectTypeName: p.defectTypeName,
        hasYandex: !!p.yandexPath,
      })))}`);

      const files = await this.projectService.readTempFiles(tmpDir, photosWithMeta);
      this.logger.log(`Файлов для загрузки: ${files.length}`);

      const { folderUrl, renamedPhotos } = await this.projectService.uploadToYandex(
        files,
        body.projectName,
        photosWithMeta,
      );

      // ищем переименованное имя по originalName + section + defectTypeName + order
      const photosWithPath = photos.map(p => {
        const match = renamedPhotos.find(r =>
          r.originalName === p.originalName &&
          r.section === p.section &&
          r.defectTypeName === p.defectTypeName &&
          r.order === p.order
        );
        const filename = match?.filename ?? p.originalName;
        return {
          section: p.section,
          defectId: null,
          originalName: p.originalName,
          filename,
          yandexPath: `${body.projectName}/${p.section ?? 'дефекты'}/${filename}`,
          order: p.order,
        };
      });

      await this.projectService.savePhotos(projectId, photosWithPath);
      await this.projectService.saveFolderUrl(projectId, folderUrl);
      await this.projectService.archiveProject(projectId);
      await this.projectService.sendProjectToOneC(projectId);

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

  @Get(':id/draft')
  async getDraft(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.getDraft(projectId);
  }
}