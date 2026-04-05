import { Module } from '@nestjs/common';
import { OneCService } from './onec.service';
import { OneCController } from './onec.controller';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [OneCController],
  providers: [OneCService, PrismaService],
  exports: [OneCService], // экспортируем чтобы другие модули могли использовать
})
export class OneCModule {}