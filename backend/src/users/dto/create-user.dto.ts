import { IsString, IsEnum } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  login: string;

  @IsString()
  password: string;

  @IsEnum(Role)
  role: Role;
}
