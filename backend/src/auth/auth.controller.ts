import { Controller, Post, Get, Body, UnauthorizedException, UseGuards, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  async login(@Body() body: { login: string; password: string }) {
    const user = await this.authService.validateUser(body.login, body.password);
    if (!user) throw new UnauthorizedException('Неверный логин или пароль');
    return this.authService.login(user);
  }

  // проверка токена при перезагрузке страницы
  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@Request() req: any) {
    return req.user;
  }

  // запрос на восстановление — отправляет письмо с логином и ссылкой на смену пароля
  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) {
    await this.authService.requestPasswordReset(body.email);
    // всегда возвращаем одинаковый ответ — не раскрываем существует ли email
    return { message: 'Если email найден, письмо отправлено' };
  }

  // смена пароля по токену из письма
  @Post('reset-password')
  async resetPassword(@Body() body: { token: string; password: string }) {
    await this.authService.resetPassword(body.token, body.password);
    return { message: 'Пароль успешно изменён' };
  }
}