const { logJSON } = require("./utils");

const SYSTEM_PROMPT = `你是一个词汇助手，帮助中文读者阅读英文数学教材。给定一个英文单词或短语及少量来源信息，只返回 JSON：

{"word":"原词","meaning":"中文翻译","category":"数学术语"|"描述词"|"连接词"|"","note":"一句简短备注"}

分类规则：
- "数学术语"：在数学或科学中有严格专业定义的词汇，或是数学推导中的操作词。
- "描述词"：作者用来评价某个论证、解法、构造之质量或难度的主观判断词，通常为形容词或副词。
- "连接词"：标示句子之间逻辑关系（因果、转折、递进、举例、总结等）的功能词。
- ""：不属于以上三类的任何词，一律返回空字符串。

note 规则：
- 用中文写一句很短的备注，说明这个词在当前来源里为什么值得收录。
- 优先结合 sourceTitle 判断；不要空泛复述翻译。
- 最多 24 个汉字或等价长度。
- 如果信息不足，就给出尽量保守但仍然有用的备注。

只返回 JSON，不要其他文字。`;

async function analyzeWord(input, apiKey, model, logDir) {
  const payload = {
    word: input.word,
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
  const result = JSON.parse(data.choices[0].message.content);
  const validCategories = ["数学术语", "描述词", "连接词"];
  if (!validCategories.includes(result.category)) result.category = "";
  result.note = String(result.note || "").replace(/\s+/g, " ").trim().slice(0, 80);
  logJSON(logDir, "analyze_word", {
    request: payload,
    response: { result, raw: data.choices[0].message.content },
  });
  return result;
}

module.exports = { analyzeWord };
