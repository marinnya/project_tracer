import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';

// типы данных из 1С
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

@Injectable()
export class OneCService {
  private readonly logger = new Logger(OneCService.name);
  private readonly baseUrl = process.env.ONEC_API_URL;
  private readonly token = process.env.ONEC_TOKEN;

  constructor(private readonly prisma: PrismaService) {}

  private getHeaders() {
    return { Authorization: `Bearer ${this.token}` };
  }

  /**
   * Сохраняет данные из 1С: проекты и сотрудников
   * Возвращает обновлённые проекты для сверки с 1С
   */
  async syncFromOneC(projects: OneCProject[], employees: OneCEmployee[]) {
    this.logger.log('Начата синхронизация данных из 1С');

    // Сначала синхронизируем сотрудников
    for (const emp of employees) {
      try {
        await this.prisma.user.upsert({
          where: { oneCId: emp.id },
          update: { firstName: emp.firstName, lastName: emp.lastName },
          create: {
            oneCId: emp.id,
            firstName: emp.firstName,
            lastName: emp.lastName,
            login: '', // админ добавит позже
            passwordHash: '', // админ добавит позже
            role: 'EMPLOYEE',
          },
        });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(`Ошибка синхронизации сотрудника ${emp.id}: ${message}`);
      }
    }

    // Синхронизация проектов
    for (const project of projects) {
      try {
        const responsibleUser = await this.prisma.user.findUnique({
          where: { oneCId: project.responsibleId },
        });

        await this.prisma.project.upsert({
          where: { oneCId: project.id },
          update: {
            name: project.name,
            responsible: project.responsible,
            oneCResponsibleId: project.responsibleId,
            responsibleId: responsibleUser?.id ?? null,
            startDate: new Date(project.startDate),
            endDate: new Date(project.endDate),
          },
          create: {
            oneCId: project.id,
            name: project.name,
            responsible: project.responsible,
            oneCResponsibleId: project.responsibleId,
            responsibleId: responsibleUser?.id ?? null,
            startDate: new Date(project.startDate),
            endDate: new Date(project.endDate),
            status: 'В работе',
          },
        });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(`Ошибка синхронизации проекта ${project.id}: ${message}`);
      }
    }

    // Возвращаем актуальные проекты для сверки с 1С
    const oneCIds = projects.map((p) => p.id);
    const updatedProjects = await this.prisma.project.findMany({
      where: { oneCId: { in: oneCIds } },
    });

    return updatedProjects;
  }

  /**
   * Получить список сотрудников для селекта
   */
  async getEmployeesForSelect(): Promise<OneCEmployee[]> {
    const users = await this.prisma.user.findMany({
      where: { oneCId: { not: null } },
    });

    return users.map((u) => ({
      id: u.oneCId!,
      firstName: u.firstName,
      lastName: u.lastName,
    }));
  }

  /**
   * Отправка обновлённых дат проекта в 1С
   */
  /**
 * Отправка ВСЕХ данных проекта в 1С одним запросом
 */
  async sendProjectUpdate(data: {
    oneCId: string;
    startDate: Date | null;
    endDate: Date | null;
    folderUrl: string | null;
  }) {
    if (!data.oneCId) {
      this.logger.warn('Пропущена отправка в 1С: нет oneCId');
      return;
    }

    if (!this.baseUrl) {
      this.logger.error('ONEC_API_URL не задан');
      return;
    }

    this.logger.log(`Отправка проекта ${data.oneCId} в 1С`);

    try {
      const response = await axios.post(
        `${this.baseUrl}/project/update`,
        {
          id: data.oneCId,
          startDate: data.startDate ? data.startDate.toISOString() : null,
          endDate: data.endDate ? data.endDate.toISOString() : null,
          folderUrl: data.folderUrl,
        },
        { headers: this.getHeaders() },
      );

      this.logger.log(`1С ответ: ${JSON.stringify(response.data)}`);
    } catch (e: any) {
      this.logger.error(`Ошибка отправки в 1С: ${e.message}`);
    }
  }
}