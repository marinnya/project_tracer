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

/** Синхронно с MAX_PHOTO_FILE_BYTES на фронте (frontend/src/constants/uploads.ts) */
const MAX_PHOTO_FILE_BYTES = 20 * 1024 * 1024;
import { ProjectsService, PhotoMeta } from './projects.service';
import { Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('projects')
export class ProjectsController {
  private readonly logger = new Logger(ProjectsController.name); // создаем логгер

  constructor(private readonly projectService: ProjectsService) {} // внедряем сервис

  // SSE-эндпоинт для отслеживания прогресса загрузки на Яндекс Диск
  @Get(':id/upload-progress')
  uploadProgress(
    @Param('id', ParseIntPipe) projectId: number, // id проекта из URL, ParseIntPipe автоматически преобразует строку из URL в число
    // Берёт объект ответа напрямую - нужно чтобы держать соединение открытым и слать данные по частям
    @Res() res: Response,
  ) {
    // Три заголовка которые переводят HTTP в режим SSE - браузер понимает что соединение не закроется сразу, а будет слать события
    res.setHeader('Content-Type', 'text/event-stream'); // указываем что будет отправляться в формате event-stream
    res.setHeader('Cache-Control', 'no-cache'); // отключаем кэширование
    res.setHeader('Connection', 'keep-alive'); // указываем что соединение должно оставаться открытым
    res.flushHeaders(); // Немедленно отправляет заголовки клиенту не дожидаясь тела - браузер сразу знает что соединение установлено

    // Передаёт res в сервис -  тот сохраняет его и потом пишет в него прогресс через res.write()
    this.projectService.registerSseClient(projectId, res);

    // Когда пользователь закрыл вкладку или ушёл - соединение закрывается, сервис удаляет клиента чтобы не держать мёртвые объекты в памяти
    res.on('close', () => {
      this.projectService.removeSseClient(projectId);
    });
  }

  // возвращает фотографии проекта
  @Get(':id/photos')
  async getPhotos(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.getProjectPhotos(projectId);
  }

  // возвращает дефекты проекта
  @Get(':id/defects')
  async getDefects(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.getDefects(projectId);
  }

  // 1 этап: сюда шлем только метаданные файлов
  // возвращает сколько места занимают временные файлы проекта
  @Get(':id/tmp-usage')
  async getTmpUsage(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.getProjectTmpUsage(projectId);
  }

  @Patch(':id/save')
  // интерцептор используется для подключения multer
  // До выполнения saveDraft() Nest сначала обработает загруженные файлы
  @UseInterceptors(
    // ожидается поле формы с именем files, максимум 200 файлов
    // например <input type="file" name="files" multiple>
    FilesInterceptor('files', 200, {
      storage: multer.diskStorage({
        destination: (req, _file, cb) => {
          const projectId = String(req.params.id); // получаем id проекта из URL
          const incomingDir = path.join(process.cwd(), 'uploads', 'incoming', projectId); // формируем путь
          fs.mkdirSync(incomingDir, { recursive: true }); // создаем папку, если её нет, recursive: true - создаёт все промежуточные папки
          cb(null, incomingDir); // callback; ошибки нет,передаем путь в multer
        },
        // функция определяет имя файла на диске
        filename: (_req, file, cb) => {
          const decodedOriginalName = Buffer.from(file.originalname, 'latin1').toString('utf8'); // декодируем имя файла из latin1 в utf8 для кириллицы
          const ext = path.extname(decodedOriginalName); // получаем расширение файла
          cb(null, `${randomUUID()}${ext}`); // генерируем новое уникальное имя + расширение
        },
      }),
      // ограничения на размер и количество файлов
      limits: {
        fileSize: MAX_PHOTO_FILE_BYTES,
        files: 200, // максимум 200 файлов
      },
    }),
  )
  async saveDraft(
    @Param('id', ParseIntPipe) projectId: number,
    // Express.Multer.File[] - массив объектов файлов
    @UploadedFiles() files: Express.Multer.File[], // Достаёт загруженные файлы — multer уже сохранил их на диск, здесь просто метаданные (путь, имя, размер)
    @Body()
    body: {
      sections: string; // секции и страницы
      sectionPhotos: string; // пока пустой
      defects: string; // список дефектов
      deletedPhotos?: string; // какие фото удалить из бд
      fileToSection?: string; // пока пустой
      fileKeys?: string; // пока пустой
    },
  ) {
    this.logger.log(`Сохранение черновика. projectId: ${projectId}, файлов: ${files?.length ?? 0}`);
    // передаем projectId, files и body в сервис
    return this.projectService.saveDraft(projectId, files ?? [], body);
  }

  // 2 этап: сюда шлем только файлы (sections, defects, deletedPhotos уже сохранены на 1 шаге)
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
        fileSize: MAX_PHOTO_FILE_BYTES,
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
  // принудительно устанавливаем статус 202 - Accepted, запрос принят, но обработка идёт в фоне
  @HttpCode(HttpStatus.ACCEPTED)
  async uploadFiles(
    // параметр id из URL
    @Param('id', ParseIntPipe) projectId: number,
    // тело запроса вида { projectName: string; photos: [] }
    @Body() body: { projectName: string; photos: string },
  ) {
    this.logger.log(`Запуск фоновой загрузки проекта ${projectId} на Яндекс.Диск`);

    // создаем переменную
    let photos: unknown;
    try {
      photos = JSON.parse(body.photos); // парсим JSON из body.photos
    } catch {
      throw new BadRequestException('Некорректный JSON в поле photos');
    }

    // проверка, не идет ли уже загрузка на Яндекс для этого проекта
    if (!this.projectService.tryBeginYandexUpload(projectId)) {
      throw new ConflictException(
        'Загрузка этого проекта на Яндекс.Диск уже выполняется. Дождитесь завершения.',
      );
    }

    // запускаем Promise (загрузка) и не ждем его завершения (photos - массив PhotoMeta)
    void this.projectService
      .uploadProjectFiles(projectId, body.projectName, photos as PhotoMeta[])
      // then - когда загрузка завершена успешно
      .then(() => {
        this.projectService.sendProgress(projectId, 100, true);
      })
      // catch - когда загрузка завершилась с ошибкой
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(message);
        this.projectService.sendProgress(projectId, -1, true);
      })
      // finally - выполняется всегда,когда загрузка завершилась, независимо от результата
      .finally(() => {
        this.projectService.endYandexUpload(projectId); // удаляем проект из активных загрузок?
      });

    // сразу после запуска фоновой задачи возвращается
    return {
      accepted: true,
      message: 'Загрузка запущена; следите за прогрессом в потоке событий.',
    };
  }

  // разархивирует проект
  @Patch(':id/unarchive')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async unarchiveProject(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.unarchiveProject(projectId);
  }

  // возвращает список проектов для текущего пользователя
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  async getAll(@Req() req: { user: { id: string; role: string } }) {
    return this.projectService.getProjectsForUser(req.user as never);
  }

  // возвращает проект по id
  @Get(':id')
  async getOne(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.getProjectById(projectId);
  }

  // обновляет даты проекта, можно передать null чтобы сбросить дату
  @Patch(':id/dates')
  async updateDates(
    @Param('id', ParseIntPipe) projectId: number,
    @Body() body: { startDate: string | null; endDate: string | null },
  ) {
    return this.projectService.updateDates(projectId, body.startDate, body.endDate);
  }

  // возвращает черновик проекта
  @Get(':id/draft')
  async getDraft(@Param('id', ParseIntPipe) projectId: number) {
    return this.projectService.getDraft(projectId);
  }
}