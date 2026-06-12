/**
 * Publication directe (API Composio, sans IA) : mapping déterministe des
 * arguments par plateforme, vérifié avec un exécuteur factice — aucun appel
 * réseau. Les schémas imités sont ceux constatés sur l'API Composio réelle.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { initEngine } from '../src/db';
import { publishDirect, sendEmailDirect, syncMetricsDirect, ToolExecutor, McpToolCaller, FileUploader } from '../src/services/composioDirect';
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
  const calls: { slug: string; args: Record<string, unknown>; version?: string }[] = [];
  const exec: ToolExecutor = async (_uid, slug, args, version) => {
    calls.push({ slug, args, version });
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
    // la version d'outil par défaut du projet est périmée (NONEXISTENT_VERSION)
    expect(calls[1].version).toBe('latest');

    // 2e publication : l'URN vient du cache, plus d'appel GET_MY_INFO
    const second = recorder({ LINKEDIN_CREATE_LINKED_IN_POST: { id: 'urn:li:share:1000' } });
    await publishDirect(userId, 'linkedin', 'Autre post', null, '', second.exec);
    expect(second.calls.map((c) => c.slug)).toEqual(['LINKEDIN_CREATE_LINKED_IN_POST']);
  });

  it('joint l\'image du post : téléversement Composio (s3key) puis paramètre images', async () => {
    const uploaded: string[] = [];
    const upload: FileUploader = async (toolkit, tool, fileUrl) => {
      uploaded.push(`${toolkit}/${tool}/${fileUrl}`);
      return { name: 'visuel.png', mimetype: 'image/png', s3key: '42/linkedin/req/abc' };
    };
    const { calls, exec } = recorder({ LINKEDIN_CREATE_LINKED_IN_POST: { id: 'urn:li:share:2000' } });
    const out = await publishDirect(userId, 'linkedin', 'Post illustré', 'https://cdn.dev/visuel.png', '', exec, undefined, upload);
    expect(out.result).toContain('OK:');
    expect(out.result).toContain('image jointe');
    expect(uploaded).toEqual(['linkedin/LINKEDIN_CREATE_LINKED_IN_POST/https://cdn.dev/visuel.png']);
    expect(calls[0].args.images).toEqual([{ name: 'visuel.png', mimetype: 'image/png', s3key: '42/linkedin/req/abc' }]);
  });

  it('publie quand même en texte si le téléversement de l\'image échoue', async () => {
    const upload: FileUploader = async () => { throw new Error('média inaccessible (HTTP 404)'); };
    const { calls, exec } = recorder({ LINKEDIN_CREATE_LINKED_IN_POST: { id: 'urn:li:share:2001' } });
    const out = await publishDirect(userId, 'linkedin', 'Post', 'https://cdn.dev/absent.png', '', exec, undefined, upload);
    expect(out.result).toContain('OK:');
    expect(out.result).toContain('image non jointe : média inaccessible (HTTP 404)');
    expect(calls[0].args.images).toBeUndefined();
  });

  it('ne tente pas de joindre une vidéo (images uniquement)', async () => {
    const upload: FileUploader = async () => { throw new Error('ne doit pas être appelé'); };
    const { calls, exec } = recorder({ LINKEDIN_CREATE_LINKED_IN_POST: { id: 'urn:li:share:2002' } });
    const out = await publishDirect(userId, 'linkedin', 'Post', 'https://cdn.dev/clip.mp4', '', exec, undefined, upload);
    expect(out.result).toContain('OK:');
    expect(out.result).toContain('vidéo non jointe');
    expect(calls[0].args.images).toBeUndefined();
  });
});

describe('publishDirect — LinkedIn, secours MCP legacy (bug NONEXISTENT_VERSION)', () => {
  const versionError = () => new Error('{"status":426,"code":"NONEXISTENT_VERSION","message":"Requested version 20241101 is not active"}');

  function mcpRecorder(reply: string | Error) {
    const calls: { tool: string; args: Record<string, unknown> }[] = [];
    const mcp: McpToolCaller = async (_uid, tool, args) => {
      calls.push({ tool, args });
      if (reply instanceof Error) throw reply;
      return reply;
    };
    return { calls, mcp };
  }

  let prevMcpUrl: string | undefined;
  beforeAll(() => {
    // isComposioConfigured() doit voir un serveur MCP pour activer le secours
    prevMcpUrl = process.env.COMPOSIO_MCP_URL;
    process.env.COMPOSIO_MCP_URL = 'https://mcp.composio.dev/partner/composio/test/mcp?user_id=test';
  });
  afterAll(() => {
    if (prevMcpUrl === undefined) delete process.env.COMPOSIO_MCP_URL;
    else process.env.COMPOSIO_MCP_URL = prevMcpUrl;
  });

  // le téléversement d'image n'est pas le sujet de ces tests : uploader muet
  const noUpload: FileUploader = async () => { throw new Error('COMPOSIO_NOT_CONFIGURED'); };

  it('bascule sur LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE (ugcPosts) en partageant le média du post', async () => {
    const { exec } = recorder({ LINKEDIN_CREATE_LINKED_IN_POST: versionError() });
    const { calls, mcp } = mcpRecorder('{"successfull": true, "data": {"id": "urn:li:share:42424242"}}');
    const out = await publishDirect(userId, 'linkedin', 'Mon post', 'https://cdn.dev/visuel.png', 'Mon titre', exec, mcp, noUpload);
    expect(out.result).toContain('OK:');
    expect(out.result).toContain('https://www.linkedin.com/feed/update/urn:li:share:42424242');
    expect(calls[0].tool).toBe('LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE');
    expect(calls[0].args).toMatchObject({
      author: 'urn:li:person:abc123', // résolu par le test précédent (cache)
      lifecycleState: 'PUBLISHED',
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: 'Mon post' },
          shareMediaCategory: 'ARTICLE',
          media: [{ originalUrl: 'https://cdn.dev/visuel.png', title: { text: 'Mon titre' }, status: 'READY' }],
        },
      },
    });
  });

  it('sans média : partage l\'URL de l\'app (APP_URL) — le schéma legacy exige un lien', async () => {
    const prev = process.env.APP_URL;
    process.env.APP_URL = 'https://launchforge.example';
    try {
      const { exec } = recorder({ LINKEDIN_CREATE_LINKED_IN_POST: versionError() });
      const { calls, mcp } = mcpRecorder('{"successfull": true, "data": {}}');
      const out = await publishDirect(userId, 'linkedin', 'Post texte', null, '', exec, mcp, noUpload);
      expect(out.result).toContain('OK:');
      const share = (calls[0].args as any).specificContent['com.linkedin.ugc.ShareContent'];
      expect(share.media[0].originalUrl).toBe('https://launchforge.example');
    } finally {
      if (prev === undefined) delete process.env.APP_URL; else process.env.APP_URL = prev;
    }
  });

  it('si le secours MCP échoue aussi : message ECHEC actionnable (clé proxy)', async () => {
    const { exec } = recorder({ LINKEDIN_CREATE_LINKED_IN_POST: versionError() });
    const { mcp } = mcpRecorder(new Error('Tool LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE failed: 422'));
    const out = await publishDirect(userId, 'linkedin', 'Mon post', 'https://cdn.dev/v.png', '', exec, mcp, noUpload);
    expect(out.result).toMatch(/^ECHEC:/);
    expect(out.result).toContain('COMPOSIO_PROXY_API_KEY');
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
    // l'id rapporté est celui du MÉDIA publié (réponse de CREATE_POST),
    // exploitable ensuite par GET_POST_INSIGHTS
    expect(out.result).toContain('id post-1');
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
  it('laisse blog, newsletter et plateformes sans API à l\'opérateur IA', async () => {
    const { exec } = recorder({});
    for (const platform of ['blog', 'newsletter', 'producthunt', 'hackernews']) {
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

describe('publishDirect — Reddit', () => {
  it('post texte : subreddit extrait de la mention r/<nom>, kind self', async () => {
    const { calls, exec } = recorder({
      REDDIT_CREATE_REDDIT_POST: { json: { data: { id: 'ab12cd', name: 't3_ab12cd', url: 'https://www.reddit.com/r/startups/comments/ab12cd/mon_post/' } } },
    });
    const out = await publishDirect(userId, 'reddit', 'Lancement de LaunchForge sur r/startups aujourd\'hui !', null, 'Mon lancement', exec);
    expect(out.handled).toBe(true);
    expect(out.result).toContain('OK:');
    expect(out.result).toContain('r/startups');
    expect(out.result).toContain('https://www.reddit.com/r/startups/comments/ab12cd/mon_post/');
    expect(calls[0].args).toEqual({
      subreddit: 'startups', title: 'Mon lancement', kind: 'self',
      text: 'Lancement de LaunchForge sur r/startups aujourd\'hui !',
    });
  });

  it('avec média : post lien vers l\'image, texte publié en premier commentaire', async () => {
    const { calls, exec } = recorder({
      REDDIT_CREATE_REDDIT_POST: { json: { data: { id: 'xy99zz', name: 't3_xy99zz', url: 'https://www.reddit.com/r/SideProject/comments/xy99zz/demo/' } } },
      REDDIT_POST_REDDIT_COMMENT: { json: { data: {} } },
    });
    const out = await publishDirect(userId, 'reddit', 'La démo complète en une image. r/SideProject', 'https://cdn.dev/demo.png', 'Démo', exec);
    expect(out.result).toContain('OK:');
    expect(out.result).toContain('premier commentaire');
    expect(calls[0].args).toMatchObject({ subreddit: 'SideProject', kind: 'link', url: 'https://cdn.dev/demo.png' });
    expect(calls[1].slug).toBe('REDDIT_POST_REDDIT_COMMENT');
    expect(calls[1].args).toEqual({ thing_id: 't3_xy99zz', text: 'La démo complète en une image. r/SideProject' });
  });

  it('sans mention r/<nom> : ECHEC pédagogique, rien n\'est envoyé', async () => {
    const { calls, exec } = recorder({});
    const out = await publishDirect(userId, 'reddit', 'Un post sans cible', null, '', exec);
    expect(out.handled).toBe(true);
    expect(out.result).toMatch(/^ECHEC:/);
    expect(out.result).toContain('r/<nom>');
    expect(calls.length).toBe(0);
  });
});

describe('syncMetricsDirect — lecture déterministe des métriques', () => {
  it('X/Twitter : public_metrics depuis l\'id du tweet', async () => {
    const { calls, exec } = recorder({
      TWITTER_POST_LOOKUP_BY_POST_ID: { data: { public_metrics: { like_count: 5, reply_count: 2, retweet_count: 3, quote_count: 1, impression_count: 100 } } },
    });
    const out = await syncMetricsDirect(userId, 'twitter', 'https://x.com/i/web/status/1234567890', exec);
    expect(out.handled).toBe(true);
    expect(out.metrics).toMatchObject({ found: true, likes: 5, comments: 2, shares: 4, impressions: 100 });
    expect(calls[0].args).toEqual({ id: '1234567890', tweet_fields: ['public_metrics'] });
  });

  it('YouTube : statistics de la vidéo (vues, likes, commentaires)', async () => {
    // enveloppe response_data constatée sur l'API réelle
    const { calls, exec } = recorder({
      YOUTUBE_VIDEO_DETAILS: { response_data: { items: [{ statistics: { viewCount: '1000', likeCount: '50', commentCount: '7' } }] } },
    });
    const out = await syncMetricsDirect(userId, 'youtube', 'https://youtu.be/dQw4w9WgXcQ', exec);
    expect(out.metrics).toMatchObject({ found: true, impressions: 1000, likes: 50, comments: 7 });
    expect(calls[0].args).toEqual({ id: 'dQw4w9WgXcQ', part: 'statistics' });
  });

  it('Reddit : score et commentaires via le fullname t3_ du post (forme réelle things[])', async () => {
    const { calls, exec } = recorder({
      REDDIT_RETRIEVE_SPECIFIC_COMMENT: { things: [{ data: { score: 42, num_comments: 6, num_crossposts: 1 } }] },
    });
    const out = await syncMetricsDirect(userId, 'reddit', 'https://www.reddit.com/r/startups/comments/ab12cd/mon_post/', exec);
    expect(out.metrics).toMatchObject({ found: true, likes: 42, comments: 6, shares: 1 });
    expect(calls[0].args).toEqual({ id: 't3_ab12cd' });
  });

  it('Instagram : insights du média publié (reach, likes, comments, shares)', async () => {
    const { calls, exec } = recorder({
      INSTAGRAM_GET_POST_INSIGHTS: { data: [
        { name: 'reach', values: [{ value: 200 }] },
        { name: 'likes', values: [{ value: 12 }] },
        { name: 'comments', values: [{ value: 3 }] },
        { name: 'shares', values: [{ value: 2 }] },
      ] },
    });
    const out = await syncMetricsDirect(userId, 'instagram', '17895695668004196', exec);
    expect(out.metrics).toMatchObject({ found: true, impressions: 200, likes: 12, comments: 3, shares: 2 });
    expect(calls[0].args).toEqual({ ig_post_id: '17895695668004196' });
  });

  it('LinkedIn : réactions comptées via l\'outil du serveur MCP', async () => {
    const prev = process.env.COMPOSIO_MCP_URL;
    process.env.COMPOSIO_MCP_URL = 'https://mcp.composio.dev/partner/composio/test/mcp?user_id=test';
    try {
      const { exec } = recorder({});
      const mcpCalls: { tool: string; args: Record<string, unknown> }[] = [];
      const mcp: McpToolCaller = async (_uid, tool, args) => {
        mcpCalls.push({ tool, args });
        return '{"data": {"paging": {"total": 9}, "elements": []}}';
      };
      const out = await syncMetricsDirect(userId, 'linkedin', 'urn:li:share:7021942390034694144', exec, mcp);
      expect(out.metrics).toMatchObject({ found: true, likes: 9 });
      expect(mcpCalls[0].tool).toBe('LINKEDIN_LIST_REACTIONS');
      expect(mcpCalls[0].args).toMatchObject({ entity: 'urn:li:share:7021942390034694144' });
    } finally {
      if (prev === undefined) delete process.env.COMPOSIO_MCP_URL; else process.env.COMPOSIO_MCP_URL = prev;
    }
  });

  it('référence inexploitable ou plateforme inconnue : main à l\'opérateur IA', async () => {
    const { exec } = recorder({});
    expect((await syncMetricsDirect(userId, 'twitter', 'pas-une-reference', exec)).handled).toBe(false);
    expect((await syncMetricsDirect(userId, 'facebook', 'https://facebook.com/x', exec)).handled).toBe(false);
  });
});

describe('publishDirect — Facebook (Page)', () => {
  it('texte : résout la première Page gérée (cache) puis CREATE_POST', async () => {
    const { calls, exec } = recorder({
      FACEBOOK_GET_USER_PAGES: { data: [{ id: '101010101010', name: 'LaunchForge' }] },
      FACEBOOK_CREATE_POST: { id: '101010101010_777' },
    });
    const out = await publishDirect(userId, 'facebook', 'Mon annonce', null, '', exec);
    expect(out.handled).toBe(true);
    expect(out.result).toContain('OK:');
    expect(out.result).toContain('LaunchForge');
    expect(out.result).toContain('https://www.facebook.com/101010101010_777');
    expect(calls.map((c) => c.slug)).toEqual(['FACEBOOK_GET_USER_PAGES', 'FACEBOOK_CREATE_POST']);
    expect(calls[1].args).toEqual({ page_id: '101010101010', message: 'Mon annonce' });

    // 2e publication : la Page vient du cache
    const second = recorder({ FACEBOOK_CREATE_POST: { id: '101010101010_778' } });
    await publishDirect(userId, 'facebook', 'Autre annonce', null, '', second.exec);
    expect(second.calls.map((c) => c.slug)).toEqual(['FACEBOOK_CREATE_POST']);
  });

  it('image : CREATE_PHOTO_POST avec l\'URL publique', async () => {
    const { calls, exec } = recorder({ FACEBOOK_CREATE_PHOTO_POST: { post_id: '101010101010_779' } });
    const out = await publishDirect(userId, 'facebook', 'Légende', 'https://cdn.dev/visuel.png', '', exec);
    expect(out.result).toContain('OK:');
    expect(calls[0].args).toEqual({ page_id: '101010101010', url: 'https://cdn.dev/visuel.png', message: 'Légende' });
  });

  it('vidéo : CREATE_VIDEO_POST avec file_url, titre et description', async () => {
    const { calls, exec } = recorder({ FACEBOOK_CREATE_VIDEO_POST: { id: '101010101010_780' } });
    const out = await publishDirect(userId, 'facebook', 'La démo en vidéo', 'https://cdn.dev/demo.mp4', 'Démo produit', exec);
    expect(out.result).toContain('OK:');
    expect(calls[0].args).toEqual({
      page_id: '101010101010', file_url: 'https://cdn.dev/demo.mp4',
      description: 'La démo en vidéo', title: 'Démo produit',
    });
  });
});

describe('publishDirect — TikTok', () => {
  it('vidéo : PUBLISH_VIDEO puis suivi du statut jusqu\'à PUBLISH_COMPLETE', async () => {
    const { calls, exec } = recorder({
      TIKTOK_PUBLISH_VIDEO: { publish_id: 'v_pub_42' },
      TIKTOK_FETCH_PUBLISH_STATUS: { status: 'PUBLISH_COMPLETE' },
    });
    const out = await publishDirect(userId, 'tiktok', 'Ma vidéo #launchforge', 'https://cdn.dev/clip.mp4', '', exec);
    expect(out.result).toContain('OK:');
    expect(out.result).toContain('publiée');
    expect(calls[0].args).toMatchObject({
      video_url: 'https://cdn.dev/clip.mp4',
      caption: 'Ma vidéo #launchforge',
      privacy_level: 'PUBLIC_TO_EVERYONE',
    });
    expect(calls[1].args).toEqual({ publish_id: 'v_pub_42' });
  }, 15000);

  it('image : POST_PHOTO en DIRECT_POST', async () => {
    const { calls, exec } = recorder({ TIKTOK_POST_PHOTO: { publish_id: 'p_pub_7' } });
    const out = await publishDirect(userId, 'tiktok', 'Mon visuel', 'https://cdn.dev/visuel.webp', 'Titre', exec);
    expect(out.result).toContain('OK:');
    expect(calls[0].args).toMatchObject({
      photo_images: ['https://cdn.dev/visuel.webp'],
      photo_cover_index: 0,
      post_mode: 'DIRECT_POST',
      title: 'Titre',
      description: 'Mon visuel',
    });
  });

  it('refuse sans média', async () => {
    const { calls, exec } = recorder({});
    const out = await publishDirect(userId, 'tiktok', 'Texte seul', null, '', exec);
    expect(out.result).toMatch(/^ECHEC:/);
    expect(calls.length).toBe(0);
  });

  it('vidéo refusée par TikTok : ECHEC avec la raison', async () => {
    const { exec } = recorder({
      TIKTOK_PUBLISH_VIDEO: { publish_id: 'v_pub_43' },
      TIKTOK_FETCH_PUBLISH_STATUS: { status: 'FAILED', fail_reason: 'video_too_long' },
    });
    const out = await publishDirect(userId, 'tiktok', 'Vidéo', 'https://cdn.dev/long.mp4', '', exec);
    expect(out.result).toMatch(/^ECHEC:/);
    expect(out.result).toContain('video_too_long');
  }, 15000);
});

describe('syncMetricsDirect — Facebook', () => {
  it('résumés likes/commentaires/partages via GET_POST (id pageId_postId)', async () => {
    const { calls, exec } = recorder({
      FACEBOOK_GET_POST: {
        id: '101010101010_777',
        likes: { summary: { total_count: 11 } },
        comments: { summary: { total_count: 4 } },
        shares: { count: 2 },
      },
    });
    const out = await syncMetricsDirect(userId, 'facebook', 'https://www.facebook.com/101010101010_777', exec);
    expect(out.handled).toBe(true);
    expect(out.metrics).toMatchObject({ found: true, likes: 11, comments: 4, shares: 2 });
    expect(calls[0].args).toMatchObject({ post_id: '101010101010_777' });
  });
});
