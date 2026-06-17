// Modèles de données — reflètent client/src/api/client.ts

class User {
  final String id, email, name, createdAt;
  final bool tutorialPending;
  User({required this.id, required this.email, required this.name, required this.createdAt, this.tutorialPending = false});
  factory User.fromJson(Map<String, dynamic> j) => User(
        id: j['id'] ?? '',
        email: j['email'] ?? '',
        name: j['name'] ?? '',
        createdAt: j['createdAt'] ?? '',
        tutorialPending: j['tutorialPending'] == true,
      );
}

class ProjectSummary {
  final String id;
  final int active;
  final String createdAt, productName, niche, targetAudience;
  final String? companyName, teamId, teamName, role;
  ProjectSummary({
    required this.id,
    required this.active,
    required this.createdAt,
    required this.productName,
    required this.niche,
    required this.targetAudience,
    this.companyName,
    this.teamId,
    this.teamName,
    this.role,
  });
  factory ProjectSummary.fromJson(Map<String, dynamic> j) => ProjectSummary(
        id: j['id'] ?? '',
        active: j['active'] ?? 0,
        createdAt: j['createdAt'] ?? '',
        productName: j['productName'] ?? '',
        niche: j['niche'] ?? '',
        targetAudience: j['targetAudience'] ?? '',
        companyName: j['companyName'],
        teamId: j['teamId'],
        teamName: j['teamName'],
        role: j['role'],
      );
}

class NextPost {
  final String id, title, platform, scheduledAt;
  NextPost({required this.id, required this.title, required this.platform, required this.scheduledAt});
  factory NextPost.fromJson(Map<String, dynamic> j) =>
      NextPost(id: j['id'] ?? '', title: j['title'] ?? '', platform: j['platform'] ?? '', scheduledAt: j['scheduledAt'] ?? '');
}

class Overview {
  final List<ProjectSummary> projects;
  final ProjectSummary? project;
  final int tasksTotal, tasksDone, tasksInProgress, tasksProgress;
  final int postsScheduled, postsPublished, postsDrafts;
  final NextPost? nextPost;
  final int approvals;
  Overview({
    required this.projects,
    required this.project,
    required this.tasksTotal,
    required this.tasksDone,
    required this.tasksInProgress,
    required this.tasksProgress,
    required this.postsScheduled,
    required this.postsPublished,
    required this.postsDrafts,
    required this.nextPost,
    required this.approvals,
  });
  factory Overview.fromJson(Map<String, dynamic> j) {
    final tasks = j['tasks'] ?? {};
    final posts = j['posts'] ?? {};
    return Overview(
      projects: (j['projects'] as List? ?? []).map((e) => ProjectSummary.fromJson(e)).toList(),
      project: j['project'] != null ? ProjectSummary.fromJson(j['project']) : null,
      tasksTotal: tasks['total'] ?? 0,
      tasksDone: tasks['done'] ?? 0,
      tasksInProgress: tasks['inProgress'] ?? 0,
      tasksProgress: tasks['progress'] ?? 0,
      postsScheduled: posts['scheduled'] ?? 0,
      postsPublished: posts['published'] ?? 0,
      postsDrafts: posts['drafts'] ?? 0,
      nextPost: posts['next'] != null ? NextPost.fromJson(posts['next']) : null,
      approvals: j['approvals'] ?? 0,
    );
  }
}

class LaunchSequencing {
  final String phase, timeline;
  final List<String> activities;
  LaunchSequencing({required this.phase, required this.timeline, required this.activities});
  factory LaunchSequencing.fromJson(Map<String, dynamic> j) => LaunchSequencing(
        phase: j['phase'] ?? '',
        timeline: j['timeline'] ?? '',
        activities: (j['activities'] as List? ?? []).map((e) => e.toString()).toList(),
      );
}

class PlanInput {
  final String productName, description, targetAudience, niche, pricing;
  final List<String> goals;
  PlanInput({
    required this.productName,
    required this.description,
    required this.targetAudience,
    required this.niche,
    required this.pricing,
    required this.goals,
  });
  factory PlanInput.fromJson(Map<String, dynamic> j) => PlanInput(
        productName: j['productName'] ?? '',
        description: j['description'] ?? '',
        targetAudience: j['targetAudience'] ?? '',
        niche: j['niche'] ?? '',
        pricing: j['pricing'] ?? '',
        goals: (j['goals'] as List? ?? []).map((e) => e.toString()).toList(),
      );
}

class LaunchPlan {
  final String id;
  final PlanInput input;
  final List<LaunchSequencing> launchSequencing;
  LaunchPlan({required this.id, required this.input, required this.launchSequencing});
  factory LaunchPlan.fromJson(Map<String, dynamic> j) => LaunchPlan(
        id: j['id'] ?? '',
        input: PlanInput.fromJson(j['input'] ?? {}),
        launchSequencing: (j['launch_sequencing'] as List? ?? []).map((e) => LaunchSequencing.fromJson(e)).toList(),
      );
}

class Post {
  final String id, platform, title, content, status;
  final String? scheduledAt, publishedAt, imageUrl, subreddit;
  final int impressions, likes, comments, shares, clicks;
  final String recurrence;
  Post({
    required this.id,
    required this.platform,
    required this.title,
    required this.content,
    required this.status,
    this.scheduledAt,
    this.publishedAt,
    this.imageUrl,
    this.subreddit,
    this.impressions = 0,
    this.likes = 0,
    this.comments = 0,
    this.shares = 0,
    this.clicks = 0,
    this.recurrence = 'none',
  });
  factory Post.fromJson(Map<String, dynamic> j) => Post(
        id: j['id'] ?? '',
        platform: j['platform'] ?? '',
        title: j['title'] ?? '',
        content: j['content'] ?? '',
        status: j['status'] ?? 'draft',
        scheduledAt: j['scheduledAt'],
        publishedAt: j['publishedAt'],
        imageUrl: j['imageUrl'],
        subreddit: j['subreddit'],
        impressions: j['impressions'] ?? 0,
        likes: j['likes'] ?? 0,
        comments: j['comments'] ?? 0,
        shares: j['shares'] ?? 0,
        clicks: j['clicks'] ?? 0,
        recurrence: j['recurrence'] ?? 'none',
      );
}

class KnowledgeEntry {
  final String id, category, title, content, updatedAt;
  KnowledgeEntry({required this.id, required this.category, required this.title, required this.content, required this.updatedAt});
  factory KnowledgeEntry.fromJson(Map<String, dynamic> j) => KnowledgeEntry(
        id: j['id'] ?? '',
        category: j['category'] ?? 'other',
        title: j['title'] ?? '',
        content: j['content'] ?? '',
        updatedAt: j['updatedAt'] ?? '',
      );
}

class Contact {
  final String id, name, type;
  final String? email, company, source, interestSummary;
  final int? interestScore;
  Contact({required this.id, required this.name, required this.type, this.email, this.company, this.source, this.interestSummary, this.interestScore});
  factory Contact.fromJson(Map<String, dynamic> j) => Contact(
        id: j['id'] ?? '',
        name: j['name'] ?? '',
        type: j['type'] ?? 'prospect',
        email: j['email'],
        company: j['company'],
        source: j['source'],
        interestSummary: j['interestSummary'],
        interestScore: j['interestScore'],
      );
}

class ApprovalItem {
  final String id, agentName, agentPlatform, cardTitle, status, startedAt;
  final String? result, planId;
  ApprovalItem({
    required this.id,
    required this.agentName,
    required this.agentPlatform,
    required this.cardTitle,
    required this.status,
    required this.startedAt,
    this.result,
    this.planId,
  });
  factory ApprovalItem.fromJson(Map<String, dynamic> j) => ApprovalItem(
        id: j['id'] ?? '',
        agentName: j['agentName'] ?? '',
        agentPlatform: j['agentPlatform'] ?? '',
        cardTitle: j['cardTitle'] ?? '',
        status: j['status'] ?? 'awaiting_approval',
        startedAt: j['startedAt'] ?? '',
        result: j['result'],
        planId: j['planId'],
      );
}

class WeeklyPerf {
  final String week;
  final int posts, impressions, likes;
  WeeklyPerf({required this.week, required this.posts, required this.impressions, required this.likes});
  factory WeeklyPerf.fromJson(Map<String, dynamic> j) =>
      WeeklyPerf(week: j['week'] ?? '', posts: j['posts'] ?? 0, impressions: j['impressions'] ?? 0, likes: j['likes'] ?? 0);
}

class PerformanceSeries {
  final List<WeeklyPerf> weekly;
  final bool hasHistory;
  PerformanceSeries({required this.weekly, required this.hasHistory});
  factory PerformanceSeries.fromJson(Map<String, dynamic> j) => PerformanceSeries(
        weekly: (j['weekly'] as List? ?? []).map((e) => WeeklyPerf.fromJson(e)).toList(),
        hasHistory: j['hasHistory'] == true,
      );
}

class ChatMessage {
  final String role; // 'user' | 'assistant'
  String text;
  List<String> actions;
  ChatMessage({required this.role, required this.text, List<String>? actions}) : actions = actions ?? [];
}

class ConfigToolkit {
  final String slug, name, capability;
  final bool connected;
  ConfigToolkit({required this.slug, required this.name, required this.capability, required this.connected});
  factory ConfigToolkit.fromJson(Map<String, dynamic> j) => ConfigToolkit(
        slug: j['slug'] ?? '',
        name: j['name'] ?? '',
        capability: j['capability'] ?? '',
        connected: j['connected'] == true,
      );
}
