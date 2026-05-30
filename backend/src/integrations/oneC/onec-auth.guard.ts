import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

// проверяет наличие токена для 1с
@Injectable()
export class OneCAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Отсутствует токен авторизации');
    }

    const token = authHeader.slice(7);
    const expected = process.env.ONEC_INCOMING_TOKEN;

    if (!expected) {
      throw new Error(
        'ONEC_INCOMING_TOKEN не задан в .env — сервер не настроен для приёма запросов от 1С',
      );
    }

    if (token !== expected) {
      throw new UnauthorizedException('Неверный токен');
    }

    return true;
  }
}