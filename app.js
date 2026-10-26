const $ = (id) => document.getElementById(id);
const MAX_SIDE = 2400;
const THUMB_SIDE = 512;

const state = {
  hide: null, // { imageData } of the picture being hidden in
  last: null, // { imageData, name } of the picture just written
  found: "", // text pulled out of the reveal picture
  device: null,
  pollTimer: 0,
};

/* ---------- pictures ---------- */

function context(canvas) {
  return canvas.getContext("2d", { willReadFrequently: true });
}

function paint(canvas, bitmap) {
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = context(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  canvas.classList.add("shown");
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function fromFile(canvas, file) {
  const bitmap = await createImageBitmap(file);
  try {
    return paint(canvas, bitmap);
  } finally {
    bitmap.close();
  }
}

function sample(canvas) {
  canvas.width = 960;
  canvas.height = 640;
  const ctx = context(canvas);
  const sky = ctx.createLinearGradient(0, 0, 0, 640);
  sky.addColorStop(0, "#1d2340");
  sky.addColorStop(0.45, "#5b3f6b");
  sky.addColorStop(1, "#e08a5f");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 960, 640);

  ctx.fillStyle = "#ffd9a0";
  ctx.beginPath();
  ctx.arc(690, 250, 58, 0, Math.PI * 2);
  ctx.fill();

  const hills = [
    ["#2d2740", 470, 96],
    ["#231f33", 530, 130],
    ["#171423", 590, 170],
  ];
  for (const [colour, base, lift] of hills) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(0, 640);
    ctx.lineTo(0, base);
    for (let x = 0; x <= 960; x += 60) {
      ctx.lineTo(x, base - Math.sin(x / 150) * lift * 0.5 - Math.cos(x / 90) * lift * 0.2);
    }
    ctx.lineTo(960, 640);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  for (let i = 0; i < 90; i += 1) {
    const x = (i * 137) % 960;
    const y = (i * 61) % 240;
    ctx.fillRect(x, y, 1.5, 1.5);
  }

  canvas.classList.add("shown");
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function thumbnail(canvas) {
  const small = document.createElement("canvas");
  const scale = Math.min(1, THUMB_SIDE / Math.max(canvas.width, canvas.height));
  small.width = Math.round(canvas.width * scale);
  small.height = Math.round(canvas.height * scale);
  context(small).drawImage(canvas, 0, 0, small.width, small.height);
  return small.toDataURL("image/jpeg", 0.72);
}

/* ---------- helpers ---------- */

function bytes(count) {
  if (count < 1024) return `${count} B`;
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} kB`;
  return `${(count / 1024 / 1024).toFixed(2)} MB`;
}

function say(id, text, bad = false) {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle("bad", bad);
}

function authHint(error) {
  return error?.code === "auth"
    ? "Connect your Pollen first — the caption and the reading are model calls."
    : error?.code === "quota"
      ? "That key is out of Pollen."
      : error?.message || "the request failed";
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/* ---------- sign in ---------- */

function renderAuth() {
  const { state: status } = Pollen.status();
  const connected = status === "connected";
  $("auth-title").textContent = connected ? "Connected — your Pollen is paying" : "Not connected";
  $("auth-note").textContent = connected
    ? "Captions and readings spend your own key."
    : "Sign in to write captions and open messages.";
  $("auth-connect").hidden = connected;
  $("auth-out").hidden = !connected;
  $("auth-device").hidden = !state.device;
}

async function pollDevice() {
  const result = await Pollen.poll();
  if (result.state === "pending") return;
  state.device = null;
  $("auth-device").hidden = true;
  if (result.state === "error") $("auth-note").textContent = `Sign-in failed: ${result.message}`;
  renderAuth();
}

function startPolling(interval) {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(pollDevice, Math.max(interval || 5000, 3000));
}

$("auth-connect").onclick = async () => {
  $("auth-connect").disabled = true;
  try {
    state.device = await Pollen.connect();
    $("auth-device").hidden = false;
    $("auth-code").textContent = state.device.userCode;
    $("auth-open").onclick = () => window.open(state.device.verify, "_blank", "noopener");
    startPolling(state.device.interval);
  } catch (error) {
    say("caption-status", `Sign-in failed: ${error.message}`, true);
  } finally {
    $("auth-connect").disabled = false;
  }
};

$("auth-out").onclick = () => {
  if (state.pollTimer) clearInterval(state.pollTimer);
  Pollen.signOut();
  renderAuth();
};

$("auth-use").onclick = () => {
  try {
    Pollen.useKey($("auth-key").value);
    $("auth-key").value = "";
    renderAuth();
  } catch (error) {
    say("caption-status", error.message, true);
  }
};

/* ---------- hide ---------- */

function compact(zone) {
  $(zone).classList.add("compact");
  $(`${zone}-text`).textContent = "Drop another picture, or click to choose one";
}

function setHideImage(imageData, label) {
  state.hide = { imageData };
  compact("hide-drop");
  $("hide-download").hidden = true;
  say("hide-status", `${label} · ${bytes(Stego.capacity(imageData))} of space for a message`);
  updateCapacity();
}

function updateCapacity() {
  const used = new TextEncoder().encode($("message").value).length;
  const room = state.hide ? Stego.capacity(state.hide.imageData) : 0;
  say("capacity", state.hide ? `${bytes(used)} of ${bytes(room)}` : "");
}

function showImageData(canvas, imageData) {
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  context(canvas).putImageData(imageData, 0, 0);
  canvas.classList.add("shown");
}

$("hide-file").onchange = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    setHideImage(await fromFile($("hide-canvas"), file), file.name);
  } catch {
    say("hide-status", "That file could not be read as an image.", true);
  }
};

$("hide-sample").onclick = () => setHideImage(sample($("hide-canvas")), "Sample picture");

$("message").oninput = updateCapacity;

$("hide-go").onclick = async () => {
  if (!state.hide) {
    setHideImage(sample($("hide-canvas")), "Sample picture");
  }
  const text = $("message").value.trim();
  if (!text) {
    say("hide-error", "Write the message you want to hide.", true);
    return;
  }
  const canvas = $("hide-canvas");
  const image = new ImageData(
    new Uint8ClampedArray(state.hide.imageData.data),
    state.hide.imageData.width,
    state.hide.imageData.height,
  );
  const result = Stego.embed(image, text);
  if (!result.ok) {
    say(
      "hide-error",
      result.reason === "too-long"
        ? `That needs ${bytes(result.bytes)} but the picture only holds ${bytes(result.capacity)}. Use a bigger picture or a shorter message.`
        : "Write the message you want to hide.",
      true,
    );
    return;
  }
  context(canvas).putImageData(image, 0, 0);
  state.last = { imageData: image, name: "cover-story.png" };

  const link = $("hide-download");
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  link.href = URL.createObjectURL(blob);
  link.hidden = false;

  say("hide-error", "");
  say(
    "hide-status",
    `Hidden: ${bytes(result.bytes)} of ${bytes(result.capacity)} used. Download the PNG and send that file — a screenshot or a JPEG copy erases it.`,
  );
};

/* ---------- captions ---------- */

const CAPTION_SYSTEM = [
  "You write ordinary captions for social posts.",
  "The sender hid a private message inside this picture and wants it to pass as a normal photo.",
  "Write three captions, one per line, no numbering, no quotes, each under 12 words.",
  "They must describe the picture plainly and never hint that anything is hidden.",
].join(" ");

async function captions(image) {
  const prompt = image
    ? "Write the three captions for this picture."
    : "Write three captions for an ordinary photo taken outdoors at dusk.";
  try {
    return await Pollen.ask({ system: CAPTION_SYSTEM, prompt, images: image ? [image] : [], maxTokens: 220 });
  } catch (error) {
    if (!error.code && image) return await Pollen.ask({ system: CAPTION_SYSTEM, prompt, maxTokens: 220 });
    throw error;
  }
}

$("caption-go").onclick = async () => {
  if (!state.hide) setHideImage(sample($("hide-canvas")), "Sample picture");
  $("caption-go").disabled = true;
  say("caption-status", "Writing captions…");
  try {
    const text = await captions(thumbnail($("hide-canvas")));
    const lines = text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:[-*\d.)]+\s*)/, "").trim())
      .filter(Boolean)
      .slice(0, 3);
    const list = $("captions");
    list.replaceChildren(
      ...lines.map((line) => {
        const button = document.createElement("button");
        button.className = "caption";
        button.type = "button";
        button.textContent = line;
        button.onclick = async () => {
          const ok = await copy(line);
          say("caption-status", ok ? "Copied." : line);
        };
        return button;
      }),
    );
    say("caption-status", lines.length ? "Click one to copy it." : "The model sent nothing usable; try again.");
  } catch (error) {
    say("caption-status", authHint(error), true);
  } finally {
    $("caption-go").disabled = false;
  }
};

/* ---------- reveal ---------- */

function reveal(imageData, label) {
  const result = Stego.extract(imageData);
  state.found = result.ok ? result.text : "";
  $("found").textContent = result.ok ? result.text : "";
  $("read").textContent = "";
  const reasons = {
    "no-message": "No hidden message in this copy. A screenshot, a chat preview or a JPEG re-save rewrites the pixels.",
    corrupt: "The message was here but its checksum failed, so part of it is damaged. Ask for the original PNG.",
    "too-small": "That picture is too small to hold a message.",
  };
  say(
    "reveal-status",
    result.ok ? `${label} · ${bytes(result.bytes)} read back, checksum good.` : reasons[result.reason] || "Nothing found.",
    !result.ok,
  );
}

$("reveal-file").onchange = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    reveal(await fromFile($("reveal-canvas"), file), file.name);
    compact("reveal-drop");
  } catch {
    say("reveal-status", "That file could not be read as an image.", true);
  }
};

$("reveal-last").onclick = () => {
  if (!state.last) {
    say("reveal-status", "Hide a message first, then this checks your own work.", true);
    return;
  }
  showImageData($("reveal-canvas"), state.last.imageData);
  compact("reveal-drop");
  reveal(state.last.imageData, "the picture you just made");
};

const TONES = {
  plain: "Rewrite the message so it reads clearly and warmly, keeping every fact, name and number.",
  poetic: "Turn the message into a short poem of at most six lines. Keep every fact, name and number.",
  spy: "Deliver the message as a handler's briefing in the second person, clipped and calm. Keep every fact.",
};

$("read-go").onclick = async () => {
  if (!state.found) {
    say("reveal-status", "There is no message to read yet.", true);
    return;
  }
  $("read-go").disabled = true;
  $("read").textContent = "Opening…";
  try {
    const tone = $("tone").value;
    const text = await Pollen.ask({
      system: `${TONES[tone]} Reply with the message only.`,
      prompt: state.found,
      maxTokens: 400,
    });
    $("read").textContent = text;
  } catch (error) {
    $("read").textContent = "";
    say("reveal-status", authHint(error), true);
  } finally {
    $("read-go").disabled = false;
  }
};

/* ---------- tabs ---------- */

for (const [tab, pane] of [
  ["tab-hide", "pane-hide"],
  ["tab-reveal", "pane-reveal"],
]) {
  $(tab).onclick = () => {
    for (const other of ["tab-hide", "tab-reveal"]) {
      $(other).setAttribute("aria-selected", String(other === tab));
    }
    $("pane-hide").hidden = pane !== "pane-hide";
    $("pane-reveal").hidden = pane !== "pane-reveal";
  };
}

for (const [zone, input] of [
  ["hide-drop", "hide-file"],
  ["reveal-drop", "reveal-file"],
]) {
  const element = $(zone);
  element.addEventListener("dragover", (event) => {
    event.preventDefault();
    element.classList.add("over");
  });
  element.addEventListener("dragleave", () => element.classList.remove("over"));
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    element.classList.remove("over");
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const target = $(input);
    const carrier = new DataTransfer();
    carrier.items.add(file);
    target.files = carrier.files;
    target.dispatchEvent(new Event("change"));
  });
}

renderAuth();
updateCapacity();

// #demo opens the page with a picture and a message already hidden, so it can
// be linked to and screenshotted without typing.
if (location.hash === "#demo") {
  $("message").value = "Meet me at the second bench, 8pm. Bring the key.";
  setHideImage(sample($("hide-canvas")), "Sample picture");
  $("hide-go").click();
}
