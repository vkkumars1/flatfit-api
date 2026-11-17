import { PrismaClient, Mode, Plan, SwipeAction } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

type DemoSpec = {
  email: string
  password: string
  phone: string
  name: string
  gender: 'male' | 'female'
  city: string
  age: number
  bio: string
  occupation: string
  budgetMin: number
  budgetMax: number
  mode: Mode
  photos: string[]
  lifestyle: {
    sleepTime: number
    wakeTime: number
    cleanliness: number
    smoking: boolean
    drinking: boolean
    pets: boolean
    diet: string
    guestsLevel: number
    noiseLevel: number
    cooking: boolean
  }
  dealBreakers: { key: string; value: string }[]
}

const DEMO: DemoSpec[] = [
  {
    email: 'aarav@flatfit.app',
    password: 'demo12345',
    phone: '+919999999991',
    name: 'Aarav Mehta',
    gender: 'male',
    city: 'Gurugram',
    age: 26,
    bio: 'Product designer, early riser, love cooking Sunday brunches and keeping the kitchen sparkling.',
    occupation: 'Product Designer',
    budgetMin: 18000,
    budgetMax: 28000,
    mode: Mode.NEEDS_FLAT,
    photos: [
      'https://randomuser.me/api/portraits/men/33.jpg',
      'https://randomuser.me/api/portraits/men/44.jpg',
      'https://randomuser.me/api/portraits/men/55.jpg',
    ],
    lifestyle: {
      sleepTime: 23 * 60,
      wakeTime: 6 * 60 + 30,
      cleanliness: 5,
      smoking: false,
      drinking: false,
      pets: true,
      diet: 'veg',
      guestsLevel: 2,
      noiseLevel: 2,
      cooking: true,
    },
    dealBreakers: [
      { key: 'smoking', value: 'true' },
      { key: 'noise', value: 'true' },
    ],
  },
  {
    email: 'priya@flatfit.app',
    password: 'demo12345',
    phone: '+919999999992',
    name: 'Priya Kapoor',
    gender: 'female',
    city: 'Gurugram',
    age: 25,
    bio: 'Software engineer @ fintech, plant mom, chai addict. Looking for a tidy flatmate who gets WFH focus time.',
    occupation: 'Software Engineer',
    budgetMin: 20000,
    budgetMax: 32000,
    mode: Mode.NEEDS_FLAT,
    photos: [
      'https://randomuser.me/api/portraits/women/22.jpg',
      'https://randomuser.me/api/portraits/women/33.jpg',
      'https://randomuser.me/api/portraits/women/44.jpg',
    ],
    lifestyle: {
      sleepTime: 23 * 60 + 30,
      wakeTime: 7 * 60,
      cleanliness: 5,
      smoking: false,
      drinking: true,
      pets: false,
      diet: 'veg',
      guestsLevel: 2,
      noiseLevel: 2,
      cooking: true,
    },
    dealBreakers: [{ key: 'smoking', value: 'true' }],
  },
  {
    email: 'rahul@flatfit.app',
    password: 'demo12345',
    phone: '+919999999993',
    name: 'Rahul Singh',
    gender: 'male',
    city: 'Gurugram',
    age: 28,
    bio: 'Marketing lead. Gym rat. Love filter coffee and quiet evenings. 6AM runs > late nights.',
    occupation: 'Marketing Lead',
    budgetMin: 22000,
    budgetMax: 35000,
    mode: Mode.NEEDS_FLAT,
    photos: [
      'https://randomuser.me/api/portraits/men/11.jpg',
      'https://randomuser.me/api/portraits/men/22.jpg',
      'https://randomuser.me/api/portraits/men/77.jpg',
    ],
    lifestyle: {
      sleepTime: 22 * 60 + 30,
      wakeTime: 6 * 60,
      cleanliness: 4,
      smoking: false,
      drinking: false,
      pets: false,
      diet: 'nonveg',
      guestsLevel: 3,
      noiseLevel: 2,
      cooking: true,
    },
    dealBreakers: [
      { key: 'pets', value: 'true' },
      { key: 'smoking', value: 'true' },
    ],
  },
]

async function upsertFull(spec: DemoSpec) {
  const hash = await bcrypt.hash(spec.password, 12)
  const dob = new Date(Date.UTC(2026 - spec.age, 5, 15))
  const user = await prisma.user.upsert({
    where: { email: spec.email },
    update: {
      phone: spec.phone,
      name: spec.name,
      gender: spec.gender,
      dob,
      password: hash,
      plan: Plan.VERIFIED,
    },
    create: {
      email: spec.email,
      phone: spec.phone,
      name: spec.name,
      gender: spec.gender,
      dob,
      password: hash,
      plan: Plan.VERIFIED,
    },
  })

  await prisma.profile.upsert({
    where: { userId: user.id },
    update: {
      bio: spec.bio,
      city: spec.city,
      budgetMin: spec.budgetMin,
      budgetMax: spec.budgetMax,
      moveInDate: new Date('2026-12-01'),
      occupation: spec.occupation,
      mode: spec.mode,
      photos: spec.photos,
    },
    create: {
      userId: user.id,
      bio: spec.bio,
      city: spec.city,
      budgetMin: spec.budgetMin,
      budgetMax: spec.budgetMax,
      moveInDate: new Date('2026-12-01'),
      occupation: spec.occupation,
      mode: spec.mode,
      photos: spec.photos,
    },
  })

  await prisma.lifestyle.upsert({
    where: { userId: user.id },
    update: spec.lifestyle,
    create: { userId: user.id, ...spec.lifestyle },
  })

  await prisma.dealBreaker.deleteMany({ where: { userId: user.id } })
  await prisma.dealBreaker.createMany({
    data: spec.dealBreakers.map((d) => ({ userId: user.id, key: d.key, value: d.value })),
  })

  return user
}

async function mutualMatch(a: string, b: string, score: number) {
  const [userA, userB] = [a, b].sort()
  await prisma.swipe.upsert({
    where: { fromUser_toUser: { fromUser: a, toUser: b } },
    update: { action: SwipeAction.LIKE },
    create: { fromUser: a, toUser: b, action: SwipeAction.LIKE },
  })
  await prisma.swipe.upsert({
    where: { fromUser_toUser: { fromUser: b, toUser: a } },
    update: { action: SwipeAction.LIKE },
    create: { fromUser: b, toUser: a, action: SwipeAction.LIKE },
  })
  return prisma.match.upsert({
    where: { userA_userB: { userA: userA!, userB: userB! } },
    update: { score },
    create: { userA: userA!, userB: userB!, score },
  })
}

async function chatHistory(matchId: string, ownerA: string, ownerB: string, lines: { from: 'a' | 'b'; text: string }[]) {
  const existing = await prisma.message.count({ where: { matchId } })
  if (existing > 0) {
    await prisma.message.deleteMany({ where: { matchId } })
  }
  const base = Date.now() - lines.length * 60 * 60 * 1000
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    await prisma.message.create({
      data: {
        matchId,
        senderId: l.from === 'a' ? ownerA : ownerB,
        text: l.text,
        createdAt: new Date(base + i * 60 * 60 * 1000),
      },
    })
  }
}

async function main() {
  console.log('🧑 upserting 3 demo users...')
  const [aarav, priya, rahul] = await Promise.all(DEMO.map(upsertFull))

  console.log('💞 creating mutual matches...')
  const m1 = await mutualMatch(aarav!.id, priya!.id, 92)
  const m2 = await mutualMatch(aarav!.id, rahul!.id, 81)
  const m3 = await mutualMatch(priya!.id, rahul!.id, 85)

  console.log('💬 seeding chat history...')
  await chatHistory(m1.id, aarav!.id, priya!.id, [
    { from: 'b', text: 'Hey Aarav! Saw your profile — I love that your kitchen aesthetic is spotless 😄' },
    { from: 'a', text: 'Haha thanks Priya! Fellow clean-kitchen person then. What area are you looking at?' },
    { from: 'b', text: 'Sushant Lok or DLF Phase 2 ideally. You?' },
    { from: 'a', text: 'Same! Golf Course Road nearby. Would you want to visit a couple of places this weekend?' },
    { from: 'b', text: 'Yes let\'s! Saturday brunch + hunt?' },
    { from: 'a', text: 'Perfect — I know a great cafe in Sector 29. 10am?' },
    { from: 'b', text: '10am works. See you Sat ✨' },
  ])

  await chatHistory(m2.id, aarav!.id, rahul!.id, [
    { from: 'b', text: 'Hey man, your 6am wake-up schedule caught my eye. Mornings are my jam too.' },
    { from: 'a', text: 'Oh nice! Finally someone who gets it. Do you run outdoors?' },
    { from: 'b', text: 'Yeah, Aravalli trail most days. Would be great to have a flatmate who\'s not up partying all night.' },
    { from: 'a', text: 'Haha same page. Quick question — ok with my cat Mochi?' },
    { from: 'b', text: 'Hmm honestly pets is a tough one for me. Let me think about it.' },
    { from: 'a', text: 'Totally fair. Let me know!' },
  ])

  await chatHistory(m3.id, priya!.id, rahul!.id, [
    { from: 'b', text: 'Priya, you mentioned WFH focus time — I work from office mostly so home is quiet during the day.' },
    { from: 'a', text: 'That\'s perfect actually! What\'s your evening routine like?' },
    { from: 'b', text: 'Gym 7-8pm, cook, early sleep. Minimal guests.' },
    { from: 'a', text: 'Sounds like we\'d sync well. Should we meet for coffee this weekend?' },
    { from: 'b', text: 'Yes! Saturday morning works?' },
    { from: 'a', text: 'Sat 11am at Blue Tokai Golf Course?' },
    { from: 'b', text: 'Done. See you then.' },
  ])

  console.log('\n✅ Demo accounts ready:')
  console.log('------------------------------------')
  for (const d of DEMO) {
    console.log(`  ${d.name.padEnd(16)} | ${d.email.padEnd(24)} | password: ${d.password}`)
  }
  console.log('------------------------------------')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
