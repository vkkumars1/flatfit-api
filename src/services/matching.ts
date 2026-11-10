// why: pure functions so every factor is unit-testable without a DB.

export type Lifestyle = {
  sleepTime: number; wakeTime: number; cleanliness: number;
  smoking: boolean; drinking: boolean; pets: boolean;
  diet: string; guestsLevel: number; noiseLevel: number; cooking: string;
};

export type ProfileLite = { city: string; budgetMin: number; budgetMax: number };

export function circularMinutesDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 1440;
  return Math.min(d, 1440 - d);
}

export function sleepScore(a: Lifestyle, b: Lifestyle): number {
  const sleepDiffHr = circularMinutesDiff(a.sleepTime, b.sleepTime) / 60;
  const wakeDiffHr  = circularMinutesDiff(a.wakeTime,  b.wakeTime)  / 60;
  const avg = (sleepDiffHr + wakeDiffHr) / 2;
  return Math.max(0, 1 - Math.min(4, avg) / 4);
}
export function cleanlinessScore(a: Lifestyle, b: Lifestyle): number {
  return 1 - Math.abs(a.cleanliness - b.cleanliness) / 4;
}
export function smokingDrinkingScore(a: Lifestyle, b: Lifestyle): number {
  const sEq = a.smoking === b.smoking;
  const dEq = a.drinking === b.drinking;
  if (sEq && dEq) return 1;
  if (sEq || dEq) return 0.4;
  return 0;
}
export function guestsNoiseScore(a: Lifestyle, b: Lifestyle): number {
  const avg = (Math.abs(a.guestsLevel - b.guestsLevel) + Math.abs(a.noiseLevel - b.noiseLevel)) / 2;
  return 1 - avg / 4;
}
export function budgetScore(a: ProfileLite, b: ProfileLite): number {
  const lo = Math.max(a.budgetMin, b.budgetMin);
  const hi = Math.min(a.budgetMax, b.budgetMax);
  if (hi < lo) return 0;
  const overlap = hi - lo;
  const union = Math.max(a.budgetMax, b.budgetMax) - Math.min(a.budgetMin, b.budgetMin);
  return union === 0 ? 1 : overlap / union;
}
export function petsDietCookingScore(a: Lifestyle, b: Lifestyle): number {
  const matches = [a.pets === b.pets, a.diet === b.diet, a.cooking === b.cooking].filter(Boolean).length;
  return matches / 3;
}

export const WEIGHTS = { sleep: 25, cleanliness: 20, smokingDrinking: 15, guestsNoise: 15, budget: 15, petsDietCooking: 10 } as const;

export function computeScore(a: Lifestyle & ProfileLite, b: Lifestyle & ProfileLite): { score: number; breakdown: { label: string; weight: number; score: number }[] } {
  const bd = [
    { label: 'Sleep schedule',          weight: WEIGHTS.sleep,           score: sleepScore(a, b) },
    { label: 'Cleanliness',             weight: WEIGHTS.cleanliness,     score: cleanlinessScore(a, b) },
    { label: 'Smoking and drinking',    weight: WEIGHTS.smokingDrinking, score: smokingDrinkingScore(a, b) },
    { label: 'Guests and noise',        weight: WEIGHTS.guestsNoise,     score: guestsNoiseScore(a, b) },
    { label: 'Budget overlap',          weight: WEIGHTS.budget,          score: budgetScore(a, b) },
    { label: 'Pets, diet, cooking',     weight: WEIGHTS.petsDietCooking, score: petsDietCookingScore(a, b) },
  ];
  const score = Math.round(bd.reduce((s, x) => s + x.weight * x.score, 0));
  return { score, breakdown: bd };
}

export function hardFilterOk(a: { city: string; budgetMin: number; budgetMax: number }, b: { city: string; budgetMin: number; budgetMax: number }): boolean {
  if (a.city.toLowerCase() !== b.city.toLowerCase()) return false;
  if (b.budgetMax < a.budgetMin || b.budgetMin > a.budgetMax) return false;
  return true;
}

export function reasons(bd: { label: string; weight: number; score: number }[]): { top: string[]; good: string[]; bad: string[] } {
  const ranked = [...bd].sort((x, y) => y.score - x.score);
  const good = ranked.filter((x) => x.score >= 0.7).map((x) => `${x.label} fits well`);
  const bad  = ranked.filter((x) => x.score < 0.4).map((x) => `${x.label} differs`);
  const top  = ranked.slice(0, 3).map((x) => `${x.label} looks compatible`);
  return { top, good, bad };
}
