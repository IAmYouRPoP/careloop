// Optional AI step for the symptom guide: Claude reads the patient's free text and returns
// symptom keys, chosen only from the rule table's own vocabulary. It never picks a department,
// urgency, diagnosis or medicine; the rule table still decides all of that.
//
// Enabled when ANTHROPIC_API_KEY is set (or CARELOOP_AI=on with another credential source).
// Any error, timeout or refusal falls back to rules only.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.CARELOOP_AI_MODEL || 'claude-opus-5-5';
const enabled = !!process.env.ANTHROPIC_API_KEY || process.env.CARELOOP_AI === 'on';

// Short timeout and one retry: a slow AI call must never hold up the guide.
const client = enabled ? new Anthropic({ timeout: 10_000, maxRetries: 1 }) : null;

const SYSTEM =
  'You extract symptoms from a patient\'s own description for a hospital triage tool. ' +
  'Return only symptom keys from the allowed list that the patient actually reports having. ' +
  'Ignore symptoms the patient says they do not have. Do not guess conditions, give advice, or add keys ' +
  'that are not clearly described. If nothing matches, return an empty list. ' +
  'Keys ending in a red-flag sign (for example chest_pain, breathing_difficulty, stroke_signs) must be ' +
  'included whenever the description plausibly reports them, since missing an emergency is worse than a false alarm.';

export function aiStatus() {
  return { enabled, model: enabled ? MODEL : null };
}

export async function extractSymptoms(text, allowedKeys) {
  if (!client) return { ok: false, keys: [], error: 'AI is not configured' };
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 1024,
      // Refusals are re-run on a fallback model chosen by the API, so a safety decline
      // on sensitive wording (self-harm, overdose) still returns keys.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { symptoms: { type: 'array', items: { type: 'string', enum: allowedKeys } } },
            required: ['symptoms'],
            additionalProperties: false,
          },
        },
      },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Patient description:\n"""${text}"""` }],
    });
    if (response.stop_reason === 'refusal') return { ok: false, keys: [], error: 'The AI declined this request' };
    if (response.stop_reason === 'max_tokens') return { ok: false, keys: [], error: 'The AI response was cut off' };
    const block = response.content.find((b) => b.type === 'text');
    const parsed = JSON.parse(block?.text || '{}');
    const keys = [...new Set((parsed.symptoms || []).filter((k) => allowedKeys.includes(k)))];
    return { ok: true, keys };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, keys: [], error: 'AI key is invalid' };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, keys: [], error: 'AI rate limit reached' };
    if (e instanceof Anthropic.APIError) return { ok: false, keys: [], error: `AI error ${e.status ?? ''}`.trim() };
    return { ok: false, keys: [], error: e instanceof SyntaxError ? 'AI returned unreadable output' : 'AI unavailable' };
  }
}
