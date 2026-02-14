// Netlify Function: Generate personalized sequence copy via Claude API
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return respond(500, { error: 'Anthropic API key not configured. Add ANTHROPIC_API_KEY to your Netlify environment variables.' });
  }

  try {
    const body = JSON.parse(event.body);
    const {
      prospects,
      channels = ['email'],
      touchpointCount = 6,
      daySpacing = 3,
      emailSendType = 'manual',
      sender = {},
      tones,
      tone = 'professional',
      productDescription = '',
      painPoint = '',
      proposedSolution = '',
      openToLearnMore = '',
    } = body;

    if (!prospects || prospects.length === 0) {
      return respond(400, { error: 'No prospects provided' });
    }

    const touchpointPlan = buildTouchpointPlan(touchpointCount, channels, daySpacing);

    // Scale max_tokens based on touchpoint count:
    // Each touchpoint needs ~200-300 tokens of JSON output.
    // 6 touchpoints ≈ 2048, 12 ≈ 4096, 20 ≈ 8192
    const maxTokens = Math.min(Math.max(touchpointPlan.length * 400, 2048), 8192);

    // Scale batch size based on prospect count to fit within Netlify Pro 26s timeout.
    // Each Claude call takes ~3-8s depending on touchpoint count.
    // batchSize=10 → 2 batches for 20 prospects → ~16s total.
    const batchSize = prospects.length > 10 ? 10 : prospects.length > 4 ? 5 : 2;
    const allSequences = [];

    console.log(`[Sequence] Generating ${touchpointPlan.length} touchpoints for ${prospects.length} prospects (batch=${batchSize}, maxTokens=${maxTokens})`);

    for (let i = 0; i < prospects.length; i += batchSize) {
      const batch = prospects.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((prospect, batchIdx) =>
          generateProspectSequence(ANTHROPIC_API_KEY, prospect, touchpointPlan, i + batchIdx, sender, emailSendType, tones || [tone], { productDescription, painPoint, proposedSolution, openToLearnMore }, maxTokens)
        )
      );
      allSequences.push(...batchResults);
    }

    return respond(200, { sequences: allSequences, touchpointPlan });
  } catch (err) {
    console.error('Error generating sequence:', err);
    return respond(500, { error: err.message || 'Failed to generate sequence' });
  }
}

function buildTouchpointPlan(count, channels, daySpacing) {
  const plan = [];
  const totalSteps = Math.min(parseInt(count) || 6, 20);
  const spacing = parseInt(daySpacing) || 3;
  const availableChannels = channels.filter(c => ['email', 'linkedin', 'calling'].includes(c));
  if (availableChannels.length === 0) availableChannels.push('email');

  for (let i = 0; i < totalSteps; i++) {
    const day = 1 + (i * spacing);
    let stage;
    const position = i / (totalSteps - 1 || 1);
    if (position <= 0.3) stage = 'opening';
    else if (position <= 0.7) stage = 'value_add';
    else stage = 'closing';

    // Respect user-defined channel order — cycle through in the order they selected
    const channel = availableChannels[i % availableChannels.length];

    plan.push({ step: i + 1, day, stage, channel });
  }
  return plan;
}

async function generateProspectSequence(apiKey, prospect, touchpointPlan, prospectIndex, sender, emailSendType, tones, messagingContext, maxTokens = 2048) {
  const totalSteps = touchpointPlan.length;

  // Build sender sign-off block
  const senderSignoff = buildSenderSignoff(sender);

  // Send style note — supports manual, automated, and combo
  let sendStyleNote;
  if (emailSendType === 'automated') {
    sendStyleNote = `EMAIL SEND TYPE: AUTOMATED — These emails will be sent via a sequencing tool (Outreach, Salesloft, Apollo, etc.). Write them to feel natural at scale. Use merge-field-friendly language. Avoid overly specific time references like "I just saw" or "this morning". Keep tone warm but systematic. Do NOT include a typed signature — it will be appended automatically by the platform.`;
  } else if (emailSendType === 'combo') {
    sendStyleNote = `EMAIL SEND TYPE: MANUAL + AUTOMATED COMBO — This sequence uses a mix of both personal 1:1 sends and automated sequenced sends. For the first 1 to 2 email touchpoints (opening stage), write them as if they will be sent manually from the sender's inbox: genuinely personal, conversational, hand-typed feel, with a natural sign-off. For later email touchpoints (value_add and closing stages), write them for automated sending: natural at scale, merge-field-friendly, no overly specific time references, no typed signature.`;
  } else {
    sendStyleNote = `EMAIL SEND TYPE: MANUAL — These emails will be sent personally 1:1 from the sender's inbox. Write them to feel genuinely personal, conversational, and hand-typed. Use casual time references. It's okay to reference specific details. End each email with a natural sign-off from the sender.`;
  }

  // Tone instructions — supports multi-tone blending
  const toneInstructions = {
    professional: `PROFESSIONAL — Polished, executive ready tone. Complete sentences, proper grammar, confident but respectful voice. Suitable for C suite and senior leadership.`,
    casual: `CASUAL — Friendly, conversational tone. Use contractions, informal language, warm approachable voice. Feel like a peer reaching out, not a salesperson.`,
    simple: `SIMPLE — Short, direct sentences. No fluff, no filler words, no unnecessary adjectives. Get to the point fast. Every word earns its place.`,
  };

  // Build tone section based on selected tones (single or blended)
  const activeTones = Array.isArray(tones) && tones.length > 0 ? tones : ['professional'];
  let toneSection;
  if (activeTones.length === 1) {
    toneSection = `TONE: ${toneInstructions[activeTones[0]] || toneInstructions.professional}`;
  } else {
    const toneDescs = activeTones.map(t => toneInstructions[t]).filter(Boolean);
    toneSection = `TONE: Use a BLEND of the following tones. Weave them together naturally throughout the sequence:\n${toneDescs.map(d => `- ${d}`).join('\n')}`;
  }

  // Build messaging context section
  const contextParts = [];
  if (messagingContext.productDescription) contextParts.push(`PRODUCT DESCRIPTION: ${messagingContext.productDescription}`);
  if (messagingContext.painPoint) contextParts.push(`PAIN POINT the product solves: ${messagingContext.painPoint}`);
  if (messagingContext.proposedSolution) contextParts.push(`PROPOSED SOLUTION: ${messagingContext.proposedSolution}`);
  if (messagingContext.openToLearnMore) contextParts.push(`GOAL is to get them open to learning more about: ${messagingContext.openToLearnMore}`);
  const messagingSection = contextParts.length > 0
    ? `\n\nPRODUCT & MESSAGING CONTEXT (use the product description to inform all copy. Weave pain points, solutions, and goals naturally into the sequence. Do NOT copy these word for word, but make sure every touchpoint clearly relates back to the product and the value it delivers):\n${contextParts.join('\n')}`
    : '';

  const systemPrompt = `You are a world-class B2B sales copywriter. You write concise, personalized outbound messages that feel human and relevant. Never use buzzwords like "synergy", "best-in-class", or "cutting-edge". Lead with value and outcomes. Use active voice.

CRITICAL FORMATTING RULE: NEVER use dashes, hyphens, em dashes, or en dashes anywhere in the copy. Not in sentences, not between words, not for emphasis, not for lists. Use commas, periods, colons, or separate sentences instead. This rule applies to subject lines, email bodies, LinkedIn messages, and call scripts.

${toneSection}

SENDER INFO:
Name: ${sender.name || 'Sales Rep'}
Title: ${sender.title || ''}
Company: ${sender.company || ''}
${sender.phone ? `Phone: ${sender.phone}` : ''}
${sender.linkedin ? `LinkedIn: ${sender.linkedin}` : ''}
${sender.calendly ? `Booking Link: ${sender.calendly}` : ''}

${sendStyleNote}

SENDER SIGN-OFF FOR EMAILS (use this at the end of email bodies):
${senderSignoff}

For LinkedIn messages, sign off casually with just the sender's first name.
For call scripts, introduce yourself with full name and company.${messagingSection}`;

  const userPrompt = `Generate a complete outbound sequence for this prospect:

Name: ${prospect.name}
Title: ${prospect.title}
Company: ${prospect.company}

Generate ${totalSteps} touchpoints with the following plan:
${touchpointPlan.map(tp => `- Step ${tp.step} (Day ${tp.day}): ${tp.channel} — Stage: ${tp.stage}`).join('\n')}

STAGE GUIDELINES:
- Opening: Introduce yourself, reference something specific about their role/company, spark curiosity. Keep short.
- Value Add: Share a relevant insight, case study, or industry trend. Provide genuine value without hard selling.
- Closing: Make a specific ask (demo, call, meeting).${sender.calendly ? ` Include the booking link: ${sender.calendly}` : ''} Create urgency without being pushy.

CHANNEL FORMATS:
- email: Provide "subject" and "body" fields. Subject under 60 chars. Body under 120 words. ${emailSendType === 'manual' ? 'Include the sender sign-off at the end of the body.' : emailSendType === 'combo' ? 'For early manual-style emails, include the sender sign-off. For later automated-style emails, do NOT include a signature.' : 'Do NOT include a signature — it will be appended automatically.'}
- linkedin: Provide "message" field. Under 300 characters for connection requests, under 500 chars for messages. Sign off with sender's first name.
- calling: Provide "script" field. A brief opening script under 80 words. Start with "Hi {prospect first name}, this is {sender name} from {sender company}..."

CRITICAL: Each touchpoint must be distinct. Don't repeat angles. Each step builds on the previous.

Respond in this exact JSON format (no markdown, just raw JSON):
{
  "touchpoints": [
    {
      "step": 1,
      "day": 1,
      "channel": "email",
      "stage": "opening",
      "subject": "...",
      "body": "...",
      "message": null,
      "script": null
    }
  ]
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Claude API error for ${prospect.name}:`, response.status, errText);
      throw new Error(`Claude API error: ${response.status} — ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data.content[0]?.text || '';

    // Check if response was truncated (hit max_tokens limit)
    if (data.stop_reason === 'max_tokens') {
      console.warn(`[Sequence] Claude response TRUNCATED for ${prospect.name} (hit ${maxTokens} max_tokens). Response length: ${content.length} chars`);
    }

    // Use non-greedy match to find the FIRST complete JSON object
    // Then validate it has the expected "touchpoints" key
    const jsonMatch = content.match(/\{[\s\S]*?\"touchpoints\"\s*:\s*\[[\s\S]*?\]\s*\}/);
    if (!jsonMatch) {
      // Fallback: try greedy match but only if it parses and has touchpoints
      const greedyMatch = content.match(/\{[\s\S]*\}/);
      if (greedyMatch) {
        try {
          const attempt = JSON.parse(greedyMatch[0]);
          if (attempt.touchpoints && Array.isArray(attempt.touchpoints) && attempt.touchpoints.length > 0) {
            return { prospectIndex, prospectName: prospect.name, touchpoints: attempt.touchpoints };
          }
        } catch (_) { /* fall through to error */ }
      }
      throw new Error('Failed to parse Claude response — no valid touchpoints JSON found');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate Claude returned actual touchpoints, not an empty array
    if (!parsed.touchpoints || !Array.isArray(parsed.touchpoints) || parsed.touchpoints.length === 0) {
      throw new Error('Claude returned empty touchpoints array');
    }

    return {
      prospectIndex,
      prospectName: prospect.name,
      touchpoints: parsed.touchpoints,
    };
  } catch (err) {
    console.error(`Error generating for ${prospect.name}:`, err);
    return {
      prospectIndex,
      prospectName: prospect.name,
      touchpoints: touchpointPlan.map(tp => ({
        ...tp,
        subject: tp.channel === 'email' ? `⚠ Generation failed` : null,
        body: tp.channel === 'email' ? `This touchpoint could not be generated. Please retry or write manually.\n\nError: ${err.message}` : null,
        message: tp.channel === 'linkedin' ? `⚠ This touchpoint could not be generated. Please retry or write manually.` : null,
        script: tp.channel === 'calling' ? `⚠ This call script could not be generated. Please retry or write manually.` : null,
        generationFailed: true,
      })),
      error: err.message,
    };
  }
}

function buildSenderSignoff(sender) {
  const lines = [];
  const firstName = (sender.name || '').split(' ')[0] || 'Best';
  lines.push(firstName);
  if (sender.title && sender.company) {
    lines.push(`${sender.title} | ${sender.company}`);
  }
  if (sender.phone) lines.push(sender.phone);
  if (sender.linkedin) lines.push(sender.linkedin);
  if (sender.calendly) lines.push(`Book a time: ${sender.calendly}`);
  return lines.join('\n');
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
