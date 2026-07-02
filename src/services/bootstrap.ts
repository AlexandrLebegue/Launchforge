/**
 * Bootstrap automatique après l'onboarding et la génération du plan :
 * l'utilisateur n'a rien à faire, l'app se remplit toute seule.
 *
 *  - Profil d'onboarding validé → fiches de la base de connaissances créées
 *    automatiquement (entreprise, produit, audience, offres).
 *  - Plan généré → premières idées de posts rédigées et datées dans le Hub
 *    de contenu (en brouillon, à valider), notification Telegram.
 */

import { v4 as uuid } from 'uuid';
import { storage } from './storage';
import { OnboardingProfile, KnowledgeEntry, KnowledgeCategory } from '../types';

// Libellés lisibles des champs commerciaux pour les fiches de connaissances.
const OBJECTIVE_LABELS: Record<string, string> = {
  launch: 'lancer / trouver les premiers clients',
  'grow-revenue': 'vendre plus / faire grandir le chiffre d\'affaires',
  both: 'lancer et vendre plus',
};
const TRACTION_LABELS: Record<string, string> = {
  'pre-revenue': 'pré-revenu (pas encore de client payant)',
  'first-customers': 'premiers clients',
  'early-revenue': 'revenu débutant',
  scaling: 'en passage à l\'échelle',
};
const SALES_MOTION_LABELS: Record<string, string> = {
  'self-serve': 'libre-service (inscription autonome)',
  'sales-led': 'vente assistée (démos / appels)',
  hybrid: 'hybride (libre-service + vente assistée)',
};

function upsertEntry(userId: string, planId: string | null, category: KnowledgeCategory, title: string, content: string): boolean {
  if (!content.trim()) return false;
  const existing = storage.getKnowledgeByPlan(userId, planId).find(
    (e) => e.category === category && e.title === title
  );
  if (existing) {
    storage.updateKnowledge(existing.id, { content: content.trim() });
    return false;
  }
  const now = new Date().toISOString();
  const entry: KnowledgeEntry = {
    id: uuid(), userId, planId, category,
    title, content: content.trim(),
    createdAt: now, updatedAt: now,
  };
  storage.saveKnowledge(entry);
  return true;
}

/**
 * Alimente la base de connaissances du projet depuis le profil validé.
 * Idempotent : regénérer le plan met à jour les fiches au lieu de les dupliquer.
 * Retourne le nombre de fiches créées.
 */
export function bootstrapKnowledgeFromProfile(userId: string, planId: string | null, profile: OnboardingProfile): number {
  let created = 0;

  const companyLines = [
    `Nom : ${profile.company.name}`,
    `Statut : ${profile.company.exists ? 'entreprise existante' : 'projet / idée'}${profile.company.stage ? ` (${profile.company.stage})` : ''}`,
    profile.company.website && `Site web : ${profile.company.website}`,
    profile.company.location && `Localisation : ${profile.company.location}`,
    profile.company.socials?.length && `Réseaux : ${profile.company.socials.join(', ')}`,
    profile.company.competitors?.length && `Concurrents identifiés : ${profile.company.competitors.join(', ')}`,
    profile.company.notes && `Notes : ${profile.company.notes}`,
  ].filter(Boolean).join('\n');
  if (upsertEntry(userId, planId, 'company', `Fiche entreprise — ${profile.company.name}`, companyLines)) created++;

  if (upsertEntry(userId, planId, 'product', `Produit — ${profile.productName}`, profile.description)) created++;

  const audienceLines = [
    `Utilisateurs : ${profile.targetAudience}`,
    profile.buyer && `Décideur / acheteur (qui paie) : ${profile.buyer}`,
  ].filter(Boolean).join('\n');
  if (upsertEntry(userId, planId, 'audience', 'Audience cible', audienceLines)) created++;

  const commercialLines = [
    `Tarification : ${profile.pricing}`,
    profile.primaryObjective && `Priorité actuelle : ${OBJECTIVE_LABELS[profile.primaryObjective] ?? profile.primaryObjective}`,
    profile.traction && `Stade commercial : ${TRACTION_LABELS[profile.traction] ?? profile.traction}`,
    profile.salesMotion && `Mode de vente : ${SALES_MOTION_LABELS[profile.salesMotion] ?? profile.salesMotion}`,
    profile.revenueGoal && `Objectif de chiffre d'affaires : ${profile.revenueGoal}`,
    profile.bottleneck && `Frein principal à la vente : ${profile.bottleneck}`,
    `Objectifs : ${profile.goals.join(' ; ')}`,
  ].filter(Boolean).join('\n');
  if (upsertEntry(userId, planId, 'offers', 'Offre & objectifs commerciaux', commercialLines)) created++;

  return created;
}

/** Plateformes de contenu pertinentes selon la niche du plan */
export function platformsForNiche(niche: string): string[] {
  const n = niche.toLowerCase();
  if (['saas', 'ai', 'devtool', 'nocode'].includes(n)) return ['linkedin', 'twitter'];
  if (['ecommerce', 'content', 'health'].includes(n)) return ['instagram', 'linkedin'];
  if (n === 'local-business' || n === 'services') return ['facebook', 'instagram', 'linkedin'];
  return ['linkedin', 'twitter'];
}
