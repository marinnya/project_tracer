import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Увеличиваем лимиты body-parser:
  // при "Записать" фронт отправляет большой JSON (список фото/метаданных),
  // и стандартный лимит (~100kb) даёт 413 Payload Too Large.
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  app.enableCors({
    origin: ['http://localhost:5173', 'http://192.168.88.198', 'http://45.80.71.143'], // разрешаем локальную разработку и продакшен сервер
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();