import { PlanInput, WeeklyAction, CommunityTarget, ContentAngle, OutreachStrategy, LaunchSequencing, ValidationChecklist, FirstUsersTactic, TemplateMeta } from '../types';

const TEMPLATES: TemplateMeta[] = [
  {
    id: 'standard-launch',
    name: 'Standard Launch Plan',
    description: 'A comprehensive 4-week launch plan with community targeting, content strategy, and outreach.',
    sections: ['weekly_plan', 'community_targets', 'content_angles', 'outreach_strategy', 'launch_sequencing', 'validation_checklist', 'first_users_tactics'],
  },
  {
    id: 'stealth-launch',
    name: 'Stealth Launch Plan',
    description: 'A low-profile launch strategy focused on private beta, invite-only access, and organic growth.',
    sections: ['weekly_plan', 'community_targets', 'content_angles', 'outreach_strategy', 'launch_sequencing', 'validation_checklist', 'first_users_tactics'],
  },
  {
    id: 'product-hunt-launch',
    name: 'Product Hunt Launch Plan',
    description: 'A launch plan optimized for Product Hunt, including pre-launch, launch day, and post-launch activities.',
    sections: ['weekly_plan', 'community_targets', 'content_angles', 'outreach_strategy', 'launch_sequencing', 'validation_checklist', 'first_users_tactics'],
  },
  {
    id: 'builder-social',
    name: 'Build in Public Plan',
    description: 'A strategy focused on building in public on Twitter/X, LinkedIn, and Indie Hackers.',
    sections: ['weekly_plan', 'community_targets', 'content_angles', 'outreach_strategy', 'launch_sequencing', 'validation_checklist', 'first_users_tactics'],
  },
];

const PLATFORM_MAP: Record<string, string[]> = {
  saas: ['Product Hunt', 'Hacker News', 'Indie Hackers', 'Twitter/X', 'LinkedIn'],
  devtool: ['GitHub', 'Hacker News', 'Dev.to', 'Reddit r/programming', 'Twitter/X'],
  nocode: ['Product Hunt', 'Indie Hackers', 'Twitter/X', 'NoCode MBA Community', 'Reddit r/nocode'],
  marketplace: ['Reddit r/startups', 'LinkedIn', 'Twitter/X', 'Indie Hackers', 'Facebook Groups'],
  content: ['LinkedIn', 'Twitter/X', 'Medium', 'Reddit', 'Substack'],
  ai: ['Hacker News', 'Twitter/X', 'Reddit r/MachineLearning', 'LinkedIn', 'Hugging Face Discord'],
  health: ['Reddit r/Health', 'Facebook Groups', 'Instagram', 'LinkedIn', 'Medium'],
  fintech: ['LinkedIn', 'Twitter/X', 'Reddit r/fintech', 'Hacker News', 'Product Hunt'],
  education: ['LinkedIn', 'Reddit r/edtech', 'Twitter/X', 'Facebook Groups', 'Medium'],
  ecommerce: ['Instagram', 'TikTok', 'Pinterest', 'Twitter/X', 'Facebook Groups'],
};

const CONTENT_FORMATS = ['Twitter/X thread', 'LinkedIn post', 'Blog post', 'Video demo', 'Case study', 'Comparison post', 'Behind-the-scenes', 'AMA', 'Tutorial', "Launch week day"];
const COMMUNITY_TYPES = ['Discord servers', 'Reddit communities', 'Facebook Groups', 'Slack communities', 'LinkedIn Groups', 'Telegram channels', 'Forum communities'];

function getPlatformsForNiche(niche: string): string[] {
  const key = Object.keys(PLATFORM_MAP).find((k) =>
    niche.toLowerCase().includes(k)
  );
  return key ? PLATFORM_MAP[key] : PLATFORM_MAP.saas;
}

function generateWeeklyPlan(input: PlanInput): WeeklyAction[] {
  const weeks = [
    { week: 1, theme: 'Pre-launch & Validation' },
    { week: 2, theme: 'Community Building & Content Engine' },
    { week: 3, theme: 'Outreach & Partnerships' },
    { week: 4, theme: 'Launch & First Users' },
  ];

  return weeks.map((w) => ({
    ...w,
    actions: generateWeekActions(w.week, input),
    kpis: generateWeekKPIs(w.week),
  }));
}

function generateWeekActions(week: number, input: PlanInput): string[] {
  const actions: Record<number, string[]> = {
    1: [
      `Set up a landing page for ${input.productName} with email capture`,
      `Interview 5 people from ${input.targetAudience} to validate messaging`,
      `Create a "waitlist" page and share it in relevant ${input.niche} communities`,
      `Define your ideal customer profile based on ${input.targetAudience}`,
      `Set up analytics (Plausible, PostHog, or Simple Analytics)`,
      `Join 5 Discord/Slack communities related to ${input.niche}`,
    ],
    2: [
      `Start building in public on Twitter/X about ${input.productName}`,
      `Publish 3 pieces of content related to ${input.niche} problems`,
      `Engage daily in top ${input.niche} communities (Reddit, Discord, Slack)`,
      `Create a content calendar aligning with ${input.goals.join(', ')}`,
      `Build a simple demo video (Loom or Screen Studio)`,
      `Reach out to 5 potential power users for early feedback`,
    ],
    3: [
      `DM 20 people in ${input.niche} communities offering early access`,
      `Publish a comparison post: "How ${input.productName} compares to alternatives"`,
      `Send personalized outreach to ${input.targetAudience} on LinkedIn`,
      `Write a guest post or contribute to a ${input.niche} newsletter`,
      `Launch a referral program for early waitlist members`,
      `Ask 3-5 early users for testimonials`,
    ],
    4: [
      `Launch on Product Hunt / Hacker News / relevant platforms`,
      `Post in every ${input.niche} community with your launch story`,
      `Send a launch email to your waitlist (${input.description})`,
      `Throw a Launch Week with daily updates on Twitter/X`,
      `Offer launch discounts: ${input.pricing} special pricing for first 50 users`,
      `Monitor feedback and iterate rapidly based on first user signals`,
    ],
  };

  return actions[week] || [];
}

function generateWeekKPIs(week: number): string[] {
  const kpis: Record<number, string[]> = {
    1: ['50 waitlist signups', '5 customer interviews completed', '10 social media posts'],
    2: ['100 waitlist signups', '3 community posts with 10+ upvotes', '20 DM conversations started'],
    3: ['300 waitlist signups', '5 testimonials collected', '15 outreach replies'],
    4: ['500+ waitlist signups', '100 first signups/activations', 'Product Hunt top 10'],
  };
  return kpis[week] || [];
}

function generateCommunityTargets(input: PlanInput): CommunityTarget[] {
  const platforms = getPlatformsForNiche(input.niche);

  return platforms.map((platform) => ({
    platform,
    communities: [`Top ${input.niche} communities on ${platform}`],
    approach: `Share ${input.productName} value proposition, engage authentically, provide value before promoting`,
    frequency: `Daily engagement, 3-5 posts per week`,
  }));
}

function generateContentAngles(input: PlanInput): ContentAngle[] {
  const platforms = getPlatformsForNiche(input.niche).slice(0, 3);

  const angles: string[] = [
    `How we built ${input.productName} in public — lessons learned`,
    `Why ${input.targetAudience} struggle with ${input.description.split('.')[0]}`,
    `${input.productName} vs alternatives — honest comparison`,
    `Our journey to ${input.goals[0] || 'first 100 users'}`,
    `The ${input.niche} playbook: a tactical guide`,
    `Behind the scenes: building ${input.productName} with ${input.pricing}`,
    `What ${input.targetAudience} really need (and what they don't)`,
  ];

  return angles.slice(0, 5).map((title, i) => ({
    title,
    format: CONTENT_FORMATS[i % CONTENT_FORMATS.length],
    platforms,
    description: `Content piece targeting ${input.targetAudience} interested in ${input.niche}`,
  }));
}

function generateOutreachStrategy(input: PlanInput): OutreachStrategy[] {
  return [
    {
      phase: 'Warm-up',
      tactics: [
        `Follow 100 ${input.targetAudience} people on Twitter/X daily`,
        `Engage with their content (reply, retweet, comment)`,
        `Add value in comments before ever mentioning ${input.productName}`,
      ],
      target: input.targetAudience,
    },
    {
      phase: 'Direct outreach',
      tactics: [
        `Send personalized DMs to ${input.niche} community builders`,
        `Ask for feedback, not sales ("I built ${input.productName} — what's missing?")`,
        `Offer free access in exchange for honest feedback`,
      ],
      target: `${input.niche} content creators and community leaders`,
    },
    {
      phase: 'Partnerships',
      tactics: [
        `Identify complementary products in ${input.niche}`,
        `Propose cross-promotions or bundle deals`,
        `Offer affiliate program for ${input.niche} creators`,
      ],
      target: `Complementary ${input.niche} businesses`,
    },
  ];
}

function generateLaunchSequencing(input: PlanInput): LaunchSequencing[] {
  return [
    {
      phase: 'Pre-launch (Week 1-2)',
      timeline: '14 days before launch',
      activities: [
        `Build waitlist with landing page for ${input.productName}`,
        `Start teasing on Twitter/X about the build`,
        `Gather early testimonials from beta users`,
        `Prepare Product Hunt assets (logo, description, maker comment)`,
      ],
    },
    {
      phase: 'Launch buildup (Week 3)',
      timeline: '7 days before launch',
      activities: [
        `Announce launch date publicly`,
        `Warm up your network: personal messages to 50+ people`,
        `Coordinate with potential upvoters and sharers`,
        `Finalize pricing page: ${input.pricing}`,
      ],
    },
    {
      phase: 'Launch day',
      timeline: 'Day 0',
      activities: [
        `Ship on Product Hunt, Hacker News, and ${input.niche} communities`,
        `Post launch thread on Twitter/X`,
        `Send launch email to full waitlist`,
        `Respond to every comment personally`,
      ],
    },
    {
      phase: 'Post-launch (Week 5-6)',
      timeline: '7-14 days after launch',
      activities: [
        `Write a post-mortem: "What worked and what didn't"`,
        `Follow up with everyone who signed up`,
        `Double down on channels that drove most traffic`,
        `Iterate based on feedback from first ${input.goals[0] || '100 users'}`,
      ],
    },
  ];
}

function generateValidationChecklist(input: PlanInput): ValidationChecklist[] {
  const items: string[] = [
    `Have at least 10 waitlist signups before building full product`,
    `Interview 5+ people from ${input.targetAudience}`,
    `Confirm pricing of ${input.pricing} resonates with target audience`,
    `Get 3 letters of intent or pre-commitments from potential users`,
    `Validate that ${input.description} solves a real pain point`,
    `Test landing page conversion rate (>5% is good)`,
    `Have a clear differentiation from competitors in ${input.niche}`,
    `Ensure you can reach ${input.goals[0] || '100 users'} within budget`,
    `${input.productName} solves a problem people are actively searching for (check Reddit, Twitter)`,
    `You have a distribution channel that can consistently bring users`,
  ];

  return items.map((item) => ({
    item,
    status: 'pending' as const,
    details: `How to verify: ${getValidationDetail(item)}`,
  }));
}

function getValidationDetail(item: string): string {
  if (item.includes('Reddit')) return 'Search Reddit, Twitter, and niche forums for pain points';
  if (item.includes('waitlist')) return 'Count current signups and check conversion rate';
  if (item.includes('Interview')) return 'Ask specific questions about current solutions and willingness to pay';
  if (item.includes('pricing')) return 'Run a price sensitivity test with 10 prospects';
  return 'Verify through direct customer conversations and market research';
}

function generateFirstUsersTactics(input: PlanInput): FirstUsersTactic[] {
  const tactics: string[] = [
    `DM 50 ${input.targetAudience} on Twitter with a personal invite to try ${input.productName}`,
    `Post in 10 ${input.niche} subreddits with a value-first post (tutorial, guide, case study)`,
    `Offer "Founders Plan" — free lifetime access for first 50 users who give feedback`,
    `Run a "Launch Week" on Twitter with daily updates and exclusive discounts`,
    `Reach out to ${input.niche} newsletter writers for a mention or interview`,
    `Create a viral Twitter/X thread about building ${input.productName} and its results`,
    `Join ${input.niche}-related Discord servers and genuinely help people before sharing`,
    `Write a "Why I built ${input.productName}" story for Indie Hackers`,
    `Run a targeted LinkedIn campaign to ${input.targetAudience}`,
    `Ask every early user to share with 1 friend who might need ${input.productName}`,
  ];

  return tactics.map((tactic) => ({
    tactic,
    effort: (['medium', 'low', 'high', 'medium', 'medium', 'high', 'medium', 'low', 'medium', 'low'])[tactics.indexOf(tactic)] as 'low' | 'medium' | 'high',
    expectedResult: `Estimated ${Math.floor(Math.random() * 30 + 10)}-${Math.floor(Math.random() * 50 + 30)} new users`,
  }));
}

export function generatePlan(input: PlanInput) {
  return {
    weekly_plan: generateWeeklyPlan(input),
    community_targets: generateCommunityTargets(input),
    content_angles: generateContentAngles(input),
    outreach_strategy: generateOutreachStrategy(input),
    launch_sequencing: generateLaunchSequencing(input),
    validation_checklist: generateValidationChecklist(input),
    first_users_tactics: generateFirstUsersTactics(input),
  };
}

export function getTemplates(): TemplateMeta[] {
  return TEMPLATES;
}

export function getTemplateById(id: string): TemplateMeta | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
