import { Controller, Post, Get, Body, Logger, UseGuards } from '@nestjs/common';
import { OneCService, OneCProject, OneCEmployee, OneCDefectType } from './onec.service';
import { OneCAuthGuard } from './onec-auth.guard';

@Controller('onec')
export class OneCController {
  private readonly logger = new Logger(OneCController.name);

  constructor(private readonly oneCService: OneCService) {}

  @Post('sync')
  @UseGuards(OneCAuthGuard)
  async syncFromOneC(
    @Body() body: { 
      projects: OneCProject[]; 
      employees: OneCEmployee[]; 
      defectTypes: OneCDefectType[] 
    },
  ) {
    this.logger.log(`Синхронизация инициирована 1С. Получено проектов: ${body.projects?.length}`);

    const updatedProjects = await this.oneCService.syncAndReturnData(
      body.projects || [],
      body.employees || [],
      body.defectTypes || [],
    );

    return { 
      success: true, 
      projects: updatedProjects 
    };
  }

  @Get('defect-types')
  async getDefectTypes() {
    return this.oneCService.getDefectTypesForSelect();
  }

  @Get('employees')
  async getEmployees() {
    return this.oneCService.getEmployeesForSelect();
  }
}