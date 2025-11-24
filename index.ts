// =================================================================================
//  Project: toolbaz-2api-openai-standard
//  Status: FIXED (IdleTimeout 255s | No ANSI Colors)
// =================================================================================

const CONFIG = {
  API_KEY: process.env.API_KEY || "sk-toolbaz-free",
  PORT: process.env.PORT || 3000,
  UPSTREAM_DOMAIN: "data.toolbaz.com",
  ORIGIN_DOMAIN: "https://toolbaz.com",
  REFERER_URL: "https://toolbaz.com/",
  USER_AGENT: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
  PROMPT_PREFIX: "Generate an original and engaging piece of writing on the following topic : ",
  PROMPT_SUFFIX: "\u3164", 
};

// --- [Logger - Clean No Colors] ---
// Đã loại bỏ các mã màu gây lỗi hiển thị
const C = { G: "", Y: "", B: "", RST: "" };

function log(id, msg, time) {
  const t = time ? ` (${time.toFixed(0)}ms)` : '';
  console.log(`[${new Date().toLocaleTimeString()}] [${id}] ${msg}${t}`);
}

// --- [Token Logic] ---
class TokenGenerator {
  static generateRandomString(len) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let res = ""; for (let i = 0; i < len; i++) res += chars.charAt(Math.floor(Math.random() * chars.length)); return res;
  }
  static generatePayloadToken() {
    const payload = { nV5kP: CONFIG.USER_AGENT, lQ9jX: "vi", sD2zR: "1536x864", tY4hL: "Asia/Saigon", pL8mC: "Win32", cQ3vD: 24, hK7jN: 12 };
    const data = { bR6wF: payload, uT4bX: { mM9wZ: [], kP8jY: [] }, tuTcS: Math.floor(Date.now() / 1000), tDfxy: "null", RtyJt: this.generateRandomString(36) };
    const bin = Array.from(new TextEncoder().encode(JSON.stringify(data)), c => String.fromCharCode(c)).join("");
    return this.generateRandomString(6) + btoa(bin);
  }
}

// --- [Server Entry] ---
console.log(`🚀 OpenAI Compatible Server running at http://localhost:${CONFIG.PORT}`);

Bun.serve({
  port: CONFIG.PORT,
  idleTimeout: 255, // Max value for Bun
  
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
    
    try {
      if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
        return await handleChat(req);
      }
      if (url.pathname === '/v1/models') {
        return handleModels();
      }
      return new Response(JSON.stringify({ error: { message: "Not Found", type: "invalid_request_error", param: null, code: "404" } }), { status: 404, headers: corsHeaders({'Content-Type': 'application/json'}) });
    } catch (e) {
      console.error(e);
      return new Response(JSON.stringify({ error: { message: e.message, type: "server_error", param: null, code: "500" } }), { status: 500, headers: corsHeaders({'Content-Type': 'application/json'}) });
    }
  }
});

// --- [Main Handler] ---
async function handleChat(req) {
  const reqId = "chatcmpl-" + TokenGenerator.generateRandomString(24);
  
  // 1. Auth & Parse
  const auth = req.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
     return new Response(JSON.stringify({ error: { message: "Missing API Key", type: "invalid_request_error", code: "401" } }), { status: 401 });
  }

  let body;
  try { body = await req.json(); } catch(e) { return new Response("Bad JSON", { status: 400 }); }
  
  const lastMsg = (body.messages || []).pop()?.content || "";
  const model = body.model || "gemini-2.5-flash";
  const isStream = body.stream === true;
  const finalPrompt = `${CONFIG.PROMPT_PREFIX}${lastMsg}${CONFIG.PROMPT_SUFFIX}`;

  log(reqId.substring(0,8), `Mode: ${isStream ? 'STREAM' : 'JSON'} | Model: ${model}`);

  // 2. Fetch Logic (Upstream)
  try {
    const headers = {
        'Accept': '*/*', 'Accept-Language': 'vi', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Origin': CONFIG.ORIGIN_DOMAIN, 'Referer': CONFIG.REFERER_URL, 'User-Agent': CONFIG.USER_AGENT,
        'sec-ch-ua': '"Chromium";v="142", "Microsoft Edge";v="142", "Not_A Brand";v="99"',
        'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"', 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-site'
    };

    // Step A: Token
    const t1 = performance.now();
    const tokenRes = await fetch(`https://${CONFIG.UPSTREAM_DOMAIN}/token.php`, {
      method: 'POST', headers, 
      body: new URLSearchParams({ session_id: '', token: TokenGenerator.generatePayloadToken() })
    });
    if (!tokenRes.ok) throw new Error("Upstream Token Error");
    const tokenData = await tokenRes.json();
    if (!tokenData.success) throw new Error("Upstream Token Rejected");

    // Step B: Chat
    const t2 = performance.now();
    const chatRes = await fetch(`https://${CONFIG.UPSTREAM_DOMAIN}/writing.php`, {
      method: 'POST', headers,
      body: new URLSearchParams({ text: finalPrompt, capcha: tokenData.token, model, session_id: '' })
    });
    if (!chatRes.ok) throw new Error("Upstream Chat Error");
    
    const rawText = await chatRes.text();
    const cleanText = rawText.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').trim();

    if (cleanText.length < 2 || cleanText.includes("Session ID is invalid")) throw new Error("Empty/Invalid Response from Provider");
    
    log(reqId.substring(0,8), `Got Content (${cleanText.length} chars)`, performance.now() - t2);

    const created = Math.floor(Date.now() / 1000);

    // === MODE 1: JSON (Non-Streaming) ===
    if (!isStream) {
        const usage = {
            prompt_tokens: Math.ceil(lastMsg.length / 4),
            completion_tokens: Math.ceil(cleanText.length / 4),
            total_tokens: Math.ceil((lastMsg.length + cleanText.length) / 4)
        };
        
        const responseData = {
            id: reqId,
            object: "chat.completion",
            created: created,
            model: model,
            choices: [{
                index: 0,
                message: { role: "assistant", content: cleanText },
                logprobs: null,
                finish_reason: "stop"
            }],
            usage: usage,
            system_fingerprint: "fp_toolbaz_bun"
        };
        
        return new Response(JSON.stringify(responseData), { headers: corsHeaders({'Content-Type': 'application/json'}) });
    }

    // === MODE 2: STREAMING (SSE) ===
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
        try {
            // Chunk 1: Role
            const roleChunk = {
                id: reqId, object: 'chat.completion.chunk', created, model,
                choices: [{ index: 0, delta: { role: 'assistant', content: "" }, finish_reason: null }]
            };
            await writer.write(encoder.encode(`data: ${JSON.stringify(roleChunk)}\n\n`));

            // Chunks 2...N: Content
            const chunkSize = 15; 
            for (let i = 0; i < cleanText.length; i += chunkSize) {
                const chunkContent = cleanText.slice(i, i + chunkSize);
                const contentChunk = {
                    id: reqId, object: 'chat.completion.chunk', created, model,
                    choices: [{ index: 0, delta: { content: chunkContent }, finish_reason: null }]
                };
                await writer.write(encoder.encode(`data: ${JSON.stringify(contentChunk)}\n\n`));
                await new Promise(r => setTimeout(r, 10));
            }

            // Chunk Last: Finish Reason
            const endChunk = {
                id: reqId, object: 'chat.completion.chunk', created, model,
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
            };
            await writer.write(encoder.encode(`data: ${JSON.stringify(endChunk)}\n\n`));
            await writer.write(encoder.encode(`data: [DONE]\n\n`));

        } catch (e) {
            console.error(e);
        } finally {
            try { await writer.close(); } catch(e){}
        }
    })();

    return new Response(readable, { headers: corsHeaders({'Content-Type': 'text/event-stream'}) });

  } catch (err) {
    log(reqId.substring(0,8), `ERROR: ${err.message}`);
    return new Response(JSON.stringify({ error: { message: err.message, type: "upstream_error", code: "502" } }), { status: 502, headers: corsHeaders({'Content-Type': 'application/json'}) });
  }
}

// --- [Helpers] ---
function handleModels() {
    const models = ["gemini-2.5-flash", "gemini-2.5-pro", "gpt-5", "claude-sonnet-4"];
    const data = models.map(m => ({
        id: m, object: "model", created: 1677610602, owned_by: "toolbaz"
    }));
    return new Response(JSON.stringify({ object: "list", data }), { headers: corsHeaders({'Content-Type': 'application/json'}) });
}

function corsHeaders(extra={}) {
  return { ...extra, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
}
