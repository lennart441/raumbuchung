import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

const rooms = [
  {
    name: 'Alte Meierei',
    capacity: 40,
    description: 'Veranstaltungs- und Gemeinderaum.',
  },
  {
    name: 'Alte Schule',
    capacity: 30,
    description: 'Seminar- und Gruppenraum.',
  },
  {
    name: 'Feuerwehrhaus',
    capacity: 25,
    description: 'Versammlungsraum im Feuerwehrhaus.',
  },
];

async function main() {
  for (const room of rooms) {
    await prisma.room.upsert({
      where: { name: room.name },
      update: { ...room, isActive: true },
      create: { ...room, isActive: true },
    });
  }

  await prisma.user.upsert({
    where: { authentikSub: 'dev-user' },
    update: {
      role: UserRole.USER,
      email: 'user@local.dev',
      displayName: 'Dev Standardnutzer',
    },
    create: {
      authentikSub: 'dev-user',
      email: 'user@local.dev',
      displayName: 'Dev Standardnutzer',
      role: UserRole.USER,
    },
  });
  await prisma.user.upsert({
    where: { authentikSub: 'dev-extended-user' },
    update: {
      role: UserRole.EXTENDED_USER,
      email: 'extended-user@local.dev',
      displayName: 'Dev Erweiterter Nutzer',
    },
    create: {
      authentikSub: 'dev-extended-user',
      email: 'extended-user@local.dev',
      displayName: 'Dev Erweiterter Nutzer',
      role: UserRole.EXTENDED_USER,
    },
  });
  await prisma.user.upsert({
    where: { authentikSub: 'dev-admin' },
    update: {
      role: UserRole.ADMIN,
      email: 'admin@local.dev',
      displayName: 'Dev Administrator',
    },
    create: {
      authentikSub: 'dev-admin',
      email: 'admin@local.dev',
      displayName: 'Dev Administrator',
      role: UserRole.ADMIN,
    },
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    process.exit(1);
  });
