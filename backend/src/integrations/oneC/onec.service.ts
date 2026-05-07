import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import axios from 'axios';

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
  private readonly logger = new Logger(OneCService.name);

  constructor(private readonly prisma: PrismaService) {}

  async syncAndReturnData(
    projects: OneCProject[],
    employees: OneCEmployee[],
    defectTypes: OneCDefectType[],
  ) {
    await this.prisma.$transaction(async (tx) => {
      // 1. Синхронизируем типы дефектов
      for (const dt of defectTypes) {
        await tx.defectType.upsert({
          where: { oneCId: dt.id },
          update: { name: dt.name },
          create: { oneCId: dt.id, name: dt.name },
        });
      }

      // 2. Синхронизируем сотрудников (User)
      for (const emp of employees) {
        await tx.user.upsert({
          where: { oneCId: emp.id },
          update: { firstName: emp.firstName, lastName: emp.lastName },
          create: {
            oneCId: emp.id,
            firstName: emp.firstName,
            lastName: emp.lastName,
            login: `onec_${emp.id}`,
            passwordHash: 'external_auth',
            role: 'EMPLOYEE',
          },
        });
      }

      // 3. Синхронизируем проекты
      for (const p of projects) {
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

    return this.prisma.project.findMany({
      include: { defects: true }
    });
  }

  async getDefectTypesForSelect() {
    return this.prisma.defectType.findMany({ orderBy: { name: 'asc' } });
  }

  async getEmployeesForSelect() {
    const users = await this.prisma.user.findMany({ where: { oneCId: { not: null } } });
    return users.map((u) => ({
      id: u.oneCId,
      firstName: u.firstName,
      lastName: u.lastName,
      displayName: `${u.lastName} ${u.firstName}`.trim(),
    }));
  }

  /*async sendProjectUpdate(projectId: number) {
    const endpoint = process.env.ONEC_OUTGOING_URL;
    if (!endpoint) {
      this.logger.warn('ONEC_OUTGOING_URL не задан, отправка данных в 1С пропущена');
      return;
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        defects: {
          select: {
            id: true,
            typeId: true,
            pages: true,
          },
        },
      },
    });

    if (!project) {
      this.logger.warn(`Проект ${projectId} не найден, отправка в 1С пропущена`);
      return;
    }

    await axios.post(
      endpoint,
      {
        projectId: project.oneCId ?? String(project.id),
        status: project.status,
        archivedAt: project.archivedAt,
        defects: project.defects,
      },
      {
        headers: {
          Authorization: process.env.ONEC_OUTGOING_TOKEN
            ? `Bearer ${process.env.ONEC_OUTGOING_TOKEN}`
            : undefined,
        },
      },
    );
  }*/
}