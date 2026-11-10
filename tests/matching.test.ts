import { describe, it, expect } from 'vitest';
import { sleepScore, cleanlinessScore, smokingDrinkingScore, guestsNoiseScore, budgetScore, petsDietCookingScore, computeScore, circularMinutesDiff } from '../src/services/matching.js';

const base = { sleepTime: 23*60, wakeTime: 7*60, cleanliness: 4, smoking: false, drinking: false, pets: false, diet: 'any', guestsLevel: 3, noiseLevel: 3, cooking: 'sometimes', city: 'Gurugram', budgetMin: 10000, budgetMax: 20000 };

describe('matching factors', () => {
  it('circular minute diff wraps midnight', () => {
    expect(circularMinutesDiff(23*60, 1*60)).toBe(120);
  });
  it('sleep score is 1 when identical', () => {
    expect(sleepScore(base as any, base as any)).toBeCloseTo(1, 5);
  });
  it('cleanliness score falls linearly', () => {
    expect(cleanlinessScore(base as any, { ...base, cleanliness: 2 } as any)).toBeCloseTo(0.5, 5);
  });
  it('smoking+drinking: both equal = 1', () => {
    expect(smokingDrinkingScore(base as any, base as any)).toBe(1);
  });
  it('smoking+drinking: one differs = 0.4', () => {
    expect(smokingDrinkingScore(base as any, { ...base, smoking: true } as any)).toBeCloseTo(0.4, 5);
  });
  it('guests+noise scores 1 on identical', () => {
    expect(guestsNoiseScore(base as any, base as any)).toBe(1);
  });
  it('budget overlap', () => {
    expect(budgetScore(base as any, { ...base, budgetMin: 15000, budgetMax: 25000 } as any)).toBeCloseTo(5000/15000, 4);
  });
  it('pets/diet/cooking all equal = 1', () => {
    expect(petsDietCookingScore(base as any, base as any)).toBe(1);
  });
  it('compute score returns 100 when identical', () => {
    expect(computeScore(base as any, base as any).score).toBe(100);
  });
});
