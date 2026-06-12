/**
 * Publication directe (API Composio, sans IA) : mapping déterministe des
 * arguments par plateforme, vérifié avec un exécuteur factice — aucun appel
 * réseau. Les schémas imités sont ceux constatés sur l'API Composio réelle.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine } from '../src/db';
import { publishDirect, sendEmailDirect, ToolExecutor } from '../src/services/composioDirect';
import app from '../src/app';

let userId: string;

beforeAll(async () => {
  await initEngine();
  const res = await request(app).post('/api/auth/register').send({
    email: 'direct@launchforge.dev', password: 'password123', name: 'Direct Tester',
  });
  userId = res.body.data.user.id;
  // L'identité Composio doit être résoluble sans env : l'inscription pose lf-<id>
});

function recorder(responses: Record<string, unknown>) {
  const calls: { slug: string; args: Record<string, unknown> }[] = [];
  const exec: ToolExecutor = async (_uid, slug, args) => {
    calls.push({ slug, args });
    if (!(slug in responses)) throw new Error(`outil inattendu : ${slug}`);
    const r = responses[slug];
    if (r instanceof Error) throw r;
    return r;
  };
  return { calls, exec };
}

describe('publishDirect — X / Twitter', () => {
  it('publie le texte et signale un média non joignable', async () => {
    const { calls, exec } = recorder({ TWITTER_CREATION_OF_A_POST: { data: { id: '1234567890' } } });
    const out = await publishDirect(userId, 'twitter', 'Mon tweet', 'https://x.dev/video.mp4', '', exec);
    expect(out.handled).toBe(true);
    expect(out.result).toContain('OK:');
    expect(out.result).toContain('https://x.com/i/web/status/1234567890');
    expect(out.result).toContain('média non joint');
    expect(calls[0].args).toEqual({ text: 'Mon tweet' });
  });
});

describe('publishDirect — LinkedIn', () => {
  it('résout l\'URN auteur une fois (cache) puis crée le post', async () => {
    const { calls, exec } = recorder({
      LINKEDIN_GET_MY_INFO: { author_urn: 'urn:li:person:abc123' },
      LINKEDIN_CREATE_LINKED_IN_POST: { share_id: 'urn:li:share:999' },
    });
    const out = await publishDirect(userId, 'linkedin', 'Mon post', null, '', exec);
    expect(out.result).toContain('OK:');
    expect(out.result).toContain('urn:li:share:999');
    expect(calls.map((c) => c.slug)).toEqual(['LINKEDIN_GET_MY_INFO', 'LINKEDIN_CREATE_LINKED_IN_POST']);
    expect(calls[1].args).toMatchObject({
      author: 'urn:li:person:abc123', commentary: 'Mon post',
      visibility: 'PUBLIC', lifecycleState: 'PUBLISHED',
    });

    // 2e publication : l'URN vient du cache, plus d'appel GET_MY_INFO
    const second = recorder({ LINKEDIN_CREATE_LINKED_IN_POST: { id: 'urn:li:share:1000' } });
    await publishDirect(userId, 'linkedin', 'Autre post', null, '', second.exec);
    expect(second.calls.map((c) => c.slug)).toEqual(['LINKEDIN_CREATE_LINKED_IN_POST']);
  });
});

describe('publishDirect — Instagram', () => {
  it('image : compte → conteneur image_url → publication', async () => {
    const { calls, exec } = recorder({
      INSTAGRAM_GET_USER_INFO: { id: '178414000' },
      INSTAGRAM_CREATE_MEDIA_CONTAINER: { id: 'container-1' },
      INSTAGRAM_CREATE_POST: { id: 'post-1' },
    });
    const out = await publishDirect(userId, 'instagram', 'Ma légende', 'https://cdn.dev/visuel.png', '', exec);
    expect(out.result).toContain('OK:');
    expect(calls.map((c) => c.slug)).toEqual([
      'INSTAGRAM_GET_USER_INFO', 'INSTAGRAM_CREATE_MEDIA_CONTAINER', 'INSTAGRAM_CREATE_POST',
    ]);
    expect(calls[1].args).toMatchObject({
      ig_user_id: '178414000', caption: 'Ma légende',
      image_url: 'https://cdn.dev/visuel.png', content_type: 'photo',
    });
    expect(calls[2].args).toEqual({ ig_user_id: '178414000', creation_id: 'container-1' });
  });

  it('vidéo : conteneur REELS + attente du transcodage avant publication', async () => {
    const { calls, exec } = recorder({
      INSTAGRAM_CREATE_MEDIA_CONTAINER: { id: 'container-v' },
      INSTAGRAM_GET_POST_STATUS: { status_code: 'FINISHED' },
      INSTAGRAM_CREATE_POST: { id: 'post-v' },
    });
    const out = await publishDirect(userId, 'instagram', 'Reel', 'https://cdn.dev/clip.mp4', '', exec);
    expect(out.result).toContain('OK:');
    expect(calls[0].args).toMatchObject({ video_url: 'https://cdn.dev/clip.mp4', content_type: 'reel', media_type: 'REELS' });
    expect(calls.map((c) => c.slug)).toContain('INSTAGRAM_GET_POST_STATUS');
  }, 15000);
});

describe('publishDirect — YouTube', () => {
  it('mappe titre/description/tags et passe l\'URL publique en videoFilePath', async () => {
    const { calls, exec } = recorder({ YOUTUBE_UPLOAD_VIDEO: { id: 'dQw4w9WgXcQ' } });
    const out = await publishDirect(
      userId, 'youtube',
      'Découvrez la v2 !\nToutes les nouveautés en 3 minutes. #launchforge #saas',
      'https://launchforge.example/uploads/demo.mp4', 'LaunchForge v2 — démo', exec,
    );
    expect(out.result).toContain('https://youtu.be/dQw4w9WgXcQ');
    expect(calls[0].args).toMatchObject({
      title: 'LaunchForge v2 — démo',
      privacyStatus: 'public',
      categoryId: '22',
      videoFilePath: 'https://launchforge.example/uploads/demo.mp4',
      tags: ['launchforge', 'saas'],
    });
  });

  it('refuse sans vidéo', async () => {
    const { exec } = recorder({});
    const out = await publishDirect(userId, 'youtube', 'Texte', 'https://cdn.dev/image.png', '', exec);
    expect(out.result).toMatch(/^ECHEC:/);
  });
});

describe('sendEmailDirect — Gmail', () => {
  it('mappe destinataire/objet/corps sur GMAIL_SEND_EMAIL (boîte authentifiée)', async () => {
    const { calls, exec } = recorder({ GMAIL_SEND_EMAIL: { id: 'msg-1' } });
    const out = await sendEmailDirect(userId, 'lead@exemple.fr', 'Suite à votre commentaire', 'Bonjour…', exec);
    expect(out.handled).toBe(true);
    expect(out.result).toContain('OK:');
    expect(calls[0].args).toEqual({
      recipient_email: 'lead@exemple.fr',
      subject: 'Suite à votre commentaire',
      body: 'Bonjour…',
      user_id: 'me',
    });
  });

  it('rend la main à l\'opérateur IA si Gmail échoue (boîte Outlook, compte absent…)', async () => {
    const { exec } = recorder({ GMAIL_SEND_EMAIL: new Error('No connected account found for gmail') });
    const out = await sendEmailDirect(userId, 'lead@exemple.fr', 'Objet', 'Corps', exec);
    expect(out.handled).toBe(false);
  });
});

describe('publishDirect — périmètre et erreurs', () => {
  it('laisse Reddit, Facebook et les autres à l\'opérateur IA', async () => {
    const { exec } = recorder({});
    for (const platform of ['reddit', 'facebook', 'blog', 'newsletter']) {
      expect((await publishDirect(userId, platform, 'Texte', null, '', exec)).handled).toBe(false);
    }
  });

  it('transforme une erreur d\'outil en ECHEC propre', async () => {
    const { exec } = recorder({ TWITTER_CREATION_OF_A_POST: new Error('Tweet text exceeds 280 characters') });
    const out = await publishDirect(userId, 'twitter', 'x'.repeat(300), null, '', exec);
    expect(out.handled).toBe(true);
    expect(out.result).toBe('ECHEC: Tweet text exceeds 280 characters');
  });
});
