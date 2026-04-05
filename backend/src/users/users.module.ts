import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaService } from '../prisma/prisma.service';
import { OneCModule } from '../integrations/oneC/onec.module';

@Module({
  imports: [OneCModule], // импортируем чтобы получить доступ к OneCService
  controllers: [UsersController],
  providers: [UsersService, PrismaService],
  exports: [UsersService],
})
export class UsersModule {}