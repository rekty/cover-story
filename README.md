[![Made with pollinations.ai](https://raw.githubusercontent.com/pollinations/pollinations/main/packages/ui/src/brand/badge-made-with.svg)](https://pollinations.ai/?ref=badge)

# Cover Story

Hide a message in the pixels of any picture. The photo looks untouched, the PNG carries the note,
and Pollinations writes the caption that keeps it ordinary. Live app:
**https://rekty.github.io/cover-story/**

Steganography is the old trick of hiding a message inside something ordinary — a picture, so only
someone who knows to look will find it. Most "AI hides a message" demos ask a model to be sneaky and
then hope the secret survived re-encoding. This one hides the message **in the bits**, so the claim
is checkable: the app writes a header, a length and a CRC32 into the least significant bit of every
colour channel, and reading it back either verifies or says "damaged".

## What you get

- **Hide** — drop any picture, type the note, get a PNG back. The message sits in the low bit of
  each colour channel, so the picture looks identical; alpha is never touched.
- **Reveal** — drop the PNG you were sent. The app returns the text and confirms the checksum. A
  screenshot, a chat preview or a JPEG re-save rewrites those bits, and the app says so instead of
  guessing.
- **Cover captions** — the model looks at your picture (a 512 px thumbnail) and writes three
  captions that would pass as an ordinary post about it, without hinting that anything is hidden.
  That is the part a model is genuinely good at: the picture still needs a reason to be posted.
- **Open the message** — the recipient can have the extracted text read back plainly, as a poem, or
  as a handler's briefing, without losing a name or a number.
- **Your Pollen** — sign in with the device flow and every caption or reading is billed to your own
  key. Nothing is hidden behind the developer's balance.

## How it works

```
picture ──► canvas ──► getImageData ──► shared/stego.js ──► PNG download
                                           │
note ──────────────────────────────────────┘   header: "CSG1" + length + CRC32

caption request ──► shared/pollen.js ──► gen.pollinations.ai/v1/chat/completions
                       (device flow, sk_ key in sessionStorage, thumbnail attached)
```

- `shared/stego.js` — pure functions over `ImageData`: `capacity`, `embed`, `extract`, plus CRC32.
  No canvas, no DOM, so the same code runs in the page and in `node --test`.
- `shared/pollen.js` — device-flow sign-in (no redirect, no app secret, no backend), key in
  `sessionStorage`, one chat call helper that can attach an image.
- `app.js` — the page: picture loading, the PNG export, the caption list and the reading.

Header layout, 12 bytes: magic `CSG1`, payload length (uint32, big endian), CRC32 of the payload,
then the UTF-8 message. Bits are written most significant first across the red, green and blue bytes
of each pixel in order; alpha is skipped.

## Capacity

Three bits per pixel, minus 12 bytes of header. A 960×640 picture holds 225 kB; a 200×200 picture
holds 14.9 kB. The page shows the free space as you type, and refuses with the exact numbers when a
message does not fit.

## Cost

One caption request and one reading are single chat completions. With the default
`openai/gpt-5.4-nano` that is a few thousandths of a Pollen each; hiding and revealing are free,
because they are arithmetic on pixels. Swapping the model is one constant in `shared/pollen.js`.

## Privacy

The picture never leaves the page. Hiding and revealing happen in the tab. Only when you ask for
captions is a 512 px JPEG thumbnail plus your request sent to Pollinations; asking for a reading
sends only the extracted text. The `sk_` key lives in `sessionStorage` and dies with the tab.

## Limits worth knowing

- **PNG only.** Re-encoding as JPEG, or a screenshot of the picture, destroys the low bits. The app
  detects a damaged copy through the CRC instead of returning garbage.
- **Not encryption.** Anyone who knows the trick can read the message without the app. It hides the
  message, it does not protect it.
- **Some services re-compress.** Social platforms that re-encode images will strip the note; share
  the file directly.

## Maintenance

The project is deliberately small and stays that way:

- **No build step and no dependencies.** The directory you clone is the page you deploy, so a fix is
  one commit and no toolchain can rot.
- **The bit format is tested, not assumed.** `node --test` covers round trips, unicode, capacity,
  damage detection, alpha preservation and the reference CRC32 — the format cannot drift silently,
  because an old picture must still decode.
- **The model side is two constants.** Model name and endpoints live in `shared/pollen.js`, so a new
  or retired text model is a one-line change; captions degrade to text-only if a model rejects
  images instead of breaking the page.
- **Endpoint drift surfaces in the tests**: the fake-network tests assert the device-flow URLs and
  the chat request shape, so a change on the Pollinations side fails a test rather than a user.
- **Issues and PRs are read.** Reports that a message did not survive a particular service are
  answered with a note in the Limits section rather than a promise the app cannot keep.

## Develop

```bash
node --test                     # bit format + BYOP client, no network, no Pollen spent
node --check app.js shared/stego.js shared/pollen.js
python -m http.server 8100      # open http://localhost:8100
```

The page needs no key to hide or reveal; captions and readings ask for one.

## Credits

The hiding happens in the pixels; the writing happens in the model. Built on
[Pollinations](https://pollinations.ai) text models and the
[Bring Your Own Pollen](https://github.com/pollinations/pollinations/blob/main/BRING_YOUR_OWN_POLLEN.md)
device flow. The quest that prompted it came from the LessWrong write-up on how a model hid a secret
in a picture it drew.

MIT licensed.
