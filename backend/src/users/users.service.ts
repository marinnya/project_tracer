import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';

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
    // проверяем что логин не занят
    const existing = await this.prisma.user.findUnique({
      where: { login: data.login },
    });

    if (existing) {
      throw new BadRequestException('Login already exists');
    }

    const hash = await bcrypt.hash(data.password, 10);

    const roleEnum: Role = data.role?.toUpperCase() === 'ADMIN' ? Role.ADMIN : Role.EMPLOYEE;

    // создаём пользователя с oneCId если передан
    const user = await this.prisma.user.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        login: data.login,
        passwordHash: hash,
        role: roleEnum,
        oneCId: data.oneCId ?? null, // ID сотрудника в 1С — для связи с проектами
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

    if (data.login) updateData.login = data.login;
    if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 10);

    return this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });
  }
}