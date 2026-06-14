import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// JwtAuthGuard - это Guard, который проверяет наличие и валидность JWT токена в запросе
// AuthGuard('jwt') - это метод Passport, который использует стратегию JwtStrategy для проверки токена

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

