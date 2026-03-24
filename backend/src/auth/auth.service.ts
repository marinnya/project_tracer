import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Resend } from 'resend';

@Injectable()
export class AuthService {
  private resend = new Resend(process.env.RESEND_API_KEY);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async validateUser(login: string, password: string) {
    const user = await this.usersService.findByLogin(login);

    // пользователь не найден или заблокирован
    if (!user || user.isBlocked) return null;

    // проверяем пароль
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) return null;

    return user;
  }

  async login(user: any) {
    const payload = {
      sub: user.id,
      role: user.role,
      login: user.login,
      firstName: user.firstName,
      lastName: user.lastName,
    };

    return {
      access_token: this.jwtService.sign(payload),
      role: user.role,
      login: user.login,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }

  // отправляет письмо с логином и ссылкой на смену пароля
  async requestPasswordReset(email: string): Promise<void> {
  const user = await this.prisma.user.findUnique({ where: { email } });
  
  console.log('Ищем пользователя по email:', email);
  console.log('Найден:', user ? user.login : 'не найден');

  if (!user) return;

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
  await this.prisma.passwordResetToken.create({
    data: { token, userId: user.id, expiresAt },
  });

  const resetUrl = `${process.env.APP_URL}/reset-password?token=${token}`;

  console.log('Отправляем письмо на:', email);
  console.log('Resend API key есть:', !!process.env.RESEND_API_KEY);

  try {
    const result = await this.resend.emails.send({
      from: 'Project Tracer <onboarding@resend.dev>',
      to: email,
      subject: 'Восстановление доступа — Project Tracer',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Восстановление доступа</h2>
          <p>Ваш логин для входа: <strong>${user.login}</strong></p>
          <p>Для смены пароля перейдите по ссылке. Ссылка действительна <strong>1 час</strong>.</p>
          <a href="${resetUrl}"
            style="display:inline-block; padding: 12px 24px; background:#1976d2; color:#fff; border-radius:8px; text-decoration:none;">
            Сменить пароль
          </a>
          <p style="color:#999; font-size:12px; margin-top:24px;">
            Если вы не запрашивали восстановление доступа — просто проигнорируйте это письмо.
          </p>
        </div>
      `,
    });
    console.log('Resend ответил:', JSON.stringify(result));
  } catch (e: any) {
    console.error('Ошибка Resend:', e.message, JSON.stringify(e));
  }
}

  // меняет пароль по токену из письма
  async resetPassword(token: string, newPassword: string): Promise<void> {
    // ищем токен в БД
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    // токен не найден или протух
    if (!resetToken || resetToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Ссылка недействительна или истекла');
    }

    // хешируем новый пароль
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // обновляем пароль пользователя
    await this.prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    });

    // удаляем использованный токен
    await this.prisma.passwordResetToken.delete({ where: { token } });
  }
}