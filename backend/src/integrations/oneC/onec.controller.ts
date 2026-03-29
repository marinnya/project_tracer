import { Controller, Post, Body, Logger } from '@nestjs/common';
import { OneCService, OneCProject, OneCEmployee } from './onec.service';

@Controller('onec')
export class OneCController {
  private readonly logger = new Logger(OneCController.name);

  constructor(private readonly oneCService: OneCService) {}

  /**
   * 1С присылает данные проектов и сотрудников
   */
  @Post('sync')
  async syncFromOneC(@Body() body: { projects: OneCProject[]; employees: OneCEmployee[] }) {
    this.logger.log('Получены данные от 1С');

    const updatedProjects = await this.oneCService.syncFromOneC(body.projects, body.employees);

    this.logger.log('Синхронизация завершена');
    return { updatedProjects }; // возвращаем обратно 1С
  }
}