// Runs the shipped client against a fake network: device flow, key handling and
// the chat request shape, with no Pollen spent.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const plain = (value) => JSON.parse(JSON.stringify(value));

function load({ responses }) {
  const calls = [];
  const context = vm.createContext({
    console,
    setInterval,
    clearInterval,
    TextEncoder,
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      const reply = responses(String(url));
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json: async () => reply.body,
      };
    },
  });
  vm.runInContext(readFileSync(new URL("../shared/pollen.js", import.meta.url), "utf8"), context);
  return { Pollen: context.Pollen, calls };
}

const chat = (text) => ({ status: 200, body: { choices: [{ message: { content: text } }] } });

test("device flow: code, then approval", async () => {
  let polls = 0;
  const { Pollen, calls } = load({
    responses: (url) => {
      if (url.endsWith("/api/device/code"))
        return {
          status: 200,
          body: {
            device_code: "dev-1",
            user_code: "WXYZ-1234",
            verification_uri_complete: "https://enter.pollinations.ai/device?user_code=WXYZ-1234",
            expires_in: 1800,
            interval: 5,
          },
        };
      polls += 1;
      return polls === 1
        ? { status: 428, body: { error: "authorization_pending" } }
        : { status: 200, body: { access_token: "sk_user" } };
    },
  });

  const started = await Pollen.connect();
  assert.equal(started.userCode, "WXYZ-1234");
  assert.equal(JSON.parse(calls[0].options.body).client_id, undefined);
  assert.equal(Pollen.status().state, "signed-out");

  assert.equal((await Pollen.poll()).state, "pending");
  assert.equal((await Pollen.poll()).state, "connected");
  assert.equal(Pollen.status().state, "connected");
});

test("spending without a key is refused before any request", async () => {
  const { Pollen, calls } = load({ responses: () => chat("hi") });
  await assert.rejects(() => Pollen.ask({ prompt: "hello" }), (error) => error.code === "auth");
  assert.equal(calls.length, 0);
});

test("a chat request carries the user key, the model and the picture", async () => {
  const { Pollen, calls } = load({ responses: () => chat("A quiet hill at dusk.") });
  Pollen.useKey("sk_user");

  const text = await Pollen.ask({
    system: "write captions",
    prompt: "three captions",
    images: ["data:image/jpeg;base64,AAAA"],
  });
  assert.equal(text, "A quiet hill at dusk.");

  const request = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].url, "https://gen.pollinations.ai/v1/chat/completions");
  assert.equal(calls[0].options.headers.Authorization, "Bearer sk_user");
  assert.equal(request.model, "openai/gpt-5.4-nano");
  assert.equal(request.messages[0].content, "write captions");
  assert.equal(request.messages[1].content[0].type, "text");
  assert.equal(request.messages[1].content[1].image_url.url, "data:image/jpeg;base64,AAAA");
});

test("text-only requests send a string, not parts", async () => {
  const { Pollen, calls } = load({ responses: () => chat("ok") });
  Pollen.useKey("sk_user");
  await Pollen.ask({ prompt: "hello" });
  assert.equal(JSON.parse(calls[0].options.body).messages[0].content, "hello");
});

test("a spent balance is reported as quota", async () => {
  const { Pollen } = load({
    responses: () => ({ status: 402, body: { error: { message: "not enough pollen" } } }),
  });
  Pollen.useKey("sk_user");
  await assert.rejects(
    () => Pollen.ask({ prompt: "hi" }),
    (error) => error.code === "quota" && /not enough pollen/.test(error.message),
  );
});

test("keys are validated and signing out forgets them", () => {
  const { Pollen } = load({ responses: () => chat("ok") });
  assert.throws(() => Pollen.useKey("pk_nope"), /not an sk_ key/);
  Pollen.useKey("sk_user");
  assert.equal(Pollen.status().state, "connected");
  assert.equal(Pollen.signOut().state, "signed-out");
  assert.equal(Pollen.status().state, "signed-out");
});

test("the page defaults to an unpriced model", () => {
  const { Pollen } = load({ responses: () => chat("ok") });
  assert.equal(plain(Pollen.MODEL), "openai/gpt-5.4-nano");
});
