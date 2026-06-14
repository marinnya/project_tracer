import { Controller, Post, Get, Body, Logger, UseGuards } from '@nestjs/common';
import { OneCService, OneCProject, OneCEmployee, OneCDefectType } from './onec.service';
import { OneCAuthGuard } from './onec-auth.guard';
import { JwtAuthGuard } from '../../auth/jwt.guard';

@Controller('onec')
export class OneCController {
  // создаем логгер
  private readonly logger = new Logger(OneCController.name);

  // NestJS видит что контроллеру нужен OneCService, автоматически создаёт его и передаёт сюда
  // После этого oneCService доступен во всех методах контроллера через this.oneCService
  constructor(private readonly oneCService: OneCService) {}

  // слушает POST /onec/sync
  @Post('sync')
  @UseGuards(OneCAuthGuard) // проверяем секретный ключ в заголовке Authorization
  // получаем 3 массива из 1С
  async syncFromOneC(
    @Body() body: { 
      projects: OneCProject[]; 
      employees: OneCEmployee[]; 
      defectTypes: OneCDefectType[] 
    },
  ) {
    this.logger.log(`Синхронизация инициирована 1С. Получено проектов: ${body.projects?.length}`);

    // если какой-то массив не передали, подставляем пустой массив вместо undefined, чтобы сервис не падал при итерации
    const updatedProjects = await this.oneCService.syncAndReturnData(
      body.projects || [],
      body.employees || [],
      body.defectTypes || [],
    );
 
    // Возвращает 1С подтверждение что синхронизация прошла, и новый актуальный список проектов
    return { 
      success: true, 
      projects: updatedProjects 
    };
  }

  // возвращает список типов дефектов для выпадающего списка на фронте
  @Get('defect-types')
  @UseGuards(JwtAuthGuard)
  async getDefectTypes() {
    return this.oneCService.getDefectTypesForSelect();
  }
}