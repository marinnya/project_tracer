import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET, // без fallback — если не задан, приложение не запустится
      signOptions: { expiresIn: '8h' }, // 8 часов — рабочий день
    }),
  ],
  providers: [AuthService, JwtStrategy, PrismaService], 
  controllers: [AuthController],
})
export class AuthModule {}