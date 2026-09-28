const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

async function getProviderConfig() {
  const stored = await chrome.storage.sync.get(["anthropicApiKey", "claudeModel"]);
  return {
    apiKey: stored.anthropicApiKey || "",
    model: stored.claudeModel || DEFAULT_CLAUDE_MODEL,
  };
}

function anthropicHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    // Required for direct requests from a browser/extension context (enables CORS).
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

function extractText(data) {
  if (!Array.isArray(data?.content)) return "";
  return data.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("")
    .trim();
}

async function getAiAnswer(question, answers, apiKey) {
  const cfg = await getProviderConfig();
  const effectiveKey = apiKey || cfg.apiKey;
  if (!effectiveKey) {
    return "Error: Anthropic API Key not available. Please set it in the extension popup.";
  }

  let prompt = `Given the following multiple-choice question and its possible answers, please choose the best answer(s).
If the question implies multiple correct answers (e.g., 'select all that apply', 'choose N correct options'), return ALL chosen answer texts, each on a new line.
Otherwise, if it's a single-choice question, return only the text of the single best chosen answer option.
Do not add any extra explanation or leading text like "The best answer is: ".

Question:
${question}

Possible Answers:
`;
  answers.forEach((ans, i) => {
    prompt += `${i + 1}. ${ans}\n`;
  });

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: anthropicHeaders(effectiveKey),
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Anthropic API Error:", errorData);
      return `Error calling Anthropic API: ${response.status} ${response.statusText}.`;
    }
    const data = await response.json();
    const text = extractText(data);
    if (!text) {
      console.error("Unexpected Anthropic response:", data);
      return "Error: Could not extract answer from Claude response.";
    }
    return text;
  } catch (error) {
    console.error("Error fetching from Anthropic API:", error);
    return "Error connecting to Anthropic API. Check console.";
  }
}

function buildBatchPrompt(questionsDataArray) {
  let prompt =
    "You will be provided with a JSON array of questions. Most are multiple-choice; some are MATCHING questions (their text starts with 'MATCHING QUESTION.').\n";
  prompt +=
    "For multiple-choice: choose the best answer(s) from 'possible_answers'. If 'select all that apply' / 'choose N', concatenate all correct answer texts separated by ' /// ' (space, three slashes, space). Otherwise return single answer text.\n";
  prompt +=
    "For MATCHING questions: read the embedded Categories and Options. Return the answer as 'A: <option text> /// B: <option text> /// ...' in CATEGORY ORDER (A, B, C, D, ...), using the EXACT option text from the question.\n";
  prompt +=
    "Return a single JSON array of strings, one per input question, in input order. No extra explanation, no leading/trailing text.\n";
  prompt +=
    'Example output: ["Text of MCQ answer", "Answer A /// Answer C", "A: option text for A /// B: option text for B /// C: option text for C /// D: option text for D"].\n\n';
  prompt += "Here are the questions:\n```json\n";
  const questionsForPrompt = questionsDataArray.map((q, index) => ({
    id: `question_${index + 1}`,
    question_text: q.question,
    possible_answers: q.answers,
  }));
  prompt += JSON.stringify(questionsForPrompt, null, 2);
  prompt += "\n```";
  return prompt;
}

function parseBatchAnswers(rawText, expectedCount) {
  let txt = rawText.trim();
  const fence = txt.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) txt = fence[1];
  let parsed;
  try {
    parsed = JSON.parse(txt);
  } catch (e) {
    return { error: "Error: Could not parse AI response for batch. Raw: " + rawText };
  }
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
    return { error: "Error: AI response was not a valid JSON array of answer strings." };
  }
  if (parsed.length !== expectedCount) {
    return { error: "Error: Mismatch in number of answers from AI.", answers: parsed };
  }
  return { answers: parsed };
}

async function getAiAnswersForBatch(questionsDataArray, apiKey) {
  const cfg = await getProviderConfig();
  const effectiveKey = apiKey || cfg.apiKey;
  if (!effectiveKey) {
    return { error: "Error: Anthropic API Key not available. Please set it in the extension popup." };
  }
  if (!questionsDataArray || questionsDataArray.length === 0) {
    return { answers: [] };
  }

  const prompt = buildBatchPrompt(questionsDataArray);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: anthropicHeaders(effectiveKey),
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 4096,
        system:
          "You are a precise answer-extraction assistant. You respond with only a JSON array of answer strings and nothing else.",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Anthropic Batch Error:", errorData);
      return {
        error: `Error calling Anthropic API: ${response.status} ${response.statusText}. Details: ${JSON.stringify(errorData)}`,
      };
    }
    const data = await response.json();
    const text = extractText(data);
    if (!text) {
      console.error("Unexpected Anthropic batch response:", data);
      return { error: "Error: Could not extract answers from Claude batch response." };
    }
    return parseBatchAnswers(text, questionsDataArray.length);
  } catch (error) {
    console.error("Error fetching from Anthropic batch API:", error);
    return { error: "Error connecting to Anthropic API for batch. Check console." };
  }
}
