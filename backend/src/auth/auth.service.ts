import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';

const validatePassword = (password: string): boolean => {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password)
  );
};

const PASSWORD_ERROR =
  'Пароль должен быть не менее 8 символов и содержать заглавную, строчную латинскую букву и цифру';

@Injectable()
export class AuthService {
  private transporter = nodemailer.createTransport({
    host: 'smtp.yandex.ru',
    port: 465,
    secure: true,
    auth: {
      user: process.env.YANDEX_MAIL_USER,
      pass: process.env.YANDEX_MAIL_PASS,
    },
  });

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async validateUser(login: string, password: string) {
    const user = await this.usersService.findByLogin(login);
    if (!user || user.isBlocked) return null;
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) return null;
    return user;
  }

  async login(user: { id: string; role: string; login: string; firstName: string; lastName: string }) {
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

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // не сообщаем существует ли email — защита от перебора
    if (!user) return;

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 час

    await this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await this.prisma.passwordResetToken.create({
      data: { token, userId: user.id, expiresAt },
    });

    const resetUrl = `${process.env.APP_URL}/reset-password?token=${token}`;

    try {
      await this.transporter.sendMail({
        from: `"Project Tracer" <${process.env.YANDEX_MAIL_USER}>`,
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
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('Ошибка отправки письма:', message);
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!validatePassword(newPassword)) {
      throw new BadRequestException(PASSWORD_ERROR);
    }

    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetToken || resetToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Ссылка недействительна или истекла');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    });

    await this.prisma.passwordResetToken.delete({ where: { token } });
  }
}