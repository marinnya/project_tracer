import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

// подключение внешних модулей, которые нужны для авторизации
@Module({
  // импортируем модули, которые нужны для авторизации
  imports: [
    UsersModule,
    PassportModule,
    // Регистрирует JWT-модуль и настраивает его
    JwtModule.register({
      secret: process.env.JWT_SECRET, // ключ подписи токенов берется из env-переменной, используется для sign/verify (чтобы не могли подделать токен)
      signOptions: { expiresIn: '8h' }, // Все создаваемые JWT будут жить 8 часов
    }),
  ],
  providers: [AuthService, JwtStrategy, PrismaService], 
  controllers: [AuthController],
})
export class AuthModule {}