// Збирання контексту для Ведучого (D-44) і схеми відповіді під поточний блок.
// Ведучий бачить скіл, карту, поточний і сусідні блоки, від сцени входу в арену — правила бою,
// а коли бюджет ходів виходить за межі — банк вставок.

const BOSS_TAGS = ["armor", "baguette", "brooch", "jam"];

export function reachable(manifest, block) {
  const blocks = manifest.blocks;
  return [block, ...blocks[block].exits.filter((e) => !blocks[e]?.insert)];
}

function inBossPart(manifest, block) {
  const order = Object.keys(manifest.blocks);
  const from = order.indexOf(manifest.context.boss_from);
  return from >= 0 && order.indexOf(block) >= from && !manifest.blocks[block].insert;
}

function needsInserts(manifest, block, turnsUsed) {
  const b = manifest.blocks[block];
  if (b.boss) return turnsUsed > 16;
  return turnsUsed < 6 || turnsUsed > 12;
}

export function buildSystem({ skill, manifest, texts }, block, turnsUsed) {
  const parts = [skill];
  for (const f of manifest.context.always) parts.push(`# Карта пригоди\n${texts[f]}`);
  if (inBossPart(manifest, block)) for (const f of manifest.context.boss) parts.push(texts[f]);
  if (needsInserts(manifest, block, turnsUsed)) parts.push(texts[manifest.context.inserts]);
  const seen = new Set();
  for (const b of reachable(manifest, block)) {
    const def = manifest.blocks[b];
    if (seen.has(def.file)) continue;
    seen.add(def.file);
    const title = b === block ? "ПОТОЧНИЙ БЛОК" : "Сусідній блок (куди можна перейти)";
    parts.push(`# ${title}: ${b}\n${texts[def.file]}\n*Дозволені зображення блоку ${b}:* ${def.images.join(", ")}`);
  }
  return parts.join("\n\n");
}

const S = "STRING", A = "ARRAY", O = "OBJECT", I = "INTEGER", B = "BOOLEAN";
const uniq = (xs) => [...new Set(xs)].sort();

export function buildSchema(manifest, block) {
  const rb = reachable(manifest, block);
  const blocks = manifest.blocks;
  const heroes = Object.keys(manifest.heroes);
  const images = uniq(rb.flatMap((b) => blocks[b].images));
  const items = uniq(rb.flatMap((b) => blocks[b].items));
  const prepared = uniq(rb.flatMap((b) => blocks[b].prepared ?? []));
  const itemTags = Object.keys(manifest.items).map((id) => `item:${id}`);
  const tags = uniq([...Object.keys(blocks), ...BOSS_TAGS, ...itemTags]);
  const phases = Object.entries(blocks).filter(([, b]) => b.boss).map(([id]) => id);
  const listOf = (values) => ({ type: A, items: values.length ? { type: S, enum: values } : { type: S } });
  return {
    type: O,
    properties: {
      // Z-22: consult — гравці уточнюють, план ще не ухвалено (без змін стану, сцени й кидка); act — дія чи рішення.
      mode: { type: S, enum: ["consult", "act"] },
      scene: { type: S, enum: rb },
      participants: { type: A, items: { type: S, enum: heroes } },
      narration: { type: A, items: { type: O, properties: { voice: { type: S, enum: Object.keys(manifest.voices) }, text: { type: S } }, required: ["voice", "text"] } },
      show: listOf(images),
      state_changes: {
        type: O,
        properties: {
          stars_delta: { type: I },
          items_add: listOf(items),
          items_remove: listOf(Object.keys(manifest.items)),
          super_used: { type: A, items: { type: S, enum: heroes } },
          shield_delta: { type: I },
          boss_phase: { type: S, enum: [...phases, "done"] },
          prepared_add: listOf(prepared),
        },
      },
      await: {
        type: O,
        properties: {
          type: { type: S, enum: ["answer", "roll", "end"] },
          hero: { type: S, enum: [...heroes, "both", "any"] },
          roll: {
            type: O,
            properties: {
              kind: { type: S, enum: ["action", "defense"] },
              tags: { type: A, items: { type: S, enum: tags } },
              idea: { type: B },
              plan_step: { type: I },
            },
            required: ["kind", "tags", "idea", "plan_step"],
          },
        },
        required: ["type", "hero"],
      },
      // Обов'язковий заклик до дії (Z-01, Z-09): коротке питання до конкретного героя чи обох; застосунок показує його окремим рядком.
      call_to_action: { type: O, properties: { hero: { type: S, enum: [...heroes, "both", "any"] }, text: { type: S } }, required: ["hero", "text"] },
      gm_note: { type: S },
    },
    required: ["mode", "scene", "participants", "narration", "call_to_action", "show", "state_changes", "await", "gm_note"],
  };
}
