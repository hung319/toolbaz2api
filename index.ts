// =================================================================================
//  Project: toolbaz-2api-headless (Fix Timeout & Stream Crash)
//  Runtime: Bun (v1.3+)
// =================================================================================

const CONFIG = {
  API_KEY: process.env.API_KEY || "1",
  PORT: process.env.PORT || 3000,
  UPSTREAM_DOMAIN: "data.toolbaz.com",
  ORIGIN_DOMAIN: "https://toolbaz.com",
  REFERER_URL: "https://toolbaz.com/",
  USER_AGENT: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
  PROMPT_PREFIX: "Generate an original and engaging piece of writing on the following topic : ",
  PROMPT_SUFFIX: "\u3164", 
  MODELS: ["gemini-2.5-flash", "gemini-2.5-pro", "gpt-5", "claude-sonnet-4"]
};

// --- [Utility Classes] ---
class TokenGenerator {
  static generateRandomString(length) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
  }

  static generatePayloadToken() {
    const payload = {
      nV5kP: CONFIG.USER_AGENT, lQ9jX: "vi", sD2zR: "1536x864", tY4hL: "Asia/Saigon", pL8mC: "Win32", cQ3vD: 24, hK7jN: 12
    };
    const uT4bX = { mM9wZ: [], kP8jY: [] };
    const data = {
      bR6wF: payload, uT4bX: uT4bX, tuTcS: Math.floor(Date.now() / 1000), tDfxy: "null", RtyJt: this.generateRandomString(36)
    };
    const binaryString = Array.from(new TextEncoder().encode(JSON.stringify(data)), c => String.fromCharCode(c)).join("");
    return this.generateRandomString(6) + btoa(binaryString);
  }
}

// --- [Server Logic] ---
console.log(`🚀 Headless API running at http://localhost:${CONFIG.PORT}`);

Bun.serve({
  port: CONFIG.PORT,
  // 🔥 FIX 1: Tăng thời gian chờ (idleTimeout) lên 120s (hoặc cao hơn nếu cần)
  idleTimeout: 120, 
  
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

    try {
      if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
        return await handleChatCompletions(request);
      }
      if (url.pathname === '/v1/models') return handleModelsRequest();

      return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      console.error("Server Error:", err);
      return new Response(JSON.stringify({ error: err.message || "Unknown Error" }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }
});

// --- [Core Logic] ---
async function handleChatCompletions(request) {
  const auth = request.headers.get('Authorization');
  if (!auth || auth !== `Bearer ${CONFIG.API_KEY}`) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  let body;
  try { body = await request.json(); } catch(e) { return new Response("Invalid JSON", { status: 400 }); }
  
  const lastMsg = (body.messages || []).pop()?.content || "Hello";
  const model = body.model || "gemini-2.5-flash";
  const requestId = `chatcmpl-${crypto.randomUUID()}`;
  const finalPrompt = `${CONFIG.PROMPT_PREFIX}${lastMsg}${CONFIG.PROMPT_SUFFIX}`;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // 🔥 Signal để hủy request upstream nếu client ngắt kết nối
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort());

  (async () => {
    try {
      const tokenPayload = TokenGenerator.generatePayloadToken();
      const headers = getHeaders();

      // Step 1: Token
      const tokenRes = await fetch(`https://${CONFIG.UPSTREAM_DOMAIN}/token.php`, {
        method: 'POST', headers, 
        body: new URLSearchParams({ session_id: '', token: tokenPayload }),
        signal: controller.signal
      });
      
      if (!tokenRes.ok) throw new Error(`Token fetch failed: ${tokenRes.status}`);
      const tokenData = await tokenRes.json();
      if (!tokenData.success) throw new Error("Failed to generate token");

      // Step 2: Chat Request
      const chatRes = await fetch(`https://${CONFIG.UPSTREAM_DOMAIN}/writing.php`, {
        method: 'POST', headers,
        body: new URLSearchParams({ text: finalPrompt, capcha: tokenData.token, model, session_id: '' }),
        signal: controller.signal
      });

      if (!chatRes.ok) throw new Error(`Chat API failed: ${chatRes.status}`);

      const rawText = await chatRes.text();
      const cleanText = cleanResponse(rawText);

      // Stream Simulation
      const chunkSize = 20;
      for (let i = 0; i < cleanText.length; i += chunkSize) {
        // 🔥 Kiểm tra nếu writer đã đóng trước khi ghi
        if (request.signal.aborted) break;

        const content = cleanText.slice(i, i + chunkSize);
        const chunk = JSON.stringify({
          id: requestId, object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model,
          choices: [{ index: 0, delta: { content }, finish_reason: null }]
        });
        await writer.write(encoder.encode(`data: ${chunk}\n\n`));
        await new Promise(r => setTimeout(r, 10));
      }

      if (!request.signal.aborted) {
        await writer.write(encoder.encode(`data: [DONE]\n\n`));
      }

    } catch (error) {
      // Log lỗi chi tiết hơn
      if (error.name !== 'AbortError') {
         console.error("Stream Error:", error);
         try {
             const errChunk = JSON.stringify({
                id: requestId, object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model,
                choices: [{ index: 0, delta: { content: `\n[Error: ${error.message || String(error)}]` }, finish_reason: "error" }]
             });
             await writer.write(encoder.encode(`data: ${errChunk}\n\n`));
             await writer.write(encoder.encode(`data: [DONE]\n\n`));
         } catch (writeErr) {
             // Ignore write errors if stream is already dead
         }
      }
    } finally {
      // 🔥 FIX 2: Safe Close - chỉ đóng nếu chưa đóng và bắt lỗi
      try {
        await writer.close();
      } catch (e) {
        // Ignore "Cannot close a writable stream that is closed or errored"
      }
    }
  })();

  return new Response(readable, {
    headers: corsHeaders({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' })
  });
}

// --- [Helpers] ---
function getHeaders() {
  return {
    'Accept': '*/*', 'Accept-Language': 'vi', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Origin': CONFIG.ORIGIN_DOMAIN, 'Referer': CONFIG.REFERER_URL, 'User-Agent': CONFIG.USER_AGENT,
    'sec-ch-ua': '"Chromium";v="142", "Microsoft Edge";v="142", "Not_A Brand";v="99"',
    'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"', 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-site'
  };
}
function cleanResponse(text) {
  return text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').trim();
}
function handleModelsRequest() {
  return new Response(JSON.stringify({ object: 'list', data: CONFIG.MODELS.map(id => ({ id, object: 'model', created: Math.floor(Date.now()/1000), owned_by: 'toolbaz-headless' })) }), { headers: corsHeaders({'Content-Type': 'application/json'}) });
}
function corsHeaders(extra = {}) {
  return { ...extra, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
}
