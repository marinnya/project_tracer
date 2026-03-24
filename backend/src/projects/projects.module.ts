import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';
import { OneCService } from '../integrations/oneC/onec.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [ProjectsController],
  providers: [ProjectsService, PrismaService, OneCService],
})
export class ProjectsModule {}
