import { Module } from '@nestjs/common';
import { OneCService } from './onec.service';
import { OneCController } from './onec.controller';
import { PrismaService } from '../../prisma/prisma.service';

// Модуль — это способ организации кода в NestJS. Он говорит фреймворку что существует и что с чем связано
//Без регистрации в модуле NestJS не знает о существовании контроллера и сервиса — они есть как файлы, но приложение их не видит и маршруты не создаются

@Module({
  // Регистрирует контроллер — NestJS создаст его экземпляр и зарегистрирует все его маршруты (/onec/sync, /onec/defect-types)
  // Без этого маршруты не появятся
  controllers: [OneCController],
  // Регистрирует сервисы как провайдеры — говорит NestJS что эти классы можно внедрять через конструктор
  // В конструкторе контроллера можно написать oneCService: OneCService и NestJS знает откуда его взять
  providers: [OneCService, PrismaService],
  // Делает OneCService доступным для других модулей. Например ProjectsModule использует OneCService для отправки данных в 1С — это возможно потому что он экспортирован
  // Без exports сервис был бы виден только внутри OneCModule
  exports: [OneCService],
})
export class OneCModule {}