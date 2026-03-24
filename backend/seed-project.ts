const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  await prisma.project.createMany({
    data: [
      {
        id: 122615,
        name: 'Ремонт №1',
        startDate: new Date('2025-12-12'),
        endDate: new Date('2026-12-18'),
        responsible: 'Евгений Журавлев',
        status: 'В работе',
      },
      {
        id: 77085,
        name: 'Ремонт №4',
        startDate: new Date('2026-02-04'),
        endDate: new Date('2026-07-07'),
        responsible: 'Иван Иванов',
        status: 'В работе',
      },
      {
        id: 81,
        name: 'Ремонт №5',
        startDate: new Date('2025-12-12'),
        endDate: new Date('2025-12-15'),
        responsible: 'Алена Сидорова',
        status: 'Завершен',
      },
    ],
  });

  console.log('Проекты созданы успешно');
}

main()
  .catch((e) => {
    console.error('Ошибка:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });