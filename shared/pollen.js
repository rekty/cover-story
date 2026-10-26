// Bring Your Own Pollen for a static page: the device flow needs no redirect,
// no app secret and no backend, so every request spends the reader's own key.
(function () {
  const GEN = "https://gen.pollinations.ai";
  const ENTER = "https://enter.pollinations.ai";
  const MODEL = "openai/gpt-5.4-nano";

  // Empty unless the owner registers an App Key (enter.pollinations.ai/keys →
  // Apps); it only labels the consent screen and attributes traffic.
  const APP_KEY = "";

  const memory = new Map();
  const store = {
    get: (key) => (globalThis.sessionStorage ? sessionStorage.getItem(key) : memory.get(key)),
    set: (key, value) =>
      globalThis.sessionStorage ? sessionStorage.setItem(key, value) : memory.set(key, value),
    remove: (key) =>
      globalThis.sessionStorage ? sessionStorage.removeItem(key) : memory.delete(key),
  };

  async function json(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  function httpError(response, body) {
    const error = new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    if (response.status === 401 || response.status === 403) error.code = "auth";
    if (response.status === 402 || response.status === 429) error.code = "quota";
    return error;
  }

  async function connect() {
    const response = await fetch(`${ENTER}/api/device/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(APP_KEY ? { client_id: APP_KEY } : {}),
    });
    const body = await json(response);
    if (!response.ok || !body.device_code) throw httpError(response, body);
    store.set("cs.device", body.device_code);
    store.set("cs.until", String(Date.now() + (body.expires_in || 1800) * 1000));
    return {
      userCode: body.user_code,
      verify: body.verification_uri_complete || body.verification_uri,
      interval: (body.interval || 5) * 1000,
    };
  }

  async function poll() {
    const device = store.get("cs.device");
    if (!device) return { state: "idle" };
    if (Date.now() > Number(store.get("cs.until") || 0)) {
      store.remove("cs.device");
      return { state: "expired" };
    }
    const response = await fetch(`${ENTER}/api/device/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code: device }),
    });
    const body = await json(response);
    if (body.access_token) {
      store.remove("cs.device");
      store.remove("cs.until");
      store.set("cs.key", body.access_token);
      return { state: "connected" };
    }
    if (body.error === "authorization_pending" || response.status === 428) return { state: "pending" };
    store.remove("cs.device");
    return { state: "error", message: body.error_description || body.error || `HTTP ${response.status}` };
  }

  function status() {
    return store.get("cs.key") ? { state: "connected" } : { state: "signed-out" };
  }

  function useKey(key) {
    const trimmed = String(key || "").trim();
    if (!/^sk_/.test(trimmed)) throw new Error("that is not an sk_ key");
    store.set("cs.key", trimmed);
    return status();
  }

  function signOut() {
    for (const key of ["cs.key", "cs.device", "cs.until"]) store.remove(key);
    return status();
  }

  async function ask({ system, prompt, images = [], maxTokens = 600, model = MODEL }) {
    const key = store.get("cs.key");
    if (!key) {
      const error = new Error("connect your Pollen first");
      error.code = "auth";
      throw error;
    }
    const content = images.length
      ? [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))]
      : prompt;
    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content });
    const response = await fetch(`${GEN}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: maxTokens }),
    });
    const body = await json(response);
    if (!response.ok) throw httpError(response, body);
    const text = body.choices?.[0]?.message?.content;
    if (!text) throw new Error("the model returned no text");
    return text.trim();
  }

  globalThis.Pollen = { connect, poll, status, useKey, signOut, ask, MODEL };
})();
