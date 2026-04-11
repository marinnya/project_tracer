import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';

// правила валидации — дублируем на бэкенде независимо от фронта
const validateLogin = (login: string): string | null => {
  if (login.length < 5) return 'Логин должен содержать не менее 5 символов';
  if (!/^[a-zA-Z0-9_]+$/.test(login)) return 'Логин может содержать только латинские буквы, цифры и _';
  return null;
};

const validatePassword = (password: string): string | null => {
  if (password.length < 8) return 'Пароль должен содержать не менее 8 символов';
  if (!/[A-Z]/.test(password)) return 'Пароль должен содержать хотя бы одну заглавную букву';
  if (!/[a-z]/.test(password)) return 'Пароль должен содержать хотя бы одну строчную букву';
  if (!/[0-9]/.test(password)) return 'Пароль должен содержать хотя бы одну цифру';
  return null;
};

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

    // валидация пароля
    const passwordError = validatePassword(data.password);
    if (passwordError) throw new BadRequestException(passwordError);

    const hash = await bcrypt.hash(data.password, 10);
    const roleEnum: Role = data.role?.toUpperCase() === 'ADMIN' ? Role.ADMIN : Role.EMPLOYEE;

    // если передан oneCId — ищем существующего пользователя из 1С
    if (data.oneCId) {
      const existingByOneCId = await this.prisma.user.findUnique({
        where: { oneCId: data.oneCId },
      });

      if (existingByOneCId) {
        // пользователь уже есть в БД (пришёл из 1С) — обновляем логин и пароль
        const user = await this.prisma.user.update({
          where: { oneCId: data.oneCId },
          data: {
            login: data.login,
            passwordHash: hash,
            role: roleEnum,
            firstName: data.firstName,
            lastName: data.lastName,
          },
        });

        // связываем все проекты где oneCResponsibleId совпадает с его oneCId
        await this.prisma.project.updateMany({
          where: { oneCResponsibleId: user.oneCId! },
          data: { responsibleId: user.id },
        });

        return user;
      }
    }

    // проверяем что логин не занят
    const existing = await this.prisma.user.findUnique({
      where: { login: data.login },
    });

    if (existing) {
      throw new BadRequestException('Логин уже занят');
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

    // если у нового пользователя есть oneCId —
    // связываем все проекты где oneCResponsibleId совпадает с его oneCId
    // это нужно когда проект подгрузился из 1С раньше чем сотрудника добавили в приложение
    if (user.oneCId) {
      await this.prisma.project.updateMany({
        where: { oneCResponsibleId: user.oneCId },
        data: { responsibleId: user.id },
      });
    }

    return user;
  }

  // возвращает всех активных сотрудников (не удалённых)
  async findAllEmployees() {
    return this.prisma.user.findMany({
      where: {
        role: Role.EMPLOYEE,
        deletedAt: null,
        NOT: { login: { startsWith: 'onec_' } }, // скрываем не добавленных админом
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

  // блокировка/разблокировка пользователя
  async blockUser(userId: string, value: boolean) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { isBlocked: value },
    });
  }

  // мягкое удаление — проставляем deletedAt вместо физического удаления
  async deleteUser(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
    });
  }

  // поиск по логину — используется при авторизации
  async findByLogin(login: string) {
    return this.prisma.user.findFirst({
      where: {
        login,
        deletedAt: null,
      },
    });
  }

  // редактирование логина или пароля
  async updateUser(userId: string, data: { login?: string; password?: string }) {
    const updateData: Partial<{ login: string; passwordHash: string }> = {};

    if (data.login) {
      const loginError = validateLogin(data.login);
      if (loginError) throw new BadRequestException(loginError);
      updateData.login = data.login;
    }

    if (data.password) {
      const passwordError = validatePassword(data.password);
      if (passwordError) throw new BadRequestException(passwordError);
      updateData.passwordHash = await bcrypt.hash(data.password, 10);
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });
  }
}