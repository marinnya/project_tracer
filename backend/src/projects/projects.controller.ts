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

  // сохранить черновик — файлы секций и дефектов во временную папку
  @Patch(':id/save')
  @UseInterceptors(FilesInterceptor('files', 200, {
    storage: diskStorage({
      destination: (req, file, cb) => {
        const projectId = String(req.params.id);
        const uploadPath = path.join(process.cwd(), 'uploads', 'tmp', projectId);
        fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
      },
      filename: (req, file, cb) => {
        const filename = Buffer.from(file.originalname, 'latin1').toString('utf8');
        cb(null, filename);
      },
    }),
  }))
  async saveDraft(
    @Param('id', ParseIntPipe) projectId: number,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: {
      sections: string;
      sectionPhotos: string;
      defects: string;
      deletedPhotos?: string;
    },
  ) {
    this.logger.log(`Сохранение черновика. projectId: ${projectId}`);

    // сохраняем количество страниц секций
    const sections = JSON.parse(body.sections) as Record<string, { pages: number }>;
    await this.projectService.saveDraft(projectId, sections);

    // удаляем помеченные фото
    const deletedPhotos = JSON.parse(body.deletedPhotos ?? '[]') as number[];
    if (deletedPhotos.length) {
      await this.projectService.deletePhotos(deletedPhotos);
    }

    // сохраняем/обновляем дефекты
    const defects = JSON.parse(body.defects) as {
      id?: number;
      typeId: number;
      typeName: string;
      pages: number;
      newPhotos: { originalName: string; order: number }[];
    }[];

    await this.projectService.saveDefects(projectId, defects);

    // получаем актуальные дефекты из БД чтобы знать их id
    const savedDefects = await this.projectService.getDefects(projectId);

    // сохраняем новые фото дефектов
    for (const d of defects) {
      if (!d.newPhotos?.length) continue;
      // находим соответствующий дефект в БД по typeId и typeName
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
      }[];

      const tmpDir = path.join(process.cwd(), 'uploads', 'tmp', String(projectId));
      const files = await this.projectService.readTempFiles(tmpDir, photos);

      const { folderUrl, renamedPhotos } = await this.projectService.uploadToYandex(
        files,
        body.projectName,
        photos,
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

      fs.rmSync(tmpDir, { recursive: true, force: true });

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