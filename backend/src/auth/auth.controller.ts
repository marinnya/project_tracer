import { Controller, Post, Get, Body, UnauthorizedException, UseGuards, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {} // контроллер может вызывать методы AuthService

  // слушает POST /auth/login
  @Post('login')
  async login(@Body() body: { login: string; password: string }) { // получает логин и пароль из тела запроса
    const user = await this.authService.validateUser(body.login, body.password);
    if (!user) throw new UnauthorizedException('Неверный логин или пароль');
    return this.authService.login(user); // вызывает метод login из AuthService и возвращает токен
  }

  // проверка токена при перезагрузке страницы
  // слушает GET /auth/me
  @Get('me')
  @UseGuards(JwtAuthGuard) // прежде чем выполнить метод, проверяет JWT из заголовка Authorization
  getMe(@Request() req: any) { // достаёт объект запроса целиком
    return req.user; // возвращает данные юзера, которые JwtStrategy положил в req.user после верификации токена
  }

  // запрос на восстановление - отправляет письмо с логином и ссылкой на смену пароля
  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) { // получает email из тела запроса
    await this.authService.requestPasswordReset(body.email); // ищет юзера по email и отправляет письмо со ссылкой вида /reset-password?token=...
    return { message: 'Если email найден, письмо отправлено' };
  }

  // смена пароля по токену из письма
  @Post('reset-password')
  async resetPassword(@Body() body: { token: string; password: string }) { // получает token и новый пароль из тела запроса
    await this.authService.resetPassword(body.token, body.password); // проверяет токен, хеширует новый пароль и сохраняет в БД
    return { message: 'Пароль успешно изменён' };
  }
}