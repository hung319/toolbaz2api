// =================================================================================
//  Project: toolbaz-2api-headless
//  Runtime: Bun (v1.1+)
//  Update: Based on provided CURL (No UI, No TDF, Empty SessionID)
// =================================================================================

const CONFIG = {
  // Key bảo vệ API riêng của bạn (Header: Authorization: Bearer ...)
  API_KEY: process.env.API_KEY || "1",
  
  PORT: process.env.PORT || 3000,
  UPSTREAM_DOMAIN: "data.toolbaz.com",
  ORIGIN_DOMAIN: "https://toolbaz.com",
  REFERER_URL: "https://toolbaz.com/",
  
  // Updated User-Agent from your curl
  USER_AGENT: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
  
  // Prompt wrapper to bypass checks (from curl)
  PROMPT_PREFIX: "Generate an original and engaging piece of writing on the following topic : ",
  PROMPT_SUFFIX: "\u3164", // Hangul Filler

  MODELS: ["gemini-2.5-flash", "gemini-2.5-pro", "gpt-5", "claude-sonnet-4"]
};

// --- [Utility Classes] ---

class TokenGenerator {
  static generateRandomString(length) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  static generatePayloadToken() {
    // Cấu trúc payload dựa trên request curl mẫu
    const payload = {
      nV5kP: CONFIG.USER_AGENT,
      lQ9jX: "vi",            // Language based on curl
      sD2zR: "1536x864",      // Resolution based on curl
      tY4hL: "Asia/Saigon",   // Timezone based on curl
      pL8mC: "Win32",
      cQ3vD: 24,
      hK7jN: 12
    };
    
    const uT4bX = { mM9wZ: [], kP8jY: [] };

    const data = {
      bR6wF: payload,
      uT4bX: uT4bX,
      tuTcS: Math.floor(Date.now() / 1000), // Current timestamp
      tDfxy: "null",                        // From curl: fixed "null"
      RtyJt: this.generateRandomString(36)  // Random hash
    };
    
    const jsonStr = JSON.stringify(data);
    const utf8Bytes = new TextEncoder().encode(jsonStr);
    let binaryString = "";
    for (let i = 0; i < utf8Bytes.length; i++) {
      binaryString += String.fromCharCode(utf8Bytes[i]);
    }
    
    // Prefix 6 chars + Base64
    return this.generateRandomString(6) + btoa(binaryString);
  }
}

// --- [Server Logic] ---

console.log(`🚀 Headless API running at http://localhost:${CONFIG.PORT}`);

Bun.serve({
  port: CONFIG.PORT,
  async fetch(request) {
    const url = new URL(request.url);

    // CORS Handling
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      // 1. Chat Completions Endpoint
      if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
        return await handleChatCompletions(request);
      }
      
      // 2. Models Endpoint
      if (url.pathname === '/v1/models') {
        return handleModelsRequest();
      }

      // 404 for root/UI (UI removed as requested)
      return new Response(JSON.stringify({ error: "Not Found. This is a headless API." }), { 
        status: 404, 
        headers: { 'Content-Type': 'application/json' } 
      });

    } catch (err) {
      console.error("Server Error:", err);
      return new Response(JSON.stringify({ error: err.message }), { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
  }
});

// --- [Core Logic] ---

async function handleChatCompletions(request) {
  // 1. Auth Check
  const auth = request.headers.get('Authorization');
  if (!auth || auth !== `Bearer ${CONFIG.API_KEY}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  // 2. Parse Body
  let body;
  try { body = await request.json(); } catch(e) { return new Response("Invalid JSON", { status: 400 }); }
  
  const userMessages = body.messages || [];
  const lastMsg = userMessages[userMessages.length - 1]?.content || "Hello";
  const model = body.model || "gemini-2.5-flash";
  const requestId = `chatcmpl-${crypto.randomUUID()}`;

  // 3. Prepare Prompt (Inject Prefix/Suffix)
  // Toolbaz expects a specific prompt format to work consistently
  const finalPrompt = `${CONFIG.PROMPT_PREFIX}${lastMsg}${CONFIG.PROMPT_SUFFIX}`;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // 4. Async Execution (Fire and Forget)
  (async () => {
    try {
      // Step A: Generate Local Token (No HTTP call needed for TDF anymore)
      const tokenPayload = TokenGenerator.generatePayloadToken();

      // Step B: Exchange Token (The "Handshake")
      // Note: session_id is empty in your curl
      const tokenBody = new URLSearchParams();
      tokenBody.append('session_id', ''); 
      tokenBody.append('token', tokenPayload);

      const tokenRes = await fetch(`https://${CONFIG.UPSTREAM_DOMAIN}/token.php`, {
        method: 'POST',
        headers: getHeaders(),
        body: tokenBody
      });

      if (!tokenRes.ok) throw new Error(`Token fetch failed: ${tokenRes.status}`);
      const tokenData = await tokenRes.json();
      if (!tokenData.success) throw new Error("Failed to generate server token");

      const serverToken = tokenData.token;

      // Step C: Send Chat Request
      const chatBody = new URLSearchParams();
      chatBody.append('text', finalPrompt);
      chatBody.append('capcha', serverToken);
      chatBody.append('model', model);
      chatBody.append('session_id', ''); // Empty session_id

      const chatRes = await fetch(`https://${CONFIG.UPSTREAM_DOMAIN}/writing.php`, {
        method: 'POST',
        headers: getHeaders(),
        body: chatBody
      });

      if (!chatRes.ok) throw new Error(`Chat API failed: ${chatRes.status}`);

      // Step D: Stream Response
      // Toolbaz returns raw text/html, not a stream. We simulate a stream for the client.
      const rawText = await chatRes.text();
      const cleanText = cleanResponse(rawText);

      // Simple streaming simulation
      const chunkSize = 20;
      for (let i = 0; i < cleanText.length; i += chunkSize) {
        const content = cleanText.slice(i, i + chunkSize);
        const chunk = {
          id: requestId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now()/1000),
          model: model,
          choices: [{ index: 0, delta: { content }, finish_reason: null }]
        };
        await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        await new Promise(r => setTimeout(r, 10)); // Tiny delay for feel
      }

      await writer.write(encoder.encode(`data: [DONE]\n\n`));

    } catch (error) {
      console.error("Stream Error:", error);
      const errChunk = {
        id: requestId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now()/1000),
        model: model,
        choices: [{ index: 0, delta: { content: `\n[Error: ${error.message}]` }, finish_reason: "error" }]
      };
      await writer.write(encoder.encode(`data: ${JSON.stringify(errChunk)}\n\n`));
      await writer.write(encoder.encode(`data: [DONE]\n\n`));
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: corsHeaders({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    })
  });
}

// --- [Helpers] ---

function getHeaders() {
  return {
    'Accept': '*/*',
    'Accept-Language': 'vi', // Changed to 'vi' per request
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Origin': CONFIG.ORIGIN_DOMAIN,
    'Referer': CONFIG.REFERER_URL,
    'User-Agent': CONFIG.USER_AGENT,
    'sec-ch-ua': '"Chromium";v="142", "Microsoft Edge";v="142", "Not_A Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site'
  };
}

function cleanResponse(text) {
  // Basic HTML cleaning if upstream returns HTML tags
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function handleModelsRequest() {
  return new Response(JSON.stringify({
    object: 'list',
    data: CONFIG.MODELS.map(id => ({
      id, object: 'model', created: Math.floor(Date.now()/1000), owned_by: 'toolbaz-headless'
    }))
  }), { headers: corsHeaders({'Content-Type': 'application/json'}) });
}

function corsHeaders(extra = {}) {
  return {
    ...extra,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}
