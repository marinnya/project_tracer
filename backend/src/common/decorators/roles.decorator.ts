import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * Декоратор для назначения ролей на роут
 * Пример:
 * @Roles(Role.ADMIN)
 * @Roles(Role.ADMIN, Role.EMPLOYEE)
 */
// Создаётся и экспортируется константа (функция), чтобы её можно было импортировать в контроллеры
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);

// (...roles: Role[]) собирает все переданные роли в массив roles = ['ADMIN', 'EMPLOYEE']
// SetMetadata('roles', roles) сохраняет этот массив в метаданные для метода контроллера с ключом 'roles'
// Эти метаданные будут доступны в Reflector, который будет использоваться в RolesGuard для проверки ролей
// RolesGuard читает reflector.get('roles', ...) и получает ['ADMIN', 'EMPLOYEE']