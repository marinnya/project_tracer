import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';

@Injectable()
// классJwtStrategy получает всю готовую логику Passport для работы с JWT
// Strategy - готовая JWT-стратегия Passport, которая умеет читать JWT, проверять подпись и срок, извлекать payload
export class JwtStrategy extends PassportStrategy(Strategy) { 
  constructor() {
    // super() - вызывает конструктор родительского класса PassportStrategy
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), // извлекает JWT из заголовка Authorization
      secretOrKey: process.env.JWT_SECRET, // ключ подписи токенов берется из env-переменной
    });
  }

  // этот метод Passport вызывает автоматически после успешной проверки подписи токена
  // метод превращает payload в req.user
  async validate(payload: any) { // payload - это то что положили в токен при login { sub: user.id, login: user.login, role: user.role }
    if (!payload.sub || !payload.role) {
      throw new UnauthorizedException();
    }
    return { id: payload.sub, role: payload.role, login: payload.login }; // то что вернёт этот метод, Passport автоматически положит в req.user
  }
}