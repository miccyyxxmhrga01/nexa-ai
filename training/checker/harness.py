"""Runs one script in a test harness and writes what happened to a JSON file.

    python harness.py pygame|vpython|python <script.py> <result.json>

pygame: no window opens (SDL dummy drivers). Time is simulated, so clock.tick() and
timers don't sleep, and every few frames it presses keys, clicks and moves the mouse
so the program's input code runs. After MAX_FRAMES frames it closes the window (a QUIT
event) and checks that the program exits within GRACE frames.

vpython: runs against the strict stand-in in vpython_stub/ (see its docstring).
"""

import json
import os
import runpy
import sys
import time
import traceback
import zlib
from pathlib import Path

MAX_FRAMES = int(os.environ.get("CHECK_FRAMES", "240"))
GRACE = 60  # frames a program may take to exit after the window is closed
WARMUP = 5  # frames (or VPython rate() calls) ignored when counting how many different frames there are

kind, script, result_path = sys.argv[1], os.path.abspath(sys.argv[2]), sys.argv[3]
result = {"ok": False, "kind": kind, "frames": 0, "quit_ok": None, "error": None, "error_line": None, "detail": "",
          "draws": False, "distinct_frames": 0}  # does it show anything, and does what it shows change


class StopProgram(BaseException):
    """Stops the run from the harness. BaseException so `except Exception` can't catch it."""


def user_frame(tb_list):
    """The line in the checked script where an error happened (the last one in that file)."""
    for fr in reversed(tb_list):
        if os.path.abspath(fr.filename) == script:
            return fr.lineno, (fr.line or "").strip()
    return None, ""


def simulated_clock(elapsed):
    """Makes the time module follow the test's simulated time (elapsed() gives seconds)."""
    start = time.time()
    real_localtime, real_strftime = time.localtime, time.strftime
    time.time = lambda: start + elapsed()
    time.perf_counter = time.monotonic = elapsed
    time.localtime = lambda secs=None: real_localtime(time.time() if secs is None else secs)
    time.strftime = lambda fmt, t=None: real_strftime(fmt, time.localtime() if t is None else t)


# ---------------------------------------------------------------- pygame


def setup_pygame():
    os.environ["SDL_VIDEODRIVER"] = "dummy"
    os.environ["SDL_AUDIODRIVER"] = "dummy"
    os.environ["PYGAME_HIDE_SUPPORT_PROMPT"] = "1"
    import pygame

    st = {"frames": 0, "ms": 0, "ticked": False, "held": set(), "mouse": (100, 100),
          "mouse_down": False, "gets": 0, "quit_at": None, "timers": {}, "looks": set()}
    keys = [pygame.K_RETURN, pygame.K_RIGHT, pygame.K_SPACE, pygame.K_LEFT, pygame.K_UP, pygame.K_h,
            pygame.K_DOWN, pygame.K_a, pygame.K_d, pygame.K_r, pygame.K_w, pygame.K_s, pygame.K_c, pygame.K_p]
    chars = {pygame.K_SPACE: " ", pygame.K_RETURN: "\r", pygame.K_a: "a", pygame.K_d: "d", pygame.K_w: "w",
             pygame.K_s: "s", pygame.K_h: "h", pygame.K_r: "r", pygame.K_c: "c", pygame.K_p: "p"}

    def post(etype, **attrs):
        try:
            pygame.event.post(pygame.event.Event(etype, **attrs))
        except pygame.error:
            pass  # the program already called pygame.quit()

    def size():
        surf = pygame.display.get_surface() if pygame.display.get_init() else None
        return surf.get_size() if surf else (640, 480)

    def press(k):
        st["held"].add(k)
        post(pygame.KEYDOWN, key=k, mod=0, unicode=chars.get(k, ""), scancode=0)

    def release(k):
        st["held"].discard(k)
        post(pygame.KEYUP, key=k, mod=0, unicode="", scancode=0)

    def inject(f):
        # A key every 12 frames, held for 6, so every key in the list gets pressed in a run
        cycle = f // 12
        if f % 12 == 4:
            press(keys[cycle % len(keys)])
        if f % 12 == 10:
            release(keys[cycle % len(keys)])
        w, h = size()
        if f % 7 == 0:
            old = st["mouse"]
            new = ((f * 37) % max(w, 1), (f * 53) % max(h, 1))
            st["mouse"] = new
            post(pygame.MOUSEMOTION, pos=new, rel=(new[0] - old[0], new[1] - old[1]),
                 buttons=(int(st["mouse_down"]), 0, 0), touch=False)
        if f % 40 == 20:
            st["mouse_down"] = True
            post(pygame.MOUSEBUTTONDOWN, pos=st["mouse"], button=1, touch=False)
        if f % 40 == 23:
            st["mouse_down"] = False
            post(pygame.MOUSEBUTTONUP, pos=st["mouse"], button=1, touch=False)

    def run_timers():
        for etype, t in list(st["timers"].items()):
            while st["ms"] >= t["next"]:
                post(etype, **t["attrs"])
                t["next"] += t["ms"]
                if t["loops"]:
                    t["loops"] -= 1
                    if t["loops"] == 0:
                        del st["timers"][etype]
                        break

    def look():
        """Notes whether the frame shows anything, and how many different frames there were."""
        surf = pygame.display.get_surface() if pygame.display.get_init() else None
        if surf is None:
            return
        try:  # averaging keeps small changes, like a score going from 5 to 6
            small = pygame.transform.smoothscale(surf, (80, 60))
        except ValueError:
            small = pygame.transform.scale(surf, (80, 60))
        data = pygame.image.tostring(small, "RGB")
        if not result["draws"] and len({data[i:i + 3] for i in range(0, len(data), 3)}) > 1:
            result["draws"] = True  # more than one color on screen
        if st["frames"] >= WARMUP:
            st["looks"].add(zlib.crc32(data))

    def on_frame():
        look()
        st["frames"] += 1
        st["gets"] = 0
        f = st["frames"]
        result["frames"] = f
        if not st["ticked"]:
            st["ms"] += 16
        st["ticked"] = False
        run_timers()
        if st["quit_at"] is None:
            inject(f)
            if f >= MAX_FRAMES:
                st["quit_at"] = f
                post(pygame.QUIT)
        elif f > st["quit_at"] + GRACE:
            result["quit_ok"] = False
            raise StopProgram("the program kept running after the window was closed (QUIT event not handled)")

    real_flip, real_update = pygame.display.flip, pygame.display.update

    def flip():
        real_flip()
        on_frame()

    def update(*a, **k):
        real_update(*a, **k)
        on_frame()

    real_get, real_poll = pygame.event.get, pygame.event.poll

    def unstick():
        # A loop that reads events but never draws (e.g. "press any key"): feed it input.
        st["gets"] += 1
        if st["gets"] % 50 == 0:
            press(pygame.K_SPACE)
            release(pygame.K_SPACE)
            post(pygame.MOUSEBUTTONDOWN, pos=st["mouse"], button=1, touch=False)
            st["ms"] += 100
            run_timers()
            if st["quit_at"] is None and st["gets"] >= 500:
                st["quit_at"] = st["frames"]
                post(pygame.QUIT)
        if st["gets"] > 5000:
            raise StopProgram("the program loops reading events but never updates the display")

    def get(*a, **k):
        unstick()
        return real_get(*a, **k)

    def poll():
        unstick()
        return real_poll()

    def wait(timeout=0):
        unstick()
        return real_poll()

    class FakeClock:
        def __init__(self):
            self._t = 16

        def tick(self, framerate=0):
            ms = int(1000 / framerate) if framerate else 16
            st["ms"] += ms
            st["ticked"] = True
            self._t = ms
            return ms

        tick_busy_loop = tick

        def get_time(self):
            return self._t

        def get_rawtime(self):
            return self._t

        def get_fps(self):
            return 60.0

    def get_ticks():
        return st["ms"]

    def delay(ms):
        st["ms"] += int(ms)
        return int(ms)

    def set_timer(event, millis, loops=0):
        if isinstance(event, pygame.event.EventType):
            etype, attrs = event.type, dict(event.dict)
        else:
            etype, attrs = int(event), {}
        if not millis:
            st["timers"].pop(etype, None)
            return
        st["timers"][etype] = {"ms": int(millis), "next": st["ms"] + int(millis), "loops": int(loops), "attrs": attrs}

    class Pressed:
        def __getitem__(self, k):
            return k in st["held"]

        def __len__(self):
            return 512

        def __iter__(self):
            return iter([False] * 512)

    # Programs that time things with the time module see the same simulated clock
    simulated_clock(lambda: st["ms"] / 1000)

    pygame.display.flip = flip
    pygame.display.update = update
    pygame.event.get = get
    pygame.event.poll = poll
    pygame.event.wait = wait
    pygame.time.Clock = FakeClock
    pygame.time.get_ticks = get_ticks
    pygame.time.delay = delay
    pygame.time.wait = delay
    pygame.time.set_timer = set_timer
    pygame.key.get_pressed = lambda: Pressed()
    pygame.mouse.get_pos = lambda: st["mouse"]
    pygame.mouse.get_pressed = lambda num_buttons=3: (st["mouse_down"],) + (False,) * (num_buttons - 1)
    return st


# ---------------------------------------------------------------- run


def main():
    st = None
    vp = None
    if kind == "pygame":
        st = setup_pygame()
    elif kind == "vpython":
        sys.path.insert(0, str(Path(__file__).parent / "vpython_stub"))
        import vpython as vp
        simulated_clock(lambda: vp.STATS["sim_time"])  # each rate(n) call moves it on by 1/n seconds
    sys.argv = [script]
    sys.path.insert(0, os.path.dirname(script))
    try:
        runpy.run_path(script, run_name="__main__")
        result["ok"] = True
    except SystemExit as e:
        if e.code in (0, None):
            result["ok"] = True
        else:
            result["error"] = f"the program exited with sys.exit({e.code!r})"
    except StopProgram as e:
        result["error"] = str(e)
    except BaseException as e:  # noqa: BLE001 - report every failure of the checked program
        if vp is not None and isinstance(e, vp.StopSimulation):
            result["ok"] = True
            result["detail"] = f"animation ran {vp.STATS['rate_calls']} frames"
        else:
            tb = traceback.extract_tb(e.__traceback__)
            line, text = user_frame(tb)
            result["error"] = f"{type(e).__name__}: {e}"
            result["error_line"] = line
            result["detail"] = text

    if kind == "pygame":
        result["distinct_frames"] = len(st["looks"])
    if kind == "vpython":
        result["draws"] = vp.STATS["objects"] > 0 or vp.STATS["graphs"] > 0
        result["warnings"] = vp.STATS["warnings"][:5]
        result["distinct_frames"] = len(vp.STATS["states"])
    if kind == "pygame" and result["ok"]:
        if st["frames"] == 0:
            result["ok"] = False
            result["error"] = "the window is never updated: no pygame.display.flip() or update() call ran"
        elif st["quit_at"] is not None:
            result["quit_ok"] = True
    if kind == "vpython":
        stats = vp.STATS
        result["frames"] = stats["rate_calls"]
        if result["ok"] and stats["objects"] == 0 and stats["graphs"] == 0:
            result["ok"] = False
            result["error"] = "the program never creates any VPython object or graph"


try:
    main()
finally:
    Path(result_path).write_text(json.dumps(result), encoding="utf-8")
    os._exit(0)  # skip pygame/atexit cleanup that can hang with dummy drivers
