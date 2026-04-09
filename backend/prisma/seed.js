const { PrismaClient, UserRole } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const rooms = Array.from({ length: 10 }, (_, idx) => ({
    name: `Raum ${idx + 1}`,
    capacity: idx < 2 ? 25 : 12,
    description:
      idx < 2
        ? 'Groesserer Besprechungsraum mit Konferenzausstattung.'
        : 'Standardraum fuer Teamtermine und Einzelgespraeche.',
  }));

  for (const room of rooms) {
    await prisma.room.upsert({
      where: { name: room.name },
      update: room,
      create: room,
    });
  }

  await prisma.user.upsert({
    where: { authentikSub: 'dev-admin' },
    update: { role: UserRole.ADMIN, email: 'admin@local.dev', displayName: 'Admin' },
    create: {
      authentikSub: 'dev-admin',
      email: 'admin@local.dev',
      displayName: 'Admin',
      role: UserRole.ADMIN,
    },
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    process.exit(1);
  });
