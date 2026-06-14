import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

// проверяет наличие токена для 1с
@Injectable()
// Этот класс обязан иметь метод canActivate()
export class OneCAuthGuard implements CanActivate {
  // Nest вызывает этот метод автоматически перед выполнением контроллера
  canActivate(context: ExecutionContext): boolean {
    // Получает объект Express Request
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization']; // Читаем заголовок Authorization

    // Если токен отсутствует или не начинается с Bearer, выбрасываем ошибку
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Отсутствует токен авторизации');
    }

    // извлекаем токен из заголовка, отрезая первые 7 символов "Bearer_"
    const token = authHeader.slice(7);
    const expected = process.env.ONEC_INCOMING_TOKEN; // Получаем токен из env-переменной

    // Если токен в .env не задан, выбрасываем ошибку
    if (!expected) {
      throw new Error(
        'ONEC_INCOMING_TOKEN не задан в .env — сервер не настроен для приёма запросов от 1С',
      );
    }

    // Если токен не совпадает с ожидаемым, выбрасываем ошибку
    if (token !== expected) {
      throw new UnauthorizedException('Неверный токен');
    }

    // если все правильно, то Guard разрешает выполнение контроллера
    return true;
  }
}