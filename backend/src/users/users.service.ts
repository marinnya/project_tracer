import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';

const validateLogin = (login: string): string | null => {
  if (login.length < 5) return 'Логин должен содержать не менее 5 символов';
  if (!/^[a-zA-Z0-9_]+$/.test(login))
    return 'Логин может содержать только латинские буквы, цифры и _';
  return null;
};

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
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(data: {
    firstName: string;
    lastName: string;
    login: string;
    password: string;
    role: string;
    oneCId?: string;
  }) {
    // валидация логина
    const loginError = validateLogin(data.login);
    if (loginError) throw new BadRequestException(loginError);

    // проверяем что логин не занят (среди не удалённых)
    const existingLogin = await this.prisma.user.findFirst({
      where: { login: data.login, deletedAt: null },
    });

    if (existingLogin) {
      throw new BadRequestException('Логин уже занят');
    }

    // валидация пароля
    if (!validatePassword(data.password)) {
      throw new BadRequestException(PASSWORD_ERROR);
    }

    const hash = await bcrypt.hash(data.password, 10);
    const roleEnum: Role =
      data.role?.toUpperCase() === 'ADMIN' ? Role.ADMIN : Role.EMPLOYEE;

    // если передан oneCId — ищем существующего пользователя (в т.ч. удалённого)
    if (data.oneCId) {
      const existingByOneCId = await this.prisma.user.findUnique({
        where: { oneCId: data.oneCId },
      });

      if (existingByOneCId) {
        // проверяем что логин не занят другим пользователем (среди не удалённых)
        const loginTaken = await this.prisma.user.findFirst({
          where: {
            login: data.login,
            deletedAt: null,
            NOT: { id: existingByOneCId.id },
          },
        });

        if (loginTaken) {
          throw new BadRequestException('Логин уже занят');
        }

        // обновляем пользователя и сбрасываем deletedAt —
        // это ключевое исправление: при повторном добавлении удалённого сотрудника
        // он снова становится активным
        const user = await this.prisma.user.update({
          where: { oneCId: data.oneCId },
          data: {
            login: data.login,
            passwordHash: hash,
            role: roleEnum,
            firstName: data.firstName,
            lastName: data.lastName,
            deletedAt: null,       // сбрасываем мягкое удаление
            isBlocked: false,      // на всякий случай снимаем блокировку
          },
        });

        await this.prisma.project.updateMany({
          where: { oneCResponsibleId: user.oneCId! },
          data: { responsibleId: user.id },
        });

        return user;
      }
    }

    // создаём нового пользователя
    const user = await this.prisma.user.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        login: data.login,
        passwordHash: hash,
        role: roleEnum,
        oneCId: data.oneCId ?? null,
      },
    });

    if (user.oneCId) {
      await this.prisma.project.updateMany({
        where: { oneCResponsibleId: user.oneCId },
        data: { responsibleId: user.id },
      });
    }

    return user;
  }

  async findAllEmployees() {
    return this.prisma.user.findMany({
      where: {
        role: Role.EMPLOYEE,
        deletedAt: null,
        NOT: { login: { startsWith: 'onec_' } },
      },
    });
  }

  async changeLogin(userId: string, newLogin: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { login: newLogin },
    });
  }

  async changePassword(userId: string, newPassword: string) {
    const hash = await bcrypt.hash(newPassword, 10);
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hash },
    });
  }

  async blockUser(userId: string, value: boolean) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { isBlocked: value },
    });
  }

  async deleteUser(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
    });
  }

  async findByLogin(login: string) {
    return this.prisma.user.findFirst({
      where: {
        login,
        deletedAt: null,
      },
    });
  }

  async updateUser(userId: string, data: { login?: string; password?: string }) {
    const updateData: Partial<{ login: string; passwordHash: string }> = {};

    if (data.login) {
      const loginError = validateLogin(data.login);
      if (loginError) throw new BadRequestException(loginError);

      const existing = await this.prisma.user.findFirst({
        where: {
          login: data.login,
          deletedAt: null,
          NOT: { id: userId },
        },
      });

      if (existing) {
        throw new BadRequestException('Логин уже занят');
      }

      updateData.login = data.login;
    }

    if (data.password) {
      if (!validatePassword(data.password)) {
        throw new BadRequestException(PASSWORD_ERROR);
      }
      updateData.passwordHash = await bcrypt.hash(data.password, 10);
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });
  }
}