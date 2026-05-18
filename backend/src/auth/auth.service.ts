import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';

// проверяет что пароль соответствует требованиям, true/false
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
  private transporter = nodemailer.createTransport({ // создаёт объект для отправки почты через Яндекс SMTP
    host: 'smtp.yandex.ru', // хост SMTP сервера Яндекса
    port: 465, // порт SMTP сервера Яндекса
    secure: true, // используется SSL (TLS)
    // логин и пароль для SMTP сервера Яндекса берутся из env-переменных
    auth: {
      user: process.env.YANDEX_MAIL_USER,
      pass: process.env.YANDEX_MAIL_PASS,
    },
  });

  constructor(
    private usersService: UsersService, // сервис для работы с пользователями
    private jwtService: JwtService, // сервис для работы с JWT токенами
    private prisma: PrismaService, // сервис для работы с БД
  ) {}

  // ищет юзера в БД по логину черезUsersService
  async validateUser(login: string, password: string) {
    const user = await this.usersService.findByLogin(login);
    if (!user || user.isBlocked) return null;
    const isMatch = await bcrypt.compare(password, user.passwordHash); // сравнивает введенный пароль с хешем в БД
    if (!isMatch) return null;
    return user; // возвращает объект юзера
  }

  // Формирует содержимое токена — то что будет внутри JWT
  async login(user: { id: string; role: string; login: string; firstName: string; lastName: string }) {
    const payload = {
      sub: user.id, // sub — стандартное поле для ID
      role: user.role,
      login: user.login,
      firstName: user.firstName,
      lastName: user.lastName,
    };

    // jwtService.sign() создаёт JWT-токен из payload
    // Вместе с токеном возвращает роль, логин, имя — чтобы фронт не делал лишний запрос /me сразу после логина
    return {
      access_token: this.jwtService.sign(payload),
      role: user.role,
      login: user.login,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }

  async requestPasswordReset(email: string): Promise<void> {
    // ищет юзера в БД по email
    const user = await this.prisma.user.findUnique({ where: { email } });
    // если юзера нет, то ничего не делаем
    if (!user) return;

    const token = crypto.randomBytes(32).toString('hex'); // генерирует случайный 64-симв. токен (одноразовая ссылка для сброса пароля)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // действует 1 час
    // удаляет все токены для этого юзера, чтобы не было дубликатов
    await this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    // сохраняет новый токен в БД, привязав в юзеру
    await this.prisma.passwordResetToken.create({
      data: { token, userId: user.id, expiresAt },
    });

    // формируем ссылку для письма
    const resetUrl = `${process.env.APP_URL}/reset-password?token=${token}`;

    try { // отправляем письмо с ссылкой на сброс пароля
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
    // проверяем новый пароль
    if (!validatePassword(newPassword)) {
      throw new BadRequestException(PASSWORD_ERROR);
    }
    // ищем токен в БД, подтягиваем связанного юзера через include
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetToken || resetToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Ссылка недействительна или истекла');
    }

    // Хешируем новый пароль, 10 - количество rounds bcrypt
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // сохраняем хеш пароля в БД
    await this.prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    });

    // Удаляем использованный токен - ссылка становится одноразовой
    await this.prisma.passwordResetToken.delete({ where: { token } });
  }
}