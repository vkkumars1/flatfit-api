import { PrismaClient, Plan, Role, Mode, VerificationType, VerificationStatus, SwipeAction } from '@prisma/client';

const prisma = new PrismaClient();

const CITIES = ['Gurugram', 'Bangalore', 'Pune'];
const FIRST = ['Aarav','Diya','Ishaan','Anaya','Vivaan','Myra','Reyansh','Aarohi','Krishna','Saanvi','Ayaan','Kiara','Kabir','Rhea','Arjun','Isha','Dev','Zoya','Rudra','Pari','Yash','Tara','Vihaan','Siya','Aarush','Meera','Shaurya','Ira','Veer','Avni','Riya','Dhruv','Kavya','Aditya','Nisha','Sahil','Priya','Rohan','Sneha','Amit','Neha','Rahul','Pooja','Karan','Aisha','Siddharth','Tanya','Nikhil','Mira','Harsh'];
const LAST = ['Mehta','Shah','Kapoor','Verma','Iyer','Nair','Reddy','Rao','Khanna','Malhotra','Patel','Joshi','Gupta','Bhat','Sinha','Agarwal','Singh','Chopra','Bansal','Kulkarni'];
const OCCUPATIONS = ['Engineer','Designer','Analyst','Doctor','Teacher','PM','Founder','Writer','Consultant'];
const LOCALITIES: Record<string, string[]> = {
  Gurugram: ['Sector 56','Sushant Lok','DLF Phase 2','Golf Course Rd','Sector 29'],
  Bangalore: ['Indiranagar','Koramangala','HSR Layout','Whitefield','Jayanagar'],
  Pune: ['Koregaon Park','Baner','Viman Nagar','Kothrud','Aundh'],
};

// why: deterministic pseudo-random so seed is idempotent across runs
let seedRng = 1;
function rng() { seedRng = (seedRng * 1664525 + 1013904223) % 2 ** 32; return seedRng / 2 ** 32; }
function pick<T>(arr: T[]): T { return arr[Math.floor(rng() * arr.length)]!; }
function rand(a: number, b: number): number { return a + Math.floor(rng() * (b - a + 1)); }
function iso(y: number, m: number, d: number): Date { return new Date(Date.UTC(y, m - 1, d)); }

async function upsertUser(phone: string, patch: any = {}) {
  const name = patch.name ?? `${pick(FIRST)} ${pick(LAST)}`;
  const gender = patch.gender ?? pick(['male','female','nonbinary']);
  const dob = patch.dob ?? iso(1998 + rand(-3, 6), rand(1, 12), rand(1, 28));
  const role: Role = patch.role ?? Role.USER;
  const plan: Plan = patch.plan ?? Plan.FREE;
  return prisma.user.upsert({
    where: { phone },
    update: { name, gender, dob, role, plan },
    create: { phone, name, gender, dob, role, plan },
  });
}

async function profile(userId: string, city: string, mode: Mode) {
  const localities = LOCALITIES[city] ?? [];
  const bmin = rand(10, 18) * 1000;
  const bmax = bmin + rand(4, 12) * 1000;
  return prisma.profile.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      bio: `Hi, I'm looking for a clean, respectful flatmate in ${city}. I enjoy ${pick(['books','music','running','coding','cooking','hiking'])} and keep common areas tidy.`,
      city,
      budgetMin: bmin,
      budgetMax: bmax,
      moveInDate: iso(2026, 12, rand(1, 28)),
      occupation: pick(OCCUPATIONS),
      mode,
      photos: [`https://i.pravatar.cc/400?u=${userId}`],
    },
  });
}

async function lifestyle(userId: string) {
  return prisma.lifestyle.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      sleepTime: rand(21, 25) * 60 % (24 * 60),
      wakeTime: rand(5, 9) * 60,
      cleanliness: rand(3, 5),
      smoking: rng() > 0.7,
      drinking: rng() > 0.4,
      pets: rng() > 0.7,
      diet: pick(['veg','nonveg','egg']),
      guestsLevel: rand(1, 5),
      noiseLevel: rand(1, 5),
      cooking: rng() > 0.3,
    },
  });
}

async function listing(ownerId: string, city: string) {
  const loc = pick(LOCALITIES[city] ?? ['Center']);
  const rent = rand(14, 32) * 1000;
  return prisma.listing.create({
    data: {
      ownerId,
      title: `${pick(['Sunny','Cozy','Spacious','Quiet','Modern'])} room near ${loc}`,
      city,
      locality: loc,
      rent,
      deposit: rent * 2,
      bills: rand(1500, 3500),
      description: `A well-maintained room in a ${rand(2, 4)}BHK flat with existing flatmates. Metro, groceries, and cafes within 10 min walk.`,
      photos: [`https://picsum.photos/seed/${randomSeed()}/800/600`, `https://picsum.photos/seed/${randomSeed()}/800/600`],
      amenities: pick([['Wifi','AC','Washing machine'],['Wifi','Parking','Gym'],['Wifi','Balcony','AC','Pet-friendly']]),
      availableFrom: iso(2026, 12, rand(1, 28)),
      verified: rng() > 0.3,
    },
  });
}

function randomSeed() { return Math.floor(rng() * 1e9).toString(36); }

async function main() {
  console.log('🌱 Seeding...');

  // why: admin account for /admin routes
  const admin = await upsertUser('+911000000001', { name: 'Admin', role: Role.ADMIN, plan: Plan.VERIFIED, gender: 'female' });
  await profile(admin.id, 'Gurugram', Mode.HAS_FLAT);
  await lifestyle(admin.id);

  // why: demo user matches DEMO_PHONE for frictionless UX showcase
  const demoPhone = process.env.DEMO_PHONE ?? '+919999999999';
  const demo = await upsertUser(demoPhone, { name: 'Aarav Mehta', plan: Plan.VERIFIED, gender: 'male' });
  await profile(demo.id, 'Gurugram', Mode.NEEDS_FLAT);
  await lifestyle(demo.id);

  // why: 50 realistic users spread across the 3 cities
  const users = [];
  for (let i = 0; i < 50; i++) {
    const phone = `+9199${String(10000000 + i).padStart(8, '0')}`;
    const city = CITIES[i % CITIES.length]!;
    const u = await upsertUser(phone);
    await profile(u.id, city, i % 2 === 0 ? Mode.HAS_FLAT : Mode.NEEDS_FLAT);
    await lifestyle(u.id);
    users.push(u);
  }

  // why: 12 listings across cities from users with HAS_FLAT mode
  const existingListings = await prisma.listing.count();
  if (existingListings < 12) {
    const needed = 12 - existingListings;
    for (let i = 0; i < needed; i++) {
      const owner = users[i % users.length]!;
      const city = CITIES[i % CITIES.length]!;
      await listing(owner.id, city);
    }
  }

  // why: 5 matches with a short chat so UI has content on first load
  const demoAndFirstFive = [demo, ...users.slice(0, 5)];
  for (let i = 1; i <= 5; i++) {
    const other = demoAndFirstFive[i]!;
    const [a, b] = [demo.id, other.id].sort();
    // why: Match requires userA < userB per unique constraint
    const matchRec = await prisma.match.upsert({
      where: { userA_userB: { userA: a!, userB: b! } },
      update: {},
      create: { userA: a!, userB: b!, score: 70 + i * 4 },
    });
    // why: mutual LIKE swipes so history is consistent with how matches form
    await prisma.swipe.upsert({
      where: { fromUser_toUser: { fromUser: demo.id, toUser: other.id } },
      update: {},
      create: { fromUser: demo.id, toUser: other.id, action: SwipeAction.LIKE },
    });
    await prisma.swipe.upsert({
      where: { fromUser_toUser: { fromUser: other.id, toUser: demo.id } },
      update: {},
      create: { fromUser: other.id, toUser: demo.id, action: SwipeAction.LIKE },
    });
    const existingMessages = await prisma.message.count({ where: { matchId: matchRec.id } });
    if (existingMessages === 0) {
      await prisma.message.create({ data: { matchId: matchRec.id, senderId: other.id, text: 'Hey! Saw we matched. Are you still looking?' } });
      await prisma.message.create({ data: { matchId: matchRec.id, senderId: demo.id, text: 'Yes! When can we chat?' } });
      await prisma.message.create({ data: { matchId: matchRec.id, senderId: other.id, text: 'How about this weekend over coffee?' } });
    }
  }

  // why: 2 pending selfie verifications so admin page has rows to review
  for (let i = 0; i < 2; i++) {
    const u = users[i]!;
    const existing = await prisma.verification.findFirst({ where: { userId: u.id, type: VerificationType.SELFIE } });
    if (!existing) {
      await prisma.verification.create({
        data: {
          userId: u.id,
          type: VerificationType.SELFIE,
          status: VerificationStatus.PENDING,
          path: `selfies/${u.id}/${randomSeed()}.jpg`,
        },
      });
    }
  }

  console.log('✅ Seed complete');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
