# Nexa: an AI assistant you can talk to, online or offline

A Gemini-style assistant with a glowing 3D talking orb. Her brain, hearing
and voice all run on your own computer, so she works with no internet. When you
*are* online she can search the web, and think with Groq, Gemini or Claude if you add
a key. Say **"Hey Nexa"** and she answers out loud.

Made by **Mic Dahryl Caybin**.

| Part | What it uses | Runs on |
| --- | --- | --- |
| Brain (offline) | [Gemma 3](https://ai.google.dev/gemma) served by [Ollama](https://ollama.com) | this PC |
| Brain (online, optional) | Groq, Gemini or Claude, with your own API key | the internet |
| Hearing | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (`base.en` and `small.en`) | this PC (NVIDIA card if there is one) |
| Voice | [Piper](https://github.com/OHF-voice/piper1-gpl) neural voices, male by default, and [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) casual voices | this PC |
| PC commands | Start menu apps, websites, music and volume keys | this PC |
| Web search | DuckDuckGo, wttr.in and Wikipedia. No key needed | the internet |
| App | Python (FastAPI) at `http://127.0.0.1:8000`, in its own Chrome/Edge window | this PC |

## Install on a Windows PC

You need Windows 10 or 11 (64-bit), a microphone, about 5 GB of free disk space,
8 GB of RAM or more, and internet for the first setup only.

1. Double-click **NexaSetup.exe**. The installer isn't code-signed yet, so Windows may stop it:
   - *"Windows protected your PC"* (SmartScreen): click **More info** → **Run anyway**.
   - *"Smart App Control blocked…"*: there's no exception for a single app. The only way
     through is to turn Smart App Control off in **Windows Security → App & browser control →
     Smart App Control settings**. On Windows 11 with the April 2026 update or later it can be
     turned back on afterwards (older versions need a Windows reset for that), but it may then
     block parts of Nexa again.
2. Press **Install**. No admin rights are needed; Nexa goes into your own Programs folder.

Setup downloads everything she needs. It takes 10 to 30 minutes depending on your
connection, and you can keep using your PC (press **Show details** to watch):
- Python, if it isn't installed
- Ollama and the Gemma model (about 0.8 GB)
- Nexa's hearing (about 0.6 GB) and five voices (about 370 MB)
- on PCs with an NVIDIA card: its speed-up for hearing, and six casual-sounding voices that run
  on it (about 2.5 GB in all)

When it's done, Nexa's window opens. Click **Allow** when it asks for the
microphone. A **Nexa** shortcut is added to the Start menu (and the desktop, if you left
that ticked); use it from now on. No internet is needed after this.

If setup stops halfway (for example the Wi-Fi drops), run NexaSetup.exe again and press
**Try again**; it picks up where it stopped.

**Without the installer:** right-click **Nexa.zip** → **Properties** → tick **Unblock** →
**OK**, extract it somewhere you'll keep it, open the **Nexa** folder and double-click
**`start.bat`**. The first start runs the same setup.

## Share Nexa with another PC

On a PC where Nexa is installed, run:

```powershell
powershell -ExecutionPolicy Bypass -File make-package.ps1
```

It builds two files in `dist\`, with only the app's own files in them:
- **`NexaSetup.exe`** (about 2.5 MB): the installer. Share this one.
- **`Nexa.zip`** (about 2 MB): the same app as a plain folder.

Your API keys, chats, logs and downloaded models are **not** included. Each PC downloads
its own models during setup and adds its own keys. The installer is built with the C#
compiler that comes with Windows (`installer\NexaSetup.cs`), so nothing extra is needed.

Nexa knows she was made by Mic Dahryl Caybin on every PC. On the maker's own PC she also
knows who she's talking with: that's set by a file named `maker` in `%LOCALAPPDATA%\Nexa`,
which never goes into the installer.

## Talk to Nexa

Nexa listens all the time but only answers what you say **to her**. Every spoken request
needs her name, at the start or the end:

- *"Hey Nexa, what's the weather today?"*
- *"Nexa, open Word for me"* or *"Nexa what is a black hole?"*
- *"Turn up the volume Nexa"*, *"Open Spotify, Nexa"* or *"What time is it, Nexa?"*
- Just *"Nexa"*: she answers *"Yes, Sir?"* and takes your next sentence as the request.

Talking *about* her, as in *"I read about Nexa today"*, doesn't wake her.
This holds everywhere you speak to her: in the background, in a **Talk** conversation and with
the **Mic** button. Typed messages are always answered.

- **Hey Nexa** button (top right): turns listening off and on. Its dot pulses when she
  hears sound. If she doesn't react, the line under the text box shows what she
  heard (*Heard "…"*).
- **Talk** button (sound-wave icon): a continuous voice conversation. Speak naturally without
  repeating her name. Tap the orb to interrupt; say **goodbye**, press **End**, or Esc to leave.
- **Mic** button: speak one message; the reply is read aloud. Her name isn't required.
- **Type** a message and press Enter (no name needed). The **speaker** button reads typed
  replies aloud too.
- **☰** (top left): your saved chats. They're stored on this PC only.

Her window keeps listening while it's minimized or behind other windows.

## Commands: apps, websites, music

Tell Nexa to do something on the PC and she does it at once, even offline. She says what she
did (*"Opening Spotify, Sir."*). Say it to her like any request (*"Hey Nexa, open Spotify"*),
or type it.

| Say | What happens |
| --- | --- |
| *open Spotify*, *open Discord*, *launch Calculator*, *open Word* | Opens any app in your Start menu. Small mishearings are fine (*"open spotfy"*) |
| *open YouTube*, *open Gmail*, *go to github.com* | Opens the website in your browser |
| *open Downloads*, *open the Recycle Bin*, *open Bluetooth settings* | Opens the folder or Settings page |
| *close Spotify*, *close Chrome* | Closes the app's windows like their X button; it can still ask to save |
| *play lofi beats on Spotify*, *search Spotify for Taylor Swift* | Opens Spotify's search for it (Spotify can't be told to start a song without its paid developer account, so click the one you want) |
| *play despacito on YouTube* | Starts the first video for it on YouTube |
| *play shape of you* | Spotify search if Spotify is installed, otherwise YouTube |
| *play*, *pause*, *next song*, *skip*, *previous song* | Controls whatever is playing: Spotify, YouTube, any player |
| *volume up* / *turn it down* / *louder* / *mute*, *set the volume to 30* | Changes the PC's volume |
| *what's this song?* | Reads the song from Spotify's window |
| *take a screenshot*, *show the desktop*, *lock the PC* | What it says |

Several at once work too: *"open Spotify and play lofi"*, *"open Notepad and Calculator"*.

She only does these things. She never runs a command an AI wrote, never deletes anything, and
won't shut down or restart the PC. Questions (*"how do I open Spotify?"*) still get a normal
answer. Play and pause are the keyboard's play/pause key, so *play* while music is already
playing pauses it.

## Settings

Click the **gear** (top right). The settings window has three tabs:

| Tab | Setting | What it does |
| --- | --- | --- |
| General | How Nexa addresses you | **Auto** guesses Sir or Ma'am from your voice. Or pick Sir, Ma'am, Master, your name, or no title |
| General | Owner voice | Enroll three samples so spoken requests must match your voice. The voice profile stays on this PC; recordings are discarded |
| General | Hearing | **Accurate** listens with the bigger model by default on every PC; **Fast** answers sooner |
| Voice | Voice | Cori (female, UK) by default; also HFC and Lessac (female, US), Alan (male, UK) and Ryan (male, US). With an NVIDIA card, six **casual** voices that sound like someone talking rather than reading: Puck, Michael, Eric, Lewis (male) and Heart, Emma (female) |
| Voice | Speaking style | **Calm** is even and steady; **Natural** is more expressive |
| Voice | Inner-voice echo | Off, Subtle or Strong |
| Voice | Sound effects | Chimes and soft swells, On or Off |
| AI brains | Groq / Gemini / Claude | Add, check or remove an online brain (see below) |

Auto's Sir/Ma'am guess comes from how high or low the voice sounds, so it can be
wrong. If it is, choose your title.

## Online brains (optional)

Nexa always works offline with Gemma. With a key, she thinks with a stronger online
model while you're connected. In **Auto** (the model menu next to her name) she uses the
brain chosen in **Auto uses first**, then the free ones before the paid one (Groq, Gemini,
Claude), then Gemma on this PC. If you're offline, a daily limit is used up, or the service
has a problem, she says so and switches to the next one by herself.

**Groq (free, recommended).** Very fast, which matters most when you talk to her, and Groq
keeps nothing you send by default. Create a free account and key at
[console.groq.com/keys](https://console.groq.com/keys) (no credit card), paste it under Groq
and click **Save**. Nexa uses GPT-OSS 120B (the smartest) for typed questions and GPT-OSS
20B for spoken ones (about a second quicker). Each Groq model has its own free daily
allowance, so when one runs out she moves on to Groq's other models.

**Claude (paid).** Create a key at
[console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) and add
credit (no free tier; each answer costs a little). In **Settings → AI brains**, paste it
under Claude and click **Save**. Nexa uses Haiku for voice and Sonnet for typed questions.

**Gemini (free tier).** Get a key at
[aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey), paste it under
Gemini and click **Save**. The free tier has a daily limit, and Google may use what you
send to improve its products, so don't send anything private through it.

Keys are saved in `%LOCALAPPDATA%\Nexa` (Nexa's data folder; a folder from before the
rename, `%LOCALAPPDATA%\Ciel`, is moved there on the next start), never in the Nexa folder,
so sharing the folder or the zip never shares a key.
**Remove key** deletes it.

## Web search

When the **Web** button (next to the mic) is on and the PC is online, Nexa searches
for questions that need fresh information: weather, news, prices, scores, "latest…",
"who is the current…", or anything starting with *"search for…"* or *"look up…"*.
Answers show numbered citations and source cards. Other questions are answered without
searching. Only the search words leave your PC; turn **Web** off to keep everything local.

## Coding help (pygame and VPython)

Online brains (Groq, Gemini, Claude) write the best code, so with a key saved and the PC
online they answer coding questions like everything else.

On this PC, questions about **pygame** or **VPython** go to a bigger offline model,
`qwen2.5-coder:7b`, if it's installed (`ollama pull qwen2.5-coder:7b`, about 4.7 GB). So do follow-ups like
*"now add a score"* after an answer with that code in it. The status line says when it's
writing code. It's much better at code than the small model, but:
- it's slow on a laptop: often a minute or more before the answer starts
- in tests about 2 in 3 of its programs ran and moved on screen, and reading them, about
  half did exactly what was asked (most pygame ones, fewer VPython ones); its mistakes often
  give no error, so run its code and tell it what looks wrong ("the ball doesn't bounce")
- it isn't used for voice questions (spoken answers have no code) or when you pick a model
  yourself in the model menu

If the `training` folder is there (it isn't part of the installer), Nexa also shows the model
a similar, already-tested example program first, which makes it use the right functions more
often. See `training/README.md`.

## Her look and sounds

- **Her orb, a hologram of green light.** A voice conversation shows Nexa's orb in deep space:
  a glowing core like an eye, dashed data rings and dial ticks around it, a wide tilted band of
  fine lines, big outer rings carrying circuit traces, rays and long threads across it, and
  soft out-of-focus lights, all with a glow. It moves like water: the rings ripple, and a wave
  rolls out from the core on every loud syllable she speaks. While she listens it turns aqua,
  your voice shapes the ring around the core and light runs in along the rays; while she thinks
  everything spins faster and signals race along the circuits. When a conversation opens it
  builds itself from the core outward, and it leans slightly toward your mouse. It's drawn on
  the graphics card (WebGL); PCs without WebGL show a flat version.
- **Her logo:** a deep-green badge with the same hologram inside: the glowing core, its rings,
  and a tilted orbit carrying three stars. It's the app icon, the browser tab
  icon and the desktop shortcut.
- **Sound effects:** a crystal chime before she speaks, a chime when she hears her name, a
  soft swell when a voice conversation opens and closes, soft data ticks while she
  analyzes, and a ping when she searches. Turn them off in **Settings → Voice**.
- When Nexa speaks, **her icon** appears in the top-right corner and pulses with her voice.
  In a voice conversation her words appear as **subtitles**.
- She talks like a relaxed, friendly companion: short, natural answers, with a bit of humor
  when it fits.

## Her hearing

Before speaking to Nexa, open **Settings → General → Owner voice → Enroll my voice**.
First setup installs [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) and downloads its
28 MB English CAMPPlus speaker model. Read each of the three sentences aloud using your
usual microphone in a quiet room. Press **Record sample** for each sentence, then pause.
Nexa checks that the samples sound like the same person before saving the profile.

Every spoken request is checked locally before transcription, web search, AI providers,
or PC commands. Without an enrolled voice, or if verification fails, spoken requests stay
blocked. Other voices are ignored. Say a complete request, such as “Hey Nexa, what time is
it?”, so there is at least a second of speech to identify you. Very short calls may be ignored.
The mic and Talk buttons still check your voice, but don't require her name.

The profile is stored in `%LOCALAPPDATA%\Nexa\owner_voice.json`, outside shared packages.
**Remove voice** deletes it and pauses spoken requests until you enroll again. **Enroll again**
replaces it only after three matching samples are accepted. Typed chat remains available.
Speaker matching is a convenience filter, not authentication: recordings, cloned voices,
overlapping speakers, noise, and changes to your microphone can cause mistakes. It hasn't
been calibrated to your voice until you enroll and try it. Don't use it as a security lock.

After updating an older Nexa folder, `start.bat` runs setup once to add speaker recognition.
If downloads fail, connect to the internet and run `setup.ps1` again.

After the speaker check, **Hearing: Accurate** uses the bigger speech model (`small.en`)
for both wake phrases and requests. **Fast** uses the smaller `base.en` model. Accurate
stays enabled by default even on CPU, where it takes longer. If the transcript is too
uncertain, Nexa asks you to repeat instead of acting on a partial command. While she
speaks, listening pauses briefly to avoid recognizing her own voice as your request.

She waits for about **1.8 seconds of silence** before finishing a turn, so a short
pause can stay inside the same request. Quiet words after a loud first word are kept,
and delayed browser callbacks don't count as silence. The microphone button can also
finish your recording when you click it again. Spoken turns can last about **35 seconds**;
if the recording reaches that limit, she asks for a shorter request and doesn't act on
the unfinished sentence.

Transcripts are checked word by word as well as phrase by phrase. In Accurate mode,
an uncertain result gets one extra decoding attempt for softer speech. If it is still
unclear, the whole turn is rejected and she asks you to repeat. Spoken replies also
use the conversation history for follow-ups and are instructed to ask when a detail
is ambiguous. These checks reduce guessing; they don't guarantee an exact transcript.

Why she still mishears sometimes:
- The models are small enough to run on a laptop, so they make more mistakes than cloud
  assistants.
- A laptop's built-in microphone picks up room echo and fan noise. A headset or USB
  microphone helps the most.
- Strong accents, fast speech, music or a TV in the background all lower accuracy.

Speak clearly, about an arm's length from the microphone, and pause briefly after her name.

To run the speech checks without using your microphone or enrolling a voice:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
node --test tests/voice-ui.test.cjs
.\.venv\Scripts\python.exe tests/smoke_speech.py
```

The last check uses the locally installed speech and voice models. It compares the
recognized words against generated English speech, including a quiet recording,
a British voice, a negation, and a pause between sentences; it also checks silence
and noise. It doesn't measure accuracy for your own voice, accent, or room.

## Advanced settings

Set these environment variables before running `start.bat`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ASSISTANT_MODEL` | `gemma3:1b` | offline model (`gemma3:4b` is smarter but needs a faster PC; download it with `ollama pull gemma3:4b`) |
| `CODE_MODEL` | `qwen2.5-coder:7b` | offline model for pygame/VPython questions, used only if it's installed (`gemma3:4b` is smaller and faster but writes worse code) |
| `CODE_KEEP_ALIVE` | `5m` | how long the code model stays loaded after an answer (it needs about 5 GB) |
| `NEXA_VOICE` | `en_GB-cori-high` | default Piper voice in the `voices` folder |
| `NEXA_PACE` | `1.08` | speaking pace (higher is slower and calmer) |
| `WHISPER_MODEL` | `base.en` | fast hearing model |
| `WHISPER_ACCURATE_MODEL` | `small.en` | accurate hearing model |
| `NEXA_STT_DEVICE` | `auto` | `auto` uses an NVIDIA card when it works; `cpu` forces the processor |
| `GEMINI_API_KEY` | (none) | Gemini key; overrides the one saved in Settings |
| `GROQ_API_KEY` | (none) | Groq key; overrides the one saved in Settings |
| `NEXA_BROWSER` | (her own window) | `default` opens her in your normal browser instead |
| `PORT` | `8000` | web page port |

More voices: any [Piper voice](https://huggingface.co/rhasspy/piper-voices) works.
For example, Amy (female, US):

```powershell
.\.venv\Scripts\python.exe -m piper.download_voices en_US-amy-medium --data-dir voices
```

It then shows up in **Settings → Voice**.

## Troubleshooting

Nexa runs without a console window. Everything she hears, and her microphone's status, is
saved to `logs\nexa.log`:

```
18:19:30 heard[wake] 'Hey Nexa, what is 2 plus 2?'  (2.5s of audio, waited 0.0s, took 1.4s)
18:24:40 page mic-open {"device": "Microphone (Realtek High Definition Audio)", ...}
```

To watch it live, quit Nexa and start her from her folder with
`.venv\Scripts\python.exe server.py --open`, which shows it in a console window.

- **She never reacts:** check that a `mic-open` line appears and that `heard[wake]` lines
  show your words. Check that **Hey Nexa** is on, and that Windows allows apps to use
  the microphone (Settings → Privacy → Microphone).
- **"Ollama not running":** start Ollama from the Start menu, or run `start.bat` again.
- **To stop Nexa,** open **Settings → General → Quit**. Closing only her window keeps her
  running in the background; the shortcut brings the window back.
- **Moved the Nexa folder?** Delete the `.venv` folder inside it and run `start.bat`
  again, then use the new shortcut.

## Uninstall

1. Installed with NexaSetup.exe: open **Settings → Apps**, find **Nexa** and choose
   **Uninstall**. It asks whether to delete your saved keys and chats too.
   From the zip: delete the Nexa folder and the Nexa shortcuts (desktop and Start menu),
   and `%LOCALAPPDATA%\Nexa` (saved keys, chats and her window's settings).
2. Ollama stays installed either way.
3. Optional: uninstall **Ollama** in Windows Settings → Apps (its models are in
   `%USERPROFILE%\.ollama`), and delete the hearing models in
   `%USERPROFILE%\.cache\huggingface`.

## Limits

- Small offline models make more mistakes than cloud AI, and may summarize search
  results imperfectly; check the sources for anything important.
- From the end of your sentence to her first word takes about 2 to 3 seconds, or longer
  when she searches the web or runs on a PC without an NVIDIA card.
