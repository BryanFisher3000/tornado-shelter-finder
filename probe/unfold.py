#!/usr/bin/env python3
"""One-off helper for the throwaway check: tries to unfold the iPhone Duo simulator through the
Simulator app's own menus (there is no command line switch for it), and prints what it finds.
Usage: unfold.py <udid> <probe bundle id>"""
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

print("== front app:", osa('tell application "System Events" to get name of first process whose frontmost is true'))
print("== activate:", osa('tell application "Simulator" to activate'))
time.sleep(2)
code, out, err = osa(DUMP, 60)
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

code, out, err = osa('tell application "System Events" to tell process "Simulator" to get {name, description, role description} of every UI element of window 1', 30)
print("== window 1 elements:", code, out[:1500], err[:300])
code, out, err = osa('tell application "System Events" to tell process "Simulator" to get {name, description} of every button of toolbar 1 of window 1', 30)
print("== toolbar buttons:", code, out[:1500], err[:300])
code, out, err = osa('tell application "System Events" to tell process "Simulator" to get name of every window', 30)
print("== windows:", code, out[:600], err[:300])

before = screen()
print("== screen before:", before)
WORDS = re.compile(r"unfold|fold|postur|flex|tent|flat|half|book|laptop|stand|open|close|hinge|angle|pose|display|screen", re.I)
SKIP_MENUS = {"Apple", "Simulator", "File", "Edit", "Window", "Help", "View"}
cands = [m for m in menus if m[0] not in SKIP_MENUS and WORDS.search(" ".join(x for x in m[1:] if x))]
# most promising first
cands.sort(key=lambda m: (0 if re.search(r"unfold|open", " ".join(x for x in m[1:] if x), re.I) else 1 if re.search(r"fold|postur|flat", " ".join(x for x in m[1:] if x), re.I) else 2))
print("== candidates:", cands)
done = None
for menu, it, sub in cands[:10]:
    if sub:
        script = 'tell application "System Events" to tell process "Simulator" to click menu item "%s" of menu 1 of menu item "%s" of menu 1 of menu bar item "%s" of menu bar 1' % (sub, it, menu)
    else:
        script = 'tell application "System Events" to tell process "Simulator" to click menu item "%s" of menu 1 of menu bar item "%s" of menu bar 1' % (it, menu)
    osa('tell application "Simulator" to activate')
    res = osa(script)
    time.sleep(4)
    # a menu item that only opened a submenu or a sheet: close it
    osa('tell application "System Events" to key code 53')
    now = screen()
    print("== clicked", (menu, it, sub), "->", res, "screen now", now)
    if now and before and now != before:
        done = (menu, it, sub)
        break
print("== UNFOLDED BY:", done)
print("== prefs:", sh(["defaults", "read", "com.apple.iphonesimulator"])[1][:3000])
