# Shared by the steps of the one-off check: run the probe app in one mode, print its notes and screenshots.
BID=com.surviveastorm.duoprobe
shot() {
  for d in 1 3; do
    f="$1-d$d"
    if xcrun simctl io "$UDID" screenshot --display=$d --type=png "$f.png" >/dev/null 2>shot.err; then
      sips -s format jpeg -s formatOptions 42 -Z 1000 "$f.png" --out "$f.jpg" >/dev/null 2>&1 || { echo "no jpeg $f"; continue; }
      size=$(stat -f %z "$f.jpg")
      sum=$(md5 -q "$f.jpg")
      if [ "$size" -lt 9000 ]; then echo "display $d for $1: blank ($size bytes)"; continue; fi
      if [ "$d" = 3 ] && [ "$sum" = "$(cat last-d3.md5 2>/dev/null)" ]; then echo "display 3 for $1: unchanged"; continue; fi
      [ "$d" = 3 ] && echo "$sum" > last-d3.md5
      echo "===SHOT $f $(sips -g pixelWidth -g pixelHeight "$f.png" | tail -2 | tr '\n' ' ')==="; base64 -b 76 -i "$f.jpg"; echo "===END $f==="
    else echo "display $d for $1: no screenshot: $(head -c 160 shot.err | tr '\n' ' ')"; fi
  done
}
macshot() {
  if screencapture -x "$1.png" 2>shot.err; then
    sips -s format jpeg -s formatOptions 40 -Z 1500 "$1.png" --out "$1.jpg" >/dev/null 2>&1 || return 0
    echo "===SHOT $1 $(sips -g pixelWidth -g pixelHeight "$1.png" | tail -2 | tr '\n' ' ')==="; base64 -b 76 -i "$1.jpg"; echo "===END $1==="
  else echo "no Mac screenshot: $(head -c 200 shot.err)"; fi
}
run() {
  label="$1"; shift
  xcrun simctl terminate "$UDID" $BID 2>/dev/null || true
  DATA=$(xcrun simctl get_app_container "$UDID" $BID data 2>/dev/null) && rm -f "$DATA/Documents/result.txt"
  xcrun simctl launch "$UDID" $BID "$@" || echo "launch failed"
  sleep "${WAIT:-9}"
  DATA=$(xcrun simctl get_app_container "$UDID" $BID data)
  echo "--- result $label"
  grep -v -E "LayoutRegionWithCornerAdaptation|selectors |\[t\+0\.05\]|\[t\+1\.20\]|\[t\+6\.00\]|\"why\":\"(extra|after-extra|vv-resize)\"" "$DATA/Documents/result.txt" || echo "(no result file)"
  shot "$label"
}
# --- the iPhone Duo's two screens and Device Hub's buttons
inner_live() { # true when the inside screen (display 3) shows a picture; a dark screen makes a tiny file
  rm -f d3.png
  xcrun simctl io "$UDID" screenshot --display=3 --type=png d3.png >/dev/null 2>&1 || return 1
  [ "$(stat -f %z d3.png 2>/dev/null || echo 0)" -gt 150000 ]
}
outer_live() {
  rm -f d1.png
  xcrun simctl io "$UDID" screenshot --display=1 --type=png d1.png >/dev/null 2>&1 || return 1
  [ "$(stat -f %z d1.png 2>/dev/null || echo 0)" -gt 100000 ]
}
screens() { echo "inside screen: $(inner_live && echo on || echo dark) ($(stat -f %z d3.png 2>/dev/null || echo -) bytes), outside screen: $(outer_live && echo on || echo dark) ($(stat -f %z d1.png 2>/dev/null || echo -) bytes)"; }
size_now() { # "<width> <height>" in points of the screen the probe app was last shown on
  local data; data=$(xcrun simctl get_app_container "$UDID" $BID data 2>/dev/null) || return 0
  sed -n -E 's/.* screen x[0-9.]+ y[0-9.]+ w([0-9]+)\.[0-9] h([0-9]+)\.[0-9] .*/\1 \2/p' "$data/Documents/result.txt" 2>/dev/null | tail -1
}
sideways() { set -- $(size_now); [ -n "$2" ] && [ "$1" -gt "$2" ]; }
hub() { # press one of Device Hub's buttons by its label (of several, the one next to the fold buttons); if it cannot be pressed, click it
  ./ax "$HUBPID" press "$1" "Partially Open" </dev/null && return 0
  open "$HUB" 2>/dev/null; sleep 2
  ./ax "$HUBPID" click "$1" "Partially Open" </dev/null
}
