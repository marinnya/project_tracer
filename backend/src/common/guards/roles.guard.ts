import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// проверяет роль пользователя (payload из токена, там роль сравнивается с переданной в декораторе)
@Injectable()
// У интерфейса CanActivate есть метод canActivate, который должен вернуть true или false
export class RolesGuard implements CanActivate {
  // автоматически создаем Reflector, который будет использоваться для получения ролей из декоратора
  constructor(private reflector: Reflector) {}

  // метод canActivate вызывается автоматически перед выполнением контроллера
  canActivate(context: ExecutionContext): boolean {
    // reflector.get() читает метаданные из декоратора (получает roles = ['ADMIN'])
    const roles = this.reflector.get<string[]>( 
      'roles',
      context.getHandler(), // получаем handler (метод контроллера)
    );

    // если у роута нет ролей @Roles(), то разрешаем доступ
    if (!roles) return true;

    // получаем http-запрос из контекста, с которым будем работать
    const request = context.switchToHttp().getRequest();
    // достаём из запроса user (payload из токена)
    const user = request.user;

    // проверяем, есть ли роль пользователя в массиве ролей, которые переданы в декораторе
    return roles.includes(user.role);
  }
}
