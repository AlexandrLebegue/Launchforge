import { v4 as uuidv4 } from 'uuid';
import { PlanInput, LaunchPlan } from '../types';
import { generatePlan } from '../templates';
import { generateAIPlan } from './aiPlanGenerator';
import { storage } from './storage';

export function createLaunchPlan(input: PlanInput, userId: string = 'anonymous'): LaunchPlan {
  const planData = generatePlan(input);

  const plan: LaunchPlan = {
    id: uuidv4(),
    userId,
    active: 1,
    createdAt: new Date().toISOString(),
    input,
    ...planData,
  };

  storage.savePlan(plan);
  // Un nouveau projet devient le projet de travail courant
  storage.setActivePlan(userId, plan.id);
  return plan;
}

export async function createAILaunchPlan(input: PlanInput, userId: string = 'anonymous'): Promise<LaunchPlan> {
  try {
    const planData = await generateAIPlan(input);
    const plan: LaunchPlan = {
      id: uuidv4(),
      userId,
      active: 1,
      createdAt: new Date().toISOString(),
      input,
      ...planData,
    };
    storage.savePlan(plan);
    storage.setActivePlan(userId, plan.id);
    return plan;
  } catch {
    return createLaunchPlan(input, userId);
  }
}

export function getLaunchPlan(id: string): LaunchPlan | undefined {
  return storage.getPlan(id);
}

export function getPlansByUserId(userId: string): LaunchPlan[] {
  return storage.getPlansByUserId(userId);
}

export function getAllLaunchPlans(): LaunchPlan[] {
  return storage.getAllPlans();
}
