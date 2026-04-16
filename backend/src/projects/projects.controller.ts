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

  // ✅ получить фото проекта
  @Get(':id/photos')
  async getPhotos(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.getProjectPhotos(projectId);
  }

  // ✅ Сохранить (черновик)
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
    @Body() body: { sections: string; photos: string; deletedPhotos?: string },
  ) {
    this.logger.log(`Сохранение черновика. projectId: ${projectId}`);

    const sections = JSON.parse(body.sections);
    await this.projectService.saveDraft(projectId, sections);

    // ✅ удаление сохранённых
    const deletedPhotos = JSON.parse(body.deletedPhotos || "[]");
    if (deletedPhotos.length) {
      await this.projectService.deletePhotos(deletedPhotos);
    }

    if (files?.length && body.photos) {
      const photos = JSON.parse(body.photos) as {
        section: string;
        defectType?: string;
        originalName: string;
        order: number;
      }[];

      await this.projectService.saveTempPhotos(projectId, photos);
    }

    return { message: 'Черновик сохранён' };
  }

  // ✅ Загрузка на Яндекс
  @Post(':id/upload')
  async uploadFiles(
    @Param('id', ParseIntPipe) projectId: number,
    @Body() body: { projectName: string; photos: string },
  ) {
    try {
      const photos = JSON.parse(body.photos) as {
        section: string;
        defectType?: string;
        originalName: string;
        order: number;
      }[];

      const tmpDir = path.join(process.cwd(), 'uploads', 'tmp', String(projectId));

      const files = await this.projectService.readTempFiles(tmpDir, photos);

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
      this.logger.error(e.message);
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

  @Patch(':id/defects')
  async saveDefects(
    @Param('id', ParseIntPipe) projectId: number,
    @Body() body: { defects: any[] },
  ) {
    return this.projectService.saveDefects(projectId, body.defects);
  }
  
  
}