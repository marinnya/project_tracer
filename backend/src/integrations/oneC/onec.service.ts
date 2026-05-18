import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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

@Injectable()
export class OneCService {
  constructor(private readonly prisma: PrismaService) {}

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

    // После транзакции возвращает актуальный список проектов с дефектами - за пределами транзакции, обычным клиентом
    return this.prisma.project.findMany({
      include: { defects: true }
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