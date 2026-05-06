import { v4 as uuidv4 } from 'uuid';
import { PlanInput, LaunchPlan } from '../types';
import { generatePlan } from '../templates';
import { storage } from './storage';

export function createLaunchPlan(input: PlanInput): LaunchPlan {
  const planData = generatePlan(input);

  const plan: LaunchPlan = {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    input,
    ...planData,
  };

  storage.savePlan(plan);
  return plan;
}

export function getLaunchPlan(id: string): LaunchPlan | undefined {
  return storage.getPlan(id);
}

export function getAllLaunchPlans(): LaunchPlan[] {
  return storage.getAllPlans();
}
