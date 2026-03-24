import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../prisma/prisma.service';

// типы данных которые приходят из 1С
// данные проекта
type OneCProject = {
  id: string;
  name: string;
  responsible: string;
  responsibleId: string;
  startDate: string;
  endDate: string;
};

// ФИО сотрудника
type OneCEmployee = {
  id: string;
  firstName: string;
  lastName: string;
};

// этот класс можно внедрять в другие через конструктор
@Injectable()
export class OneCService {
  private readonly logger = new Logger(OneCService.name);

  // базовый URL и токен берём из .env
  private readonly baseUrl = process.env.ONEC_API_URL; // читает адрес 1с-сервера из env файла
  private readonly token = process.env.ONEC_TOKEN; // токен авторизации из env файла, вставляется в каждый запрос к 1с

  constructor(private readonly prisma: PrismaService) {}

  // возвращает объект с заголовком авторизации для всех запросов к 1С
  private getHeaders() {
    return { Authorization: `Bearer ${this.token}` };
  }

  // ПОЛУЧЕНИЕ ДАННЫХ ИЗ 1С

  // асинхронная функция: получает список проектов из 1С и сохраняет/обновляет в нашей БД
  async syncProjects(): Promise<void> {
    this.logger.log('Синхронизация проектов из 1С...');

    // ЗАГЛУШКА — раскомментировать когда 1С-разработчик создаст API
    // const { data } = await axios.get<OneCProject[]>(
    //   `${this.baseUrl}/projects`,
    //   { headers: this.getHeaders() }
    // );

    // временные тестовые данные пока нет API от 1С
    const data: OneCProject[] = [
      {
        id: '1c-001',
        name: 'Ремонт склада №1',
        responsible: 'Иван Иванов',
        responsibleId: 'emp-001',
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      },
    ];

    // сохраняем каждый проект в нашу БД
    for (const project of data) {

      // ищем пользователя по oneCId чтобы получить наш внутренний User.id
      // пользователь может ещё не быть добавлен в приложение — тогда null
      const responsibleUser = await this.prisma.user.findUnique({
        where: { oneCId: project.responsibleId },
      });

      await this.prisma.project.upsert({
        // upsert = update (если запись уже существует) + insert (если ещё нет)
        where: { oneCId: project.id },
        update: {
          name: project.name,
          responsible: project.responsible,         // ФИО всегда обновляем из 1С
          oneCResponsibleId: project.responsibleId, // id сотрудника в 1С
          responsibleId: responsibleUser?.id ?? null, // наш внутренний id — если нашли
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
    }

    this.logger.log(`Синхронизировано проектов: ${data.length}`);
  }

  // возвращает список всех сотрудников из 1С для выпадающего списка в AddModal
  async getEmployeesForSelect(): Promise<OneCEmployee[]> {
    // ЗАГЛУШКА — раскомментировать когда будет API
    // const { data } = await axios.get<OneCEmployee[]>(
    //   `${this.baseUrl}/employees`,
    //   { headers: this.getHeaders() }
    // );
    // return data;

    // временные тестовые данные
    return [
      { id: 'emp-001', firstName: 'Иван', lastName: 'Иванов' },
      { id: 'emp-002', firstName: 'Петр', lastName: 'Петров' },
    ];
  }

  // ОТПРАВКА ДАННЫХ В 1С

  // отправляет обновлённые даты проекта в 1С
  async updateProjectDates(oneCId: string, startDate: Date | null, endDate: Date | null): Promise<void> {
    this.logger.log(`Отправка дат проекта ${oneCId} в 1С`);

    // ЗАГЛУШКА — раскомментировать когда будет API
    // await axios.patch(
    //   `${this.baseUrl}/projects/${oneCId}/dates`,
    //   { startDate, endDate },
    //   { headers: this.getHeaders() }
    // );

    this.logger.log('ЗАГЛУШКА: даты в 1С не отправлены (API ещё не готов)');
  }

  // отправляет ссылку на Яндекс.Диск в 1С после завершения проекта
  async sendFolderUrl(oneCId: string, folderUrl: string): Promise<void> {
    this.logger.log(`Отправка ссылки на Яндекс.Диск для проекта ${oneCId} в 1С`);

    // ЗАГЛУШКА — раскомментировать когда будет API
    // await axios.post(
    //   `${this.baseUrl}/projects/${oneCId}/complete`,
    //   { folderUrl },
    //   { headers: this.getHeaders() }
    // );

    this.logger.log('ЗАГЛУШКА: ссылка в 1С не отправлена (API ещё не готов)');
  }
}