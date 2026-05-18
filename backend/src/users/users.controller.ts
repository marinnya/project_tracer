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
@UseGuards(JwtAuthGuard, RolesGuard) // JwtAuthGuard проверяет токен, RolesGuard проверяет роль
export class UsersController {
  constructor(
    private usersService: UsersService,
    private oneCService: OneCService,
  ) {}

  // получение сотрудников из БД для выпадающего списка в AddModal
  @Roles(Role.ADMIN) // декоратор показывает что маршрут доступен только для админа
  // GET /users/onec-employees
  @Get('onec-employees') // должен быть ДО @Get(), @Patch(':id') и т.д.
  async getOneCEmployees() {
    return this.oneCService.getEmployeesForSelect(); // возвращает список сотрудников из 1С для выпадающего списка в AddModal
  }

  @Roles(Role.ADMIN)
  @Post()
  async create(
    @Body()
    // Достаёт тело запроса и типизирует его
    dto: {
      firstName: string;
      lastName: string;
      login: string;
      password: string;
      role: string;
      oneCId?: string;
    },
  ) {
    console.log('CONTROLLER DTO RECEIVED:', dto); // лог
    return this.usersService.create(dto); // Передаёт данные в сервис, который создаст юзера в БД
  }

  // Возвращает список всех сотрудников для таблицы в админке
  @Roles(Role.ADMIN)
  @Get()
  getEmployees() {
    return this.usersService.findAllEmployees();
  }

  @Roles(Role.ADMIN)
  @Patch(':id/block')
  // Достаёт булево значение — true заблокировать, false разблокировать
  block(@Param('id') id: string, @Body('value') value: boolean) {
    return this.usersService.blockUser(id, value);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.usersService.deleteUser(id); // удаляет юзера по id
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  // оба поля необязательные - можно передать одно или оба
  update(@Param('id') id: string, @Body() body: { login?: string; password?: string }) {
    return this.usersService.updateUser(id, body); // универсальное обновление юзера
  }

}