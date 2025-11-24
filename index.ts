// =================================================================================
//  Project: toolbaz-2api-headless
//  Mode: DEEP DEBUG (Log everything: Headers, Payloads, Raw Responses)
// =================================================================================

const CONFIG = {
  API_KEY: process.env.API_KEY || "1",
  PORT: process.env.PORT || 3000,
  UPSTREAM_DOMAIN: "data.toolbaz.com",
  ORIGIN_DOMAIN: "https://toolbaz.com",
  REFERER_URL: "https://toolbaz.com/",
  USER_AGENT: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
  // Prompt wrapper
  PROMPT_PREFIX: "Generate an original and engaging piece of writing on the following topic : ",
  PROMPT_SUFFIX: "\u3164", 
};

// --- [Colors for Visibility] ---
const C = {
  R: "\x1b[31m", G: "\x1b[32m", Y: "\x1b[33m", B: "\x1b[34m", DIM: "\x1b[2m", RST: "\x1b[0m", CYAN: "\x1b[36m"
};

function log(step, data) {
  console.log(`${C.CYAN}[${new Date().toLocaleTimeString()}]${C.RST} ${C.B}[${step}]${C.RST}`);
  if (typeof data === 'string') console.log(data);
  else console.log(JSON.stringify(data, null, 2));
  console.log(C.DIM + "-".repeat(50) + C.RST);
}

// --- [Token Logic] ---
class TokenGenerator {
  static generateRandomString(len) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let res = ""; for (let i = 0; i < len; i++) res += chars.charAt(Math.floor(Math.random() * chars.length)); return res;
  }
  static generatePayloadToken() {
    const payload = {
      nV5kP: CONFIG.USER_AGENT, lQ9jX: "vi", sD2zR: "1536x864", tY4hL: "Asia/Saigon", pL8mC: "Win32", cQ3vD: 24, hK7jN: 12
    };
    const data = {
      bR6wF: payload, uT4bX: { mM9wZ: [], kP8jY: [] }, tuTcS: Math.floor(Date.now() / 1000), tDfxy: "null", RtyJt: this.generateRandomString(36)
    };
    const bin = Array.from(new TextEncoder().encode(JSON.stringify(data)), c => String.fromCharCode(c)).join("");
    return this.generateRandomString(6) + btoa(bin);
  }
}

// --- [Server] ---
console.log(`${C.G}🚀 DEBUG Server running at http://localhost:${CONFIG.PORT}${C.RST}`);

Bun.serve({
  port: CONFIG.PORT,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
    
    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      return await handleDebugChat(req);
    }
    return new Response("Not Found", { status: 404 });
  }
});

// --- [Debug Handler] ---
async function handleDebugChat(req) {
  const requestId = TokenGenerator.generateRandomString(4);
  console.log(`\n${C.G}=== NEW REQUEST [${requestId}] ===${C.RST}`);

  // 1. Check Auth
  const auth = req.headers.get('Authorization');
  if (auth !== `Bearer ${CONFIG.API_KEY}`) {
    log("AUTH", "Failed");
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Parse Input
  let body;
  try { body = await req.json(); } catch(e) { return new Response("Bad JSON", { status: 400 }); }
  const lastMsg = (body.messages || []).pop()?.content || "";
  const finalPrompt = `${CONFIG.PROMPT_PREFIX}${lastMsg}${CONFIG.PROMPT_SUFFIX}`;
  
  log("INPUT", { model: body.model, promptLength: finalPrompt.length });

  // 3. Prepare Stream
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // 4. Execute Async
  (async () => {
    try {
      const headers = {
        'Accept': '*/*', 
        'Accept-Language': 'vi', 
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

      // --- STEP A: TOKEN ---
      const localToken = TokenGenerator.generatePayloadToken();
      log("STEP A: Local Token Generated", localToken.substring(0, 30) + "...");

      const tokenUrl = `https://${CONFIG.UPSTREAM_DOMAIN}/token.php`;
      const tokenBody = new URLSearchParams();
      tokenBody.append('session_id', '');
      tokenBody.append('token', localToken);

      log("STEP A: Sending Request", { url: tokenUrl, body: tokenBody.toString() });

      const tokenRes = await fetch(tokenUrl, {
        method: 'POST', headers: headers, body: tokenBody
      });

      const tokenRaw = await tokenRes.text();
      log("STEP A: Response", { status: tokenRes.status, rawBody: tokenRaw });

      if (!tokenRes.ok) throw new Error(`Token HTTP ${tokenRes.status}`);
      
      let tokenData;
      try { tokenData = JSON.parse(tokenRaw); } catch(e) { throw new Error("Token Response is NOT JSON (Likely HTML Block)"); }
      
      if (!tokenData.success) throw new Error(`Token API refused: ${JSON.stringify(tokenData)}`);

      // --- STEP B: CHAT ---
      const chatUrl = `https://${CONFIG.UPSTREAM_DOMAIN}/writing.php`;
      const chatBody = new URLSearchParams();
      chatBody.append('text', finalPrompt);
      chatBody.append('capcha', tokenData.token);
      chatBody.append('model', body.model || "gemini-2.5-flash");
      chatBody.append('session_id', '');

      log("STEP B: Sending Chat", { url: chatUrl, model: body.model });

      const chatRes = await fetch(chatUrl, {
        method: 'POST', headers: headers, body: chatBody
      });

      const chatRaw = await chatRes.text();
      // Log 200 ký tự đầu tiên để xem có phải lỗi không
      log("STEP B: Response", { status: chatRes.status, preview: chatRaw.substring(0, 200) + "..." });

      if (!chatRes.ok) throw new Error(`Chat HTTP ${chatRes.status}`);

      const cleanText = chatRaw.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').trim();

      if (cleanText.includes("Session ID is invalid") || cleanText.length < 2) {
        log("ERROR", "Detected Invalid Session or Empty Response in body");
        throw new Error("Upstream rejected session or returned empty");
      }

      // --- STEP C: STREAM ---
      const chunk = JSON.stringify({
          id: `chatcmpl-${requestId}`, object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: body.model,
          choices: [{ index: 0, delta: { content: cleanText }, finish_reason: null }]
      });
      await writer.write(encoder.encode(`data: ${chunk}\n\n`));
      await writer.write(encoder.encode(`data: [DONE]\n\n`));
      log("SUCCESS", "Stream Sent");

    } catch (err) {
      log(`${C.R}FATAL ERROR${C.RST}`, err.message);
      const errChunk = JSON.stringify({
          id: `err-${requestId}`, object: 'chat.completion.chunk', created: Math.floor(Date.now()/1000), model: body.model,
          choices: [{ index: 0, delta: { content: `\n[DEBUG ERROR]: ${err.message}` }, finish_reason: "error" }]
       });
       try { await writer.write(encoder.encode(`data: ${errChunk}\n\n`)); await writer.write(encoder.encode(`data: [DONE]\n\n`)); } catch(e){}
    } finally {
      try { await writer.close(); } catch(e){}
    }
  })();

  return new Response(readable, { headers: corsHeaders({'Content-Type': 'text/event-stream'}) });
}

function corsHeaders(extra={}) {
  return { ...extra, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
}
