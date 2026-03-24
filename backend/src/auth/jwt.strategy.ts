import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  async validate(payload: any) {
    // payload — это то что положили в токен при login
    // здесь можно добавить проверку что пользователь не заблокирован
    if (!payload.sub || !payload.role) {
      throw new UnauthorizedException();
    }
    return { id: payload.sub, role: payload.role, login: payload.login };
  }
}