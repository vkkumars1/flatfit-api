import { PrismaClient, Plan, Role, ListingMode, VerificationType, VerificationStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

const CITIES = ['Gurugram', 'Bangalore', 'Pune'];
const FIRST = ['Aarav','Diya','Ishaan','Anaya','Vivaan','Myra','Reyansh','Aarohi','Krishna','Saanvi','Ayaan','Kiara','Kabir','Rhea','Arjun','Isha','Dev','Zoya','Rudra','Pari','Yash','Tara','Vihaan','Siya','Aarush','Meera','Shaurya','Ira','Veer','Avni'];
const LAST = ['Mehta','Shah','Kapoor','Verma','Iyer','Nair','Reddy','Rao','Khanna','Malhotra','Patel','Joshi','Gupta','Bhat','Sinha'];
const OCCUPATIONS = ['Engineer','Designer','Analyst','Doctor','Teacher','PM','Founder','Writer','Consultant'];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random()*arr.length)]!; }
function rand(a: number, b: number): number { return a + Math.floor(Math.random() * (b - a + 1)); }
function iso(y: number, m: number, d: number): Date { return new Date(Date.UTC(y, m - 1, d)); }

async function upsertUser(phone: string, patch: any = {}) {
  const name = patch.name ?? `${pick(FIRST)} ${pick(LAST)}`;
  return prisma.user.upsert({
    where: { phone },
    update: {},
    create: {
      phone,
      name,
      gender: patch.gender ?? pick(['male','female','other']),
      dob: patch.dob ?? iso(1998, 1, 1),
      role: patch.role ?? Role.USER,
      plan: patch.plan ?? Plan.FREE,
      email: patch.email ?? null,
    },
  });
}

async function profile(userId: string, city: string, mode: ListingMode) {
  const min = rand(10, 30) * 1000;
  return prisma.profile.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      bio: `Looking for a tidy flatmate in ${city}.`,
      city,
      budgetMin: min,
      budgetMax: min + rand(5, 20) * 1000,
      moveInDate: iso(2026, 1, 15),
      occupation: pick(OCCUPATIONS),
      mode,
      photos: [],
    },
  });
}

async function lifestyle(userId: string) {
  return prisma.lifestyle.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      sleepTime: rand(21*60, 25*60) % (24*60),
      wakeTime:  rand(5*60, 9*60),
      cleanliness: rand(2, 5),
      smoking: Math.random() < 0.15,
      drinking: Math.random() < 0.4,
      pets: Math.random() < 0.25,
      diet: pick(['any','vegetarian','vegan','eggetarian']),
      guestsLevel: rand(1, 5),
      noiseLevel:  rand(1, 5),
      cooking: pick(['never','sometimes','often']),
    },
  });
}

async function listing(ownerId: string, city: string) {
  const rent = rand(12, 40) * 1000;
  return prisma.listing.create({
    data: {
      ownerId, city,
      locality: pick(['Sector 56','Indiranagar','Koramangala','Baner','Viman Nagar','Sushant Lok','Golf Course Rd','Whitefield']),
      title: pick(['Sunny room in 3BHK','Quiet nook near metro','Spacious balcony flat','Cozy studio near park']),
      rent,
      deposit: rent * 2,
      bills: rand(1, 3) * 1000,
      description: 'Well-maintained, flatmate-friendly place with natural light and good ventilation.',
      photos: [],
      amenities: pick([['WiFi','AC','Washer'],['WiFi','Gym'],['Parking','WiFi','Lift']]),
      availableFrom: iso(2026, 1, pick([1,5,10,15,20])),
      verified: Math.random() < 0.6,
    },
  });
}

async function main() {
  // Admin
  const admin = await upsertUser('+911111111111', { name: 'FlatFit Admin', role: Role.ADMIN, gender: 'other' });
  await prisma.verification.upsert({ where: { id: `v-admin-phone` }, update: {}, create: { id: 'v-admin-phone', userId: admin.id, type: VerificationType.PHONE, status: VerificationStatus.VERIFIED } });

  // Demo user (matches DEMO_PHONE default from env)
  const demoPhone = process.env.DEMO_PHONE ?? '+919999999999';
  const demo = await upsertUser(demoPhone, { name: 'Demo User', plan: Plan.VERIFIED });
  await profile(demo.id, 'Gurugram', ListingMode.NEEDS_FLAT);
  await lifestyle(demo.id);

  // 50 users spread across 3 cities
  const users = [demo];
  for (let i = 0; i < 50; i++) {
    const city = CITIES[i % CITIES.length]!;
    const mode = (i % 2 === 0 ? ListingMode.HAS_FLAT : ListingMode.NEEDS_FLAT);
    const u = await upsertUser(`+9188000${String(10000 + i).slice(-5)}`);
    await profile(u.id, city, mode);
    await lifestyle(u.id);
    users.push(u);
  }

  // 12 listings
  const existing = await prisma.listing.count();
  if (existing < 12) {
    for (let i = existing; i < 12; i++) {
      const owner = users[1 + (i % (users.length - 1))]!;
      await listing(owner.id, CITIES[i % 3]!);
    }
  }

  // 5 matches with 2-3 messages each
  for (let i = 0; i < 5; i++) {
    const a = users[1]!.id; // demo
    const b = users[2 + i]!.id;
    const [userA, userB] = a < b ? [a, b] : [b, a];
    const match = await prisma.match.upsert({
      where: { userA_userB: { userA, userB } },
      update: {},
      create: { userA, userB, score: 70 + i * 4 },
    });
    const exists = await prisma.message.count({ where: { matchId: match.id } });
    if (exists === 0) {
      await prisma.message.create({ data: { matchId: match.id, senderId: userA, text: 'Hey! How are you?' } });
      await prisma.message.create({ data: { matchId: match.id, senderId: userB, text: 'All good, want to meet this weekend?' } });
    }
  }

  // 2 pending selfies
  for (let i = 0; i < 2; i++) {
    const u = users[10 + i]!;
    await prisma.verification.upsert({
      where: { id: `v-pending-${u.id}` },
      update: {},
      create: { id: `v-pending-${u.id}`, userId: u.id, type: VerificationType.SELFIE, status: VerificationStatus.PENDING, path: `selfie/${u.id}/${randomUUID()}.jpg` },
    });
  }

  console.log('Seed complete:', { admin: admin.id, demo: demo.id, users: users.length });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
