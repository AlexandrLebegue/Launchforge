import { LaunchPlan, Feedback } from '../types';

class Storage {
  private plans: Map<string, LaunchPlan> = new Map();
  private feedbacks: Map<string, Feedback> = new Map();

  savePlan(plan: LaunchPlan): void {
    this.plans.set(plan.id, plan);
  }

  getPlan(id: string): LaunchPlan | undefined {
    return this.plans.get(id);
  }

  getAllPlans(): LaunchPlan[] {
    return Array.from(this.plans.values());
  }

  saveFeedback(feedback: Feedback): void {
    this.feedbacks.set(feedback.id, feedback);
  }

  getFeedbacksByPlanId(planId: string): Feedback[] {
    return Array.from(this.feedbacks.values()).filter(
      (f) => f.planId === planId
    );
  }

  getAllFeedbacks(): Feedback[] {
    return Array.from(this.feedbacks.values());
  }
}

export const storage = new Storage();
