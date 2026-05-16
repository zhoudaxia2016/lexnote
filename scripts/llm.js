const { logJSON } = require("./utils");

const SYSTEM_PROMPT = `你是一个词汇助手，帮助中文读者阅读英文数学教材。给定原始选中文本、程序归一化候选词及少量来源信息，只返回 JSON：

{"word":"原词","meaning":"中文翻译","category":"数学术语"|"描述词"|"连接词"|"","note":"一句简短备注"}

word 规则：
- 输出最终应该收录到生词表中的词形。
- 优先参考 candidateWord，但如果 rawWord 显示它应保留大写、连字符或专有名词形式，可以修正。
- 若是普通句首大写或普通全大写词，通常改回正常小写。
- 若是缩写、专有名词、人名、术语固定写法，可保留原样或合适大小写。

分类规则：
- "数学术语"：在数学或科学中有严格专业定义的词汇，或是数学推导中的操作词。
- "描述词"：作者用来评价某个论证、解法、构造之质量或难度的主观判断词，通常为形容词或副词。
- "连接词"：标示句子之间逻辑关系（因果、转折、递进、举例、总结等）的功能词。
- ""：不属于以上三类的任何词，一律返回空字符串。

note 规则：
- 用中文写一句很短的备注，帮助用户过段时间回看时迅速想起这个词在阅读中的具体用法或易错点。
- 备注必须具体、有区分度，优先说明：在数学语境里的含义、句中作用、与日常义的差别、容易误解的点。
- 不要写来源介绍、频率判断、收录理由说明、流程说明。
- 不要描述“这本书里常见/经常出现/值得收录/因断词才收录”这类元信息。
- 不要只给词性或泛化标签，如“常见动词”“常见形容词”；要改写成这个词本身在阅读中的语义提示。
- 不要解释收录过程，不要评价这本书，不要重复来源信息。
- 如果只能想到空泛备注，就改写成更短的语义提示；仍然没有有效信息时，返回空字符串。
- 最多 18 个汉字或等价长度，尽量像词典边注，而不是完整句子。

note 示例：
- recurrent -> "表反复出现，不只是重复"
- investigated -> "表对对象作详细考察"
- assuming -> "证明里表示先作假设"

只返回 JSON，不要其他文字。`;

async function analyzeWord(input, apiKey, model, logDir) {
  const payload = {
    rawWord: input.rawWord,
    candidateWord: input.candidateWord,
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
  result.word = String(result.word || input.candidateWord || input.rawWord || "").trim();
  if (!validCategories.includes(result.category)) result.category = "";
  result.note = String(result.note || "").replace(/\s+/g, " ").trim().slice(0, 80);
  logJSON(logDir, "analyze_word", {
    request: payload,
    response: { result, raw: data.choices[0].message.content },
  });
  return result;
}

module.exports = { analyzeWord };
