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
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Express } from 'express';
import type { Response } from 'express';
import { ProjectsService, PhotoMeta } from './projects.service';
import { Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('projects')
export class ProjectsController {
  private readonly logger = new Logger(ProjectsController.name);

  constructor(private readonly projectService: ProjectsService) {}

  // SSE-эндпоинт для отслеживания прогресса загрузки на Яндекс.Диск
  @Get(':id/upload-progress')
  uploadProgress(
    @Param('id', ParseIntPipe) projectId: number,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    this.projectService.registerSseClient(projectId, res);

    res.on('close', () => {
      this.projectService.removeSseClient(projectId);
    });
  }

  @Get(':id/photos')
  async getPhotos(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.getProjectPhotos(projectId);
  }

  @Get(':id/defects')
  async getDefects(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.getDefects(projectId);
  }

  @Get(':id/tmp-usage')
  async getTmpUsage(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.getProjectTmpUsage(projectId);
  }

  @Patch(':id/save')
  @UseInterceptors(
    FilesInterceptor('files', 200, {
      storage: multer.diskStorage({
        destination: (req, _file, cb) => {
          const projectId = String(req.params.id);
          const incomingDir = path.join(process.cwd(), 'uploads', 'incoming', projectId);
          fs.mkdirSync(incomingDir, { recursive: true });
          cb(null, incomingDir);
        },
        filename: (_req, file, cb) => {
          const decodedOriginalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
          const ext = path.extname(decodedOriginalName);
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: {
        fileSize: 10 * 1024 * 1024,
        files: 200,
      },
    }),
  )
  async saveDraft(
    @Param('id', ParseIntPipe) projectId: number,
    @UploadedFiles() files: Express.Multer.File[],
    @Body()
    body: {
      sections: string;
      sectionPhotos: string;
      defects: string;
      deletedPhotos?: string;
      fileToSection?: string;
      fileKeys?: string;
    },
  ) {
    this.logger.log(`Сохранение черновика. projectId: ${projectId}, файлов: ${files?.length ?? 0}`);
    return this.projectService.saveDraft(projectId, files ?? [], body);
  }

  @Patch(':id/save-files')
  @UseInterceptors(
    FilesInterceptor('files', 50, {
      storage: multer.diskStorage({
        destination: (req, _file, cb) => {
          const projectId = String(req.params.id);
          const incomingDir = path.join(process.cwd(), 'uploads', 'incoming', projectId);
          fs.mkdirSync(incomingDir, { recursive: true });
          cb(null, incomingDir);
        },
        filename: (_req, file, cb) => {
          const decodedOriginalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
          const ext = path.extname(decodedOriginalName);
          cb(null, `${randomUUID()}${ext}`);
        },
      }),
      limits: {
        fileSize: 10 * 1024 * 1024,
        files: 50,
      },
    }),
  )
  async saveDraftFiles(
    @Param('id', ParseIntPipe) projectId: number,
    @UploadedFiles() files: Express.Multer.File[],
    @Body()
    body: {
      fileToSection?: string;
      fileKeys?: string;
      sectionPhotos?: string;
      defectPhotos?: string;
    },
  ) {
    this.logger.log(`Сохранение файлов черновика (batch). projectId: ${projectId}, файлов: ${files?.length ?? 0}`);
    return this.projectService.saveDraftFiles(projectId, files ?? [], body);
  }

  /**
   * Принимает задачу и сразу отвечает 202 — тяжёлая выгрузка идёт в фоне.
   * Прогресс и успех/ошибка — только через SSE `/projects/:id/upload-progress`
   * (`percent` до 100 и `done`, либо `percent: -1`).
   */
  @Post(':id/upload')
  @HttpCode(HttpStatus.ACCEPTED)
  async uploadFiles(
    @Param('id', ParseIntPipe) projectId: number,
    @Body() body: { projectName: string; photos: string },
  ) {
    this.logger.log(`Запуск фоновой загрузки проекта ${projectId} на Яндекс.Диск`);

    let photos: unknown;
    try {
      photos = JSON.parse(body.photos);
    } catch {
      throw new BadRequestException('Некорректный JSON в поле photos');
    }

    if (!this.projectService.tryBeginYandexUpload(projectId)) {
      throw new ConflictException(
        'Загрузка этого проекта на Яндекс.Диск уже выполняется. Дождитесь завершения.',
      );
    }

    void this.projectService
      .uploadProjectFiles(projectId, body.projectName, photos as PhotoMeta[])
      .then(() => {
        this.projectService.sendProgress(projectId, 100, true);
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(message);
        this.projectService.sendProgress(projectId, -1, true);
      })
      .finally(() => {
        this.projectService.endYandexUpload(projectId);
      });

    return {
      accepted: true,
      message: 'Загрузка запущена; следите за прогрессом в потоке событий.',
    };
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