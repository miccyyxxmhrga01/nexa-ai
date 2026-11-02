"""A strict, browser-free stand-in for VPython 7, used only to test code.

It copies the real package's API (attribute tables from vpython.py 7.6) and behaves
like it, but it fails loudly on mistakes the real one hides or only shows in the
browser:

- a misnamed attribute such as ``position=`` or ``colour=`` (real VPython silently
  stores it as a custom attribute, so the object just never moves or changes colour)
- a tuple or list where a vector is needed (``pos=(1, 2, 3)``); real VPython raises too
- ``vector(1, 2)``, ``vector * vector`` or ``v[0]``; real VPython raises too

``rate()`` counts frames and ends the run after VP_MAX_RATE calls, so an animation
loop finishes. A loop with no ``rate()`` never ends; the harness reports that as a
timeout. Every so often ``rate()`` also fires the program's bound key, mouse and widget
handlers, so their code runs too.
"""

import inspect
import math
import os
from math import *  # noqa: F401,F403  (real vpython re-exports math)
from random import random  # noqa: F401  (real vpython exports random())

from numpy import arange  # noqa: F401  (real vpython exports arange)

MAX_RATE = int(os.environ.get("VP_MAX_RATE", "300"))
STATS = {"rate_calls": 0, "objects": 0, "graphs": 0, "handlers_fired": 0, "states": set(), "sim_time": 0.0,
         "warnings": []}
_ALL = []  # every object, curve and graph line made, to see whether anything changes over time


class StopSimulation(BaseException):
    """Ends the run after enough frames. BaseException so `except Exception` can't catch it."""


class VPythonMistake(Exception):
    """Raised for code that real VPython accepts but that doesn't do what was meant."""


# Attribute names people (and models) often use that VPython doesn't have.
MISNAMED = {
    "position": "pos", "location": "pos", "center": "pos", "centre": "pos", "loc": "pos",
    "colour": "color", "col": "color", "rad": "radius",
    "velocity_vector": "a custom name like velocity", "direction": "axis",
    "transparency": "opacity", "alpha": "opacity", "trail": "make_trail",
    "trail_length": "retain", "label_text": "text",
}
CANVAS_MISNAMED = {
    "bg": "background", "bgcolor": "background", "background_color": "background",
    "backgroundcolor": "background", "color": "background", "size": "width and height",
    "autocenter": "center", "name": "title",
}
GRAPH_MISNAMED = {
    "xlabel": "xtitle", "ylabel": "ytitle", "x_title": "xtitle", "y_title": "ytitle",
    "x_label": "xtitle", "y_label": "ytitle", "name": "title", "label": "title",
    "x_min": "xmin", "x_max": "xmax", "y_min": "ymin", "y_max": "ymax",
}


def _misnamed(kind, key, table):
    if key in table:
        raise VPythonMistake(
            f"{kind} has no attribute '{key}' (use '{table[key]}'). Real VPython would "
            f"silently store '{key}' as a custom attribute, so it would have no effect."
        )


# ---------------------------------------------------------------- vectors


class vector:
    __slots__ = ("_x", "_y", "_z")

    @staticmethod
    def random():
        return vector(-1.0 + 2.0 * random(), -1.0 + 2.0 * random(), -1.0 + 2.0 * random())

    def __init__(self, *args):
        if len(args) == 3:
            self._x, self._y, self._z = float(args[0]), float(args[1]), float(args[2])
        elif len(args) == 1 and isinstance(args[0], vector):
            self._x, self._y, self._z = args[0]._x, args[0]._y, args[0]._z
        else:
            raise TypeError("A vector needs 3 components.")

    x = property(lambda s: s._x, lambda s, v: setattr(s, "_x", float(v)))
    y = property(lambda s: s._y, lambda s, v: setattr(s, "_y", float(v)))
    z = property(lambda s: s._z, lambda s, v: setattr(s, "_z", float(v)))

    @property
    def value(self):
        return [self._x, self._y, self._z]

    @value.setter
    def value(self, other):
        self._x, self._y, self._z = other._x, other._y, other._z

    def __str__(self):
        return f"<{self._x:.6g}, {self._y:.6g}, {self._z:.6g}>"

    def __repr__(self):
        return f"vector({self._x:.6g}, {self._y:.6g}, {self._z:.6g})"

    def __neg__(self):
        return vector(-self._x, -self._y, -self._z)

    def __pos__(self):
        return self

    def __add__(self, other):
        if type(other) is vector:
            return vector(self._x + other._x, self._y + other._y, self._z + other._z)
        return NotImplemented

    def __sub__(self, other):
        if type(other) is vector:
            return vector(self._x - other._x, self._y - other._y, self._z - other._z)
        return NotImplemented

    def __truediv__(self, other):
        if isinstance(other, (float, int)):
            return vector(self._x / other, self._y / other, self._z / other)
        return NotImplemented

    def __mul__(self, other):
        if isinstance(other, (float, int)):
            return vector(self._x * other, self._y * other, self._z * other)
        return NotImplemented

    __rmul__ = __mul__

    def __eq__(self, other):
        return type(other) is vector and self.equals(other)

    def __ne__(self, other):
        return not self.__eq__(other)

    __hash__ = None

    def equals(self, v):
        return self._x == v._x and self._y == v._y and self._z == v._z

    @property
    def mag(self):
        return math.sqrt(self._x ** 2 + self._y ** 2 + self._z ** 2)

    @mag.setter
    def mag(self, value):
        n = self.norm()
        self._x, self._y, self._z = n._x * value, n._y * value, n._z * value

    @property
    def mag2(self):
        return self._x ** 2 + self._y ** 2 + self._z ** 2

    @mag2.setter
    def mag2(self, value):
        self.mag = math.sqrt(value)

    @property
    def hat(self):
        return self.norm()

    @hat.setter
    def hat(self, value):
        m = self.mag
        n = vector(value).norm()
        self._x, self._y, self._z = n._x * m, n._y * m, n._z * m

    def norm(self):
        m = self.mag
        return vector(0, 0, 0) if m == 0 else vector(self._x / m, self._y / m, self._z / m)

    def dot(self, other):
        return self._x * other._x + self._y * other._y + self._z * other._z

    def cross(self, other):
        return vector(
            self._y * other._z - self._z * other._y,
            self._z * other._x - self._x * other._z,
            self._x * other._y - self._y * other._x,
        )

    def proj(self, other):
        n = other.norm()
        return n * self.dot(n)

    def comp(self, other):
        return self.dot(other.norm())

    def diff_angle(self, other):
        a, b = self.norm(), other.norm()
        return math.acos(max(-1.0, min(1.0, a.dot(b))))

    def rotate(self, angle=0.0, axis=None):
        axis = vector(0, 0, 1) if axis is None else axis
        k = axis.norm()
        c, s = math.cos(angle), math.sin(angle)
        return self * c + k.cross(self) * s + k * (k.dot(self) * (1 - c))

    def rotate_in_place(self, angle=0.0, axis=None):
        self.value = self.rotate(angle, axis)


vec = vector


def mag(v):
    return v.mag


def mag2(v):
    return v.mag2


def norm(v):
    return v.norm()


def hat(v):
    return v.norm()


def dot(a, b):
    return a.dot(b)


def cross(a, b):
    return a.cross(b)


def proj(a, b):
    return a.proj(b)


def comp(a, b):
    return a.comp(b)


def diff_angle(a, b):
    return a.diff_angle(b)


def rotate(v, angle=0.0, axis=None):
    return v.rotate(angle, axis)


def sign(x):
    return 1 if x > 0 else -1 if x < 0 else 0


def combin(a, b):
    return math.comb(int(a), int(b))


def set_browser(type="default"):
    pass


class color:
    black = vector(0, 0, 0)
    white = vector(1, 1, 1)
    red = vector(1, 0, 0)
    green = vector(0, 1, 0)
    blue = vector(0, 0, 1)
    yellow = vector(1, 1, 0)
    cyan = vector(0, 1, 1)
    magenta = vector(1, 0, 1)
    orange = vector(1, 0.6, 0)
    purple = vector(0.4, 0.2, 0.6)

    @classmethod
    def gray(cls, luminance):
        return vector(luminance, luminance, luminance)

    @classmethod
    def rgb_to_hsv(cls, v):
        import colorsys
        return vector(*colorsys.rgb_to_hsv(v.x, v.y, v.z))

    @classmethod
    def hsv_to_rgb(cls, v):
        import colorsys
        return vector(*colorsys.hsv_to_rgb(v.x, v.y, v.z))

    @classmethod
    def rgb_to_grayscale(cls, v):
        lum = 0.21 * v.x + 0.71 * v.y + 0.07 * v.z
        return vector(lum, lum, lum)


def _need_vector(kind, name, value):
    if not isinstance(value, vector):
        raise AttributeError(f"{name} must be a vector (in {kind}); use vector(x, y, z), not {value!r}")


# ---------------------------------------------------------------- canvas, mouse, camera


class _Event:
    def __init__(self, event, canvas, **kw):
        self.event = event
        self.type = event
        self.canvas = canvas
        self.pos = kw.pop("pos", vector(0, 0, 0))
        self.key = kw.pop("key", "")
        self.which = kw.pop("which", 0)
        self.shift = self.ctrl = self.alt = False
        for k, v in kw.items():
            setattr(self, k, v)


class Mouse:
    def __init__(self, canvas):
        self.canvas = canvas
        self.pos = vector(0, 0, 0)
        self.ray = vector(0, 0, -1)
        self.pick = None
        self.shift = self.ctrl = self.alt = False

    def project(self, normal=None, point=None, d=None):
        return vector(self.pos)

    def getclick(self):
        return _Event("click", self.canvas, pos=vector(self.pos))


class Camera:
    def __init__(self, canvas):
        self.canvas = canvas
        self.pos = vector(0, 0, 10)
        self.axis = vector(0, 0, -10)
        self.up = vector(0, 1, 0)

    def rotate(self, angle=0.0, axis=None, origin=None):
        self.axis = self.axis.rotate(angle, axis or vector(0, 1, 0))

    def follow(self, obj):
        self.canvas.center = obj.pos if hasattr(obj, "pos") else vector(0, 0, 0)


_CANVAS_VECTORS = {"background", "foreground", "ambient", "center", "forward", "up", "axis"}


class canvas:
    selected = None

    def __init__(self, **kw):
        d = self.__dict__
        d["_handlers"] = []  # [event names, function]
        d["title"] = ""
        d["caption"] = ""
        d["width"] = 640
        d["height"] = 400
        d["background"] = vector(0, 0, 0)
        d["foreground"] = vector(1, 1, 1)
        d["ambient"] = vector(0.2, 0.2, 0.2)
        d["center"] = vector(0, 0, 0)
        d["forward"] = vector(0, 0, -1)
        d["up"] = vector(0, 1, 0)
        d["axis"] = vector(0, 0, -10)
        d["range"] = 10.0
        d["autoscale"] = True
        d["userzoom"] = d["userspin"] = d["userpan"] = True
        d["fov"] = math.pi / 3
        d["visible"] = True
        d["resizable"] = True
        d["align"] = "none"
        d["lights"] = []
        d["objects"] = []
        d["mouse"] = Mouse(self)
        d["camera"] = Camera(self)
        d["title_anchor"] = [0, 1]
        d["caption_anchor"] = [0, 2]
        for k, v in kw.items():
            setattr(self, k, v)
        canvas.selected = self

    def __setattr__(self, key, value):
        # Real VPython quietly stores unknown canvas settings; the window just keeps its default
        # look, so this is only a warning (a misnamed object attribute like position= stays an error)
        if key in CANVAS_MISNAMED:
            STATS["warnings"].append(f"canvas has no '{key}' (use '{CANVAS_MISNAMED[key]}'); it has no effect")
        if key in _CANVAS_VECTORS:
            _need_vector("canvas", key, value)
        if key == "range" and not isinstance(value, (int, float)):
            raise TypeError("canvas.range must be a number")
        self.__dict__[key] = value

    def bind(self, events, fn):
        if not callable(fn):
            raise TypeError("bind() needs a function as its second argument")
        self._handlers.append((events.split(), fn))

    def unbind(self, events, fn):
        self.__dict__["_handlers"] = [h for h in self._handlers if h[1] is not fn]

    def waitfor(self, events, *args):
        rate()  # counts as a frame so a `while True: scene.waitfor(...)` loop still ends
        name = events.split()[0]
        if name in ("keydown", "keyup", "keyinput"):
            return _Event(name, self, key="right")
        return _Event(name, self, pos=vector(1, 1, 0))

    def pause(self, *args):
        rate()
        return _Event("click", self, pos=vector(0, 0, 0))

    def append_to_caption(self, *args):
        self.__dict__["caption"] += "".join(str(a) for a in args)

    def append_to_title(self, *args):
        self.__dict__["title"] += "".join(str(a) for a in args)

    def select(self):
        canvas.selected = self

    def delete(self):
        pass

    def capture(self, filename, *args):
        pass

    def follow(self, obj):
        self.camera.follow(obj)

    def get_selected(self):
        return canvas.selected

    def pixel_to_world(self, *args):
        return 1.0

    def _fire(self, name, **kw):
        for events, fn in list(self._handlers):
            if name in events:
                STATS["handlers_fired"] += 1
                _call(fn, _Event(name, self, **kw))


def _call(fn, arg):
    """Calls a bound function the way VPython does: with the event/widget, or with nothing."""
    try:
        params = inspect.signature(fn).parameters.values()
        needed = [p for p in params if p.default is p.empty and p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
    except (TypeError, ValueError):
        needed = [None]
    return fn(arg) if needed else fn()


scene = canvas()

# ---------------------------------------------------------------- 3D objects

# From vpython.py: per object, [vector attrs, vector attrs with side effects, scalars, scalars with side effects].
_BOX = [["pos", "color", "trail_color"], ["axis", "size", "up"],
        ["visible", "opacity", "shininess", "emissive", "make_trail", "trail_type", "interval",
         "retain", "trail_color", "trail_radius", "texture", "pickable"],
        ["red", "green", "blue", "length", "width", "height"]]
_SPHERE = [_BOX[0], _BOX[1], _BOX[2], _BOX[3] + ["radius"]]
ATTRS = {
    "box": _BOX, "pyramid": _BOX, "sphere": _SPHERE, "simple_sphere": _SPHERE,
    "cylinder": _SPHERE, "cone": _SPHERE, "ellipsoid": _SPHERE,
    "arrow": [["pos", "color", "trail_color"], ["axis", "size", "up"],
              _BOX[2] + ["frame", "material", "round", "shaftwidth", "headwidth", "headlength"],
              _BOX[3]],
    "ring": [["pos", "color", "trail_color", "size"], ["axis", "up"], _BOX[2], _BOX[3] + ["thickness", "radius"]],
    "helix": [["pos", "color", "trail_color"], ["axis", "size", "up"],
              _BOX[2] + ["ccw", "coils", "thickness"], _BOX[3] + ["radius"]],
    "label": [["pos", "color", "background", "linecolor"], [],
              ["visible", "xoffset", "yoffset", "font", "height", "opacity", "border", "line", "box",
               "space", "align", "linewidth", "pixel_pos"], ["text"]],
    "compound": [["pos", "color", "trail_color"], ["axis", "size", "up", "origin"],
                 _BOX[2] + ["obj_idxs"], _BOX[3]],
    "text": [["pos", "up", "color", "start_face_color", "end_face_color", "axis"], [],
             ["visible", "opacity", "shininess", "emissive", "make_trail", "trail_type", "interval",
              "retain", "trail_color", "trail_radius", "pickable", "align", "text", "font",
              "billboard", "show_start_face", "show_end_face", "descender", "vertical_spacing",
              "depth", "length", "width", "height"], ["red", "green", "blue"]],
    "extrusion": [["pos", "color", "start_face_color", "end_face_color", "start_normal", "end_normal"],
                  ["axis", "size", "up"],
                  ["path", "shape", "visible", "opacity", "shininess", "emissive", "show_start_face",
                   "show_end_face", "smooth", "smooth_joints", "sharp_joints", "scale", "xscale",
                   "yscale", "twist", "make_trail", "trail_type", "interval", "retain",
                   "trail_color", "trail_radius", "texture", "pickable"], _BOX[3]],
    "local_light": [["pos", "color", "offset"], [], ["visible", "attach_idx"], []],
    "distant_light": [["direction", "color"], [], ["visible"], []],
    "vertex": [["pos", "color", "normal", "bumpaxis", "texpos"], [], ["visible", "opacity", "shininess", "emissive"], ["red", "green", "blue"]],
    "triangle": [[], [], ["texture", "bumpmap", "visible", "pickable"], ["v0", "v1", "v2"]],
    "quad": [[], [], ["texture", "bumpmap", "visible", "pickable"], ["v0", "v1", "v2", "v3"]],
}
DEFAULT_SIZE = {
    "box": (1, 1, 1), "pyramid": (1, 1, 1), "sphere": (2, 2, 2), "simple_sphere": (2, 2, 2),
    "cylinder": (1, 2, 2), "cone": (1, 2, 2), "ellipsoid": (1, 1, 1), "arrow": (1, 0.1, 0.1),
    "ring": (0.2, 2.2, 2.2), "helix": (1, 2, 2), "compound": (1, 1, 1), "extrusion": (1, 1, 1),
    "text": (1, 1, 1),
}
# Objects whose size isn't tied to the length of their axis.
_UNSIZED = ("sphere", "simple_sphere", "ring", "text", "compound")


class _Obj:
    _kind = "object"

    def __init__(self, **kw):
        kind = self._kind
        d = self.__dict__
        size = DEFAULT_SIZE.get(kind, (1, 1, 1))
        d["pos"] = vector(0, 0, 0)
        d["axis"] = vector(size[0], 0, 0)
        d["up"] = vector(0, 1, 0)
        d["size"] = vector(*size)
        d["color"] = vector(1, 1, 1)
        d["trail_color"] = vector(1, 1, 1)
        d["visible"] = True
        d["opacity"] = 1.0
        d["shininess"] = 0.6
        d["emissive"] = False
        d["make_trail"] = False
        d["texture"] = None
        d["canvas"] = kw.pop("canvas", canvas.selected)
        d["_trail"] = []
        for k, v in kw.items():
            setattr(self, k, v)
        if d["make_trail"]:
            d["_trail"].append(vector(d["pos"]))
        STATS["objects"] += 1
        _ALL.append(self)
        if d["canvas"] is not None:
            d["canvas"].objects.append(self)

    # Every attribute assignment goes through here, as in the real setters.
    def __setattr__(self, key, value):
        kind = self._kind
        _misnamed(f"{kind}()", key, MISNAMED)
        table = ATTRS.get(kind, _BOX)
        if key in table[0] or key in table[1]:
            _need_vector(f"{kind}()", key, value)
            value = vector(value)
        d = self.__dict__
        if key == "pos" and d.get("make_trail"):
            d["_trail"].append(vector(value))
        if key == "axis":
            d["axis"] = value
            if kind not in _UNSIZED:
                d["size"] = vector(value.mag, d["size"].y, d["size"].z)
            return
        if key == "size":
            d["size"] = value
            if kind not in _UNSIZED:
                d["axis"] = d["axis"].norm() * value.x
            return
        if key in ("length", "width", "height", "radius", "thickness"):
            if not isinstance(value, (int, float)):
                raise TypeError(f"{kind}.{key} must be a number, not {value!r}")
            self._set_scalar(key, float(value))
            return
        if key in ("red", "green", "blue"):
            c = d["color"]
            d["color"] = vector(value if key == "red" else c.x, value if key == "green" else c.y,
                                value if key == "blue" else c.z)
            return
        if key == "opacity" and not isinstance(value, (int, float)):
            raise TypeError(f"{kind}.opacity must be a number from 0 to 1")
        d[key] = value

    def _set_scalar(self, key, v):
        d = self.__dict__
        s = d["size"]
        if key == "length":
            d["size"] = vector(v, s.y, s.z)
            if self._kind not in _UNSIZED:
                d["axis"] = d["axis"].norm() * v
        elif key == "height":
            d["size"] = vector(s.x, v, s.z)
        elif key == "width":
            d["size"] = vector(s.x, s.y, v)
        elif key == "radius":
            if self._kind in ("sphere", "simple_sphere"):
                d["size"] = vector(2 * v, 2 * v, 2 * v)
            elif self._kind == "ring":
                d["size"] = vector(s.x, 2 * v + s.x, 2 * v + s.x)
            else:
                d["size"] = vector(s.x, 2 * v, 2 * v)
        elif key == "thickness":
            d["size"] = vector(v, s.y, s.z)

    @property
    def length(self):
        return self.size.x

    @property
    def height(self):
        return self.size.y

    @property
    def width(self):
        return self.size.z

    @property
    def radius(self):
        if self._kind in ("sphere", "simple_sphere"):
            return self.size.x / 2
        if self._kind == "ring":
            return (self.size.y - self.size.x) / 2
        return self.size.y / 2

    @property
    def thickness(self):
        return self.size.x

    @property
    def red(self):
        return self.color.x

    @property
    def green(self):
        return self.color.y

    @property
    def blue(self):
        return self.color.z

    def rotate(self, angle=0.0, axis=None, origin=None):
        if not isinstance(angle, (int, float)):
            raise TypeError("rotate(angle=...) needs the angle in radians as a number")
        axis = vector(0, 0, 1) if axis is None else axis
        _need_vector(f"{self._kind}.rotate()", "axis", axis)
        if origin is not None:
            _need_vector(f"{self._kind}.rotate()", "origin", origin)
            self.pos = origin + (self.pos - origin).rotate(angle, axis)
        self.__dict__["axis"] = self.axis.rotate(angle, axis)
        self.__dict__["up"] = self.up.rotate(angle, axis)

    def clone(self, **kw):
        attrs = {k: v for k, v in self.__dict__.items() if not k.startswith("_") and k != "canvas"}
        attrs.update(kw)
        return type(self)(**attrs)

    def clear_trail(self):
        self.__dict__["_trail"] = []

    def delete(self):
        self.__dict__["visible"] = False


def _make(kind):
    return type(kind, (_Obj,), {"_kind": kind})


box = _make("box")
sphere = _make("sphere")
simple_sphere = _make("simple_sphere")
cylinder = _make("cylinder")
cone = _make("cone")
pyramid = _make("pyramid")
ellipsoid = _make("ellipsoid")
arrow = _make("arrow")
ring = _make("ring")
helix = _make("helix")
extrusion = _make("extrusion")
local_light = _make("local_light")
distant_light = _make("distant_light")
vertex = _make("vertex")
triangle = _make("triangle")
quad = _make("quad")


class label(_Obj):
    _kind = "label"

    def __init__(self, **kw):
        self.__dict__["text"] = ""
        self.__dict__["_height"] = 13
        super().__init__(**kw)

    def __setattr__(self, key, value):
        if key == "text":
            self.__dict__["text"] = str(value)  # real VPython shows any value as text
            return
        if key == "height":
            self.__dict__["_height"] = value
            return
        super().__setattr__(key, value)

    @property
    def height(self):
        return self.__dict__["_height"]


class text(_Obj):
    _kind = "text"

    def __init__(self, **kw):
        if "text" not in kw:
            raise TypeError("text() needs text='...'")
        super().__init__(**kw)


class compound(_Obj):
    _kind = "compound"

    def __init__(self, objs, **kw):
        if not isinstance(objs, (list, tuple)) or not all(isinstance(o, _Obj) for o in objs):
            raise TypeError("compound() needs a list of 3D objects as its first argument")
        for o in objs:
            o.__dict__["visible"] = False
        super().__init__(**kw)


class frame:
    def __init__(self, **kw):
        raise NameError("frame is not yet implemented (VPython 7 uses compound() instead)")


def _point_list(args, kw):
    pts = []
    for a in args:
        if isinstance(a, (list, tuple)):
            pts.extend(a)
        else:
            pts.append(a)
    if "pos" in kw:
        p = kw.pop("pos")
        pts.extend(p if isinstance(p, (list, tuple)) else [p])
    out = []
    for p in pts:
        if isinstance(p, dict):
            p = p.get("pos")
        _need_vector("curve/points", "each point", p)
        out.append(vector(p))
    return out


class curve:
    _kind = "curve"

    def __init__(self, *args, **kw):
        d = self.__dict__
        d["_points"] = _point_list(args, kw)
        d["color"] = vector(1, 1, 1)
        d["radius"] = 0.0
        d["origin"] = vector(0, 0, 0)
        d["visible"] = True
        d["retain"] = -1
        d["canvas"] = kw.pop("canvas", canvas.selected)
        for k, v in kw.items():
            setattr(self, k, v)
        STATS["objects"] += 1
        _ALL.append(self)

    def __setattr__(self, key, value):
        _misnamed(f"{self._kind}()", key, MISNAMED)
        if key in ("color", "origin", "axis", "size", "up"):
            _need_vector(f"{self._kind}()", key, value)
        self.__dict__[key] = value

    def append(self, *args, **kw):
        if "pos" in kw:
            args = args + (kw.pop("pos"),)
        if "color" in kw:
            _need_vector(f"{self._kind}.append()", "color", kw.pop("color"))
        for k in ("radius", "visible", "retain"):
            kw.pop(k, None)
        if kw:
            raise TypeError(f"{self._kind}.append() got unexpected keyword(s): {', '.join(kw)}")
        if not args:
            raise TypeError(f"{self._kind}.append() needs a point, e.g. append(vector(1, 2, 0))")
        self._points.extend(_point_list(args, {}))
        r = self.retain
        if isinstance(r, int) and r > 0:
            del self._points[:-r]

    def clear(self):
        self._points.clear()

    @property
    def npoints(self):
        return len(self._points)

    def point(self, n):
        return {"pos": self._points[n], "color": self.color, "radius": self.radius, "visible": True}

    def modify(self, n, *args, **kw):
        if args:
            _need_vector(f"{self._kind}.modify()", "pos", args[0])
            self._points[n] = vector(args[0])
        if "pos" in kw:
            _need_vector(f"{self._kind}.modify()", "pos", kw["pos"])
            self._points[n] = vector(kw["pos"])

    def pop(self, n=-1):
        return {"pos": self._points.pop(n)}

    def shift(self):
        return {"pos": self._points.pop(0)}

    def unshift(self, *args, **kw):
        self._points[:0] = _point_list(args, kw)

    def slice(self, a, b):
        return [{"pos": p} for p in self._points[a:b]]

    def splice(self, start, howmany, *args):
        self._points[start:start + howmany] = _point_list(args, {})

    def rotate(self, angle=0.0, axis=None, origin=None):
        pass

    def delete(self):
        self.__dict__["visible"] = False


class points(curve):
    _kind = "points"


class _Trail:
    def __init__(self, obj, **kw):
        if not isinstance(obj, _Obj):
            raise TypeError("attach_trail() needs an object, e.g. attach_trail(ball)")
        if "color" in kw:
            _need_vector("attach_trail()", "color", kw["color"])
        self.obj = obj

    def start(self):
        pass

    def stop(self):
        pass

    def clear(self):
        pass


def attach_trail(obj, **kw):
    return _Trail(obj, **kw)


def attach_arrow(obj, attr, **kw):
    if not hasattr(obj, attr):
        raise AttributeError(f"attach_arrow(): the object has no attribute '{attr}' yet; set it before attaching")
    _need_vector("attach_arrow()", attr, getattr(obj, attr))
    return _Trail(obj)


def attach_light(obj, **kw):
    return local_light(pos=obj.pos)


class _Names:
    """textures.wood, bumpmaps.stucco, ... : any name gives a string."""

    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        return name


textures = _Names()
bumpmaps = _Names()


class _Shapes:
    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        return lambda **kw: [[0, 0], [1, 0], [1, 1], [0, 1]]


class _Paths:
    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        return lambda **kw: [vector(0, 0, 0), vector(1, 0, 0), vector(1, 1, 0)]


shapes = _Shapes()
paths = _Paths()

# ---------------------------------------------------------------- graphs


class graph:
    _ALLOWED = {"title", "xtitle", "ytitle", "width", "height", "xmin", "xmax", "ymin", "ymax",
                "logx", "logy", "fast", "scroll", "align", "background", "foreground", "visible"}
    selected = None

    def __init__(self, **kw):
        for k, v in kw.items():
            _misnamed("graph()", k, GRAPH_MISNAMED)
            if k not in self._ALLOWED:
                raise TypeError(f"graph() got an unexpected keyword '{k}'")
            if k in ("background", "foreground"):
                _need_vector("graph()", k, v)
            self.__dict__[k] = v
        if kw.get("scroll") and not ("xmin" in kw and "xmax" in kw):
            raise AttributeError("graph(scroll=True) needs xmin and xmax")
        graph.selected = self
        STATS["graphs"] += 1

    def delete(self):
        pass


class _GObj:
    _ALLOWED = {"graph", "color", "label", "legend", "width", "markers", "marker_color", "dot",
                "dot_color", "dot_radius", "radius", "size", "delta", "data", "interval", "fast",
                "visible", "horizontal"}

    def __init__(self, **kw):
        d = self.__dict__
        d["_data"] = []
        d["color"] = vector(0, 0, 0)
        for k, v in kw.items():
            if k == "pos":
                raise TypeError(f"{type(self).__name__}() uses data=[...] (or .plot()), not pos=")
            if k not in self._ALLOWED:
                raise TypeError(f"{type(self).__name__}() got an unexpected keyword '{k}'")
            if k in ("color", "marker_color", "dot_color"):
                _need_vector(type(self).__name__ + "()", k, v)
            if k == "graph" and not isinstance(v, graph):
                raise TypeError(f"{type(self).__name__}(graph=...) needs a graph() object")
            if k == "data":
                self.plot(v)
                continue
            d[k] = v
        if graph.selected is None and "graph" not in kw:
            graph()  # real VPython makes a default graph
        _ALL.append(self)

    def __setattr__(self, key, value):
        if key == "data":
            self.__dict__["_data"] = []
            self.plot(value)
            return
        if key in ("color", "marker_color", "dot_color"):
            _need_vector(type(self).__name__, key, value)
        self.__dict__[key] = value

    @property
    def data(self):
        return list(self._data)

    def plot(self, *args, **kw):
        if "pos" in kw:
            args = (kw.pop("pos"),)
        if "data" in kw:
            args = (kw.pop("data"),)
        if kw:
            raise TypeError(f"plot() got unexpected keyword(s): {', '.join(kw)}")
        if len(args) == 2:
            pts = [args]
        elif len(args) == 1 and isinstance(args[0], (list, tuple)):
            a = args[0]
            if len(a) == 2 and all(isinstance(t, (int, float)) for t in a):
                pts = [a]
            else:
                pts = list(a)
        else:
            raise TypeError("plot() needs x, y numbers or [x, y] pairs")
        for p in pts:
            if not (isinstance(p, (list, tuple)) and len(p) == 2):
                raise TypeError(f"plot() point {p!r} is not an [x, y] pair")
            x, y = p
            float(x), float(y)  # raises for vectors or strings, like the real one
            self._data.append([x, y])

    def delete(self):
        self._data.clear()


class gcurve(_GObj):
    pass


class gdots(_GObj):
    pass


class gvbars(_GObj):
    pass


class ghbars(_GObj):
    pass


gobj = _GObj

# ---------------------------------------------------------------- widgets

_WIDGETS = []


class _Widget:
    _ALLOWED = {"bind", "pos", "text", "disabled", "canvas"}

    def __init__(self, **kw):
        extra = set(kw) - self._ALLOWED
        if extra:
            raise TypeError(f"{type(self).__name__}() got unexpected keyword(s): {', '.join(sorted(extra))}")
        if "bind" in kw and not callable(kw["bind"]):
            raise TypeError(f"{type(self).__name__}(bind=...) needs a function (without calling it)")
        self.bind = kw.pop("bind", None)
        self.disabled = False
        self.text = ""
        for k, v in kw.items():
            setattr(self, k, v)
        _WIDGETS.append(self)

    def delete(self):
        if self in _WIDGETS:
            _WIDGETS.remove(self)

    def _fire(self):
        if self.bind is not None and not self.disabled:
            STATS["handlers_fired"] += 1
            _call(self.bind, self)


class button(_Widget):
    _ALLOWED = _Widget._ALLOWED | {"color", "background", "textcolor"}

    def __init__(self, **kw):
        if "bind" not in kw:
            raise TypeError("button() needs bind=function")
        super().__init__(**kw)


class checkbox(_Widget):
    _ALLOWED = _Widget._ALLOWED | {"checked"}

    def __init__(self, **kw):
        if "bind" not in kw:
            raise TypeError(f"{type(self).__name__}() needs bind=function")
        self.checked = False
        super().__init__(**kw)

    def _fire(self):
        self.checked = not self.checked
        super()._fire()


class radio(checkbox):
    _ALLOWED = checkbox._ALLOWED | {"name"}


class slider(_Widget):
    _ALLOWED = _Widget._ALLOWED | {"min", "max", "value", "step", "length", "width", "left",
                                   "right", "top", "bottom", "vertical", "align"}

    def __init__(self, **kw):
        if "bind" not in kw:
            raise TypeError("slider() needs bind=function")
        self.min, self.max, self.step = 0.0, 1.0, 0.01
        self.value = kw.get("min", 0.0)
        super().__init__(**kw)
        if self.min >= self.max:
            raise ValueError("slider() min must be less than max")

    def _fire(self):
        self.value = self.min + (self.max - self.min) * random()
        super()._fire()


class menu(_Widget):
    _ALLOWED = _Widget._ALLOWED | {"choices", "index", "selected"}

    def __init__(self, **kw):
        if "bind" not in kw:
            raise TypeError("menu() needs bind=function")
        if not isinstance(kw.get("choices"), (list, tuple)) or not kw["choices"]:
            raise TypeError("menu() needs choices=['...', '...']")
        self.index = 0
        super().__init__(**kw)
        self.selected = self.choices[self.index]

    def _fire(self):
        self.index = (self.index + 1) % len(self.choices)
        self.selected = self.choices[self.index]
        super()._fire()


class winput(_Widget):
    _ALLOWED = _Widget._ALLOWED | {"prompt", "type", "width", "height", "number"}

    def __init__(self, **kw):
        if "bind" not in kw:
            raise TypeError("winput() needs bind=function")
        self.number = None
        super().__init__(**kw)

    def _fire(self):
        self.text, self.number = "3", 3.0
        super()._fire()


class wtext:
    def __init__(self, text="", pos=None, canvas=None):
        self.text = text

    def __setattr__(self, key, value):
        object.__setattr__(self, key, str(value) if key == "text" else value)

    def delete(self):
        pass


# ---------------------------------------------------------------- time


_KEY_SCRIPT = ["left", "right", "up", "down", " ", "a", "d", "w", "s"]


def keysdown():
    n = STATS["rate_calls"]
    if (n // 20) % 2 == 1:
        return [_KEY_SCRIPT[(n // 40) % len(_KEY_SCRIPT)]]
    return []


def _fire_events():
    n = STATS["rate_calls"]
    c = canvas.selected or scene
    key = _KEY_SCRIPT[(n // 25) % len(_KEY_SCRIPT)]
    if n % 25 == 5:
        c._fire("keydown", key=key)
    if n % 25 == 9:
        c._fire("keyup", key=key)
    if n % 50 == 15:
        c.mouse.pos = vector(1.5, 1.0, 0)
        for name in ("mousedown", "mouseup", "click"):
            c._fire(name, pos=vector(1.5, 1.0, 0))
    if n % 50 == 30:
        c._fire("mousemove", pos=vector(-1.0, 0.5, 0))
    if n % 60 == 40:
        for w in list(_WIDGETS):
            w._fire()


def _vec(v, digits=4):
    return (round(v._x, digits), round(v._y, digits), round(v._z, digits))


def _snapshot():
    """A fingerprint of everything visible, to count how many different frames a program shows."""
    parts = []
    for o in _ALL:
        d = o.__dict__
        if isinstance(o, _Obj):
            parts.append((_vec(d["pos"]), _vec(d["axis"]), _vec(d["size"]), _vec(d["color"], 3),
                          d.get("visible"), d.get("text")))
        elif isinstance(o, curve):
            pts = d["_points"]
            parts.append((len(pts), _vec(pts[-1]) if pts else None, _vec(pts[0]) if pts else None))
        else:  # a graph line: its length and newest points (bars can change without growing)
            data = d["_data"]
            parts.append((len(data), tuple(tuple(p) for p in data[-3:])))
    c = canvas.selected or scene
    parts.append((_vec(c.camera.axis), _vec(c.center), _vec(c.forward), c.range))
    return hash(tuple(parts))


def rate(n=60):
    if not isinstance(n, (int, float)) or n <= 0:
        raise ValueError("rate() needs a positive number of loops per second, e.g. rate(60)")
    STATS["rate_calls"] += 1
    STATS["sim_time"] += 1 / n
    _fire_events()
    if STATS["rate_calls"] > 5:  # skip the first few, while the scene may still be being built
        STATS["states"].add(_snapshot())
    if STATS["rate_calls"] >= MAX_RATE:
        raise StopSimulation()


def sleep(t):
    rate()


class clock:
    pass


def event_return(*args):
    pass


# What `from vpython import *` gives you: like the real package, the VPython names plus
# math's functions, arange and random(), but not this stub's own helpers or modules.
_HIDDEN = {"inspect", "math", "os", "MAX_RATE", "STATS", "StopSimulation", "VPythonMistake", "MISNAMED",
           "CANVAS_MISNAMED", "GRAPH_MISNAMED", "ATTRS", "DEFAULT_SIZE"}
__all__ = [name for name in dir() if not name.startswith("_") and name not in _HIDDEN]
