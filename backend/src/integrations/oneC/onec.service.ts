import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// TypeScript-тип — описание того какую форму должен иметь объект проекта пришедший из 1С
// Говорит компилятору: "объект типа OneCProject обязательно должен содержать эти поля с этими типами данных"
// Если 1С пришлёт объект без поля name — TypeScript выдаст ошибку на этапе компиляции
// export — чтобы этот тип можно было импортировать в других файлах (например в контроллере)
export type OneCProject = {
  id: string;
  name: string;
  responsible: string;
  responsibleId: string;
  startDate: string;
  endDate: string;
};

export type OneCEmployee = {
  id: string;
  firstName: string;
  lastName: string;
};

export type OneCDefectType = {
  id: string;
  name: string;
};

// Декоратор NestJS — помечает класс как провайдер который можно внедрять через Dependency Injection
// Без него NestJS не сможет автоматически создать экземпляр этого сервиса и передать его в конструктор контроллера
@Injectable()
// Объявляет и экспортирует класс сервиса
export class OneCService {
  // NestJS автоматически создаёт экземпляр PrismaService и передаёт его сюда
  // После этого во всех методах класса доступен this.prisma для работы с базой данных
  constructor(private readonly prisma: PrismaService) {}

  // метод асинхронный, внутри будут запросы к БД которые занимают время
  // Без async нельзя использовать await
  // Три параметра метода — массивы объектов соответствующих типов
  // OneCProject[] - "массив объектов типа OneCProject"
  async syncAndReturnData(
    projects: OneCProject[],
    employees: OneCEmployee[],
    defectTypes: OneCDefectType[],
  ) {

    // Оборачивает все операции в одну транзакцию
    // Если что-то упадёт на середине — все изменения откатятся
    // tx — это тот же Prisma-клиент, но внутри транзакции, все запросы идут через него
    await this.prisma.$transaction(async (tx) => {
      // Синхронизируем типы дефектов
      // upsert - если запись с таким oneCId уже есть - обновляет name, нет - создаёт новую
      for (const dt of defectTypes) {
        await tx.defectType.upsert({
          where: { oneCId: dt.id },
          update: { name: dt.name },
          create: { oneCId: dt.id, name: dt.name },
        });
      }

      // Синхронизируем сотрудников
      for (const emp of employees) {
        await tx.user.upsert({
          where: { oneCId: emp.id },
          update: { firstName: emp.firstName, lastName: emp.lastName },
          create: {
            oneCId: emp.id,
            firstName: emp.firstName,
            lastName: emp.lastName,
            login: `onec_${emp.id}`, // технический юзер
            passwordHash: 'external_auth', // заглушка пароля
            role: 'EMPLOYEE',
          },
        });
      }

      // Синхронизируем проекты
      for (const p of projects) {
        // Ищет юзера по oneCId ответственного из 1С - чтобы привязать реальный id из БД к проекту
        const user = p.responsibleId 
          ? await tx.user.findUnique({ where: { oneCId: p.responsibleId } }) 
          : null;

        await tx.project.upsert({
          where: { oneCId: p.id },
          update: {
            name: p.name,
            oneCResponsibleId: p.responsibleId,
            responsibleId: user?.id || null,
            startDate: p.startDate ? new Date(p.startDate) : null,
            endDate: p.endDate ? new Date(p.endDate) : null,
          },
          create: {
            oneCId: p.id,
            name: p.name,
            oneCResponsibleId: p.responsibleId,
            responsibleId: user?.id || null,
            startDate: p.startDate ? new Date(p.startDate) : null,
            endDate: p.endDate ? new Date(p.endDate) : null,
          },
        });
      }
    });

    // В ответ 1С — только проекты «в работе» (без archivedAt); архивные не отправляем
    return this.prisma.project.findMany({
      where: { archivedAt: null },
      include: { defects: true },
    });
  }

  // Все типы дефектов отсортированные по алфавиту - для выпадающего списка на фронте
  async getDefectTypesForSelect() {
    return this.prisma.defectType.findMany({ orderBy: { name: 'asc' } });
  }

  // Только юзеры привязанные к 1С - у которых есть oneCId
  async getEmployeesForSelect() {
    const users = await this.prisma.user.findMany({ where: { oneCId: { not: null } } });
    return users.map((u) => ({
      id: u.oneCId, 
      firstName: u.firstName,
      lastName: u.lastName,
      displayName: `${u.lastName} ${u.firstName}`.trim(),
    }));
  }
}