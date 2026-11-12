#!/usr/bin/env python3
"""One-off helper for the throwaway check: tries to unfold the iPhone Duo simulator through the
Simulator app's own menus and window buttons (there is no command line switch for it), and prints
what it finds. Usage: unfold.py <udid> <probe bundle id>"""
import re, subprocess, sys, time

UDID, BID = sys.argv[1], sys.argv[2]


def sh(args, t=40):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=t)
        return r.returncode, (r.stdout or "").strip(), (r.stderr or "").strip()
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"


def osa(script, t=30):
    return sh(["osascript", "-e", script], t)


def front():
    return osa('tell application "System Events" to set frontmost of process "Simulator" to true')


def screen():
    """Size of the screen the probe app is shown on, in points, e.g. (466, 678)."""
    sh(["xcrun", "simctl", "terminate", UDID, BID])
    code, out, _ = sh(["xcrun", "simctl", "get_app_container", UDID, BID, "data"])
    if code == 0 and out:
        sh(["rm", "-f", out + "/Documents/result.txt"])
    sh(["xcrun", "simctl", "launch", UDID, BID, "web"])
    time.sleep(4)
    code, out, _ = sh(["xcrun", "simctl", "get_app_container", UDID, BID, "data"])
    try:
        text = open(out + "/Documents/result.txt").read()
    except OSError:
        return None
    m = re.findall(r"screen x[\d.]+ y[\d.]+ w(\d+)\.0 h(\d+)\.0", text)
    return (int(m[-1][0]), int(m[-1][1])) if m else None


def unfolded(size):
    """The inside screen is 669 x 951; the outside one is 466 x 678 either way up."""
    return bool(size) and min(size) >= 600


DUMP = '''
tell application "System Events"
  tell process "Simulator"
    set out to ""
    repeat with m in menu bar items of menu bar 1
      set out to out & "MENU|" & (name of m) & linefeed
      try
        repeat with i in menu items of menu 1 of m
          set nm to name of i
          if nm is missing value then set nm to "-"
          set out to out & "ITEM|" & nm & linefeed
          try
            repeat with j in menu items of menu 1 of i
              set n2 to name of j
              if n2 is missing value then set n2 to "-"
              set out to out & "SUB|" & n2 & linefeed
            end repeat
          end try
        end repeat
      end try
    end repeat
    return out
  end tell
end tell
'''

# every button in the Simulator's windows, with whatever names it carries
BUTTONS = '''
tell application "System Events"
  tell process "Simulator"
    set out to ""
    repeat with w in windows
      set wn to name of w
      if wn is missing value then set wn to "-"
      set out to out & "WINDOW|" & wn & linefeed
      try
        set els to entire contents of w
        repeat with e in els
          try
            set r to role of e
            if r is "AXButton" or r is "AXMenuButton" or r is "AXPopUpButton" or r is "AXCheckBox" or r is "AXRadioButton" then
              set nm to name of e
              if nm is missing value then set nm to ""
              set ds to description of e
              if ds is missing value then set ds to ""
              set hp to help of e
              if hp is missing value then set hp to ""
              set tt to title of e
              if tt is missing value then set tt to ""
              set out to out & "BTN|" & r & "|" & nm & "|" & ds & "|" & hp & "|" & tt & linefeed
            end if
          end try
        end repeat
      end try
    end repeat
    return out
  end tell
end tell
'''

print("== processes:", sh(["pgrep", "-lf", "Simulator.app/Contents/MacOS/Simulator"])[1][:300])
print("== front app:", osa('tell application "System Events" to get name of first process whose frontmost is true'))
print("== bring to front:", front())
time.sleep(2)
code, out, err = osa(DUMP, 90)
print("== menu dump code", code, "err", err[:300])
menus, cur, item = [], None, None
for line in out.splitlines():
    kind, _, name = line.partition("|")
    if kind == "MENU":
        cur = name
    elif kind == "ITEM":
        item = name
        menus.append((cur, name, None))
    elif kind == "SUB":
        menus.append((cur, item, name))
for m in menus:
    print("   ", " > ".join(x for x in m if x))

code, out, err = osa('tell application "System Events" to tell process "Simulator" to get name of every window', 30)
print("== windows:", code, out[:600], err[:300])
code, out, err = osa(BUTTONS, 120)
print("== window buttons code", code, "err", err[:300])
buttons = []
for line in out.splitlines():
    parts = line.split("|")
    if parts[0] == "WINDOW":
        print("    window:", parts[1])
    elif parts[0] == "BTN":
        buttons.append(parts[1:])
        print("    button:", parts[1:])

before = screen()
print("== screen before:", before)
done = None
if unfolded(before):
    done = ("already unfolded",)

STRONG = re.compile(r"unfold|fold|postur|hinge|angle|flex|flat|tent|book|half|pose|open|close|expand|inner|inside|cover", re.I)
AVOID = re.compile(r"log|external|keyboard|url|file|simulator|recent|window|erase|restart|shake|siri|lock|home|app switcher|screenshot|record", re.I)
SKIP_MENUS = {"Apple", "Simulator", "File", "Edit", "Window", "Help", "View"}


def words(m):
    return " ".join(x for x in m[1:] if x)


def rank(m):
    w = words(m)
    if re.search(r"unfold", w, re.I): return 0
    if re.search(r"fold|postur|hinge|flat|flex|angle", w, re.I): return 1
    if re.search(r"open|expand|inner|inside", w, re.I): return 2
    return 3


cands = [m for m in menus if m[0] not in SKIP_MENUS and STRONG.search(words(m)) and not AVOID.search(words(m))]
cands.sort(key=rank)
print("== menu candidates:", cands)
for menu, it, sub in ([] if done else cands[:12]):
    if sub:
        script = 'tell application "System Events" to tell process "Simulator" to click menu item "%s" of menu 1 of menu item "%s" of menu 1 of menu bar item "%s" of menu bar 1' % (sub, it, menu)
    else:
        script = 'tell application "System Events" to tell process "Simulator" to click menu item "%s" of menu 1 of menu bar item "%s" of menu bar 1' % (it, menu)
    front()
    res = osa(script)
    time.sleep(4)
    osa('tell application "System Events" to key code 53')   # a menu item that only opened a submenu or a sheet: close it
    now = screen()
    print("== clicked menu", (menu, it, sub), "->", res, "screen now", now)
    if unfolded(now):
        done = (menu, it, sub)
        break

if not done:
    bc = [b for b in buttons if re.search(r"fold|postur|hinge|open|expand", " ".join(b[1:]), re.I) and not AVOID.search(" ".join(b[1:]))]
    print("== button candidates:", bc)
    for b in bc[:6]:
        idx = [i for i, x in enumerate(b[1:]) if x][0]
        key, field = b[1:][idx], ["name", "description", "help", "title"][idx]
        script = '''
tell application "System Events"
  tell process "Simulator"
    repeat with w in windows
      repeat with e in (entire contents of w)
        try
          if (role of e is "%s") and (%s of e is "%s") then
            click e
            return "clicked"
          end if
        end try
      end repeat
    end repeat
    return "not found"
  end tell
end tell
''' % (b[0], field, key.replace('"', '\\"'))
        front()
        res = osa(script, 90)
        time.sleep(4)
        now = screen()
        print("== clicked button", b, "->", res, "screen now", now)
        if unfolded(now):
            done = ("button", key)
            break

print("== UNFOLDED BY:", done)
print("== prefs:", sh(["defaults", "read", "com.apple.iphonesimulator"])[1][:2500])
