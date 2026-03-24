// users.module.ts
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaService } from '../prisma/prisma.service';
import { OneCService } from '../integrations/oneC/onec.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, PrismaService, OneCService],
  exports: [UsersService],
})
export class UsersModule {}