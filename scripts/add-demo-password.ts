import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const demoEmail = 'demo@flatfit.app'
  const password = await bcrypt.hash('demo12345', 12)
  const user = await prisma.user.upsert({
    where: { phone: '+919999999999' },
    update: { email: demoEmail, password },
    create: {
      phone: '+919999999999',
      email: demoEmail,
      password,
      name: 'Aarav Mehta',
      gender: 'male',
      dob: new Date('2000-01-01'),
    },
  })
  console.log('demo user ready:', user.id, user.email)
  const matches = await prisma.match.findMany({
    where: { OR: [{ userA: user.id }, { userB: user.id }] },
  })
  console.log('demo user has', matches.length, 'matches')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
