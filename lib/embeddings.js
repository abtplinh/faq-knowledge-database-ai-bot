// lib/embeddings.js

/**
 * Embed a single query string → float[] (768-dim for Gemini)
 * Using native fetch to explicitly set outputDimensionality to match DB.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embedQuery(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${process.env.GEMINI_API_KEY}`;
  
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/gemini-embedding-001",
      content: { parts: [{ text: String(text || "").slice(0, 7500) }] },
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: 768, // Bắt buộc phải là 768 để khớp với DB
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini Embedding Error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.embedding.values;
}
