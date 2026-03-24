const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  // хешируем пароли
  const adminHash = await bcrypt.hash('admin123', 10);
  const emp1Hash = await bcrypt.hash('employee1', 10);
  const emp2Hash = await bcrypt.hash('employee2', 10);

  // создаём пользователей
  await prisma.user.createMany({
    data: [
      {
        firstName: 'Админ',
        lastName: 'Системный',
        login: 'admin',
        passwordHash: adminHash,
        role: 'ADMIN',
        isBlocked: false,
      },
      {
        firstName: 'Иван',
        lastName: 'Иванов',
        login: 'employee1',
        passwordHash: emp1Hash,
        role: 'EMPLOYEE',
        isBlocked: false,
      },
      {
        firstName: 'Мария',
        lastName: 'Петрова',
        login: 'employee2',
        passwordHash: emp2Hash,
        role: 'EMPLOYEE',
        isBlocked: false,
      },
    ],
  });

  console.log('Пользователи созданы успешно');
}

main()
  .catch((e) => {
    console.error('Ошибка:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });