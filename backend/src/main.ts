import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: ['http://localhost:5173', 'http://45.80.71.143'], // разрешаем локальную разработку и продакшен сервер
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();