const { logJSON } = require("./utils");

const VALID_CATEGORIES = ["数学术语", "描述词", "连接词"];
const VALID_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

const SYSTEM_PROMPT = `你是一个阅读助手，帮助中文读者阅读英文数学教材。给定用户选中的英文片段（可以是单词、短语、半句或整句）及来源信息，只返回 JSON：

{
  "translation": "整句或整段的自然中文翻译",
  "items": [
    {
      "word": "候选收录词或短语",
      "type": "word 或 phrase",
      "meaning": "当前语境下的中文意思",
      "category": "数学术语"|"描述词"|"连接词"|"",
      "note": "简短备注",
      "level": "A1"|"A2"|"B1"|"B2"|"C1"|"C2"
    }
  ]
}

总规则：
- translation 要优先保证读者能直接看懂当前选中内容在文中的意思。
- items 用来给出候选词/短语解释；允许既有 word 也有 phrase。
- 只返回 JSON，不要其他文字。

translation 规则：
- 如果用户选中的是完整句子或接近完整句子，就给整句自然中文。
- 如果用户选中的是短语或半句，就给该片段在原文里的自然中文。
- 不要逐词硬译，优先中文自然表达。

items 规则：
- 至少覆盖对理解当前片段有帮助的词；必要时补充固定短语。
- word 用最终适合记忆或收录的形式：普通动词尽量还原原形，普通名词复数尽量还原单数。
- phrase 用固定表达或真正需要整体理解的短语，不要把整句机械塞成一个 phrase。
- 如果给了 phrase，且其中包含值得单独记忆、单独收录的实词，必须同时给出对应的 word 项；不要只给短语不给核心单词。
- 只有当短语里的单词都过于基础、单独收录价值很低时，才可以只给 phrase。
- type 只能是 "word" 或 "phrase"。
- meaning 是当前语境下的意思，不是词典里最常见义的堆砌。
- category 只在明显符合时填写，否则返回空字符串。

category 规则：
- "数学术语"：在数学或科学中有严格专业定义的词汇，或是数学推导中的操作词。
- "描述词"：作者用来评价某个论证、解法、构造之质量、性质或难度的词，通常为形容词、副词，或在句中起评价作用的动词。
- "连接词"：标示句子之间逻辑关系（因果、转折、递进、举例、总结等）的功能词或短语。
- ""：不属于以上三类时返回空字符串。

note 规则：
- 用中文写一句很短的备注，帮助读者想起这个词/短语在当前片段里的特殊用法。
- 优先说明：数学语境里的含义、句中作用、与日常义的差别、固定搭配的整体意思。
- 不要写来源介绍、频率判断、收录理由、流程说明。
- 如果没有特别值得提示的点，可以返回空字符串。
- 最多 18 个汉字或等价长度。

level 规则：
- 用 CEFR 的 A1~C2 作为稳定等级。
- A1/A2：基础常见词或极常见表达。
- B1/B2：一般学术阅读中常见，但仍可能构成理解障碍。
- C1/C2：高级、低频、抽象或需要较强语境能力才能掌握的词/短语。
- 先按词/短语本身在一般英语中的难度定级，再参考当前语境是否会显著增加理解难度；不要随意漂移。

示例：
- "given the inclination" -> translation: "如果愿意的话", item: { word: "given the inclination", type: "phrase", meaning: "如果愿意的话", category: "", note: "固定表达，不按字面理解", level: "C1" }
- "given the inclination" -> 同时还应给出 { word: "inclination", type: "word", meaning: "意愿；倾向", category: "", note: "这里指意愿，不是倾斜", level: "B2" }
- "insight" -> item: { word: "insight", type: "word", meaning: "洞见；深入理解", category: "", note: "这里更接近看清问题结构", level: "B2" }
- "recurrence" -> item: { word: "recurrence", type: "word", meaning: "递归；递推", category: "数学术语", note: "指递推关系或递归定义", level: "B2" }`;

function normalizeItem(item) {
  if (!item || typeof item !== "object") return null;
  const type = item.type === "phrase" ? "phrase" : "word";
  const category = VALID_CATEGORIES.includes(item.category) ? item.category : "";
  const level = VALID_LEVELS.includes(item.level) ? item.level : "B2";
  const word = String(item.word || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const meaning = String(item.meaning || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const note = String(item.note || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!word || !meaning) return null;
  return { word, type, meaning, category, note, level };
}

async function analyzeSelection(input, apiKey, model, logDir) {
  const payload = {
    rawText: input.rawText,
    normalizedText: input.normalizedText,
    sourceTitle: input.sourceTitle || "",
    sourceUrl: input.sourceUrl || "",
  };
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(payload, null, 2) },
  ];
  const reqBody = {
    model: model || "deepseek-v4-flash",
    messages,
    response_format: { type: "json_object" },
    temperature: 0.1,
  };
  const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(reqBody),
  });
  const data = await resp.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  const translation = String(parsed.translation || payload.normalizedText || payload.rawText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items = rawItems.map(normalizeItem).filter(Boolean);
  const result = { translation, items };
  logJSON(logDir, "analyze_selection", {
    request: payload,
    response: { result, raw: data.choices[0].message.content },
  });
  return result;
}

module.exports = { analyzeSelection, VALID_CATEGORIES, VALID_LEVELS };
