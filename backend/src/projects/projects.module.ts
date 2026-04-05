import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';
import { OneCModule } from '../integrations/oneC/onec.module';

@Module({
  imports: [OneCModule], // используем модуль вместо прямого сервиса
  controllers: [ProjectsController],
  providers: [ProjectsService, PrismaService],
})
export class ProjectsModule {}