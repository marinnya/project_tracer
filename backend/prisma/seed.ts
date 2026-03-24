import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Создаем хеши для паролей
  const adminPassword = await bcrypt.hash('admin123', 10);
  const user1Password = await bcrypt.hash('user123', 10);
  const user2Password = await bcrypt.hash('user123', 10);

  // Создаем пользователей
  await prisma.user.createMany({
    data: [
      {
        firstName: 'Админ',
        lastName: 'Иванов',
        login: 'admin',
        passwordHash: adminPassword,
        role: Role.ADMIN,
      },
      {
        firstName: 'Мария',
        lastName: 'Петрова',
        login: 'petrovam',
        passwordHash: user1Password,
        role: Role.EMPLOYEE,
      },
      {
        firstName: 'Петр',
        lastName: 'Петров',
        login: 'petrovp',
        passwordHash: user2Password,
        role: Role.EMPLOYEE,
      },
    ],
    skipDuplicates: true, // если уже есть, не создаст повторно
  });

  console.log('Тестовые пользователи созданы!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
