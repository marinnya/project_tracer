import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * Декоратор для назначения ролей на роут
 * Пример:
 * @Roles(Role.ADMIN)
 * @Roles(Role.ADMIN, Role.EMPLOYEE)
 */
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
