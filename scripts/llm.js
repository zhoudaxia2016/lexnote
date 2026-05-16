const { logJSON } = require("./utils");

const SYSTEM_PROMPT = `你是一个词汇助手，帮助中文读者阅读英文数学教材。给定一个英文单词或短语，只返回 JSON：

{"word":"原词","meaning":"中文翻译","category":"数学术语"|"描述词"|"连接词"|""}

分类规则：
- "数学术语"：在数学或科学中有严格专业定义的词汇，或是数学推导中的操作词。
- "描述词"：作者用来评价某个论证、解法、构造之质量或难度的主观判断词，通常为形容词或副词。
- "连接词"：标示句子之间逻辑关系（因果、转折、递进、举例、总结等）的功能词。
- ""：不属于以上三类的任何词，一律返回空字符串。

只返回 JSON，不要其他文字。`;

async function analyzeWord(word, apiKey, model, logDir) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: word },
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
  logJSON(logDir, "analyze_word", {
    request: { word },
    response: { result, raw: data.choices[0].message.content },
  });
  return result;
}

module.exports = { analyzeWord };
