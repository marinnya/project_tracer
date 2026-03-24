import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { OneCService } from '../integrations/oneC/onec.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private usersService: UsersService,
    private oneCService: OneCService, // добавили OneCService
  ) {}

  @Roles(Role.ADMIN)
  @Post()
  async create(@Body() dto: { firstName: string; lastName: string; login: string; password: string; role: string }) {
    return this.usersService.create(dto);
  }

  @Roles(Role.ADMIN)
  @Get()
  getEmployees() {
    return this.usersService.findAllEmployees();
  }

  @Roles(Role.ADMIN)
  @Patch(':id/login')
  changeLogin(@Param('id') id: string, @Body('login') login: string) {
    return this.usersService.changeLogin(id, login);
  }

  @Roles(Role.ADMIN)
  @Patch(':id/password')
  changePassword(@Param('id') id: string, @Body('password') password: string) {
    return this.usersService.changePassword(id, password);
  }

  @Roles(Role.ADMIN)
  @Patch(':id/block')
  block(@Param('id') id: string, @Body('value') value: boolean) {
    return this.usersService.blockUser(id, value);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.usersService.deleteUser(id);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { login?: string; password?: string }) {
    return this.usersService.updateUser(id, body);
  }

  // получение сотрудников из 1С для выпадающего списка в AddModal
  @Roles(Role.ADMIN)
  @Get('onec-employees')
  async getOneCEmployees() {
    return this.oneCService.getEmployeesForSelect();
  }
}