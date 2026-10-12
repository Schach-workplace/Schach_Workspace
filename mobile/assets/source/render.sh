#!/bin/sh
# Re-render app icons/splash from these SVG sources (run from mobile/assets/source).
set -e
out=..
for n in icon splash-icon android-icon-foreground android-icon-background android-icon-monochrome; do
  rsvg-convert -w 1024 -h 1024 "$n.svg" -o "$out/$n.png"
done
# iOS rejects icons with an alpha channel.
magick "$out/icon.png" -background '#faf9f6' -alpha remove -alpha off "$out/icon.png"
rsvg-convert -w 48 -h 48 icon.svg -o "$out/favicon.png"
