import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    const existing = await this.prisma.user.findUnique({
      where: { login: data.login },
    });

    if (existing) {
      throw new BadRequestException('Login already exists');
    }

    const hash = await bcrypt.hash(data.password, 10);

    let roleEnum: Role = data.role?.toLowerCase() === 'admin' ? Role.ADMIN : Role.EMPLOYEE;

    return this.prisma.user.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        login: data.login,
        passwordHash: hash,
        role: roleEnum,
      },
    });
  }

  async findAllEmployees() {
    return this.prisma.user.findMany({
      where: {
        role: Role.EMPLOYEE,
        deletedAt: null,
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

  // для редактирования логина или пароля
  async updateUser(userId: string, data: { login?: string; password?: string }) {
    const updateData: any = {};

    if (data.login) updateData.login = data.login;
    if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 10);

    return this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });
  }

}
